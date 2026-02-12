/**
 * TransformControls - Simplified gizmo for move/rotate/scale
 * ES6 class extending THREE.Object3D
 */
class TransformControlsImpl extends THREE.Object3D {
    constructor(camera, domElement) {
        super();

        this.camera = camera;
        this.domElement = domElement;
        this.enabled = true;
        this.mode = 'translate';
        this.space = 'world';
        this.snap = null;
        this.dragging = false;
        this.object = null;
        this.visible = false;

        // Event system
        this._tcListeners = {};

        const scope = this;
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();
        const pointStart = new THREE.Vector3();
        const pointEnd = new THREE.Vector3();
        const offset = new THREE.Vector3();
        const startPosition = new THREE.Vector3();
        const startRotation = new THREE.Euler();
        const startScale = new THREE.Vector3();
        let axis = null;
        let dragging = false;

        // Create gizmo visuals
        const gizmoGroup = new THREE.Group();
        this.add(gizmoGroup);

        const axisMaterials = {
            x: new THREE.MeshBasicMaterial({ color: 0xff4444, depthTest: false, transparent: true, opacity: 0.8 }),
            y: new THREE.MeshBasicMaterial({ color: 0x44ff44, depthTest: false, transparent: true, opacity: 0.8 }),
            z: new THREE.MeshBasicMaterial({ color: 0x4444ff, depthTest: false, transparent: true, opacity: 0.8 }),
        };

        const arrowGeom = new THREE.ConeGeometry(0.06, 0.2, 12);
        const lineGeom = new THREE.CylinderGeometry(0.02, 0.02, 1, 8);

        const translateGroup = new THREE.Group();
        const rotateGroup = new THREE.Group();
        const scaleGroup = new THREE.Group();

        function createTranslateAxis(dir, mat, parent) {
            const line = new THREE.Mesh(lineGeom, mat);
            const arrow = new THREE.Mesh(arrowGeom, mat);
            if (dir === 'x') {
                line.rotation.z = -Math.PI / 2; line.position.x = 0.5;
                arrow.rotation.z = -Math.PI / 2; arrow.position.x = 1.1;
            } else if (dir === 'y') {
                line.position.y = 0.5; arrow.position.y = 1.1;
            } else {
                line.rotation.x = Math.PI / 2; line.position.z = 0.5;
                arrow.rotation.x = Math.PI / 2; arrow.position.z = 1.1;
            }
            line.userData.axis = dir; arrow.userData.axis = dir;
            line.renderOrder = 999; arrow.renderOrder = 999;
            parent.add(line); parent.add(arrow);
        }

        createTranslateAxis('x', axisMaterials.x, translateGroup);
        createTranslateAxis('y', axisMaterials.y, translateGroup);
        createTranslateAxis('z', axisMaterials.z, translateGroup);

        const scaleHandleGeom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
        function createScaleAxis(dir, mat, parent) {
            const line = new THREE.Mesh(lineGeom, mat);
            const handle = new THREE.Mesh(scaleHandleGeom, mat);
            if (dir === 'x') {
                line.rotation.z = -Math.PI / 2; line.position.x = 0.5; handle.position.x = 1.05;
            } else if (dir === 'y') {
                line.position.y = 0.5; handle.position.y = 1.05;
            } else {
                line.rotation.x = Math.PI / 2; line.position.z = 0.5; handle.position.z = 1.05;
            }
            line.userData.axis = dir; handle.userData.axis = dir;
            line.renderOrder = 999; handle.renderOrder = 999;
            parent.add(line); parent.add(handle);
        }

        createScaleAxis('x', axisMaterials.x, scaleGroup);
        createScaleAxis('y', axisMaterials.y, scaleGroup);
        createScaleAxis('z', axisMaterials.z, scaleGroup);

        const torusGeom = new THREE.TorusGeometry(1, 0.02, 8, 48);
        function createRotateRing(dir, mat, parent) {
            const ring = new THREE.Mesh(torusGeom, mat);
            if (dir === 'x') ring.rotation.y = Math.PI / 2;
            else if (dir === 'z') ring.rotation.x = Math.PI / 2;
            ring.userData.axis = dir; ring.renderOrder = 999;
            parent.add(ring);
        }

        createRotateRing('x', axisMaterials.x, rotateGroup);
        createRotateRing('y', axisMaterials.y, rotateGroup);
        createRotateRing('z', axisMaterials.z, rotateGroup);

        gizmoGroup.add(translateGroup);
        gizmoGroup.add(rotateGroup);
        gizmoGroup.add(scaleGroup);

        const updateGizmoVisibility = () => {
            translateGroup.visible = this.mode === 'translate';
            rotateGroup.visible = this.mode === 'rotate';
            scaleGroup.visible = this.mode === 'scale';
        };
        updateGizmoVisibility();

        this.setMode = function(mode) {
            this.mode = mode;
            updateGizmoVisibility();
        };

        this.attach = function(object) {
            this.object = object;
            this.visible = true;
        };

        this.detach = function() {
            this.object = null;
            this.visible = false;
        };

        // Override updateMatrixWorld
        const originalUpdateMatrixWorld = THREE.Object3D.prototype.updateMatrixWorld;
        this.updateMatrixWorld = function(force) {
            if (this.object) {
                this.position.copy(this.object.position);
                const dist = this.camera.position.distanceTo(this.position);
                const s = dist * 0.15;
                gizmoGroup.scale.set(s, s, s);
            }
            originalUpdateMatrixWorld.call(this, force);
        };

        // Event helpers
        this.addEventListener = function(type, listener) {
            if (!this._tcListeners[type]) this._tcListeners[type] = [];
            if (this._tcListeners[type].indexOf(listener) === -1) this._tcListeners[type].push(listener);
        };
        this.removeEventListener = function(type, listener) {
            if (!this._tcListeners[type]) return;
            const idx = this._tcListeners[type].indexOf(listener);
            if (idx !== -1) this._tcListeners[type].splice(idx, 1);
        };
        this.dispatchEvent = function(event) {
            if (!this._tcListeners[event.type]) return;
            const arr = this._tcListeners[event.type].slice();
            for (let i = 0; i < arr.length; i++) arr[i].call(this, event);
        };

        // Interaction
        const plane = new THREE.Plane();
        const intersection = new THREE.Vector3();

        function getPointer(event) {
            const rect = domElement.getBoundingClientRect();
            mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        }

        function intersectGizmo(event) {
            getPointer(event);
            raycaster.setFromCamera(mouse, scope.camera);

            let activeGroup;
            if (scope.mode === 'translate') activeGroup = translateGroup;
            else if (scope.mode === 'rotate') activeGroup = rotateGroup;
            else activeGroup = scaleGroup;

            const allMeshes = [];
            activeGroup.traverse(child => { if (child.isMesh) allMeshes.push(child); });
            const hits = raycaster.intersectObjects(allMeshes, false);
            return hits.length > 0 ? hits[0] : null;
        }

        const onPointerDown = (event) => {
            if (!scope.enabled || !scope.object || event.button !== 0) return;
            const hit = intersectGizmo(event);
            if (!hit) return;

            event.preventDefault();
            event.stopPropagation();

            axis = hit.object.userData.axis;
            dragging = true;
            scope.dragging = true;
            startPosition.copy(scope.object.position);
            startRotation.copy(scope.object.rotation);
            startScale.copy(scope.object.scale);

            getPointer(event);
            raycaster.setFromCamera(mouse, scope.camera);

            const planeNormal = new THREE.Vector3();
            const eye = new THREE.Vector3().subVectors(scope.camera.position, scope.object.position).normalize();

            if (scope.mode === 'translate' || scope.mode === 'scale') {
                const axisDir = new THREE.Vector3(
                    axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0
                );
                const cross = new THREE.Vector3().crossVectors(axisDir, eye);
                planeNormal.crossVectors(axisDir, cross).normalize();
            } else {
                if (axis === 'x') planeNormal.set(1, 0, 0);
                else if (axis === 'y') planeNormal.set(0, 1, 0);
                else planeNormal.set(0, 0, 1);
            }

            plane.setFromNormalAndCoplanarPoint(planeNormal, scope.object.position);
            if (raycaster.ray.intersectPlane(plane, intersection)) pointStart.copy(intersection);

            scope.dispatchEvent({ type: 'dragging-changed', value: true });
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        };

        const onPointerMove = (event) => {
            if (!dragging || !scope.object) return;
            getPointer(event);
            raycaster.setFromCamera(mouse, scope.camera);
            if (!raycaster.ray.intersectPlane(plane, intersection)) return;
            pointEnd.copy(intersection);

            if (scope.mode === 'translate') {
                offset.subVectors(pointEnd, pointStart);
                if (axis === 'x') offset.y = offset.z = 0;
                else if (axis === 'y') offset.x = offset.z = 0;
                else offset.x = offset.y = 0;
                const newPos = startPosition.clone().add(offset);
                if (scope.snap) {
                    if (axis === 'x') newPos.x = Math.round(newPos.x / scope.snap) * scope.snap;
                    if (axis === 'y') newPos.y = Math.round(newPos.y / scope.snap) * scope.snap;
                    if (axis === 'z') newPos.z = Math.round(newPos.z / scope.snap) * scope.snap;
                }
                scope.object.position.copy(newPos);
            } else if (scope.mode === 'scale') {
                offset.subVectors(pointEnd, pointStart);
                let sf;
                if (axis === 'x') sf = 1 + offset.x;
                else if (axis === 'y') sf = 1 + offset.y;
                else sf = 1 + offset.z;
                sf = Math.max(0.1, sf);
                const newScale = startScale.clone();
                if (axis === 'x') newScale.x = startScale.x * sf;
                else if (axis === 'y') newScale.y = startScale.y * sf;
                else newScale.z = startScale.z * sf;
                scope.object.scale.copy(newScale);
            } else if (scope.mode === 'rotate') {
                const dir1 = new THREE.Vector3().subVectors(pointStart, scope.object.position).normalize();
                const dir2 = new THREE.Vector3().subVectors(pointEnd, scope.object.position).normalize();
                let angle;
                if (axis === 'x') { angle = Math.atan2(dir2.z, dir2.y) - Math.atan2(dir1.z, dir1.y); scope.object.rotation.x = startRotation.x + angle; }
                else if (axis === 'y') { angle = Math.atan2(dir2.x, dir2.z) - Math.atan2(dir1.x, dir1.z); scope.object.rotation.y = startRotation.y + angle; }
                else { angle = Math.atan2(dir2.y, dir2.x) - Math.atan2(dir1.y, dir1.x); scope.object.rotation.z = startRotation.z + angle; }
                if (scope.snap) {
                    const sa = THREE.MathUtils.degToRad(15);
                    if (axis === 'x') scope.object.rotation.x = Math.round(scope.object.rotation.x / sa) * sa;
                    if (axis === 'y') scope.object.rotation.y = Math.round(scope.object.rotation.y / sa) * sa;
                    if (axis === 'z') scope.object.rotation.z = Math.round(scope.object.rotation.z / sa) * sa;
                }
            }
            scope.dispatchEvent({ type: 'objectChange' });
        };

        const onPointerUp = () => {
            dragging = false;
            scope.dragging = false;
            axis = null;
            scope.dispatchEvent({ type: 'dragging-changed', value: false });
            document.removeEventListener('pointermove', onPointerMove);
            document.removeEventListener('pointerup', onPointerUp);
        };

        domElement.addEventListener('pointerdown', onPointerDown);

        this.dispose = function() {
            domElement.removeEventListener('pointerdown', onPointerDown);
        };
    }
}

THREE.TransformControls = TransformControlsImpl;
