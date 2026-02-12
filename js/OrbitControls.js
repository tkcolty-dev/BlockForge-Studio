/**
 * OrbitControls - Three.js r128 compatible
 * Simplified but fully functional orbit camera controls
 */
THREE.OrbitControls = function(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;
    this.target = new THREE.Vector3();
    this.minDistance = 1;
    this.maxDistance = 500;
    this.minPolarAngle = 0;
    this.maxPolarAngle = Math.PI;
    this.enableDamping = true;
    this.dampingFactor = 0.08;
    this.enableZoom = true;
    this.zoomSpeed = 1.0;
    this.enableRotate = true;
    this.rotateSpeed = 0.8;
    this.enablePan = true;
    this.panSpeed = 1.0;
    this.enableKeys = true;

    const scope = this;
    const STATE = { NONE: -1, ROTATE: 0, DOLLY: 1, PAN: 2 };
    let state = STATE.NONE;

    const spherical = new THREE.Spherical();
    const sphericalDelta = new THREE.Spherical();
    const panOffset = new THREE.Vector3();
    let scale = 1;

    const rotateStart = new THREE.Vector2();
    const rotateEnd = new THREE.Vector2();
    const rotateDelta = new THREE.Vector2();
    const panStart = new THREE.Vector2();
    const panEnd = new THREE.Vector2();
    const panDelta = new THREE.Vector2();
    const dollyStart = new THREE.Vector2();
    const dollyEnd = new THREE.Vector2();
    const dollyDelta = new THREE.Vector2();

    function getZoomScale() {
        return Math.pow(0.95, scope.zoomSpeed);
    }

    const panLeft = (function() {
        const v = new THREE.Vector3();
        return function(distance, objectMatrix) {
            v.setFromMatrixColumn(objectMatrix, 0);
            v.multiplyScalar(-distance);
            panOffset.add(v);
        };
    })();

    const panUp = (function() {
        const v = new THREE.Vector3();
        return function(distance, objectMatrix) {
            v.setFromMatrixColumn(objectMatrix, 1);
            v.multiplyScalar(distance);
            panOffset.add(v);
        };
    })();

    const pan = (function() {
        const offset = new THREE.Vector3();
        return function(deltaX, deltaY) {
            const element = scope.domElement;
            offset.copy(scope.camera.position).sub(scope.target);
            let targetDistance = offset.length();
            targetDistance *= Math.tan((scope.camera.fov / 2) * Math.PI / 180.0);
            panLeft(2 * deltaX * targetDistance / element.clientHeight, scope.camera.matrix);
            panUp(2 * deltaY * targetDistance / element.clientHeight, scope.camera.matrix);
        };
    })();

    this.update = (function() {
        const offset = new THREE.Vector3();
        const quat = new THREE.Quaternion().setFromUnitVectors(
            camera.up, new THREE.Vector3(0, 1, 0)
        );
        const quatInverse = quat.clone().invert();
        const lastPosition = new THREE.Vector3();
        const lastQuaternion = new THREE.Quaternion();

        return function() {
            const position = scope.camera.position;
            offset.copy(position).sub(scope.target);
            offset.applyQuaternion(quat);
            spherical.setFromVector3(offset);

            spherical.theta += sphericalDelta.theta;
            spherical.phi += sphericalDelta.phi;
            spherical.phi = Math.max(scope.minPolarAngle, Math.min(scope.maxPolarAngle, spherical.phi));
            spherical.makeSafe();
            spherical.radius *= scale;
            spherical.radius = Math.max(scope.minDistance, Math.min(scope.maxDistance, spherical.radius));

            scope.target.add(panOffset);
            offset.setFromSpherical(spherical);
            offset.applyQuaternion(quatInverse);
            position.copy(scope.target).add(offset);
            scope.camera.lookAt(scope.target);

            if (scope.enableDamping) {
                sphericalDelta.theta *= (1 - scope.dampingFactor);
                sphericalDelta.phi *= (1 - scope.dampingFactor);
                panOffset.multiplyScalar(1 - scope.dampingFactor);
            } else {
                sphericalDelta.set(0, 0, 0);
                panOffset.set(0, 0, 0);
            }

            scale = 1;

            if (lastPosition.distanceToSquared(scope.camera.position) > 0.000001 ||
                8 * (1 - lastQuaternion.dot(scope.camera.quaternion)) > 0.000001) {
                lastPosition.copy(scope.camera.position);
                lastQuaternion.copy(scope.camera.quaternion);
                return true;
            }
            return false;
        };
    })();

    function onPointerDown(event) {
        if (!scope.enabled) return;
        switch (event.button) {
            case 0: // left
                if (event.ctrlKey || event.metaKey) {
                    state = STATE.PAN;
                    panStart.set(event.clientX, event.clientY);
                } else {
                    state = STATE.ROTATE;
                    rotateStart.set(event.clientX, event.clientY);
                }
                break;
            case 1: // middle
                state = STATE.DOLLY;
                dollyStart.set(event.clientX, event.clientY);
                break;
            case 2: // right
                state = STATE.PAN;
                panStart.set(event.clientX, event.clientY);
                break;
        }
        if (state !== STATE.NONE) {
            document.addEventListener('pointermove', onPointerMove);
            document.addEventListener('pointerup', onPointerUp);
        }
    }

    function onPointerMove(event) {
        if (!scope.enabled) return;
        switch (state) {
            case STATE.ROTATE:
                rotateEnd.set(event.clientX, event.clientY);
                rotateDelta.subVectors(rotateEnd, rotateStart).multiplyScalar(scope.rotateSpeed);
                const el = scope.domElement;
                sphericalDelta.theta -= 2 * Math.PI * rotateDelta.x / el.clientHeight;
                sphericalDelta.phi -= 2 * Math.PI * rotateDelta.y / el.clientHeight;
                rotateStart.copy(rotateEnd);
                break;
            case STATE.DOLLY:
                dollyEnd.set(event.clientX, event.clientY);
                dollyDelta.subVectors(dollyEnd, dollyStart);
                if (dollyDelta.y > 0) { scale *= getZoomScale(); }
                else if (dollyDelta.y < 0) { scale /= getZoomScale(); }
                dollyStart.copy(dollyEnd);
                break;
            case STATE.PAN:
                panEnd.set(event.clientX, event.clientY);
                panDelta.subVectors(panEnd, panStart).multiplyScalar(scope.panSpeed);
                pan(panDelta.x, panDelta.y);
                panStart.copy(panEnd);
                break;
        }
    }

    function onPointerUp() {
        state = STATE.NONE;
        document.removeEventListener('pointermove', onPointerMove);
        document.removeEventListener('pointerup', onPointerUp);
    }

    function onWheel(event) {
        if (!scope.enabled || !scope.enableZoom) return;
        event.preventDefault();
        if (event.deltaY > 0) { scale *= getZoomScale(); }
        else if (event.deltaY < 0) { scale /= getZoomScale(); }
    }

    this.dispose = function() {
        domElement.removeEventListener('pointerdown', onPointerDown);
        domElement.removeEventListener('wheel', onWheel);
        domElement.removeEventListener('contextmenu', onContextMenu);
    };

    function onContextMenu(event) {
        event.preventDefault();
    }

    domElement.addEventListener('pointerdown', onPointerDown);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    domElement.addEventListener('contextmenu', onContextMenu);

    this.update();
};
