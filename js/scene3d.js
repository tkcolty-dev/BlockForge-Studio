/**
 * Scene3D - Core 3D scene management for BlockForge Studio
 * Handles rendering, objects, selection, and camera
 */
class Scene3D {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.objects = [];
        this.selectedObject = null;
        this.selectedObjects = [];
        this.nextId = 1;
        this.snapEnabled = true;
        this.snapSize = 0.5;
        this.currentTool = 'select';
        this.isPlaying = false;
        this.viewerMode = !!options.viewerMode;

        this.initRenderer();
        this.initScene();
        this.initCamera();
        this.initLights();

        if (!this.viewerMode) {
            this.initGrid();
            this.initSky();
            this.initControls();
            this.initRaycaster();
            this.initViewCube();
            this.initDefaultScene();
        } else {
            this.initSky();
            this.initViewerControls();
        }

        this.onObjectSelected = null;
        this.onObjectDeselected = null;
        this.onObjectChanged = null;
        this.onMultiSelect = null;
        this.onObjectAdded = null;
        this.onObjectRemoved = null;
        this._collabIdCounter = 0;

        // Render-on-demand: dirty flag
        this._needsRender = true;

        this.animate();
        window.addEventListener('resize', () => { this.onResize(); this._needsRender = true; });
        this.onResize();
    }

    initViewerControls() {
        this.orbitControls = new THREE.OrbitControls(this.camera, this.canvas);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.08;
        this.orbitControls.target.set(0, 0, 0);
        this.orbitControls.minDistance = 1;
        this.orbitControls.maxDistance = 100;

        this.canvas.addEventListener('pointerdown', () => { this._needsRender = true; });
        this.canvas.addEventListener('pointermove', () => { this._needsRender = true; });
        this.canvas.addEventListener('wheel', () => { this._needsRender = true; });
    }

    initRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: false
        });
        this._graphicsQuality = 'high';
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputEncoding = THREE.sRGBEncoding;
        this.renderer.setClearColor(0x1a1a2e);
    }

    initScene() {
        this.scene = new THREE.Scene();
        this.scene.fog = null;
    }

    initCamera() {
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
        this.camera.position.set(12, 10, 12);
        this.camera.lookAt(0, 0, 0);
    }

    initLights() {
        // Ambient
        this.ambientLight = new THREE.AmbientLight(0x6688cc, 0.5);
        this.scene.add(this.ambientLight);

        // Hemisphere
        this.hemisphereLight = new THREE.HemisphereLight(0x87CEEB, 0x362d1e, 0.4);
        this.scene.add(this.hemisphereLight);

        // Directional (sun)
        this.sunLight = new THREE.DirectionalLight(0xffffff, 0.8);
        this.sunLight.position.set(15, 25, 15);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.near = 0.5;
        this.sunLight.shadow.camera.far = 120;
        this.sunLight.shadow.camera.left = -35;
        this.sunLight.shadow.camera.right = 35;
        this.sunLight.shadow.camera.top = 35;
        this.sunLight.shadow.camera.bottom = -35;
        this.sunLight.shadow.bias = -0.003;
        this.sunLight.shadow.normalBias = 0.02;
        this.sunLight.shadow.radius = 2;
        this.scene.add(this.sunLight);
    }

    initGrid() {
        // Main grid
        this.gridHelper = new THREE.GridHelper(100, 100, 0x3a3a5c, 0x2a2a44);
        this.gridHelper.position.y = 0;
        this.scene.add(this.gridHelper);

        // Center axes
        const axisSize = 50;
        const axesMat = {
            x: new THREE.LineBasicMaterial({ color: 0xff4444, opacity: 0.4, transparent: true }),
            z: new THREE.LineBasicMaterial({ color: 0x4444ff, opacity: 0.4, transparent: true })
        };

        const xPoints = [new THREE.Vector3(-axisSize, 0.01, 0), new THREE.Vector3(axisSize, 0.01, 0)];
        const zPoints = [new THREE.Vector3(0, 0.01, -axisSize), new THREE.Vector3(0, 0.01, axisSize)];

        this.axisLineX = new THREE.Line(new THREE.BufferGeometry().setFromPoints(xPoints), axesMat.x);
        this.axisLineZ = new THREE.Line(new THREE.BufferGeometry().setFromPoints(zPoints), axesMat.z);
        this.scene.add(this.axisLineX);
        this.scene.add(this.axisLineZ);

        // Ground plane (for shadows and base)
        const groundGeo = new THREE.PlaneGeometry(100, 100);
        const groundMat = new THREE.ShadowMaterial({ opacity: 0.15 });
        this.groundPlane = new THREE.Mesh(groundGeo, groundMat);
        this.groundPlane.rotation.x = -Math.PI / 2;
        this.groundPlane.receiveShadow = true;
        this.groundPlane.userData.isGround = true;
        this.scene.add(this.groundPlane);
    }

    setGridVisible(visible) {
        if (this.gridHelper) this.gridHelper.visible = visible;
        if (this.axisLineX) this.axisLineX.visible = visible;
        if (this.axisLineZ) this.axisLineZ.visible = visible;
        this._needsRender = true;
    }

    initSky() {
        // Sky gradient
        const skyGeo = new THREE.SphereGeometry(400, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: new THREE.Color(0x0077ff) },
                bottomColor: { value: new THREE.Color(0x1a1a2e) },
                offset: { value: 20 },
                exponent: { value: 0.4 }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this.sky = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this.sky);
    }

    initControls() {
        this.orbitControls = new THREE.OrbitControls(this.camera, this.canvas);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.08;
        this.orbitControls.target.set(0, 0, 0);
        this.orbitControls.enableRotate = false;

        // Mark dirty on any pointer interaction (covers orbit, pan, zoom)
        this.canvas.addEventListener('pointerdown', () => { this._needsRender = true; });
        this.canvas.addEventListener('wheel', () => { this._needsRender = true; });

        this.transformControls = new THREE.TransformControls(this.camera, this.canvas);
        this.scene.add(this.transformControls);

        this.transformControls.addEventListener('dragging-changed', (e) => {
            this.orbitControls.enabled = !e.value;
            this._needsRender = true;
        });

        this.transformControls.addEventListener('objectChange', () => {
            this._needsRender = true;
            if (this.onObjectChanged && this.selectedObject) {
                this.onObjectChanged(this.selectedObject);
            }
        });
    }

    initRaycaster() {
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Drag state
        this._isDragging = false;
        this._dragObject = null;
        this._dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this._dragOffset = new THREE.Vector3();
        this._dragIntersect = new THREE.Vector3();
        this._pointerDownPos = new THREE.Vector2();

        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    }

    initDefaultScene() {
        // Create a base platform
        const platform = this.addObject('box', {
            name: 'Baseplate',
            position: { x: 0, y: -0.25, z: 0 },
            scale: { x: 20, y: 0.5, z: 20 },
            color: '#4a7c3f',
            anchored: true
        });

        // Spawn point indicator
        this.addObject('spawn', {
            name: 'SpawnPoint',
            position: { x: 0, y: 0.5, z: 0 }
        });
    }

    // ===== ViewCube =====

    initViewCube() {
        const container = this.canvas.parentElement;

        const wrapper = document.createElement('div');
        wrapper.className = 'viewcube-wrapper';

        const cube = document.createElement('div');
        cube.className = 'viewcube';
        this._viewCube = cube;

        const faces = [
            { name: 'FRONT', transform: 'translateZ(30px)' },
            { name: 'BACK', transform: 'rotateY(180deg) translateZ(30px)' },
            { name: 'RIGHT', transform: 'rotateY(90deg) translateZ(30px)' },
            { name: 'LEFT', transform: 'rotateY(-90deg) translateZ(30px)' },
            { name: 'TOP', transform: 'rotateX(90deg) translateZ(30px)' },
            { name: 'BOTTOM', transform: 'rotateX(-90deg) translateZ(30px)' }
        ];

        faces.forEach(face => {
            const el = document.createElement('div');
            el.className = 'viewcube-face';
            el.textContent = face.name;
            el.style.transform = face.transform;
            cube.appendChild(el);
        });

        wrapper.appendChild(cube);
        container.appendChild(wrapper);

        this._setupViewCubeDrag(wrapper);
    }

    _setupViewCubeDrag(wrapper) {
        let startX, startY, dragging;

        wrapper.addEventListener('pointerdown', (e) => {
            startX = e.clientX;
            startY = e.clientY;
            dragging = false;
            this._lastCubeX = e.clientX;
            this._lastCubeY = e.clientY;
            e.preventDefault();

            const onMove = (ev) => {
                if (!dragging && (Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3)) {
                    dragging = true;
                }
                if (dragging) {
                    const dx = ev.clientX - this._lastCubeX;
                    const dy = ev.clientY - this._lastCubeY;
                    this._orbitByDelta(-dx * 0.01, dy * 0.01);
                }
                this._lastCubeX = ev.clientX;
                this._lastCubeY = ev.clientY;
            };

            const onUp = (ev) => {
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                if (!dragging) {
                    const el = document.elementFromPoint(ev.clientX, ev.clientY);
                    if (el && el.classList.contains('viewcube-face')) {
                        this._snapToView(el.textContent.trim());
                    }
                }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    _orbitByDelta(dTheta, dPhi) {
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.orbitControls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta += dTheta;
        sph.phi += dPhi;
        sph.phi = THREE.MathUtils.clamp(sph.phi, 0.05, Math.PI - 0.05);
        offset.setFromSpherical(sph);
        this.camera.position.copy(this.orbitControls.target).add(offset);
        this.camera.lookAt(this.orbitControls.target);
        this._needsRender = true;
    }

    _snapToView(viewName) {
        const dist = this.camera.position.distanceTo(this.orbitControls.target);
        const t = this.orbitControls.target;
        switch (viewName) {
            case 'FRONT':
                this.camera.position.set(t.x, t.y, t.z + dist);
                break;
            case 'BACK':
                this.camera.position.set(t.x, t.y, t.z - dist);
                break;
            case 'RIGHT':
                this.camera.position.set(t.x + dist, t.y, t.z);
                break;
            case 'LEFT':
                this.camera.position.set(t.x - dist, t.y, t.z);
                break;
            case 'TOP':
                this.camera.position.set(t.x, t.y + dist, t.z + 0.001);
                break;
            case 'BOTTOM':
                this.camera.position.set(t.x, t.y - dist, t.z + 0.001);
                break;
        }
        this.camera.lookAt(t);
        this._needsRender = true;
    }

    _updateViewCube() {
        if (!this._viewCube) return;
        const offset = new THREE.Vector3().subVectors(this.camera.position, this.orbitControls.target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        const rotX = -(sph.phi - Math.PI / 2);
        const rotY = -sph.theta;
        this._viewCube.style.transform = `rotateX(${rotX}rad) rotateY(${rotY}rad)`;
    }

    // ===== Object Management =====

    addObject(type, options = {}) {
        let mesh;
        const color = options.color || '#4a90d9';
        const material = new THREE.MeshStandardMaterial({
            color: new THREE.Color(color),
            roughness: 0.6,
            metalness: 0.1
        });

        switch (type) {
            case 'box':
                mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
                break;
            case 'sphere':
                mesh = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 12), material);
                break;
            case 'cylinder':
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 16), material);
                break;
            case 'cone':
                mesh = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1, 16), material);
                break;
            case 'plane':
                mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
                mesh.rotation.x = -Math.PI / 2;
                break;
            case 'torus':
                mesh = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.15, 12, 24), material);
                break;
            case 'wedge': {
                const shape = new THREE.Shape();
                shape.moveTo(0, 0);
                shape.lineTo(1, 0);
                shape.lineTo(0, 1);
                shape.lineTo(0, 0);
                const extrudeSettings = { depth: 1, bevelEnabled: false };
                const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                geom.center();
                mesh = new THREE.Mesh(geom, material);
                break;
            }
            case 'stairs': {
                const stairGroup = new THREE.Group();
                const steps = 5;
                for (let i = 0; i < steps; i++) {
                    const step = new THREE.Mesh(
                        new THREE.BoxGeometry(2, 0.25, 0.5),
                        material.clone()
                    );
                    step.position.set(0, i * 0.25 + 0.125, -i * 0.5);
                    step.castShadow = true;
                    step.receiveShadow = true;
                    stairGroup.add(step);
                }
                mesh = stairGroup;
                break;
            }
            case 'pyramid': {
                const pyrGeom = new THREE.ConeGeometry(0.7, 1, 4);
                pyrGeom.rotateY(Math.PI / 4);
                mesh = new THREE.Mesh(pyrGeom, material);
                break;
            }
            case 'dome': {
                const domeGeom = new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
                mesh = new THREE.Mesh(domeGeom, material);
                break;
            }
            case 'arch': {
                const archGroup = new THREE.Group();
                // Left pillar
                const pillarL = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 0.3), material.clone());
                pillarL.position.set(-0.6, 0.75, 0);
                pillarL.castShadow = true; pillarL.receiveShadow = true;
                archGroup.add(pillarL);
                // Right pillar
                const pillarR = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.5, 0.3), material.clone());
                pillarR.position.set(0.6, 0.75, 0);
                pillarR.castShadow = true; pillarR.receiveShadow = true;
                archGroup.add(pillarR);
                // Curved top
                const archCurve = new THREE.Mesh(
                    new THREE.TorusGeometry(0.6, 0.15, 8, 16, Math.PI),
                    material.clone()
                );
                archCurve.position.set(0, 1.5, 0);
                archCurve.castShadow = true;
                archGroup.add(archCurve);
                mesh = archGroup;
                break;
            }
            case 'tube': {
                const tubeGeom = new THREE.TorusGeometry(0.5, 0.15, 12, 32);
                tubeGeom.rotateX(Math.PI / 2);
                mesh = new THREE.Mesh(tubeGeom, material);
                break;
            }
            case 'wall': {
                mesh = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 0.3), material);
                break;
            }
            case 'corner': {
                const cornerGroup = new THREE.Group();
                const wallA = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 0.3), material.clone());
                wallA.position.set(1, 1, 0);
                wallA.castShadow = true; wallA.receiveShadow = true;
                cornerGroup.add(wallA);
                const wallB = new THREE.Mesh(new THREE.BoxGeometry(0.3, 2, 2), material.clone());
                wallB.position.set(0, 1, 1);
                wallB.castShadow = true; wallB.receiveShadow = true;
                cornerGroup.add(wallB);
                mesh = cornerGroup;
                break;
            }
            case 'tree': {
                const treeGroup = new THREE.Group();
                // Trunk
                const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.9 });
                const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 1.2, 8), trunkMat);
                trunk.position.y = 0.6;
                trunk.castShadow = true;
                treeGroup.add(trunk);
                // Foliage layers
                const leafMat = new THREE.MeshStandardMaterial({ color: 0x27ae60, roughness: 0.8 });
                const foliage1 = new THREE.Mesh(new THREE.ConeGeometry(0.7, 1, 8), leafMat);
                foliage1.position.y = 1.5;
                foliage1.castShadow = true;
                treeGroup.add(foliage1);
                const foliage2 = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.8, 8), leafMat.clone());
                foliage2.position.y = 2.1;
                foliage2.castShadow = true;
                treeGroup.add(foliage2);
                mesh = treeGroup;
                break;
            }
            case 'house': {
                const houseGroup = new THREE.Group();
                // Walls
                const wallMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, roughness: 0.7 });
                const walls = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), wallMat);
                walls.position.y = 0.75;
                walls.castShadow = true; walls.receiveShadow = true;
                houseGroup.add(walls);
                // Roof
                const roofMat = new THREE.MeshStandardMaterial({ color: 0xc0392b, roughness: 0.6 });
                const roofGeom = new THREE.ConeGeometry(1.6, 1, 4);
                roofGeom.rotateY(Math.PI / 4);
                const roof = new THREE.Mesh(roofGeom, roofMat);
                roof.position.y = 2;
                roof.castShadow = true;
                houseGroup.add(roof);
                // Door
                const doorMat = new THREE.MeshStandardMaterial({ color: 0x6B4226 });
                const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.05), doorMat);
                door.position.set(0, 0.4, 1.03);
                houseGroup.add(door);
                mesh = houseGroup;
                break;
            }
            case 'platform': {
                const platMat = new THREE.MeshStandardMaterial({ color: 0x1abc9c, roughness: 0.5, metalness: 0.2 });
                mesh = new THREE.Mesh(new THREE.BoxGeometry(3, 0.3, 3), platMat);
                break;
            }
            case 'bridge': {
                const bridgeGroup = new THREE.Group();
                const plankMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.9 });
                // Planks
                for (let i = 0; i < 6; i++) {
                    const plank = new THREE.Mesh(new THREE.BoxGeometry(2, 0.1, 0.3), plankMat.clone());
                    plank.position.set(0, 0, i * 0.35 - 0.875);
                    plank.castShadow = true; plank.receiveShadow = true;
                    bridgeGroup.add(plank);
                }
                // Rails
                const railMat = new THREE.MeshStandardMaterial({ color: 0x6B4F12, roughness: 0.8 });
                const railL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 2.2), railMat);
                railL.position.set(-0.9, 0.3, 0);
                railL.castShadow = true;
                bridgeGroup.add(railL);
                const railR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.6, 2.2), railMat.clone());
                railR.position.set(0.9, 0.3, 0);
                railR.castShadow = true;
                bridgeGroup.add(railR);
                // Posts
                for (let s = -1; s <= 1; s += 2) {
                    for (let p = -1; p <= 1; p += 2) {
                        const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.1), railMat.clone());
                        post.position.set(s * 0.9, 0.25, p * 0.9);
                        post.castShadow = true;
                        bridgeGroup.add(post);
                    }
                }
                mesh = bridgeGroup;
                break;
            }
            case 'crate': {
                const crateMat = new THREE.MeshStandardMaterial({ color: 0xd4a24e, roughness: 0.85 });
                mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), crateMat);
                // Cross detail via edges
                const edgeMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.9 });
                const edgeH = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.06, 0.82), edgeMat);
                edgeH.position.y = 0;
                mesh.add(edgeH);
                const edgeV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.82, 0.82), edgeMat.clone());
                edgeV.position.x = 0;
                mesh.add(edgeV);
                break;
            }
            case 'gem': {
                const gemMat = new THREE.MeshStandardMaterial({
                    color: 0xe74c3c, roughness: 0.1, metalness: 0.6,
                    emissive: 0xe74c3c, emissiveIntensity: 0.15
                });
                const gemGeom = new THREE.OctahedronGeometry(0.3, 0);
                mesh = new THREE.Mesh(gemGeom, gemMat);
                break;
            }
            case 'spawn': {
                // Spawn point marker
                const spawnMat = new THREE.MeshStandardMaterial({
                    color: 0x2ecc71,
                    emissive: 0x2ecc71,
                    emissiveIntensity: 0.3,
                    transparent: true,
                    opacity: 0.6
                });
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 16), spawnMat);
                // Add arrow indicator
                const arrow = new THREE.Mesh(
                    new THREE.ConeGeometry(0.15, 0.5, 12),
                    new THREE.MeshStandardMaterial({ color: 0x2ecc71, emissive: 0x2ecc71, emissiveIntensity: 0.5 })
                );
                arrow.position.y = 0.8;
                mesh.add(arrow);
                break;
            }
            case 'light-point': {
                const lightMat = new THREE.MeshStandardMaterial({
                    color: 0xf1c40f,
                    emissive: 0xf1c40f,
                    emissiveIntensity: 0.8
                });
                mesh = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 8), lightMat);
                // Add actual point light (no shadow to avoid flicker)
                const pointLight = new THREE.PointLight(0xf1c40f, 1, 15);
                pointLight.castShadow = false;
                mesh.add(pointLight);
                break;
            }
            case 'coin': {
                const coinMat = new THREE.MeshStandardMaterial({
                    color: 0xf1c40f,
                    metalness: 0.8,
                    roughness: 0.2,
                    emissive: 0xf1c40f,
                    emissiveIntensity: 0.1
                });
                mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 16), coinMat);
                mesh.rotation.x = Math.PI / 2;
                break;
            }
            case 'npc': {
                const npcGroup = new THREE.Group();
                const npcBodyColor = options.childColors?.[0] || 0x3498db;
                const npcHeadColor = options.childColors?.[1] || 0xf5cba7;
                const npcLegColor = options.childColors?.[2] || 0x2c3e50;
                // Body
                const bodyMat = new THREE.MeshStandardMaterial({ color: npcBodyColor });
                const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.8, 0.4), bodyMat);
                body.position.y = 0.4;
                body.castShadow = true;
                npcGroup.add(body);
                // Head
                const headMat = new THREE.MeshStandardMaterial({ color: npcHeadColor });
                const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
                head.position.y = 1.05;
                head.castShadow = true;
                npcGroup.add(head);
                // Legs
                const legMat = new THREE.MeshStandardMaterial({ color: npcLegColor });
                const legL = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.4), legMat);
                legL.position.set(-0.15, -0.3, 0);
                legL.castShadow = true;
                npcGroup.add(legL);
                const legR = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.6, 0.4), legMat.clone());
                legR.position.set(0.15, -0.3, 0);
                legR.castShadow = true;
                npcGroup.add(legR);
                mesh = npcGroup;
                break;
            }
            case 'camera': {
                const camGroup = new THREE.Group();
                // Camera body
                const camBody = new THREE.Mesh(
                    new THREE.BoxGeometry(0.5, 0.35, 0.3),
                    new THREE.MeshStandardMaterial({ color: 0x8e44ad, roughness: 0.4, metalness: 0.3 })
                );
                camBody.castShadow = true;
                camGroup.add(camBody);
                // Lens
                const lens = new THREE.Mesh(
                    new THREE.CylinderGeometry(0.1, 0.12, 0.2, 12),
                    new THREE.MeshStandardMaterial({ color: 0x2c3e50, roughness: 0.2, metalness: 0.6 })
                );
                lens.rotation.x = Math.PI / 2;
                lens.position.set(0, 0, 0.22);
                lens.castShadow = true;
                camGroup.add(lens);
                // Lens glass
                const glass = new THREE.Mesh(
                    new THREE.CircleGeometry(0.09, 16),
                    new THREE.MeshStandardMaterial({ color: 0x5dade2, emissive: 0x5dade2, emissiveIntensity: 0.3, roughness: 0.1, metalness: 0.8 })
                );
                glass.position.set(0, 0, 0.33);
                camGroup.add(glass);
                // View direction indicator (cone pointing forward)
                const viewCone = new THREE.Mesh(
                    new THREE.ConeGeometry(0.3, 0.6, 4),
                    new THREE.MeshStandardMaterial({ color: 0x8e44ad, transparent: true, opacity: 0.2, emissive: 0x8e44ad, emissiveIntensity: 0.3 })
                );
                viewCone.rotation.x = -Math.PI / 2;
                viewCone.position.set(0, 0, 0.65);
                camGroup.add(viewCone);
                mesh = camGroup;
                break;
            }
            case 'custom': {
                const customGroup = new THREE.Group();
                const parts = options.customParts || [];
                parts.forEach(part => {
                    let partGeom;
                    switch (part.shape) {
                        case 'sphere': partGeom = new THREE.SphereGeometry(0.5, 16, 12); break;
                        case 'cylinder': partGeom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
                        case 'cone': partGeom = new THREE.ConeGeometry(0.5, 1, 16); break;
                        case 'pyramid': partGeom = new THREE.ConeGeometry(0.7, 1, 4); partGeom.rotateY(Math.PI / 4); break;
                        case 'dome': partGeom = new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); break;
                        case 'wedge': {
                            const ws = new THREE.Shape();
                            ws.moveTo(0, 0); ws.lineTo(1, 0); ws.lineTo(0, 1); ws.lineTo(0, 0);
                            partGeom = new THREE.ExtrudeGeometry(ws, { depth: 1, bevelEnabled: false });
                            partGeom.center();
                            break;
                        }
                        default: partGeom = new THREE.BoxGeometry(1, 1, 1); break;
                    }
                    const partMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(part.color || '#4a90d9'), roughness: 0.6, metalness: 0.1 });
                    const partMesh = new THREE.Mesh(partGeom, partMat);
                    partMesh.position.set(part.offset?.x || 0, part.offset?.y || 0, part.offset?.z || 0);
                    partMesh.scale.set(part.scale?.x || 1, part.scale?.y || 1, part.scale?.z || 1);
                    partMesh.castShadow = true;
                    partMesh.receiveShadow = true;
                    customGroup.add(partMesh);
                });
                mesh = customGroup;
                if (options.customObjectId) {
                    mesh.userData.customObjectId = options.customObjectId;
                }
                mesh.userData.customParts = parts;
                break;
            }
            default:
                mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
        }

        const id = this.nextId++;
        const name = options.name || `${type.charAt(0).toUpperCase() + type.slice(1)}_${id}`;

        // Setup mesh
        if (mesh.isMesh) {
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        } else {
            mesh.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });
        }

        // Apply transforms
        if (options.position) {
            mesh.position.set(
                options.position.x || 0,
                options.position.y || 0,
                options.position.z || 0
            );
        }
        if (options.scale) {
            mesh.scale.set(
                options.scale.x || 1,
                options.scale.y || 1,
                options.scale.z || 1
            );
        }
        if (options.rotation) {
            mesh.rotation.set(
                THREE.MathUtils.degToRad(options.rotation.x || 0),
                THREE.MathUtils.degToRad(options.rotation.y || 0),
                THREE.MathUtils.degToRad(options.rotation.z || 0)
            );
        }

        // Store metadata
        mesh.userData = {
            id: id,
            name: name,
            type: type,
            collabId: options.collabId || this._generateCollabId(),
            anchored: options.anchored !== undefined ? options.anchored : false,
            collidable: options.collidable !== undefined ? options.collidable : true,
            mass: options.mass || 1,
            locked: false,
            visible: true,
            scripts: [],
            isPrefab: ['spawn', 'light-point', 'coin', 'npc', 'tree', 'house', 'platform', 'bridge', 'crate', 'gem', 'camera', 'custom'].includes(type)
        };

        this.scene.add(mesh);
        this.objects.push(mesh);
        this._needsRender = true;

        if (this.onObjectAdded) {
            this.onObjectAdded(mesh);
        }

        return mesh;
    }

    removeObject(obj) {
        if (!obj) return;
        if (this.onObjectRemoved) {
            this.onObjectRemoved(obj);
        }
        this._needsRender = true;
        const idx = this.objects.indexOf(obj);
        if (idx !== -1) {
            this.objects.splice(idx, 1);
        }
        // Remove from multi-select array
        const multiIdx = this.selectedObjects.indexOf(obj);
        if (multiIdx !== -1) {
            this.removeMultiSelectHighlight(obj);
            this.selectedObjects.splice(multiIdx, 1);
        }
        if (this.selectedObject === obj) {
            this.deselect();
        }
        this.scene.remove(obj);

        // Dispose geometries and materials
        obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(m => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    duplicateObject(obj) {
        if (!obj) return null;

        const type = obj.userData.type;
        let color = '#4a90d9';
        if (obj.material && obj.material.color) {
            color = '#' + obj.material.color.getHexString();
        }

        const dup = this.addObject(type, {
            name: obj.userData.name + '_copy',
            position: {
                x: obj.position.x + 1,
                y: obj.position.y,
                z: obj.position.z + 1
            },
            scale: {
                x: obj.scale.x,
                y: obj.scale.y,
                z: obj.scale.z
            },
            color: color,
            anchored: obj.userData.anchored,
            collidable: obj.userData.collidable,
            mass: obj.userData.mass
        });

        dup.rotation.copy(obj.rotation);
        dup.userData.scripts = JSON.parse(JSON.stringify(obj.userData.scripts));

        // Copy material properties
        if (obj.material && dup.material) {
            dup.material.roughness = obj.material.roughness;
            dup.material.metalness = obj.material.metalness;
            dup.material.opacity = obj.material.opacity;
            dup.material.transparent = obj.material.transparent;
        }

        // Copy texture
        if (obj.userData.textureId && typeof TextureManager !== 'undefined') {
            const mgr = window._textureManager || (window._textureManager = new TextureManager());
            mgr.applyTexture(dup, obj.userData.textureId, obj.userData.tileScale || 1);
        }

        return dup;
    }

    // ===== Selection =====

    selectObject(obj) {
        if (this.selectedObject === obj) return;
        this.deselect();

        this.selectedObject = obj;
        if (this.transformControls) this.transformControls.attach(obj);
        this._needsRender = true;

        // Highlight
        this.addSelectionOutline(obj);

        if (this.onObjectSelected) {
            this.onObjectSelected(obj);
        }
    }

    deselect() {
        if (this.selectedObject) {
            this.removeSelectionOutline(this.selectedObject);
            this.selectedObject = null;
            if (this.transformControls) this.transformControls.detach();
            this._needsRender = true;

            if (this.onObjectDeselected) {
                this.onObjectDeselected();
            }
        }
    }

    addSelectionOutline(obj) {
        // Simple outline using wireframe overlay
        const createOutline = (mesh) => {
            if (!mesh.geometry) return;
            const outlineMat = new THREE.MeshBasicMaterial({
                color: 0x4c97ff,
                wireframe: true,
                transparent: true,
                opacity: 0.3
            });
            const outline = new THREE.Mesh(mesh.geometry.clone(), outlineMat);
            outline.scale.multiplyScalar(1.02);
            outline.userData.isOutline = true;
            outline.renderOrder = 998;
            mesh.add(outline);
        };

        if (obj.isMesh) {
            createOutline(obj);
        } else {
            obj.traverse(child => {
                if (child.isMesh && !child.userData.isOutline) {
                    createOutline(child);
                }
            });
        }
    }

    removeSelectionOutline(obj) {
        const toRemove = [];
        obj.traverse(child => {
            if (child.userData.isOutline) {
                toRemove.push(child);
            }
        });
        toRemove.forEach(outline => {
            if (outline.parent) outline.parent.remove(outline);
            if (outline.geometry) outline.geometry.dispose();
            if (outline.material) outline.material.dispose();
        });
    }

    // ===== Multi-Selection =====

    selectMultiple(obj) {
        if (!obj) return;
        const idx = this.selectedObjects.indexOf(obj);
        if (idx !== -1) {
            // Toggle off: remove from multi-select
            this.removeMultiSelectHighlight(obj);
            this.selectedObjects.splice(idx, 1);
            // If this was also the primary selected object, clear it
            if (this.selectedObject === obj) {
                this.removeSelectionOutline(obj);
                this.selectedObject = null;
                this.transformControls.detach();
            }
            // If there are still objects in the multi-select, make the last one the primary
            if (this.selectedObjects.length > 0) {
                const last = this.selectedObjects[this.selectedObjects.length - 1];
                if (this.selectedObject !== last) {
                    if (this.selectedObject) {
                        this.removeSelectionOutline(this.selectedObject);
                    }
                    this.selectedObject = last;
                    this.addSelectionOutline(last);
                    this.transformControls.attach(last);
                }
            } else {
                // Nothing left selected
                if (this.onObjectDeselected) {
                    this.onObjectDeselected();
                }
            }
        } else {
            // Add to multi-select
            // If there is a current single selection not yet in the array, add it first
            if (this.selectedObject && !this.selectedObjects.includes(this.selectedObject)) {
                this.selectedObjects.push(this.selectedObject);
                this.addMultiSelectHighlight(this.selectedObject);
            }
            this.selectedObjects.push(obj);
            this.addMultiSelectHighlight(obj);

            // Make the new object the primary selection (for transform gizmo)
            if (this.selectedObject && this.selectedObject !== obj) {
                this.removeSelectionOutline(this.selectedObject);
            }
            this.selectedObject = obj;
            this.addSelectionOutline(obj);
            this.transformControls.attach(obj);
        }

        if (this.onMultiSelect) {
            this.onMultiSelect(this.selectedObjects);
        }
    }

    deselectAll() {
        // Clear multi-select highlights
        this.selectedObjects.forEach(obj => {
            this.removeMultiSelectHighlight(obj);
        });
        this.selectedObjects = [];
        // Also clear the primary selection
        this.deselect();
    }

    addMultiSelectHighlight(obj) {
        // Add a subtle emissive tint to indicate multi-selection
        const setEmissive = (mesh) => {
            if (!mesh.material) return;
            if (mesh.userData.isOutline) return;
            // Store original emissive values for restoration
            if (mesh.userData._origEmissive === undefined) {
                mesh.userData._origEmissive = mesh.material.emissive ? '#' + mesh.material.emissive.getHexString() : '#000000';
                mesh.userData._origEmissiveIntensity = mesh.material.emissiveIntensity || 0;
            }
            if (mesh.material.emissive) {
                mesh.material.emissive.set(0x2244aa);
                mesh.material.emissiveIntensity = 0.25;
            }
        };

        if (obj.isMesh) {
            setEmissive(obj);
        }
        obj.traverse(child => {
            if (child.isMesh) {
                setEmissive(child);
            }
        });
    }

    removeMultiSelectHighlight(obj) {
        // Restore original emissive values
        const restoreEmissive = (mesh) => {
            if (!mesh.material) return;
            if (mesh.userData.isOutline) return;
            if (mesh.userData._origEmissive !== undefined) {
                if (mesh.material.emissive) {
                    mesh.material.emissive.set(mesh.userData._origEmissive);
                    mesh.material.emissiveIntensity = mesh.userData._origEmissiveIntensity;
                }
                delete mesh.userData._origEmissive;
                delete mesh.userData._origEmissiveIntensity;
            }
        };

        if (obj.isMesh) {
            restoreEmissive(obj);
        }
        obj.traverse(child => {
            if (child.isMesh) {
                restoreEmissive(child);
            }
        });
    }

    // ===== Interaction =====

    _getMouseNDC(event) {
        const rect = this.canvas.getBoundingClientRect();
        return new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
    }

    _getSceneMeshes() {
        const meshes = [];
        this.objects.forEach(obj => {
            if (obj.isMesh) {
                meshes.push(obj);
            } else {
                obj.traverse(child => {
                    if (child.isMesh && !child.userData.isOutline) {
                        meshes.push(child);
                    }
                });
            }
        });
        return meshes;
    }

    _findRootObject(mesh) {
        let target = mesh;
        while (target.parent && !this.objects.includes(target)) {
            target = target.parent;
        }
        return this.objects.includes(target) ? target : null;
    }

    onPointerDown(event) {
        if (this.isPlaying) return;
        if (this.transformControls.dragging) return;
        if (event.button !== 0) return;

        this.mouse.copy(this._getMouseNDC(event));
        this._pointerDownPos.copy(this.mouse);

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const meshes = this._getSceneMeshes();
        const intersects = this.raycaster.intersectObjects(meshes, false);

        if (intersects.length > 0) {
            const target = this._findRootObject(intersects[0].object);
            if (target && !target.userData.locked) {
                if (event.shiftKey) {
                    this.selectMultiple(target);
                    return;
                }
                this.selectObject(target);

                // Set up drag plane at object's Y, facing up
                this._dragPlane.set(new THREE.Vector3(0, 1, 0), -target.position.y);

                // Compute offset between hit point and object position on the drag plane
                const hitPoint = new THREE.Vector3();
                this.raycaster.ray.intersectPlane(this._dragPlane, hitPoint);
                this._dragOffset.subVectors(target.position, hitPoint);

                this._dragObject = target;
                this._isDragging = false; // Will become true on move beyond threshold
            }
        } else {
            this.deselect();
            this._dragObject = null;
        }
    }

    onPointerMove(event) {
        if (this.isPlaying) return;
        if (!this._dragObject) return;
        if (this.transformControls.dragging) return;

        this.mouse.copy(this._getMouseNDC(event));

        // Require a small movement threshold before starting drag
        if (!this._isDragging) {
            const dx = this.mouse.x - this._pointerDownPos.x;
            const dy = this.mouse.y - this._pointerDownPos.y;
            if (Math.sqrt(dx * dx + dy * dy) < 0.01) return;
            this._isDragging = true;
            this.orbitControls.enabled = false;
            // Hide transform gizmo while direct-dragging
            this.transformControls.detach();
        }

        this.raycaster.setFromCamera(this.mouse, this.camera);
        if (this.raycaster.ray.intersectPlane(this._dragPlane, this._dragIntersect)) {
            let newX = this._dragIntersect.x + this._dragOffset.x;
            let newZ = this._dragIntersect.z + this._dragOffset.z;

            // Apply snap
            if (this.snapEnabled) {
                newX = Math.round(newX / this.snapSize) * this.snapSize;
                newZ = Math.round(newZ / this.snapSize) * this.snapSize;
            }

            this._dragObject.position.x = newX;
            this._dragObject.position.z = newZ;
            this._needsRender = true;

            if (this.onObjectChanged) {
                this.onObjectChanged(this._dragObject);
            }
        }
    }

    onPointerUp(event) {
        if (!this._dragObject) return;

        if (this._isDragging) {
            this.orbitControls.enabled = true;
            // Re-attach transform gizmo
            if (this.selectedObject) {
                this.transformControls.attach(this.selectedObject);
            }
        }

        this._isDragging = false;
        this._dragObject = null;
    }

    // ===== Tool Management =====

    setTool(tool) {
        this.currentTool = tool;
        switch (tool) {
            case 'move':
                this.transformControls.setMode('translate');
                break;
            case 'rotate':
                this.transformControls.setMode('rotate');
                break;
            case 'scale':
                this.transformControls.setMode('scale');
                break;
            default:
                // Select mode defaults to translate
                this.transformControls.setMode('translate');
                break;
        }
    }

    setSnap(enabled, size) {
        this.snapEnabled = enabled;
        if (size !== undefined) this.snapSize = size;
        this.transformControls.snap = enabled ? this.snapSize : null;
    }

    // ===== Environment =====

    setSkyColor(color) {
        this.sky.material.uniforms.topColor.value.set(color);
        this._needsRender = true;
    }

    setSkybox(type) {
        // Remove existing skybox mesh if present
        if (this._skyboxMesh) {
            this.scene.remove(this._skyboxMesh);
            this._skyboxMesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this._skyboxMesh = null;
        }
        // Remove existing star points if present
        if (this._skyboxStars) {
            this.scene.remove(this._skyboxStars);
            this._skyboxStars.geometry.dispose();
            this._skyboxStars.material.dispose();
            this._skyboxStars = null;
        }

        // Hide or show the default sky sphere
        if (type === 'default') {
            this.sky.visible = true;
            this._needsRender = true;
            return;
        }

        // Hide the default sky for custom skyboxes
        this.sky.visible = false;

        let topColor, bottomColor, exponent;

        switch (type) {
            case 'gradient':
                topColor = new THREE.Color(0x1e90ff);   // Dodger blue
                bottomColor = new THREE.Color(0x00004d); // Deep blue
                exponent = 0.6;
                break;
            case 'sunset':
                topColor = new THREE.Color(0x4b0082);    // Indigo/purple
                bottomColor = new THREE.Color(0xff6a00);  // Deep orange
                exponent = 0.35;
                break;
            case 'night':
                topColor = new THREE.Color(0x000022);     // Near black with blue tint
                bottomColor = new THREE.Color(0x000011);  // Very dark
                exponent = 0.3;
                break;
            case 'cloudy':
                topColor = new THREE.Color(0x8899aa);     // Blue-gray
                bottomColor = new THREE.Color(0x556677);  // Darker gray
                exponent = 0.5;
                break;
            default:
                this.sky.visible = true;
                return;
        }

        // Create inverted sphere with gradient shader
        const skyGeo = new THREE.SphereGeometry(500, 32, 15);
        const skyMat = new THREE.ShaderMaterial({
            uniforms: {
                topColor: { value: topColor },
                bottomColor: { value: bottomColor },
                offset: { value: 20 },
                exponent: { value: exponent }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 bottomColor;
                uniform float offset;
                uniform float exponent;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition + offset).y;
                    gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
                }
            `,
            side: THREE.BackSide
        });
        this._skyboxMesh = new THREE.Mesh(skyGeo, skyMat);
        this.scene.add(this._skyboxMesh);

        // For night mode, add stars using THREE.Points
        if (type === 'night') {
            const starCount = 2000;
            const starPositions = new Float32Array(starCount * 3);
            for (let i = 0; i < starCount; i++) {
                // Distribute on a sphere of radius ~480
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = 480;
                starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
                starPositions[i * 3 + 1] = Math.abs(r * Math.cos(phi)); // Keep stars above horizon
                starPositions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
            }
            const starGeometry = new THREE.BufferGeometry();
            starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
            const starMaterial = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 1.5,
                sizeAttenuation: true,
                transparent: true,
                opacity: 0.9
            });
            this._skyboxStars = new THREE.Points(starGeometry, starMaterial);
            this.scene.add(this._skyboxStars);
        }

        this._needsRender = true;
    }

    setAmbientIntensity(value) {
        this.ambientLight.intensity = value;
        this._needsRender = true;
    }

    setFog(density) {
        if (density > 0) {
            this.scene.fog = new THREE.FogExp2(0x1a1a2e, density * 0.002);
        } else {
            this.scene.fog = null;
        }
        this._needsRender = true;
    }

    setShadows(enabled) {
        this.renderer.shadowMap.enabled = enabled;
        this.sunLight.castShadow = enabled;
        this.objects.forEach(obj => {
            obj.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = enabled;
                    child.receiveShadow = enabled;
                }
            });
        });
        this._needsRender = true;
    }

    // ===== Graphics Quality =====

    setGraphicsQuality(level) {
        this._graphicsQuality = level;
        const dpr = window.devicePixelRatio || 1;
        const settings = {
            ultra: {
                shadows: true, shadowType: THREE.PCFSoftShadowMap, shadowSize: 4096,
                shadowRadius: 4, shadowBias: -0.002,
                pixelRatio: Math.min(dpr, 2), particleScale: 1.5, farPlane: 1000,
                toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1,
                ambientIntensity: 0.6, hemiIntensity: 0.5, sunIntensity: 1.0,
                groundShadowOpacity: 0.25, gridVisible: true
            },
            high: {
                shadows: true, shadowType: THREE.PCFSoftShadowMap, shadowSize: 2048,
                shadowRadius: 2, shadowBias: -0.003,
                pixelRatio: Math.min(dpr, 2), particleScale: 1.0, farPlane: 1000,
                toneMapping: THREE.LinearToneMapping, toneMappingExposure: 1.0,
                ambientIntensity: 0.5, hemiIntensity: 0.4, sunIntensity: 0.8,
                groundShadowOpacity: 0.15, gridVisible: true
            },
            medium: {
                shadows: true, shadowType: THREE.PCFShadowMap, shadowSize: 1024,
                shadowRadius: 1, shadowBias: -0.004,
                pixelRatio: Math.min(dpr, 1.5), particleScale: 0.5, farPlane: 500,
                toneMapping: THREE.LinearToneMapping, toneMappingExposure: 1.0,
                ambientIntensity: 0.5, hemiIntensity: 0.35, sunIntensity: 0.7,
                groundShadowOpacity: 0.1, gridVisible: true
            },
            low: {
                shadows: false, shadowType: THREE.BasicShadowMap, shadowSize: 512,
                shadowRadius: 0, shadowBias: -0.005,
                pixelRatio: 1, particleScale: 0.25, farPlane: 300,
                toneMapping: THREE.LinearToneMapping, toneMappingExposure: 1.0,
                ambientIntensity: 0.6, hemiIntensity: 0.3, sunIntensity: 0.6,
                groundShadowOpacity: 0, gridVisible: true
            }
        };
        const s = settings[level] || settings.high;

        // Pixel ratio
        this.renderer.setPixelRatio(s.pixelRatio);

        // Tone mapping
        this.renderer.toneMapping = s.toneMapping;
        this.renderer.toneMappingExposure = s.toneMappingExposure;

        // Shadows
        this.renderer.shadowMap.enabled = s.shadows;
        this.renderer.shadowMap.type = s.shadowType;
        this.renderer.shadowMap.needsUpdate = true;
        this.sunLight.castShadow = s.shadows;
        this.sunLight.intensity = s.sunIntensity;
        this.sunLight.shadow.mapSize.width = s.shadowSize;
        this.sunLight.shadow.mapSize.height = s.shadowSize;
        this.sunLight.shadow.radius = s.shadowRadius;
        this.sunLight.shadow.bias = s.shadowBias;
        if (this.sunLight.shadow.map) {
            this.sunLight.shadow.map.dispose();
            this.sunLight.shadow.map = null;
        }

        // Lighting
        this.ambientLight.intensity = s.ambientIntensity;
        this.hemisphereLight.intensity = s.hemiIntensity;

        // Ground shadow plane
        if (this.groundPlane && this.groundPlane.material) {
            this.groundPlane.material.opacity = s.groundShadowOpacity;
            this.groundPlane.receiveShadow = s.shadows;
        }

        // Update all objects
        this.objects.forEach(obj => {
            obj.traverse(child => {
                if (child.isMesh) {
                    child.castShadow = s.shadows;
                    child.receiveShadow = s.shadows;
                    // Force material update for tone mapping changes
                    if (child.material) {
                        child.material.needsUpdate = true;
                    }
                }
            });
        });

        // Draw distance
        this.camera.far = s.farPlane;
        this.camera.updateProjectionMatrix();

        // Grid visibility
        if (this.gridHelper) this.gridHelper.visible = s.gridVisible;

        // Re-create weather with new particle scale
        if (this._weatherType && this._weatherType !== 'none') {
            this.setWeather(this._weatherType);
        }

        // Force resize to apply pixel ratio
        this.onResize();
        this._needsRender = true;
    }

    getParticleScale() {
        const scales = { ultra: 1.5, high: 1.0, medium: 0.5, low: 0.25 };
        return scales[this._graphicsQuality] || 1.0;
    }

    // ===== Rendering =====

    onResize() {
        const container = this.canvas.parentElement;
        const width = container.clientWidth || window.innerWidth;
        const height = container.clientHeight || window.innerHeight;

        if (width === 0 || height === 0) return;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    dispose() {
        this._disposed = true;
        if (this.renderer) this.renderer.dispose();
    }

    animate() {
        if (this._disposed) return;
        requestAnimationFrame(() => this.animate());

        if (!this.isPlaying) {
            // OrbitControls.update() returns true when damping causes movement
            if (this.orbitControls && this.orbitControls.update()) {
                this._needsRender = true;
            }
            if (!this.viewerMode) this._updateViewCube();
        }

        // Update weather particles
        if (this._weatherParticles) {
            this._updateWeather();
            this._needsRender = true;
        }

        // Render-on-demand: skip render when nothing changed in editor mode
        if (this.isPlaying || this._needsRender) {
            this.renderer.render(this.scene, this.camera);
            this._needsRender = false;
        }

        // Update FPS counter
        if (this._fpsCallback) {
            this._frameCount = (this._frameCount || 0) + 1;
            const now = performance.now();
            if (!this._lastFPSTime) this._lastFPSTime = now;
            if (now - this._lastFPSTime >= 1000) {
                this._fpsCallback(this._frameCount);
                this._frameCount = 0;
                this._lastFPSTime = now;
            }
        }
    }

    onFPSUpdate(callback) {
        this._fpsCallback = callback;
    }

    // ===== Weather =====

    setWeather(type) {
        // Cleanup existing weather particles
        if (this._weatherParticles) {
            this.scene.remove(this._weatherParticles);
            this._weatherParticles.geometry.dispose();
            this._weatherParticles.material.dispose();
            this._weatherParticles = null;
        }
        this._weatherType = type || 'none';

        if (type === 'none' || !type) {
            this._needsRender = true;
            return;
        }

        let count, geometry, material, positions, volX, volY, volZ;
        const pScale = this.getParticleScale();

        if (type === 'rain') {
            count = Math.round(3000 * pScale);
            volX = 60; volY = 40; volZ = 60;
            geometry = new THREE.BufferGeometry();
            positions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                positions[i * 3]     = (Math.random() - 0.5) * volX;
                positions[i * 3 + 1] = Math.random() * volY;
                positions[i * 3 + 2] = (Math.random() - 0.5) * volZ;
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            material = new THREE.PointsMaterial({
                color: 0xaaccff,
                size: 0.15,
                transparent: true,
                opacity: 0.6,
                depthWrite: false
            });
        } else if (type === 'snow') {
            count = Math.round(2000 * pScale);
            volX = 60; volY = 40; volZ = 60;
            geometry = new THREE.BufferGeometry();
            positions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                positions[i * 3]     = (Math.random() - 0.5) * volX;
                positions[i * 3 + 1] = Math.random() * volY;
                positions[i * 3 + 2] = (Math.random() - 0.5) * volZ;
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            material = new THREE.PointsMaterial({
                color: 0xffffff,
                size: 0.2,
                transparent: true,
                opacity: 0.8,
                depthWrite: false
            });
        } else if (type === 'fireflies') {
            count = Math.round(200 * pScale);
            volX = 30; volY = 15; volZ = 30;
            geometry = new THREE.BufferGeometry();
            positions = new Float32Array(count * 3);
            for (let i = 0; i < count; i++) {
                positions[i * 3]     = (Math.random() - 0.5) * volX;
                positions[i * 3 + 1] = Math.random() * volY + 0.5;
                positions[i * 3 + 2] = (Math.random() - 0.5) * volZ;
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            material = new THREE.PointsMaterial({
                color: 0xffdd44,
                size: 0.25,
                transparent: true,
                opacity: 0.9,
                depthWrite: false
            });
            // Store phase offsets for sinusoidal motion
            this._fireflyPhases = new Float32Array(count);
            for (let i = 0; i < count; i++) {
                this._fireflyPhases[i] = Math.random() * Math.PI * 2;
            }
        }

        this._weatherParticles = new THREE.Points(geometry, material);
        this._weatherParticles.frustumCulled = false;
        this.scene.add(this._weatherParticles);
        this._needsRender = true;
    }

    _updateWeather() {
        if (!this._weatherParticles) return;
        const positions = this._weatherParticles.geometry.attributes.position.array;
        const count = positions.length / 3;
        const type = this._weatherType;

        if (type === 'rain') {
            for (let i = 0; i < count; i++) {
                positions[i * 3 + 1] -= 0.4; // fast fall
                positions[i * 3] += (Math.random() - 0.5) * 0.01;
                if (positions[i * 3 + 1] < -1) {
                    positions[i * 3 + 1] = 40;
                    positions[i * 3]     = (Math.random() - 0.5) * 60;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
                }
            }
        } else if (type === 'snow') {
            for (let i = 0; i < count; i++) {
                positions[i * 3 + 1] -= 0.05; // slow fall
                positions[i * 3] += (Math.random() - 0.5) * 0.03; // horizontal drift
                positions[i * 3 + 2] += (Math.random() - 0.5) * 0.03;
                if (positions[i * 3 + 1] < -1) {
                    positions[i * 3 + 1] = 40;
                    positions[i * 3]     = (Math.random() - 0.5) * 60;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 60;
                }
            }
        } else if (type === 'fireflies') {
            const time = performance.now() * 0.001;
            for (let i = 0; i < count; i++) {
                const phase = this._fireflyPhases[i];
                positions[i * 3]     += Math.sin(time + phase) * 0.01;
                positions[i * 3 + 1] += Math.sin(time * 0.7 + phase * 1.3) * 0.005;
                positions[i * 3 + 2] += Math.cos(time * 0.8 + phase) * 0.01;
                // Soft bounds
                if (positions[i * 3 + 1] < 0.5) positions[i * 3 + 1] = 0.5;
                if (positions[i * 3 + 1] > 15) positions[i * 3 + 1] = 15;
            }
        }

        this._weatherParticles.geometry.attributes.position.needsUpdate = true;
    }

    // ===== Serialization =====

    serialize() {
        return this.objects.map(obj => {
            let color = '#4a90d9';
            if (obj.material && obj.material.color) {
                color = '#' + obj.material.color.getHexString();
            }

            // Collect child mesh colors for group objects (npc, tree, house, etc.)
            let childColors = null;
            if (!obj.isMesh && obj.isGroup !== false) {
                const children = [];
                obj.traverse(child => {
                    if (child.isMesh && child.material && child.material.color && child !== obj) {
                        children.push('#' + child.material.color.getHexString());
                    }
                });
                if (children.length > 0) childColors = children;
            }

            const data = {
                type: obj.userData.type,
                name: obj.userData.name,
                collabId: obj.userData.collabId,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: {
                    x: THREE.MathUtils.radToDeg(obj.rotation.x),
                    y: THREE.MathUtils.radToDeg(obj.rotation.y),
                    z: THREE.MathUtils.radToDeg(obj.rotation.z)
                },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                color: color,
                anchored: obj.userData.anchored,
                collidable: obj.userData.collidable,
                mass: obj.userData.mass,
                scripts: obj.userData.scripts,
                material: obj.material ? {
                    roughness: obj.material.roughness,
                    metalness: obj.material.metalness,
                    opacity: obj.material.opacity
                } : null,
                textureId: obj.userData.textureId || null,
                tileScale: obj.userData.tileScale || null,
                childColors: childColors
            };

            // Custom object data
            if (obj.userData.type === 'custom') {
                data.customObjectId = obj.userData.customObjectId;
                data.customParts = obj.userData.customParts;
            }

            return data;
        });
    }

    deserialize(data) {
        // Clear existing objects
        [...this.objects].forEach(obj => this.removeObject(obj));
        this._needsRender = true;

        data.forEach(item => {
            const opts = {
                name: item.name,
                collabId: item.collabId,
                position: item.position,
                rotation: item.rotation,
                scale: item.scale,
                color: item.color,
                anchored: item.anchored,
                collidable: item.collidable,
                mass: item.mass
            };

            // Pass childColors for NPC and other group objects
            if (item.childColors) {
                opts.childColors = item.childColors;
            }

            // Pass custom object data
            if (item.type === 'custom') {
                opts.customParts = item.customParts;
                opts.customObjectId = item.customObjectId;
            }

            const obj = this.addObject(item.type, opts);
            obj.userData.scripts = item.scripts || [];
            if (item.material && obj.material) {
                obj.material.roughness = item.material.roughness;
                obj.material.metalness = item.material.metalness;
                obj.material.opacity = item.material.opacity;
                obj.material.transparent = item.material.opacity < 1;
            }

            // Restore texture
            if (item.textureId && typeof TextureManager !== 'undefined') {
                const mgr = window._textureManager || (window._textureManager = new TextureManager());
                mgr.applyTexture(obj, item.textureId, item.tileScale || 1);
            }

            // Apply childColors to existing group children (for non-NPC groups that don't use opts.childColors in addObject)
            if (item.childColors && !obj.isMesh && item.type !== 'npc') {
                const meshChildren = [];
                obj.traverse(child => {
                    if (child.isMesh && child !== obj) meshChildren.push(child);
                });
                item.childColors.forEach((c, i) => {
                    if (meshChildren[i] && meshChildren[i].material) {
                        meshChildren[i].material.color.set(c);
                    }
                });
            }
        });
    }

    // ===== Collaboration Helpers =====

    _generateCollabId() {
        return 'c' + Date.now().toString(36) + '_' + (this._collabIdCounter++).toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    }

    findByCollabId(collabId) {
        return this.objects.find(obj => obj.userData.collabId === collabId) || null;
    }

    remoteAddObject(type, opts) {
        const savedAdded = this.onObjectAdded;
        this.onObjectAdded = null;
        const mesh = this.addObject(type, opts);
        this.onObjectAdded = savedAdded;
        return mesh;
    }

    remoteRemoveObject(collabId) {
        const obj = this.findByCollabId(collabId);
        if (!obj) return;
        const savedRemoved = this.onObjectRemoved;
        this.onObjectRemoved = null;
        this.removeObject(obj);
        this.onObjectRemoved = savedRemoved;
    }

    remoteUpdateTransform(collabId, pos, rot, scale) {
        const obj = this.findByCollabId(collabId);
        if (!obj) return;
        if (pos) obj.position.set(pos.x, pos.y, pos.z);
        if (rot) obj.rotation.set(
            THREE.MathUtils.degToRad(rot.x || 0),
            THREE.MathUtils.degToRad(rot.y || 0),
            THREE.MathUtils.degToRad(rot.z || 0)
        );
        if (scale) obj.scale.set(scale.x, scale.y, scale.z);
        this._needsRender = true;
    }

    remoteUpdateProperty(collabId, prop, value) {
        const obj = this.findByCollabId(collabId);
        if (!obj) return;
        switch (prop) {
            case 'color':
                if (obj.material && obj.material.color) obj.material.color.set(value);
                break;
            case 'name':
                obj.userData.name = value;
                break;
            case 'anchored':
                obj.userData.anchored = value;
                break;
            case 'collidable':
                obj.userData.collidable = value;
                break;
            case 'mass':
                obj.userData.mass = value;
                break;
            case 'visible':
                obj.visible = value;
                obj.userData.visible = value;
                break;
            case 'locked':
                obj.userData.locked = value;
                break;
            case 'roughness':
                if (obj.material) obj.material.roughness = value;
                break;
            case 'metalness':
                if (obj.material) obj.material.metalness = value;
                break;
            case 'opacity':
                if (obj.material) { obj.material.opacity = value; obj.material.transparent = value < 1; }
                break;
            case 'materialType':
                // Apply material preset
                if (obj.material) {
                    switch (value) {
                        case 'metallic': obj.material.metalness = 0.8; obj.material.roughness = 0.2; break;
                        case 'glass': obj.material.opacity = 0.4; obj.material.transparent = true; obj.material.roughness = 0.1; obj.material.metalness = 0; break;
                        case 'emissive': obj.material.emissive = obj.material.color; obj.material.emissiveIntensity = 0.4; break;
                        case 'flat': obj.material.roughness = 1; obj.material.metalness = 0; break;
                        default: obj.material.roughness = 0.6; obj.material.metalness = 0.1; break;
                    }
                }
                break;
        }
        this._needsRender = true;
    }
}
