/**
 * Runtime - Game play mode engine
 * Handles player controller, physics, script execution, and game logic
 */
class Runtime {
    constructor(scene3d, blockCode, domMap = {}) {
        this.scene3d = scene3d;
        this.blockCode = blockCode;
        this._domMap = domMap;
        this.isRunning = false;
        this.keys = {};
        this.variables = {};
        this.gameTimer = 0;
        this.playerController = null;
        this.runningScripts = [];
        this.objectStates = new Map(); // Store original states for reset
        this.activeAnimations = [];
        this.hudElements = [];
        this.soundVolume = 1.0;

        // Projectile system
        this.projectiles = [];
        this._fireRates = new Map();
        this._projectileConfig = new Map();

        // Health system
        this.maxHealth = 100;
        this._invincibleUntil = 0;
        this._showingHealthBar = false;
        this._contactDamage = new Map();

        // Enemy system
        this._enemies = new Map();
        this._enemyBars = new Map();

        // Inventory system
        this.inventory = [];
        this._pickupConfig = new Map();
        this._showingInventory = false;

        // Music system
        this._musicTrack = 'none';
        this._musicVolume = 0.3;
        this._musicNodes = null;

        // Spawned objects tracking
        this._spawnedObjects = [];

        // Lives system
        this._lives = 3;
        this._showingLives = false;
        this._livesWasAboveZero = true;

        // Countdown timer
        this._countdown = null;
        this._showingTimer = false;
        this._countdownInterval = null;

        // Visual effects
        this._screenOverlay = null;
        this._timeScale = 1;
        this._originalFov = null;

        // UI Screens
        this._activeScreens = new Map();
        this._uiScreens = [];

        // Custom sounds
        this._customSounds = [];
        this._customSoundBuffers = {};

        // Number displays
        this._numberDisplays = new Map();

        // Reusable temp objects to reduce allocations in hot loops
        this._tempVec3 = new THREE.Vector3();
        this._tempBox3 = new THREE.Box3();
        this._closestPoint = new THREE.Vector3();

        // Audio context for sound effects
        this.audioCtx = null;

        this.onStop = null;

        this._boundKeyDown = (e) => this.onKeyDown(e);
        this._boundKeyUp = (e) => this.onKeyUp(e);
    }

    _getElement(key, fallbackId) {
        if (this._domMap[key]) return this._domMap[key];
        return document.getElementById(fallbackId);
    }

    // ===== Start/Stop =====

    start(settings = {}) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.gameTimer = 0;
        this.variables = { score: 0, health: 100, coins: 0, speed: 5, level: 1 };
        // Init custom variables
        if (this.blockCode.customVariables) {
            this.blockCode.customVariables.forEach(name => { this.variables[name] = 0; });
        }
        this.activeAnimations = [];
        this.hudElements = [];
        this.runningScripts = [];
        this.projectiles = [];
        this._fireRates.clear();
        this._projectileConfig.clear();

        // Health system
        this.maxHealth = 100;
        this._invincibleUntil = 0;
        this._showingHealthBar = false;
        this._contactDamage.clear();
        this._healthWasAboveZero = true;

        // Enemy system
        this._enemies.clear();
        this._enemyBars.forEach(el => el.remove());
        this._enemyBars.clear();

        // Inventory system
        this.inventory = [];
        this._pickupConfig.clear();
        this._showingInventory = false;

        // Spawned objects
        this._spawnedObjects.forEach(obj => {
            this.scene3d.scene.remove(obj);
            const idx = this.scene3d.objects.indexOf(obj);
            if (idx !== -1) this.scene3d.objects.splice(idx, 1);
        });
        this._spawnedObjects = [];

        // Lives system
        this._lives = 3;
        this._showingLives = false;
        this._livesWasAboveZero = true;

        // Countdown timer
        if (this._countdownInterval) clearInterval(this._countdownInterval);
        this._countdown = null;
        this._showingTimer = false;
        this._countdownInterval = null;

        // Visual effects
        if (this._screenOverlay) { this._screenOverlay.remove(); this._screenOverlay = null; }
        this._timeScale = 1;
        this._originalFov = null;

        // UI Screens
        this._activeScreens.forEach(el => el.remove());
        this._activeScreens.clear();

        // Number displays
        this._numberDisplays.clear();

        // Music system
        this._stopMusic();

        this.settings = settings;

        // Apply settings
        this.controlScheme = settings.controlScheme || 'first-person';
        this.playerSpeed = settings.speed || 6;
        this.playerJumpForce = settings.jumpForce || 8;
        this.lookSpeed = (settings.sensitivity || 5) * 0.5;
        this._moveTarget = null; // for point-click

        // Key bindings (customizable)
        this.keyBindings = settings.keyBindings || {
            moveForward: 'KeyW',
            moveBack: 'KeyS',
            moveLeft: 'KeyA',
            moveRight: 'KeyD',
            lookUp: 'ArrowUp',
            lookDown: 'ArrowDown',
            lookLeft: 'ArrowLeft',
            lookRight: 'ArrowRight',
            jump: 'Space'
        };

        // Save object states
        this.objectStates.clear();
        this.scene3d.objects.forEach(obj => {
            this.objectStates.set(obj.userData.id, {
                position: obj.position.clone(),
                rotation: obj.rotation.clone(),
                scale: obj.scale.clone(),
                visible: obj.visible,
                color: obj.material ? obj.material.color.clone() : null,
                opacity: obj.material ? obj.material.opacity : 1,
                textureId: obj.userData.textureId || null,
                tileScale: obj.userData.tileScale || null
            });
        });

        // Init local vars on each object
        this.scene3d.objects.forEach(obj => {
            obj.userData.localVars = {};
        });

        // Cloud cache
        this._cloudCache = {};

        // Pre-cache bounding boxes for collision detection
        this.scene3d.objects.forEach(obj => {
            obj.userData._cachedBox = new THREE.Box3().setFromObject(obj);
        });

        // Save editor camera state
        this._savedCameraPos = this.scene3d.camera.position.clone();
        this._savedCameraRot = this.scene3d.camera.quaternion.clone();
        this._savedOrbitTarget = this.scene3d.orbitControls ? this.scene3d.orbitControls.target.clone() : new THREE.Vector3();

        // Disable editor controls
        this.scene3d.isPlaying = true;
        if (this.scene3d.orbitControls) this.scene3d.orbitControls.enabled = false;
        if (this.scene3d.transformControls) {
            this.scene3d.transformControls.detach();
            this.scene3d.transformControls.visible = false;
        }
        this.scene3d.deselect();

        // Setup player
        this.initPlayer();

        // Hide camera objects during play
        this._cameraOverride = false;
        this._cameraObj = null;
        this._cameraFollow = null;
        this.scene3d.objects.forEach(obj => {
            if (obj.userData.type === 'camera') obj.visible = false;
        });

        // Setup input
        document.addEventListener('keydown', this._boundKeyDown);
        document.addEventListener('keyup', this._boundKeyUp);

        // Init audio
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Preload custom sounds
        this._customSoundBuffers = {};
        if (this._customSounds && this._customSounds.length > 0) {
            this._customSounds.forEach(snd => {
                try {
                    const binary = atob(snd.dataUrl.split(',')[1]);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    this.audioCtx.decodeAudioData(bytes.buffer.slice(0), (buffer) => {
                        this._customSoundBuffers[snd.name] = buffer;
                    });
                } catch (e) { /* skip bad sounds */ }
            });
        }

        // Start background music if configured
        const bgMusic = this.settings?.bgMusic || 'none';
        if (bgMusic !== 'none') {
            this._musicVolume = (this.settings?.musicVolume || 30) / 100;
            this._startMusic(bgMusic);
        }

        // Click handler for in-game object interaction (all modes) and point-click movement
        const viewportContainer = this.scene3d.canvas.parentElement;
        this._boundClick = (e) => this.onGameClick(e);
        viewportContainer.addEventListener('click', this._boundClick);

        // Track mouse position for custom crosshair
        this._boundMouseMove = (e) => this.onMouseMove(e);
        document.addEventListener('mousemove', this._boundMouseMove);

        // Show custom crosshair, hide system cursor on viewport
        this._gameCrosshair = this._getElement('crosshair', 'game-crosshair');
        if (this._gameCrosshair) this._gameCrosshair.classList.remove('hidden');
        viewportContainer.style.cursor = 'none';

        // Start quick animations on all objects
        this.scene3d.objects.forEach(obj => this.startQuickAnimations(obj));

        // Compile and start scripts
        this.scene3d.objects.forEach(obj => {
            const compiled = this.blockCode.compileScripts(obj);
            compiled.forEach(script => {
                this.runningScripts.push({
                    object: obj,
                    script: script,
                    state: 'pending'
                });
            });
        });

        // Compile global (game-level) scripts
        if (this.blockCode.globalScripts && this.blockCode.globalScripts.length > 0) {
            const globalObj = { userData: { scripts: this.blockCode.globalScripts, name: 'Game Scripts', isGlobal: true } };
            const globalCompiled = this.blockCode.compileScripts(globalObj);
            globalCompiled.forEach(script => {
                this.runningScripts.push({
                    object: globalObj,
                    script: script,
                    state: 'pending'
                });
            });
        }

        // Start game events
        this.triggerEvent('onStart');

        // Start timers
        this.startTimers();

        // Main game loop
        this._gameLoop = () => {
            if (!this.isRunning) return;
            this.update();
            requestAnimationFrame(this._gameLoop);
        };
        requestAnimationFrame(this._gameLoop);

        // Show play overlay with controls hint
        const playOverlay = this._getElement('playOverlay', 'play-overlay');
        if (playOverlay) playOverlay.classList.remove('hidden');
        if (!this.scene3d.viewerMode) {
            const btnPlay = this._getElement('btnPlay', 'btn-play');
            if (btnPlay) btnPlay.classList.add('hidden');
            const btnStop = this._getElement('btnStop', 'btn-stop');
            if (btnStop) btnStop.classList.remove('hidden');
        }
        const statusMode = this._getElement('statusMode', 'status-mode');
        if (statusMode) statusMode.textContent = 'Play Mode';
        const viewcube = document.querySelector('.viewcube-wrapper');
        if (viewcube) viewcube.classList.add('hidden');

        // Hide editor grid (only in editor mode)
        if (!this.scene3d.viewerMode) this.scene3d.setGridVisible(false);

        // Update controls hint
        const hints = {
            'first-person': 'WASD to move | Arrows to look | Space to jump | Click objects | ESC to stop',
            'third-person': 'WASD to move | Arrows to orbit | Space to jump | Click objects | ESC to stop',
            'top-down': 'WASD to move | Space to jump | Click objects | ESC to stop',
            'point-click': 'Click to move | Space to jump | Click objects | ESC to stop'
        };
        const hintEl = (playOverlay || document).querySelector('.play-info span');
        if (hintEl) hintEl.textContent = hints[this.controlScheme] || hints['first-person'];
    }

    stop() {
        if (!this.isRunning) return;
        this.isRunning = false;

        // Restore object states
        this.scene3d.objects.forEach(obj => {
            const state = this.objectStates.get(obj.userData.id);
            if (state) {
                obj.position.copy(state.position);
                obj.rotation.copy(state.rotation);
                obj.scale.copy(state.scale);
                obj.visible = state.visible;
                if (state.color && obj.material) {
                    obj.material.color.copy(state.color);
                    obj.material.opacity = state.opacity;
                    obj.material.transparent = state.opacity < 1;
                }
                // Restore texture
                if (state.textureId && window._textureManager) {
                    window._textureManager.applyTexture(obj, state.textureId, state.tileScale || 1);
                }
            }
        });

        // Remove dynamically created objects
        const toRemove = this.scene3d.objects.filter(obj => obj.userData.isClone);
        toRemove.forEach(obj => this.scene3d.removeObject(obj));

        // Clean up particles
        if (this._particles) {
            this._particles.forEach(p => {
                this.scene3d.scene.remove(p);
                p.geometry.dispose();
                p.material.dispose();
            });
            this._particles = [];
        }

        // Clean up projectiles
        if (this.projectiles) {
            this.projectiles.forEach(p => {
                this.scene3d.scene.remove(p.mesh);
                p.mesh.geometry.dispose();
                p.mesh.material.dispose();
                if (p.light) this.scene3d.scene.remove(p.light);
            });
            this.projectiles = [];
        }
        this._fireRates.clear();
        this._projectileConfig.clear();

        // Clean up enemy health bars
        this._enemyBars.forEach(el => el.remove());
        this._enemyBars.clear();
        this._enemies.clear();
        this._contactDamage.clear();
        this._pickupConfig.clear();

        // Stop music
        this._stopMusic();

        // Clean up spawned objects
        this._spawnedObjects.forEach(obj => {
            this.scene3d.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) obj.material.dispose();
        });
        this._spawnedObjects = [];

        // Clean up countdown timer
        if (this._countdownInterval) { clearInterval(this._countdownInterval); this._countdownInterval = null; }

        // Clean up screen overlay
        if (this._screenOverlay) { this._screenOverlay.remove(); this._screenOverlay = null; }
        this._timeScale = 1;

        // Clean up UI screens
        this._activeScreens.forEach(el => el.remove());
        this._activeScreens.clear();

        // Clean up number displays
        this._numberDisplays.clear();

        // Reset camera overrides
        this._cameraOverride = false;
        this._cameraObj = null;
        this._cameraFollow = null;

        // Restore camera FOV
        if (this._originalFov !== null) {
            this.scene3d.camera.fov = this._originalFov;
            this.scene3d.camera.updateProjectionMatrix();
            this._originalFov = null;
        }

        // Clean up
        this.scene3d.isPlaying = false;
        if (this.scene3d.orbitControls) this.scene3d.orbitControls.enabled = true;
        this.activeAnimations = [];
        this.runningScripts = [];

        // Restore editor camera
        if (this._savedCameraPos) {
            const cam = this.scene3d.camera;
            cam.rotation.order = 'XYZ';
            cam.up.set(0, 1, 0);
            cam.position.copy(this._savedCameraPos);
            cam.quaternion.copy(this._savedCameraRot);
            if (this.scene3d.orbitControls) {
                this.scene3d.orbitControls.target.copy(this._savedOrbitTarget);
                this.scene3d.orbitControls.update();
            }
        }

        const viewportContainer = this.scene3d.canvas.parentElement;
        document.removeEventListener('keydown', this._boundKeyDown);
        document.removeEventListener('keyup', this._boundKeyUp);
        if (this._boundMouseMove) {
            document.removeEventListener('mousemove', this._boundMouseMove);
            this._boundMouseMove = null;
        }
        if (this._boundClick) {
            viewportContainer.removeEventListener('click', this._boundClick);
            this._boundClick = null;
        }

        // Hide custom crosshair, restore cursor
        if (this._gameCrosshair) {
            this._gameCrosshair.classList.add('hidden');
            this._gameCrosshair = null;
        }
        viewportContainer.style.cursor = '';

        // Remove player mesh and click marker
        if (this.playerController) {
            // Dispose player mesh and children
            this.playerController.mesh.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) child.material.dispose();
            });
            this.scene3d.scene.remove(this.playerController.mesh);
            this.playerController = null;
        }
        if (this._moveMarker) {
            this.scene3d.scene.remove(this._moveMarker);
            this._moveMarker.geometry.dispose();
            this._moveMarker.material.dispose();
            this._moveMarker = null;
        }

        // Clean up HUD
        const hud = this._getElement('gameHud', 'game-hud');
        if (hud) hud.innerHTML = '';

        // Remove speech bubbles
        document.querySelectorAll('.speech-bubble-3d').forEach(el => el.remove());

        // Hide play overlay
        const playOverlay = this._getElement('playOverlay', 'play-overlay');
        if (playOverlay) playOverlay.classList.add('hidden');
        if (!this.scene3d.viewerMode) {
            const btnPlay = this._getElement('btnPlay', 'btn-play');
            if (btnPlay) btnPlay.classList.remove('hidden');
            const btnStop = this._getElement('btnStop', 'btn-stop');
            if (btnStop) btnStop.classList.add('hidden');
        }
        const statusMode = this._getElement('statusMode', 'status-mode');
        if (statusMode) statusMode.textContent = 'Edit Mode';
        const viewcube = document.querySelector('.viewcube-wrapper');
        if (viewcube) viewcube.classList.remove('hidden');

        // Restore editor grid (only in editor mode, not viewer)
        if (!this.scene3d.viewerMode) this.scene3d.setGridVisible(true);

        // Clear timers
        if (this._timerIntervals) {
            this._timerIntervals.forEach(id => clearInterval(id));
            this._timerIntervals = [];
        }

        if (this.onStop) this.onStop();
    }

    // ===== Player Controller =====

    initPlayer() {
        // Find spawn point
        let spawnPos = new THREE.Vector3(0, 1.5, 0);
        this.scene3d.objects.forEach(obj => {
            if (obj.userData.type === 'spawn') {
                spawnPos.copy(obj.position);
                spawnPos.y += 1.5;
            }
        });

        const isThirdPerson = this.controlScheme === 'third-person';
        const isTopDown = this.controlScheme === 'top-down';
        const isPointClick = this.controlScheme === 'point-click';
        const showBody = isThirdPerson || isTopDown || isPointClick;

        let playerMesh;
        let playerHeight = 1.6;

        // Custom character or default
        if (this.characterParts && this.characterParts.length > 0 && showBody) {
            playerMesh = this._buildCustomCharacterMesh(this.characterParts);
            // Compute bounding box in LOCAL space (before setting world position)
            const box = new THREE.Box3().setFromObject(playerMesh);
            playerHeight = box.max.y - box.min.y;
            if (playerHeight < 0.5) playerHeight = 1.6;
            // Center children so group origin = geometric center
            const center = box.getCenter(new THREE.Vector3());
            playerMesh.children.forEach(child => {
                child.position.x -= center.x;
                child.position.y -= center.y;
                child.position.z -= center.z;
            });
            // Position so center is at spawn height
            playerMesh.position.copy(spawnPos);
        } else if (this.characterParts && this.characterParts.length > 0 && !showBody) {
            // First-person: invisible collision body
            const playerGeom = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8);
            const playerMat = new THREE.MeshBasicMaterial({ visible: false });
            playerMesh = new THREE.Mesh(playerGeom, playerMat);
            playerMesh.position.copy(spawnPos);
        } else {
            // Default character
            const playerGeom = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8);
            const bodyColor = this.playerColors?.body || '#4c97ff';
            const playerMat = showBody
                ? new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.6 })
                : new THREE.MeshBasicMaterial({ visible: false });
            playerMesh = new THREE.Mesh(playerGeom, playerMat);
            playerMesh.position.copy(spawnPos);
            playerMesh.castShadow = showBody;
            playerMesh.receiveShadow = showBody;

            if (showBody) {
                const headGeom = new THREE.SphereGeometry(0.25, 12, 8);
                const headColor = this.playerColors?.head || '#f5cba7';
                const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.6 });
                const head = new THREE.Mesh(headGeom, headMat);
                head.position.y = 1.05;
                head.castShadow = true;
                playerMesh.add(head);

                const noseGeom = new THREE.BoxGeometry(0.08, 0.08, 0.12);
                const detailColor = this.playerColors?.detail || '#e0b090';
                const noseMat = new THREE.MeshStandardMaterial({ color: detailColor });
                const nose = new THREE.Mesh(noseGeom, noseMat);
                nose.position.set(0, 1.03, 0.28);
                playerMesh.add(nose);
            }
        }

        this.scene3d.scene.add(playerMesh);

        this.playerController = {
            mesh: playerMesh,
            velocity: new THREE.Vector3(),
            speed: this.playerSpeed,
            jumpForce: this.playerJumpForce,
            gravity: -20,
            isGrounded: false,
            yaw: 0,
            pitch: 0,
            height: playerHeight,
            tpDistance: 8,
            tpAngle: 0.5
        };

        // Fully reset camera state for play mode
        const cam = this.scene3d.camera;
        cam.rotation.order = 'YXZ';
        cam.rotation.set(0, 0, 0);
        cam.quaternion.identity();
        cam.up.set(0, 1, 0);

        // Set camera based on scheme
        if (this.controlScheme === 'first-person') {
            cam.position.copy(spawnPos);
            cam.position.y += 0.3;
        } else if (isThirdPerson) {
            this._updateThirdPersonCamera();
        } else if (isTopDown) {
            cam.position.set(spawnPos.x, 25, spawnPos.z);
            cam.rotation.set(-Math.PI / 2, 0, 0);
        } else if (isPointClick) {
            cam.position.set(spawnPos.x + 10, 12, spawnPos.z + 10);
            cam.lookAt(spawnPos.x, 0, spawnPos.z);
            this._moveTarget = null;
        }
    }

    _buildCustomCharacterMesh(parts) {
        const group = new THREE.Group();
        parts.forEach(part => {
            let geom;
            switch (part.shape) {
                case 'sphere': geom = new THREE.SphereGeometry(0.5, 16, 12); break;
                case 'cylinder': geom = new THREE.CylinderGeometry(0.5, 0.5, 1, 16); break;
                case 'cone': geom = new THREE.ConeGeometry(0.5, 1, 16); break;
                case 'pyramid': geom = new THREE.ConeGeometry(0.7, 1, 4); geom.rotateY(Math.PI / 4); break;
                case 'dome': geom = new THREE.SphereGeometry(0.5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2); break;
                case 'wedge': {
                    const ws = new THREE.Shape();
                    ws.moveTo(0, 0); ws.lineTo(1, 0); ws.lineTo(0, 1); ws.lineTo(0, 0);
                    geom = new THREE.ExtrudeGeometry(ws, { depth: 1, bevelEnabled: false });
                    geom.center();
                    break;
                }
                case 'torus': geom = new THREE.TorusGeometry(0.35, 0.15, 12, 24); break;
                default: geom = new THREE.BoxGeometry(1, 1, 1); break;
            }
            const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(part.color || '#4c97ff'),
                roughness: 0.5,
                metalness: 0.1
            });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(part.offset?.x || 0, part.offset?.y || 0, part.offset?.z || 0);
            mesh.scale.set(part.scale?.x || 1, part.scale?.y || 1, part.scale?.z || 1);
            if (part.rotation) {
                mesh.rotation.set(
                    (part.rotation.x || 0) * Math.PI / 180,
                    (part.rotation.y || 0) * Math.PI / 180,
                    (part.rotation.z || 0) * Math.PI / 180
                );
            }
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            group.add(mesh);
        });
        return group;
    }

    _updateThirdPersonCamera() {
        const pc = this.playerController;
        if (!pc) return;
        // Use cos(angle) for horizontal distance so the total distance stays correct
        const hDist = pc.tpDistance * Math.cos(pc.tpAngle);
        const vDist = pc.tpDistance * Math.sin(pc.tpAngle);
        const offset = new THREE.Vector3(
            -Math.sin(pc.yaw) * hDist,
            vDist,
            -Math.cos(pc.yaw) * hDist
        );
        const target = pc.mesh.position.clone();
        target.y += 1;
        this.scene3d.camera.position.copy(target).add(offset);
        this.scene3d.camera.lookAt(target);
    }

    onPointClick(e) {
        if (!this.isRunning || !this.playerController) return;

        const rect = this.scene3d.canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.scene3d.camera);

        // Raycast against ground plane and objects
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(plane, hit)) {
            this._moveTarget = hit.clone();
            this._moveTarget.y = this.playerController.mesh.position.y;

            // Show click marker
            if (this._moveMarker) {
                this.scene3d.scene.remove(this._moveMarker);
            }
            const markerGeom = new THREE.RingGeometry(0.3, 0.5, 16);
            markerGeom.rotateX(-Math.PI / 2);
            const markerMat = new THREE.MeshBasicMaterial({
                color: 0x4c97ff,
                transparent: true,
                opacity: 0.6,
                side: THREE.DoubleSide
            });
            this._moveMarker = new THREE.Mesh(markerGeom, markerMat);
            this._moveMarker.position.copy(this._moveTarget);
            this._moveMarker.position.y = 0.05;
            this.scene3d.scene.add(this._moveMarker);

            // Fade marker
            setTimeout(() => {
                if (this._moveMarker) {
                    this.scene3d.scene.remove(this._moveMarker);
                    this._moveMarker.geometry.dispose();
                    this._moveMarker.material.dispose();
                    this._moveMarker = null;
                }
            }, 1000);
        }
    }

    onKeyDown(e) {
        this.keys[e.code] = true;

        // Prevent default for arrow keys and space to avoid page scroll
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) {
            e.preventDefault();
        }

        if (e.key === 'Escape') {
            this.stop();
            return;
        }

        // Trigger block code key events using display names
        const codeToLabel = {
            'KeyW': 'W', 'KeyA': 'A', 'KeyS': 'S', 'KeyD': 'D',
            'Space': 'Space', 'KeyE': 'E', 'KeyQ': 'Q',
            'Digit1': '1', 'Digit2': '2', 'Digit3': '3',
            'ArrowUp': 'ArrowUp', 'ArrowDown': 'ArrowDown',
            'ArrowLeft': 'ArrowLeft', 'ArrowRight': 'ArrowRight',
            'ShiftLeft': 'Shift', 'ShiftRight': 'Shift'
        };
        const label = codeToLabel[e.code] || e.key;
        this.triggerEvent('onKey', { key: label });
    }

    onKeyUp(e) {
        this.keys[e.code] = false;
    }

    onMouseMove(e) {
        if (!this.isRunning) return;

        // Move custom crosshair to mouse position
        if (this._gameCrosshair) {
            this._gameCrosshair.style.left = e.clientX + 'px';
            this._gameCrosshair.style.top = e.clientY + 'px';
        }
    }

    onGameClick(e) {
        if (!this.isRunning || !this.playerController) return;

        const rect = this.scene3d.canvas.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, this.scene3d.camera);

        // Check for object clicks first
        const meshes = [];
        this.scene3d.objects.forEach(obj => {
            if (!obj.visible) return;
            if (obj.isMesh) meshes.push(obj);
            else obj.traverse(child => { if (child.isMesh) meshes.push(child); });
        });
        const hits = raycaster.intersectObjects(meshes, false);
        if (hits.length > 0) {
            // Find the root scene object
            let target = hits[0].object;
            while (target.parent && !this.scene3d.objects.includes(target)) {
                target = target.parent;
            }
            if (this.scene3d.objects.includes(target)) {
                this.triggerEvent('onClick', {}, target);
            }
        }

        // Trigger shooting event
        this.triggerEvent('onShoot');

        // Point-click movement: raycast against ground plane
        if (this.controlScheme === 'point-click') {
            this.onPointClick(e);
        }
    }

    // ===== Game Loop =====

    update() {
        const rawDt = 1 / 60; // Fixed timestep
        const dt = rawDt * this._timeScale;
        this.gameTimer += rawDt; // timer always runs at real speed

        this.updatePlayer(dt);
        this.updateAnimations(dt);
        this.updateProjectiles(dt);
        this.checkCollisions();
        this.updateHUD();
        this.updateEnemyHealthBars();
        this._checkHealthZero();
        this._checkLivesZero();
    }

    _isKeyBound(action) {
        const code = this.keyBindings[action];
        return this.keys[code];
    }

    updatePlayer(dt) {
        const pc = this.playerController;
        if (!pc) return;

        const moveDir = new THREE.Vector3();
        const sprint = this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 1.6 : 1;
        const lookSpd = this.lookSpeed || 2;

        // Arrow-key (or custom key) looking for first-person / third-person
        if (this.controlScheme === 'first-person' || this.controlScheme === 'third-person') {
            if (this._isKeyBound('lookLeft'))  pc.yaw += lookSpd * dt;
            if (this._isKeyBound('lookRight')) pc.yaw -= lookSpd * dt;
            if (this._isKeyBound('lookUp'))    pc.pitch += lookSpd * dt;
            if (this._isKeyBound('lookDown'))  pc.pitch -= lookSpd * dt;
            pc.pitch = Math.max(-1.5, Math.min(1.5, pc.pitch));

            if (this.controlScheme === 'third-person') {
                // Remap pitch to tp angle (higher pitch = look up = lower angle)
                pc.tpAngle = Math.max(0.1, Math.min(1.2, 0.5 - pc.pitch * 0.5 + 0.5));
            }
        }

        if (this.controlScheme === 'first-person' || this.controlScheme === 'third-person') {
            // Movement relative to yaw direction
            const forward = new THREE.Vector3(0, 0, -1);
            forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), pc.yaw);
            const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));

            if (this._isKeyBound('moveForward')) moveDir.add(forward);
            if (this._isKeyBound('moveBack'))    moveDir.sub(forward);
            if (this._isKeyBound('moveLeft'))    moveDir.sub(right);
            if (this._isKeyBound('moveRight'))   moveDir.add(right);

            if (moveDir.length() > 0) {
                moveDir.normalize().multiplyScalar(pc.speed * sprint * dt);
                if (this.controlScheme === 'third-person') {
                    pc.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);
                }
            }
        } else if (this.controlScheme === 'top-down') {
            // World-axis movement with WASD
            if (this._isKeyBound('moveForward')) moveDir.z -= 1;
            if (this._isKeyBound('moveBack'))    moveDir.z += 1;
            if (this._isKeyBound('moveLeft'))    moveDir.x -= 1;
            if (this._isKeyBound('moveRight'))   moveDir.x += 1;

            if (moveDir.length() > 0) {
                moveDir.normalize().multiplyScalar(pc.speed * sprint * dt);
                pc.mesh.rotation.y = Math.atan2(moveDir.x, moveDir.z);
            }
        } else if (this.controlScheme === 'point-click') {
            // Move toward click target
            if (this._moveTarget) {
                const toTarget = new THREE.Vector3().subVectors(this._moveTarget, pc.mesh.position);
                toTarget.y = 0;
                const dist = toTarget.length();
                if (dist > 0.3) {
                    toTarget.normalize().multiplyScalar(pc.speed * dt);
                    moveDir.copy(toTarget);
                    pc.mesh.rotation.y = Math.atan2(toTarget.x, toTarget.z);
                } else {
                    this._moveTarget = null;
                }
            }
        }

        // Apply horizontal movement
        const newPos = pc.mesh.position.clone().add(moveDir);

        // Gravity
        pc.velocity.y += pc.gravity * dt;

        // Jump
        if (this._isKeyBound('jump') && pc.isGrounded) {
            pc.velocity.y = pc.jumpForce;
            pc.isGrounded = false;
        }

        newPos.y += pc.velocity.y * dt;

        // Simple ground collision
        pc.isGrounded = false;
        const playerRadius = 0.3;
        const playerBottom = newPos.y - pc.height / 2;

        // Check collisions with objects
        this.scene3d.objects.forEach(obj => {
            if (!obj.userData.collidable || !obj.visible) return;
            if (obj.userData.type === 'spawn') return;
            if (obj.userData.type === 'coin' || obj.userData.type === 'light-point') return;

            const box = new THREE.Box3().setFromObject(obj);

            // Simple AABB collision for ground
            if (newPos.x + playerRadius > box.min.x && newPos.x - playerRadius < box.max.x &&
                newPos.z + playerRadius > box.min.z && newPos.z - playerRadius < box.max.z) {

                // Landing on top
                if (playerBottom <= box.max.y && playerBottom >= box.max.y - 0.5 && pc.velocity.y <= 0) {
                    newPos.y = box.max.y + pc.height / 2;
                    pc.velocity.y = 0;
                    pc.isGrounded = true;
                }
                // Hitting from below (head hits ceiling/roof)
                else if (newPos.y + pc.height / 2 >= box.min.y && playerBottom < box.min.y && pc.velocity.y > 0) {
                    newPos.y = box.min.y - pc.height / 2;
                    pc.velocity.y = 0;
                }
                // Side collision (only if player vertically overlaps the object — not just underneath it)
                else if (playerBottom < box.max.y - 0.3 && newPos.y + pc.height / 2 > box.min.y) {
                    // Push out
                    const centerX = (box.min.x + box.max.x) / 2;
                    const centerZ = (box.min.z + box.max.z) / 2;
                    const dx = newPos.x - centerX;
                    const dz = newPos.z - centerZ;
                    const halfW = (box.max.x - box.min.x) / 2 + playerRadius;
                    const halfD = (box.max.z - box.min.z) / 2 + playerRadius;

                    const overlapX = halfW - Math.abs(dx);
                    const overlapZ = halfD - Math.abs(dz);

                    if (overlapX > 0 && overlapZ > 0) {
                        if (overlapX < overlapZ) {
                            newPos.x += Math.sign(dx) * overlapX;
                        } else {
                            newPos.z += Math.sign(dz) * overlapZ;
                        }
                    }
                }
            }
        });

        // Terrain heightmap collision
        this.scene3d.scene.children.forEach(child => {
            if (!child.userData.isTerrain || !child.userData.terrainCollision) return;
            const td = child.userData;
            const halfSize = td.terrainSize / 2;
            const res = td.terrainResolution;
            // Player position relative to terrain
            const lx = newPos.x - child.position.x + halfSize;
            const lz = newPos.z - child.position.z + halfSize;
            if (lx < 0 || lx > td.terrainSize || lz < 0 || lz > td.terrainSize) return;
            // Grid coords
            const gx = (lx / td.terrainSize) * res;
            const gz = (lz / td.terrainSize) * res;
            const ix = Math.floor(gx), iz = Math.floor(gz);
            const fx = gx - ix, fz = gz - iz;
            const stride = res + 1;
            // Bilinear interpolation of height
            const h00 = td.heightData[iz * stride + ix] || 0;
            const h10 = td.heightData[iz * stride + Math.min(ix + 1, res)] || 0;
            const h01 = td.heightData[Math.min(iz + 1, res) * stride + ix] || 0;
            const h11 = td.heightData[Math.min(iz + 1, res) * stride + Math.min(ix + 1, res)] || 0;
            const terrainY = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
            const groundY = terrainY + child.position.y;
            const playerFeet = newPos.y - pc.height / 2;
            if (playerFeet < groundY && playerFeet > groundY - 2 && pc.velocity.y <= 0) {
                newPos.y = groundY + pc.height / 2;
                pc.velocity.y = 0;
                pc.isGrounded = true;
            }
        });

        // World ground
        if (newPos.y - pc.height / 2 < 0) {
            newPos.y = pc.height / 2;
            pc.velocity.y = 0;
            pc.isGrounded = true;
        }

        // Death plane
        if (newPos.y < -50) {
            let spawnPos = new THREE.Vector3(0, 2, 0);
            this.scene3d.objects.forEach(obj => {
                if (obj.userData.type === 'spawn') {
                    spawnPos.copy(obj.position);
                    spawnPos.y += 1.5;
                }
            });
            newPos.copy(spawnPos);
            pc.velocity.set(0, 0, 0);
        }

        pc.mesh.position.copy(newPos);

        // Update camera based on scheme (skip if camera override from code blocks)
        const cam = this.scene3d.camera;
        if (this._cameraOverride) {
            // Camera follow mode
            if (this._cameraFollow) {
                const cf = this._cameraFollow;
                let targetPos;
                if (cf.target === 'player' && this.playerController) {
                    targetPos = this.playerController.mesh.position;
                } else if (cf.target === 'this object' && cf.object) {
                    targetPos = cf.object.position;
                }
                if (targetPos) {
                    const desired = new THREE.Vector3(
                        targetPos.x + cf.distance * 0.5,
                        targetPos.y + cf.distance * 0.4,
                        targetPos.z + cf.distance * 0.5
                    );
                    cam.position.lerp(desired, 0.05);
                    cam.lookAt(targetPos);
                }
            }
        } else if (this.controlScheme === 'first-person') {
            cam.position.set(newPos.x, newPos.y + 0.3, newPos.z);
            const euler = new THREE.Euler(pc.pitch, pc.yaw, 0, 'YXZ');
            cam.quaternion.setFromEuler(euler);
        } else if (this.controlScheme === 'third-person') {
            this._updateThirdPersonCamera();
        } else if (this.controlScheme === 'top-down') {
            // Fixed top-down: set position directly, use manual rotation to look straight down
            cam.position.set(newPos.x, 25, newPos.z);
            cam.rotation.set(-Math.PI / 2, 0, 0);
        } else if (this.controlScheme === 'point-click') {
            // Smooth follow camera (isometric-ish)
            const camTarget = new THREE.Vector3(newPos.x + 10, 12, newPos.z + 10);
            cam.position.lerp(camTarget, 0.05);
            cam.lookAt(newPos.x, 0, newPos.z);
        }
    }

    startQuickAnimations(obj) {
        const qa = obj.userData.quickAnimations;
        if (!qa || !qa.length) return;
        qa.forEach(a => {
            switch (a.type) {
                case 'spin':
                    this.activeAnimations.push({ type: 'spin', object: obj, axis: (a.axis || 'y').toUpperCase(), speed: a.speed || 1, elapsed: 0 });
                    break;
                case 'bounce':
                    this.activeAnimations.push({ type: 'bounce', object: obj, baseY: obj.position.y, height: a.height || 2, speed: a.speed || 2, elapsed: 0 });
                    break;
                case 'hover':
                    this.activeAnimations.push({ type: 'hover', object: obj, baseY: obj.position.y, height: a.height || 0.5, speed: a.speed || 1.5, phase: 0, elapsed: 0 });
                    break;
                case 'orbit':
                    this.activeAnimations.push({ type: 'orbit', object: obj, centerX: obj.position.x, centerZ: obj.position.z, radius: a.radius || 3, speed: a.speed || 1, elapsed: 0 });
                    break;
                case 'scalePulse':
                    this.activeAnimations.push({ type: 'scalePulse', object: obj, min: 0.8, max: 1.2, speed: a.speed || 2, baseScale: obj.scale.clone(), elapsed: 0 });
                    break;
                case 'zigzag':
                    this.activeAnimations.push({ type: 'zigzag', object: obj, baseX: obj.position.x, width: a.width || 3, speed: a.speed || 2, phase: 0, elapsed: 0 });
                    break;
                case 'wander':
                    this.activeAnimations.push({ type: 'wander', object: obj, radius: a.area || 5, speed: a.speed || 1.5, baseX: obj.position.x, baseZ: obj.position.z, targetX: obj.position.x, targetZ: obj.position.z, elapsed: 0, nextChange: 0 });
                    break;
                case 'patrol':
                    this.activeAnimations.push({ type: 'patrol', object: obj, baseX: obj.position.x, distance: a.distance || 5, speed: a.speed || 2, elapsed: 0 });
                    break;
            }
        });
    }

    updateAnimations(dt) {
        for (let i = this.activeAnimations.length - 1; i >= 0; i--) {
            const anim = this.activeAnimations[i];
            if (anim.type === 'particles') {
                // particles handled separately
            } else if (!anim.object || !anim.object.parent) {
                this.activeAnimations.splice(i, 1);
                continue;
            }

            anim.elapsed += dt;

            // Invalidate bounding box cache for animated objects
            if (anim.object && anim.object.userData) {
                anim.object.userData._cachedBox = null;
            }

            switch (anim.type) {
                case 'spin':
                    const axis = anim.axis.toLowerCase();
                    anim.object.rotation[axis] += anim.speed * dt;
                    break;

                case 'bounce': {
                    const t = anim.elapsed * anim.speed;
                    anim.object.position.y = anim.baseY + Math.abs(Math.sin(t)) * anim.height;
                    break;
                }

                case 'glide': {
                    const progress = Math.min(anim.elapsed / anim.duration, 1);
                    const eased = progress < 0.5
                        ? 2 * progress * progress
                        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                    anim.object.position.lerpVectors(anim.startPos, anim.endPos, eased);
                    if (progress >= 1) {
                        this.activeAnimations.splice(i, 1);
                    }
                    break;
                }

                case 'patrol': {
                    const t2 = Math.sin(anim.elapsed * anim.speed * 0.5);
                    anim.object.position.x = anim.baseX + t2 * anim.distance;
                    break;
                }

                case 'followPlayer': {
                    if (!this.playerController) break;
                    const playerPos = this.playerController.mesh.position;
                    const dir = this._tempVec3.subVectors(playerPos, anim.object.position);
                    dir.y = 0;
                    if (dir.length() > 1) {
                        dir.normalize().multiplyScalar(anim.speed * dt);
                        anim.object.position.add(dir);
                        anim.object.lookAt(playerPos.x, anim.object.position.y, playerPos.z);
                    }
                    break;
                }

                case 'colorShift': {
                    if (!anim.object.material) break;
                    const hue = (anim.elapsed * anim.speed * 0.1) % 1;
                    anim.object.material.color.setHSL(hue, 0.8, 0.5);
                    break;
                }

                case 'gravity': {
                    if (!anim.object.userData.anchored) {
                        anim.velocity += -20 * dt;
                        anim.object.position.y += anim.velocity * dt;
                        // Ground collision
                        const box = new THREE.Box3().setFromObject(anim.object);
                        if (box.min.y <= 0) {
                            anim.object.position.y += (0 - box.min.y);
                            anim.velocity = 0;
                        }
                    }
                    break;
                }

                case 'orbit': {
                    const angle = anim.elapsed * anim.speed;
                    anim.object.position.x = anim.centerX + Math.cos(angle) * anim.radius;
                    anim.object.position.z = anim.centerZ + Math.sin(angle) * anim.radius;
                    break;
                }

                case 'scalePulse': {
                    const t = Math.sin(anim.elapsed * anim.speed * Math.PI);
                    const s = anim.min + (anim.max - anim.min) * (t * 0.5 + 0.5);
                    anim.object.scale.copy(anim.baseScale).multiplyScalar(s);
                    break;
                }

                case 'particles': {
                    if (!anim.points || !anim.points.parent) {
                        this.activeAnimations.splice(i, 1);
                        continue;
                    }
                    const posAttr = anim.points.geometry.getAttribute('position');
                    for (let p = 0; p < anim.velocities.length; p++) {
                        posAttr.array[p * 3] += anim.velocities[p].x * dt;
                        posAttr.array[p * 3 + 1] += anim.velocities[p].y * dt;
                        posAttr.array[p * 3 + 2] += anim.velocities[p].z * dt;
                        if (anim.particleType !== 'snow') {
                            anim.velocities[p].y -= 5 * dt; // gravity on particles
                        }
                    }
                    posAttr.needsUpdate = true;
                    anim.points.material.opacity = Math.max(0, 1 - anim.elapsed / anim.life);
                    if (anim.elapsed >= anim.life) {
                        this.scene3d.scene.remove(anim.points);
                        anim.points.geometry.dispose();
                        anim.points.material.dispose();
                        if (this._particles) {
                            const idx = this._particles.indexOf(anim.points);
                            if (idx !== -1) this._particles.splice(idx, 1);
                        }
                        this.activeAnimations.splice(i, 1);
                    }
                    break;
                }

                case 'wander': {
                    if (anim.elapsed > anim.nextChange) {
                        const angle = Math.random() * Math.PI * 2;
                        const dist = Math.random() * anim.radius;
                        anim.targetX = anim.baseX + Math.cos(angle) * dist;
                        anim.targetZ = anim.baseZ + Math.sin(angle) * dist;
                        anim.nextChange = anim.elapsed + 2 + Math.random() * 3;
                    }
                    const dx = anim.targetX - anim.object.position.x;
                    const dz = anim.targetZ - anim.object.position.z;
                    const wdist = Math.sqrt(dx * dx + dz * dz);
                    if (wdist > 0.3) {
                        const wspeed = anim.speed * dt;
                        anim.object.position.x += (dx / wdist) * wspeed;
                        anim.object.position.z += (dz / wdist) * wspeed;
                        anim.object.rotation.y = Math.atan2(dx, dz);
                    }
                    break;
                }

                case 'trail': {
                    if (anim.elapsed - anim.lastSpawn > 0.05) {
                        anim.lastSpawn = anim.elapsed;
                        const dot = new THREE.Mesh(
                            new THREE.SphereGeometry(0.08, 4, 4),
                            new THREE.MeshBasicMaterial({
                                color: new THREE.Color(anim.color),
                                transparent: true, opacity: 0.8
                            })
                        );
                        dot.position.copy(anim.object.position);
                        this.scene3d.scene.add(dot);
                        // Fade and remove
                        const fadeStart = anim.elapsed;
                        const fadeDot = () => {
                            const age = (performance.now() / 1000) - fadeStart;
                            if (age > 1 || !this.isRunning) {
                                this.scene3d.scene.remove(dot);
                                dot.geometry.dispose();
                                dot.material.dispose();
                                return;
                            }
                            dot.material.opacity = 0.8 * (1 - age);
                            dot.scale.setScalar(1 - age * 0.5);
                            requestAnimationFrame(fadeDot);
                        };
                        requestAnimationFrame(fadeDot);
                    }
                    break;
                }

                case 'zigzag': {
                    anim.phase = (anim.phase || 0) + dt * anim.speed;
                    anim.object.position.x = anim.baseX + Math.sin(anim.phase) * anim.width;
                    break;
                }

                case 'spiral': {
                    anim.angle = (anim.angle || 0) + dt * anim.speed;
                    anim.object.position.x = anim.baseX + Math.cos(anim.angle) * anim.radius;
                    anim.object.position.z = anim.baseZ + Math.sin(anim.angle) * anim.radius;
                    break;
                }

                case 'hover': {
                    anim.phase = (anim.phase || 0) + dt * anim.speed;
                    anim.object.position.y = anim.baseY + Math.sin(anim.phase) * anim.height;
                    break;
                }

                case 'launchArc': {
                    anim.vy += -20 * dt; // gravity
                    anim.object.position.y += anim.vy * dt;
                    if (anim.object.position.y <= anim.groundY) {
                        anim.object.position.y = anim.groundY;
                        anim.done = true;
                    }
                    break;
                }

                case 'cameraGlide': {
                    const progress = Math.min(anim.elapsed / (anim.duration / 1000), 1);
                    const eased = progress < 0.5
                        ? 2 * progress * progress
                        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
                    this.scene3d.camera.position.lerpVectors(anim.startPos, anim.endPos, eased);
                    if (progress >= 1) anim.done = true;
                    break;
                }

                case 'cameraShake': {
                    if (anim.elapsed * 1000 < anim.duration) {
                        const cam = this.scene3d.camera;
                        cam.position.x = anim.originalPos.x + (Math.random() - 0.5) * anim.intensity * 2;
                        cam.position.y = anim.originalPos.y + (Math.random() - 0.5) * anim.intensity * 2;
                        cam.position.z = anim.originalPos.z + (Math.random() - 0.5) * anim.intensity * 2;
                    } else {
                        this.scene3d.camera.position.copy(anim.originalPos);
                        anim.done = true;
                    }
                    break;
                }

                case 'cameraZoom': {
                    anim.elapsed2 = (anim.elapsed2 || 0) + dt;
                    const t = Math.min(1, anim.elapsed2 / anim.duration);
                    const eased = t * (2 - t); // ease out
                    this.scene3d.camera.fov = anim.startFov + (anim.targetFov - anim.startFov) * eased;
                    this.scene3d.camera.updateProjectionMatrix();
                    if (t >= 1) anim.done = true;
                    break;
                }

                case 'keyframe': {
                    const kfs = anim.keyframes;
                    if (!kfs || kfs.length < 2) { anim.done = true; break; }
                    const totalTime = kfs[kfs.length - 1].time;
                    let time = anim.elapsed;
                    if (anim.loop) {
                        time = totalTime > 0 ? (time % totalTime) : 0;
                    } else if (time >= totalTime) {
                        anim.done = true;
                    }
                    // Interpolate
                    this._interpolateKeyframes(anim.object, kfs, Math.min(time, totalTime));
                    break;
                }
            }

            // Remove finished one-shot animations
            if (anim.done) {
                this.activeAnimations.splice(i, 1);
            }
        }
    }

    checkCollisions() {
        if (!this.playerController) return;
        const playerPos = this.playerController.mesh.position;
        const playerRadius = 0.8;
        const box = this._tempBox3;
        const cp = this._closestPoint;

        this.scene3d.objects.forEach(obj => {
            if (!obj.visible) return;

            // Use cached bounding box if available, otherwise compute
            if (obj.userData._cachedBox) {
                box.copy(obj.userData._cachedBox);
            } else {
                box.setFromObject(obj);
                if (!obj.userData._cachedBox) obj.userData._cachedBox = new THREE.Box3();
                obj.userData._cachedBox.copy(box);
            }

            cp.set(
                Math.max(box.min.x, Math.min(playerPos.x, box.max.x)),
                Math.max(box.min.y, Math.min(playerPos.y, box.max.y)),
                Math.max(box.min.z, Math.min(playerPos.z, box.max.z))
            );

            if (playerPos.distanceTo(cp) < playerRadius) {
                this.triggerEvent('onCollide', { object: 'player' }, obj);

                // Contact damage
                const contactDmg = this._contactDamage.get(obj.userData.id);
                if (contactDmg && contactDmg > 0 && this.gameTimer >= this._invincibleUntil) {
                    this.variables.health = Math.max(0, (this.variables.health || 100) - contactDmg);
                    this._invincibleUntil = this.gameTimer + 0.5;
                    this.playSynthSound('hurt');
                    if (this.playerController && this.playerController.mesh.material) {
                        const origColor = this.playerController.mesh.material.color.clone();
                        this.playerController.mesh.material.color.set(0xff0000);
                        setTimeout(() => {
                            if (this.playerController && this.playerController.mesh.material) {
                                this.playerController.mesh.material.color.copy(origColor);
                            }
                        }, 200);
                    }
                }

                // Pickup collection
                const pickupData = this._pickupConfig.get(obj.userData.id);
                if (pickupData && obj.visible) {
                    this._collectPickup(obj, pickupData);
                }
            }
        });
    }

    // ===== Projectile System =====

    updateProjectiles(dt) {
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const p = this.projectiles[i];
            p.elapsed += dt;

            // Remove if lifetime exceeded
            if (p.elapsed >= p.lifetime) {
                this._removeProjectile(i);
                continue;
            }

            // Move projectile (reuse temp vector to avoid allocation)
            this._tempVec3.copy(p.velocity).multiplyScalar(dt);
            p.mesh.position.add(this._tempVec3);
            if (p.light) p.light.position.copy(p.mesh.position);

            // Check collision with scene objects
            let hit = false;
            for (const obj of this.scene3d.objects) {
                if (!obj.visible || !obj.userData.collidable) continue;
                if (obj === p.owner) continue;
                if (obj.userData.type === 'spawn' || obj.userData.type === 'light-point') continue;

                const box = new THREE.Box3().setFromObject(obj);
                if (box.containsPoint(p.mesh.position)) {
                    this.triggerEvent('onProjectileHit', { damage: p.damage, shooter: p.owner }, obj);
                    // Damage enemies
                    const enemyData = this._enemies.get(obj.userData.id);
                    if (enemyData) {
                        enemyData.health -= p.damage;
                        this._checkEnemyDeath(obj);
                    }
                    this._spawnImpactEffect(p.mesh.position.clone(), p.color);
                    this._playImpactSound();
                    this._removeProjectile(i);
                    hit = true;
                    break;
                }
            }
            if (hit) continue;

            // Check collision with player (for enemy projectiles)
            if (this.playerController && p.owner !== this.playerController.mesh) {
                const dist = p.mesh.position.distanceTo(this.playerController.mesh.position);
                if (dist < 0.8) {
                    if (this.gameTimer >= this._invincibleUntil) {
                        this.variables.health = Math.max(0, (this.variables.health || 100) - p.damage);
                        this._invincibleUntil = this.gameTimer + 0.5;
                    }
                    this._spawnImpactEffect(p.mesh.position.clone(), '#ff0000');
                    this._playImpactSound();
                    this.playSynthSound('hurt');
                    this._removeProjectile(i);
                    continue;
                }
            }

            // Ground collision
            if (p.mesh.position.y < 0) {
                this._spawnImpactEffect(new THREE.Vector3(p.mesh.position.x, 0.05, p.mesh.position.z), p.color);
                this._removeProjectile(i);
                continue;
            }

            // Out of bounds
            if (p.mesh.position.length() > 200) {
                this._removeProjectile(i);
            }
        }
    }

    _removeProjectile(index) {
        const p = this.projectiles[index];
        this.scene3d.scene.remove(p.mesh);
        p.mesh.geometry.dispose();
        p.mesh.material.dispose();
        if (p.light) this.scene3d.scene.remove(p.light);
        this.projectiles.splice(index, 1);
    }

    _createProjectile(position, velocity, color, owner) {
        const ownerId = owner?.userData?.id;
        const config = this._projectileConfig.get(ownerId) || {};
        const size = config.size || 0.15;
        const damage = config.damage || 10;
        const lifetime = config.lifetime || 3;
        const colorObj = new THREE.Color(color);

        const geo = new THREE.SphereGeometry(size, 8, 8);
        const mat = new THREE.MeshBasicMaterial({ color: colorObj, transparent: true, opacity: 0.9 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        this.scene3d.scene.add(mesh);

        let light = null;
        if (this.projectiles.length < 20) {
            light = new THREE.PointLight(colorObj, 0.5, 4);
            light.position.copy(position);
            this.scene3d.scene.add(light);
        }

        const projectile = { mesh, light, velocity: velocity.clone(), damage, lifetime, elapsed: 0, owner, color };
        this.projectiles.push(projectile);
        this._spawnMuzzleFlash(position.clone(), color);
        return projectile;
    }

    _canFire(obj) {
        const id = obj?.userData?.id || 'player';
        const rateConfig = this._fireRates.get(id);
        const cooldown = rateConfig?.cooldown || 0.3;
        const now = this.gameTimer;
        const lastFired = rateConfig?.lastFired || 0;

        if (now - lastFired < cooldown) return false;

        if (!rateConfig) {
            this._fireRates.set(id, { cooldown, lastFired: now });
        } else {
            rateConfig.lastFired = now;
        }
        return true;
    }

    _spawnMuzzleFlash(position, color) {
        const geo = new THREE.SphereGeometry(0.15, 6, 6);
        const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.8 });
        const flash = new THREE.Mesh(geo, mat);
        flash.position.copy(position);
        this.scene3d.scene.add(flash);

        const startTime = performance.now();
        const animate = () => {
            const elapsed = (performance.now() - startTime) / 1000;
            if (elapsed > 0.12 || !this.isRunning) {
                this.scene3d.scene.remove(flash);
                geo.dispose();
                mat.dispose();
                return;
            }
            flash.scale.setScalar(1 + elapsed * 15);
            mat.opacity = 0.8 * (1 - elapsed / 0.12);
            requestAnimationFrame(animate);
        };
        requestAnimationFrame(animate);
    }

    _spawnImpactEffect(position, color) {
        const count = 12;
        const positions = new Float32Array(count * 3);
        const velocities = [];
        for (let i = 0; i < count; i++) {
            positions[i * 3] = position.x;
            positions[i * 3 + 1] = position.y;
            positions[i * 3 + 2] = position.z;
            velocities.push(new THREE.Vector3(
                (Math.random() - 0.5) * 3,
                Math.random() * 2 + 1,
                (Math.random() - 0.5) * 3
            ));
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        const mat = new THREE.PointsMaterial({
            color: new THREE.Color(color), size: 0.12,
            transparent: true, opacity: 0.9, sizeAttenuation: true
        });
        const points = new THREE.Points(geo, mat);
        this.scene3d.scene.add(points);
        if (!this._particles) this._particles = [];
        this._particles.push(points);
        this.activeAnimations.push({
            type: 'particles', points, velocities,
            life: 0.5, elapsed: 0, particleType: 'burst'
        });
    }

    _playShootSound() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.12);
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.soundVolume * 0.2, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.15);
    }

    _playImpactSound() {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const now = ctx.currentTime;
        const bufferSize = ctx.sampleRate * 0.08;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const g = ctx.createGain();
        g.gain.setValueAtTime(this.soundVolume * 0.15, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 800;
        noise.connect(filter);
        filter.connect(g);
        g.connect(ctx.destination);
        noise.start(now);
    }

    // ===== Script Execution =====

    triggerEvent(eventType, eventData = {}, specificObject = null) {
        this.runningScripts.forEach(rs => {
            if (rs.script.trigger !== eventType) return;
            if (specificObject && rs.object !== specificObject) return;

            // Check trigger conditions
            if (eventType === 'onKey') {
                if (rs.script.triggerValues.key !== eventData.key) return;
            }
            if (eventType === 'onCollide') {
                if (rs.script.triggerValues.object !== 'any' &&
                    rs.script.triggerValues.object !== eventData.object) return;
            }
            if (eventType === 'onMessage') {
                if (rs.script.triggerValues.msg !== eventData.msg) return;
            }

            // Execute commands
            this.executeCommands(rs.object, rs.script.commands);
        });
    }

    startTimers() {
        this._timerIntervals = [];
        this.runningScripts.forEach(rs => {
            if (rs.script.trigger === 'onTimer') {
                const seconds = parseFloat(rs.script.triggerValues.seconds) || 1;
                const id = setInterval(() => {
                    if (!this.isRunning) return;
                    this.executeCommands(rs.object, rs.script.commands);
                }, seconds * 1000);
                this._timerIntervals.push(id);
            }
        });
    }

    async executeCommands(obj, commands) {
        if (!commands || !this.isRunning) return;

        for (const cmd of commands) {
            if (!cmd || !this.isRunning) break;
            await this.executeCommand(obj, cmd);
        }
    }

    async executeCommand(obj, cmd) {
        if (!this.isRunning || !obj) return;

        const v = cmd.values || {};

        switch (cmd.code) {
            // Motion
            case 'move': {
                const amount = parseFloat(v.amount) || 1;
                const dir = v.direction || 'forward';
                switch (dir) {
                    case 'forward': obj.position.z -= amount; break;
                    case 'backward': obj.position.z += amount; break;
                    case 'left': obj.position.x -= amount; break;
                    case 'right': obj.position.x += amount; break;
                    case 'up': obj.position.y += amount; break;
                    case 'down': obj.position.y -= amount; break;
                }
                break;
            }
            case 'moveTo': {
                obj.position.set(
                    parseFloat(v.x) || 0,
                    parseFloat(v.y) || 0,
                    parseFloat(v.z) || 0
                );
                break;
            }
            case 'rotate': {
                const deg = parseFloat(v.degrees) || 15;
                const axis = (v.axis || 'Y').toLowerCase();
                obj.rotation[axis] += THREE.MathUtils.degToRad(deg);
                break;
            }
            case 'spin': {
                this.activeAnimations.push({
                    type: 'spin',
                    object: obj,
                    axis: v.axis || 'Y',
                    speed: parseFloat(v.speed) || 1,
                    elapsed: 0
                });
                break;
            }
            case 'glide': {
                this.activeAnimations.push({
                    type: 'glide',
                    object: obj,
                    startPos: obj.position.clone(),
                    endPos: new THREE.Vector3(
                        parseFloat(v.x) || 0,
                        parseFloat(v.y) || 0,
                        parseFloat(v.z) || 0
                    ),
                    duration: parseFloat(v.time) || 1,
                    elapsed: 0
                });
                await this.sleep((parseFloat(v.time) || 1) * 1000);
                break;
            }
            case 'bounce': {
                this.activeAnimations.push({
                    type: 'bounce',
                    object: obj,
                    baseY: obj.position.y,
                    height: parseFloat(v.height) || 2,
                    speed: parseFloat(v.speed) || 2,
                    elapsed: 0
                });
                break;
            }
            case 'followPlayer': {
                this.activeAnimations.push({
                    type: 'followPlayer',
                    object: obj,
                    speed: parseFloat(v.speed) || 2,
                    elapsed: 0
                });
                break;
            }
            case 'patrol': {
                this.activeAnimations.push({
                    type: 'patrol',
                    object: obj,
                    baseX: obj.position.x,
                    distance: parseFloat(v.dist) || 5,
                    speed: parseFloat(v.speed) || 2,
                    elapsed: 0
                });
                break;
            }

            // Control
            case 'wait': {
                await this.sleep((parseFloat(v.seconds) || 1) * 1000);
                break;
            }
            case 'repeat': {
                const times = parseInt(v.times) || 10;
                for (let i = 0; i < times && this.isRunning; i++) {
                    if (cmd.children) {
                        await this.executeCommands(obj, cmd.children);
                    }
                }
                break;
            }
            case 'forever': {
                const foreverLoop = async () => {
                    while (this.isRunning) {
                        if (cmd.children) {
                            await this.executeCommands(obj, cmd.children);
                        }
                        await this.sleep(16); // ~60fps
                    }
                };
                foreverLoop(); // Don't await - runs in background
                break;
            }
            case 'if': {
                let condition = false;
                switch (v.condition) {
                    case 'touching player':
                        if (this.playerController) {
                            const dist = obj.position.distanceTo(this.playerController.mesh.position);
                            condition = dist < 2;
                        }
                        break;
                    case 'key pressed':
                        condition = Object.values(this.keys).some(k => k);
                        break;
                    case 'variable > 0':
                        condition = (this.variables.score || 0) > 0;
                        break;
                    case 'random chance':
                        condition = Math.random() > 0.5;
                        break;
                }
                if (condition && cmd.children) {
                    await this.executeCommands(obj, cmd.children);
                }
                break;
            }
            case 'stop': {
                // Stop script execution
                return;
            }

            // Looks
            case 'setColor': {
                if (obj.material) {
                    obj.material.color.set(v.color || '#ff0000');
                }
                obj.traverse(child => {
                    if (child.material && child !== obj) {
                        child.material.color.set(v.color || '#ff0000');
                    }
                });
                break;
            }
            case 'setSize': {
                const percent = (parseFloat(v.percent) || 100) / 100;
                const origState = this.objectStates.get(obj.userData.id);
                if (origState) {
                    obj.scale.copy(origState.scale).multiplyScalar(percent);
                }
                break;
            }
            case 'show': {
                obj.visible = true;
                break;
            }
            case 'hide': {
                obj.visible = false;
                break;
            }
            case 'glow': {
                if (obj.material) {
                    obj.material.emissive = new THREE.Color(v.color || '#ffffff');
                    obj.material.emissiveIntensity = parseFloat(v.val) || 0.5;
                }
                break;
            }
            case 'setOpacity': {
                const opacity = (parseFloat(v.percent) || 100) / 100;
                if (obj.material) {
                    obj.material.opacity = opacity;
                    obj.material.transparent = opacity < 1;
                }
                break;
            }
            case 'say': {
                this.showSpeechBubble(obj, v.text || 'Hello!', parseFloat(v.time) || 2);
                await this.sleep((parseFloat(v.time) || 2) * 1000);
                break;
            }
            case 'colorShift': {
                this.activeAnimations.push({
                    type: 'colorShift',
                    object: obj,
                    speed: parseFloat(v.speed) || 1,
                    elapsed: 0
                });
                break;
            }
            case 'setPlayerColor': {
                const pc = this.playerController;
                if (pc && pc.mesh) {
                    const color = v.color || '#4c97ff';
                    const part = v.part || 'body';
                    if (part === 'body' && pc.mesh.material) {
                        pc.mesh.material.color.set(color);
                    } else if (part === 'head' && pc.mesh.children[0]) {
                        pc.mesh.children[0].material.color.set(color);
                    } else if (part === 'detail' && pc.mesh.children[1]) {
                        pc.mesh.children[1].material.color.set(color);
                    }
                }
                break;
            }
            case 'setNpcColor': {
                if (obj && obj.isGroup) {
                    const color = v.color || '#3498db';
                    const part = v.part || 'body';
                    if (part === 'body' && obj.children[0]) {
                        obj.children[0].material.color.set(color);
                    } else if (part === 'head' && obj.children[1]) {
                        obj.children[1].material.color.set(color);
                    } else if (part === 'legs') {
                        if (obj.children[2]) obj.children[2].material.color.set(color);
                        if (obj.children[3]) obj.children[3].material.color.set(color);
                    }
                }
                break;
            }

            // Camera
            case 'cameraSwitch': {
                // Use this camera object's position and rotation as the game camera
                const cam = this.scene3d.camera;
                cam.position.copy(obj.position);
                // Look in the direction the camera object faces (local +Z)
                const forward = new THREE.Vector3(0, 0, 1);
                forward.applyQuaternion(obj.quaternion);
                cam.lookAt(obj.position.clone().add(forward));
                this._cameraOverride = true;
                this._cameraObj = obj;
                break;
            }
            case 'cameraSwitchBack': {
                this._cameraOverride = false;
                this._cameraObj = null;
                this._cameraFollow = null;
                break;
            }
            case 'cameraLookAt': {
                const cam2 = this.scene3d.camera;
                const target = v.target || 'player';
                if (target === 'player' && this.playerController) {
                    cam2.lookAt(this.playerController.mesh.position);
                } else if (target === 'this object') {
                    cam2.lookAt(obj.position);
                } else {
                    cam2.lookAt(0, 0, 0);
                }
                break;
            }
            case 'cameraMoveTo': {
                const cam3 = this.scene3d.camera;
                cam3.position.set(
                    parseFloat(v.x) || 0,
                    parseFloat(v.y) || 5,
                    parseFloat(v.z) || 10
                );
                this._cameraOverride = true;
                break;
            }
            case 'cameraGlideTo': {
                const cam4 = this.scene3d.camera;
                const startPos = cam4.position.clone();
                const endPos = new THREE.Vector3(
                    parseFloat(v.x) || 0,
                    parseFloat(v.y) || 5,
                    parseFloat(v.z) || 10
                );
                const duration = (parseFloat(v.time) || 1) * 1000;
                this._cameraOverride = true;
                this.activeAnimations.push({
                    type: 'cameraGlide',
                    startPos,
                    endPos,
                    duration,
                    elapsed: 0
                });
                await this.sleep(duration);
                break;
            }
            case 'cameraFollow': {
                const followTarget = v.target || 'player';
                const dist = parseFloat(v.dist) || 8;
                this._cameraOverride = true;
                this._cameraFollow = { target: followTarget, distance: dist, object: obj };
                break;
            }
            case 'cameraShake': {
                const shakeIntensity = parseFloat(v.intensity) || 0.3;
                const shakeDuration = (parseFloat(v.time) || 0.5) * 1000;
                this.activeAnimations.push({
                    type: 'cameraShake',
                    intensity: shakeIntensity,
                    duration: shakeDuration,
                    elapsed: 0,
                    originalPos: this.scene3d.camera.position.clone()
                });
                break;
            }
            case 'cameraFov': {
                const fov = parseFloat(v.fov) || 75;
                this.scene3d.camera.fov = Math.max(10, Math.min(150, fov));
                this.scene3d.camera.updateProjectionMatrix();
                break;
            }

            // Physics
            case 'enableGravity': {
                obj.userData.anchored = false;
                this.activeAnimations.push({
                    type: 'gravity',
                    object: obj,
                    velocity: 0,
                    elapsed: 0
                });
                break;
            }
            case 'disableGravity': {
                obj.userData.anchored = true;
                break;
            }
            case 'setVelocity': {
                // Find or create gravity animation
                let gravAnim = this.activeAnimations.find(a => a.type === 'gravity' && a.object === obj);
                if (!gravAnim) {
                    gravAnim = { type: 'gravity', object: obj, velocity: 0, elapsed: 0 };
                    this.activeAnimations.push(gravAnim);
                    obj.userData.anchored = false;
                }
                obj.position.x += (parseFloat(v.x) || 0) * 0.016;
                obj.position.z += (parseFloat(v.z) || 0) * 0.016;
                gravAnim.velocity = parseFloat(v.y) || 0;
                break;
            }
            case 'impulse': {
                const force = parseFloat(v.force) || 5;
                const dir2 = v.direction || 'up';
                switch (dir2) {
                    case 'up': obj.position.y += force * 0.1; break;
                    case 'forward': obj.position.z -= force * 0.1; break;
                    case 'backward': obj.position.z += force * 0.1; break;
                    case 'left': obj.position.x -= force * 0.1; break;
                    case 'right': obj.position.x += force * 0.1; break;
                }
                break;
            }
            case 'setAnchored': {
                obj.userData.anchored = v.state === 'true';
                break;
            }
            case 'destroy': {
                obj.visible = false;
                obj.userData.collidable = false;
                break;
            }
            case 'clone': {
                const clone = this.scene3d.duplicateObject(obj);
                if (clone) {
                    clone.userData.isClone = true;
                    clone.position.y += 1;
                }
                break;
            }
            case 'teleportPlayer': {
                if (this.playerController) {
                    this.playerController.mesh.position.set(
                        parseFloat(v.x) || 0,
                        parseFloat(v.y) || 0,
                        parseFloat(v.z) || 0
                    );
                    this.playerController.velocity.set(0, 0, 0);
                }
                break;
            }

            // Sound
            case 'playSound': {
                this.playSynthSound(v.sound || 'pop');
                break;
            }
            case 'setVolume': {
                this.soundVolume = (parseFloat(v.percent) || 100) / 100;
                break;
            }

            // Variables
            case 'setVar': {
                const varName = v.var || 'score';
                this.variables[varName] = parseFloat(v.value) || 0;
                break;
            }
            case 'changeVar': {
                const varName2 = v.var || 'score';
                this.variables[varName2] = (this.variables[varName2] || 0) + (parseFloat(v.amount) || 1);
                break;
            }
            case 'showVar': {
                const varName3 = v.var || 'score';
                this.addHUDElement(varName3);
                break;
            }
            case 'resetVars': {
                this.variables = { score: 0, health: 100, coins: 0, speed: 5, level: 1 };
                if (this.blockCode.customVariables) {
                    this.blockCode.customVariables.forEach(name => { this.variables[name] = 0; });
                }
                break;
            }
            case 'ifVar': {
                const varVal = this.variables[v.var] || 0;
                const checkVal = parseFloat(v.value) || 0;
                let cond = false;
                switch (v.op) {
                    case '>': cond = varVal > checkVal; break;
                    case '<': cond = varVal < checkVal; break;
                    case '=': cond = varVal === checkVal; break;
                    case '>=': cond = varVal >= checkVal; break;
                    case '<=': cond = varVal <= checkVal; break;
                }
                if (cond && cmd.children) {
                    await this.executeCommands(obj, cmd.children);
                }
                break;
            }

            // === Local Variables (per-object) ===
            case 'setLocalVar': {
                if (!obj.userData.localVars) obj.userData.localVars = {};
                obj.userData.localVars[v.var || 'myLocal'] = parseFloat(v.value) || 0;
                break;
            }
            case 'changeLocalVar': {
                if (!obj.userData.localVars) obj.userData.localVars = {};
                const lv = v.var || 'myLocal';
                obj.userData.localVars[lv] = (obj.userData.localVars[lv] || 0) + (parseFloat(v.amount) || 1);
                break;
            }
            case 'ifLocalVar': {
                if (!obj.userData.localVars) obj.userData.localVars = {};
                const lvVal = obj.userData.localVars[v.var] || 0;
                const lvCheck = parseFloat(v.value) || 0;
                let lvCond = false;
                switch (v.op) {
                    case '>': lvCond = lvVal > lvCheck; break;
                    case '<': lvCond = lvVal < lvCheck; break;
                    case '=': lvCond = lvVal === lvCheck; break;
                    case '>=': lvCond = lvVal >= lvCheck; break;
                    case '<=': lvCond = lvVal <= lvCheck; break;
                }
                if (lvCond && cmd.children) {
                    await this.executeCommands(obj, cmd.children);
                }
                break;
            }
            case 'showLocalVar': {
                if (!obj.userData.localVars) obj.userData.localVars = {};
                const lvName = v.var || 'myLocal';
                const lvValue = obj.userData.localVars[lvName] || 0;
                const label = (obj.userData.name || 'Object') + '.' + lvName;
                this.addHUDElement(label, lvValue);
                break;
            }

            // === Cloud Data Variables ===
            case 'cloudSet': {
                const ck = v.key || 'highscore';
                const cv = String(v.value ?? 0);
                if (!this._cloudCache) this._cloudCache = {};
                this._cloudCache[ck] = cv;
                this._cloudStore(ck, cv);
                break;
            }
            case 'cloudGet': {
                const ck2 = v.key || 'highscore';
                const val = await this._cloudFetch(ck2);
                this.addHUDElement('cloud:' + ck2, val);
                break;
            }
            case 'cloudChange': {
                const ck3 = v.key || 'highscore';
                const current = parseFloat(await this._cloudFetch(ck3)) || 0;
                const newVal = current + (parseFloat(v.amount) || 1);
                if (!this._cloudCache) this._cloudCache = {};
                this._cloudCache[ck3] = String(newVal);
                this._cloudStore(ck3, String(newVal));
                break;
            }
            case 'cloudIf': {
                const ck4 = v.key || 'highscore';
                const cloudVal = parseFloat(await this._cloudFetch(ck4)) || 0;
                const cloudCheck = parseFloat(v.value) || 0;
                let cloudCond = false;
                switch (v.op) {
                    case '>': cloudCond = cloudVal > cloudCheck; break;
                    case '<': cloudCond = cloudVal < cloudCheck; break;
                    case '=': cloudCond = cloudVal === cloudCheck; break;
                    case '>=': cloudCond = cloudVal >= cloudCheck; break;
                    case '<=': cloudCond = cloudVal <= cloudCheck; break;
                }
                if (cloudCond && cmd.children) {
                    await this.executeCommands(obj, cmd.children);
                }
                break;
            }

            // New motion blocks
            case 'orbit': {
                this.activeAnimations.push({
                    type: 'orbit', object: obj,
                    centerX: obj.position.x, centerZ: obj.position.z,
                    radius: parseFloat(v.r) || 3,
                    speed: parseFloat(v.s) || 1,
                    elapsed: 0
                });
                break;
            }
            case 'lookAtPlayer': {
                if (this.playerController) {
                    const pp = this.playerController.mesh.position;
                    obj.lookAt(pp.x, obj.position.y, pp.z);
                }
                break;
            }
            case 'randomPos': {
                const range = parseFloat(v.range) || 10;
                obj.position.x = (Math.random() - 0.5) * range * 2;
                obj.position.z = (Math.random() - 0.5) * range * 2;
                break;
            }
            case 'pushFromPlayer': {
                if (this.playerController) {
                    const dir = new THREE.Vector3().subVectors(obj.position, this.playerController.mesh.position);
                    dir.y = 0;
                    dir.normalize().multiplyScalar(parseFloat(v.f) || 3);
                    obj.position.add(dir);
                }
                break;
            }

            // New control
            case 'ifElse': {
                let cond2 = false;
                switch (v.condition) {
                    case 'touching player':
                        if (this.playerController) cond2 = obj.position.distanceTo(this.playerController.mesh.position) < 2;
                        break;
                    case 'key pressed': cond2 = Object.values(this.keys).some(k => k); break;
                    case 'variable > 0': cond2 = (this.variables.score || 0) > 0; break;
                    case 'health < 50': cond2 = (this.variables.health || 100) < 50; break;
                    case 'random chance': cond2 = Math.random() > 0.5; break;
                    case 'distance < 3':
                        if (this.playerController) cond2 = obj.position.distanceTo(this.playerController.mesh.position) < 3;
                        break;
                }
                if (cond2 && cmd.children) await this.executeCommands(obj, cmd.children);
                break;
            }
            case 'waitUntil': {
                const checkCond = async () => {
                    while (this.isRunning) {
                        let met = false;
                        switch (v.condition) {
                            case 'touching player':
                                if (this.playerController) met = obj.position.distanceTo(this.playerController.mesh.position) < 2;
                                break;
                            case 'key pressed': met = Object.values(this.keys).some(k => k); break;
                            case 'timer > 5': met = this.gameTimer > 5; break;
                        }
                        if (met) break;
                        await this.sleep(50);
                    }
                };
                await checkCond();
                break;
            }

            // New looks
            case 'scalePulse': {
                this.activeAnimations.push({
                    type: 'scalePulse', object: obj,
                    min: (parseFloat(v.min) || 80) / 100,
                    max: (parseFloat(v.max) || 120) / 100,
                    speed: parseFloat(v.spd) || 2,
                    baseScale: obj.scale.clone(),
                    elapsed: 0
                });
                break;
            }
            case 'trail': {
                // Simplified particle trail
                this.activeAnimations.push({
                    type: 'trail', object: obj,
                    color: v.color || '#ffff00',
                    elapsed: 0, lastSpawn: 0
                });
                break;
            }

            // New physics
            case 'explode': {
                const force = parseFloat(v.force) || 10;
                const radius = parseFloat(v.radius) || 5;
                this.scene3d.objects.forEach(other => {
                    if (other === obj) return;
                    const dist = other.position.distanceTo(obj.position);
                    if (dist < radius && dist > 0.1) {
                        const pushDir = new THREE.Vector3().subVectors(other.position, obj.position).normalize();
                        const strength = (1 - dist / radius) * force * 0.1;
                        other.position.add(pushDir.multiplyScalar(strength));
                        other.position.y += strength * 0.5;
                    }
                });
                if (this.playerController) {
                    const pd = this.playerController.mesh.position.distanceTo(obj.position);
                    if (pd < radius) {
                        this.playerController.velocity.y += (1 - pd / radius) * force;
                    }
                }
                this.playSynthSound('boom');
                break;
            }
            case 'launchPlayer': {
                if (this.playerController) {
                    this.playerController.velocity.y = parseFloat(v.force) || 15;
                    this.playerController.isGrounded = false;
                }
                break;
            }
            case 'setPlayerSpeed': {
                if (this.playerController) {
                    this.playerController.speed = parseFloat(v.speed) || 6;
                }
                break;
            }

            // New sound
            case 'playTone': {
                if (this.audioCtx) {
                    const osc = this.audioCtx.createOscillator();
                    const g = this.audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = parseFloat(v.freq) || 440;
                    g.gain.value = this.soundVolume * 0.3;
                    const now = this.audioCtx.currentTime;
                    const dur = parseFloat(v.dur) || 0.3;
                    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
                    osc.connect(g); g.connect(this.audioCtx.destination);
                    osc.start(now); osc.stop(now + dur);
                }
                break;
            }

            // ===== Particle Effects =====
            case 'emitParticles': {
                const pType = v.type || 'burst';
                const pColor = new THREE.Color(v.color || '#ffff00');
                const count = pType === 'snow' ? 200 : 30;
                const positions = new Float32Array(count * 3);
                const velocities = [];
                for (let i = 0; i < count; i++) {
                    positions[i * 3] = obj.position.x;
                    positions[i * 3 + 1] = obj.position.y + 1;
                    positions[i * 3 + 2] = obj.position.z;
                    let vx, vy, vz;
                    switch (pType) {
                        case 'burst':
                            vx = (Math.random() - 0.5) * 4;
                            vy = Math.random() * 5 + 2;
                            vz = (Math.random() - 0.5) * 4;
                            break;
                        case 'sparkle':
                            vx = (Math.random() - 0.5) * 2;
                            vy = Math.random() * 3 + 1;
                            vz = (Math.random() - 0.5) * 2;
                            break;
                        case 'fire':
                            vx = (Math.random() - 0.5) * 0.8;
                            vy = Math.random() * 4 + 2;
                            vz = (Math.random() - 0.5) * 0.8;
                            break;
                        case 'snow':
                            vx = (Math.random() - 0.5) * 0.5;
                            vy = -(Math.random() * 1 + 0.5);
                            vz = (Math.random() - 0.5) * 0.5;
                            positions[i * 3] = obj.position.x + (Math.random() - 0.5) * 10;
                            positions[i * 3 + 1] = obj.position.y + 8;
                            positions[i * 3 + 2] = obj.position.z + (Math.random() - 0.5) * 10;
                            break;
                    }
                    velocities.push(new THREE.Vector3(vx, vy, vz));
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                const mat = new THREE.PointsMaterial({
                    color: pColor, size: pType === 'fire' ? 0.3 : 0.2,
                    transparent: true, opacity: 0.9, sizeAttenuation: true
                });
                const points = new THREE.Points(geo, mat);
                points.userData._isParticle = true;
                points.userData._velocities = velocities;
                points.userData._life = pType === 'snow' ? 8 : 2;
                points.userData._elapsed = 0;
                points.userData._sourceObj = obj;
                this.scene3d.scene.add(points);
                if (!this._particles) this._particles = [];
                this._particles.push(points);
                this.activeAnimations.push({
                    type: 'particles', points, velocities,
                    life: points.userData._life, elapsed: 0, particleType: pType
                });
                break;
            }
            case 'stopParticles': {
                if (this._particles) {
                    this._particles.forEach(p => {
                        this.scene3d.scene.remove(p);
                        p.geometry.dispose();
                        p.material.dispose();
                    });
                    this._particles = [];
                    this.activeAnimations = this.activeAnimations.filter(a => a.type !== 'particles');
                }
                break;
            }

            // ===== New Motion Blocks =====
            case 'smoothMove': {
                const amt = parseFloat(v.amt) || 3;
                const time = parseFloat(v.time) || 0.5;
                const dir = v.dir || 'forward';
                const startPos = obj.position.clone();
                const endPos = startPos.clone();
                switch (dir) {
                    case 'forward': endPos.z -= amt; break;
                    case 'backward': endPos.z += amt; break;
                    case 'left': endPos.x -= amt; break;
                    case 'right': endPos.x += amt; break;
                    case 'up': endPos.y += amt; break;
                    case 'down': endPos.y -= amt; break;
                }
                this.activeAnimations.push({
                    type: 'glide',
                    object: obj,
                    startPos: startPos,
                    endPos: endPos,
                    duration: time,
                    elapsed: 0
                });
                await this.sleep(time * 1000);
                break;
            }
            case 'snapToGrid': {
                const size = parseFloat(v.size) || 1;
                obj.position.x = Math.round(obj.position.x / size) * size;
                obj.position.y = Math.round(obj.position.y / size) * size;
                obj.position.z = Math.round(obj.position.z / size) * size;
                break;
            }
            case 'faceDirection': {
                const dir = v.dir || 'north';
                switch (dir) {
                    case 'north': obj.rotation.y = 0; break;
                    case 'south': obj.rotation.y = Math.PI; break;
                    case 'east': obj.rotation.y = -Math.PI / 2; break;
                    case 'west': obj.rotation.y = Math.PI / 2; break;
                    case 'player': {
                        if (this.playerController) {
                            const pp = this.playerController.mesh.position;
                            obj.lookAt(pp.x, obj.position.y, pp.z);
                        }
                        break;
                    }
                }
                break;
            }
            case 'setRotation': {
                obj.rotation.x = THREE.MathUtils.degToRad(parseFloat(v.x) || 0);
                obj.rotation.y = THREE.MathUtils.degToRad(parseFloat(v.y) || 0);
                obj.rotation.z = THREE.MathUtils.degToRad(parseFloat(v.z) || 0);
                break;
            }

            // ===== New Control Blocks =====
            case 'broadcast': {
                this.triggerEvent('onMessage', { msg: v.msg });
                break;
            }
            case 'while': {
                const evalWhileCondition = () => {
                    switch (v.condition) {
                        case 'touching player':
                            if (this.playerController) return obj.position.distanceTo(this.playerController.mesh.position) < 2;
                            return false;
                        case 'key pressed':
                            return Object.values(this.keys).some(k => k);
                        case 'variable > 0':
                            return (this.variables.score || 0) > 0;
                        case 'health > 0':
                            return (this.variables.health || 0) > 0;
                        case 'timer < 10':
                            return this.gameTimer < 10;
                        default:
                            return false;
                    }
                };
                while (this.isRunning && evalWhileCondition()) {
                    if (cmd.children) {
                        await this.executeCommands(obj, cmd.children);
                    }
                    await this.sleep(16);
                }
                break;
            }
            case 'forEach': {
                const varName = v.var || 'i';
                const start = parseInt(v.start) || 1;
                const end = parseInt(v.end) || 10;
                const step = start <= end ? 1 : -1;
                for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
                    if (!this.isRunning) break;
                    this.variables[varName] = i;
                    if (cmd.children) {
                        await this.executeCommands(obj, cmd.children);
                    }
                }
                break;
            }

            // ===== New Looks Blocks =====
            case 'tint': {
                const tintColor = new THREE.Color(v.color || '#ff0000');
                const amount = (parseFloat(v.amount) || 50) / 100;
                const applyTint = (material) => {
                    if (!material) return;
                    const origColor = material.color.clone();
                    material.color.lerp(tintColor, amount);
                };
                if (obj.material) applyTint(obj.material);
                obj.traverse(child => {
                    if (child.material && child !== obj) applyTint(child.material);
                });
                break;
            }
            case 'wireframe': {
                const wireOn = v.state === 'on';
                if (obj.material) {
                    obj.material.wireframe = wireOn;
                }
                obj.traverse(child => {
                    if (child.material && child !== obj) {
                        child.material.wireframe = wireOn;
                    }
                });
                break;
            }
            case 'flash': {
                const flashColor = new THREE.Color(v.color || '#ffffff');
                const times = parseInt(v.times) || 3;
                const origColors = [];
                if (obj.material) origColors.push({ mat: obj.material, color: obj.material.color.clone() });
                obj.traverse(child => {
                    if (child.material && child !== obj) origColors.push({ mat: child.material, color: child.material.color.clone() });
                });
                for (let i = 0; i < times && this.isRunning; i++) {
                    // Flash on
                    origColors.forEach(entry => entry.mat.color.copy(flashColor));
                    await this.sleep(100);
                    // Flash off (restore)
                    origColors.forEach(entry => entry.mat.color.copy(entry.color));
                    await this.sleep(100);
                }
                break;
            }
            case 'billboardText': {
                const text = v.text || 'Label';
                // Persistent speech bubble (no timeout)
                const bubble = document.createElement('div');
                bubble.className = 'speech-bubble-3d';
                bubble.textContent = text;
                bubble.style.cssText = `
                    position: fixed;
                    background: white;
                    color: #333;
                    padding: 8px 14px;
                    border-radius: 12px;
                    font-size: 13px !important;
                    font-weight: 500;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                    pointer-events: none;
                    z-index: 1000;
                    transform: translate(-50%, -100%);
                    white-space: nowrap;
                `;
                document.body.appendChild(bubble);
                const updatePos = () => {
                    if (!bubble.parentElement || !this.isRunning) {
                        bubble.remove();
                        return;
                    }
                    const pos = obj.position.clone();
                    pos.y += 2;
                    pos.project(this.scene3d.camera);
                    const rect = this.scene3d.canvas.getBoundingClientRect();
                    bubble.style.left = ((pos.x + 1) / 2 * rect.width + rect.left) + 'px';
                    bubble.style.top = ((-pos.y + 1) / 2 * rect.height + rect.top) + 'px';
                    requestAnimationFrame(updatePos);
                };
                updatePos();
                break;
            }

            // ===== New Physics Blocks =====
            case 'freeze': {
                obj.userData.anchored = true;
                // Remove any gravity animations for this object
                this.activeAnimations = this.activeAnimations.filter(
                    a => !(a.type === 'gravity' && a.object === obj)
                );
                break;
            }
            case 'unfreeze': {
                obj.userData.anchored = false;
                this.activeAnimations.push({
                    type: 'gravity',
                    object: obj,
                    velocity: 0,
                    elapsed: 0
                });
                break;
            }
            case 'attract': {
                const force = parseFloat(v.force) || 3;
                const radius = parseFloat(v.radius) || 8;
                this.scene3d.objects.forEach(other => {
                    if (other === obj || !other.visible) return;
                    const dist = other.position.distanceTo(obj.position);
                    if (dist < radius && dist > 0.1) {
                        const pullDir = new THREE.Vector3().subVectors(obj.position, other.position).normalize();
                        const strength = (1 - dist / radius) * force * 0.05;
                        other.position.add(pullDir.multiplyScalar(strength));
                    }
                });
                if (this.playerController) {
                    const pd = this.playerController.mesh.position.distanceTo(obj.position);
                    if (pd < radius && pd > 0.1) {
                        const pullDir = new THREE.Vector3().subVectors(obj.position, this.playerController.mesh.position).normalize();
                        const strength = (1 - pd / radius) * force * 0.05;
                        this.playerController.mesh.position.add(pullDir.multiplyScalar(strength));
                    }
                }
                break;
            }
            case 'setWorldGravity': {
                const g = parseFloat(v.g);
                if (this.playerController) {
                    this.playerController.gravity = isNaN(g) ? -20 : g;
                }
                break;
            }
            case 'spawnObject': {
                const shape = v.shape || 'box';
                const ox = parseFloat(v.x) || 0;
                const oy = parseFloat(v.y) || 2;
                const oz = parseFloat(v.z) || 0;
                const spawnPos = new THREE.Vector3(
                    obj.position.x + ox,
                    obj.position.y + oy,
                    obj.position.z + oz
                );
                const spawned = this._createSpawnedMesh(shape, 0x59c059);
                spawned.position.copy(spawnPos);
                this.scene3d.scene.add(spawned);
                this.scene3d.objects.push(spawned);
                this._spawnedObjects.push(spawned);
                break;
            }
            case 'spawnObjectColor': {
                const shape2 = v.shape || 'box';
                const color = new THREE.Color(v.color || '#4c97ff');
                const spawned2 = this._createSpawnedMesh(shape2, color);
                spawned2.position.copy(obj.position);
                spawned2.position.y += 1;
                this.scene3d.scene.add(spawned2);
                this.scene3d.objects.push(spawned2);
                this._spawnedObjects.push(spawned2);
                break;
            }
            case 'spawnAtPlayer': {
                if (this.playerController) {
                    const shape3 = v.shape || 'box';
                    const spawned3 = this._createSpawnedMesh(shape3, 0x59c059);
                    spawned3.position.copy(this.playerController.mesh.position);
                    spawned3.position.y += 1;
                    this.scene3d.scene.add(spawned3);
                    this.scene3d.objects.push(spawned3);
                    this._spawnedObjects.push(spawned3);
                }
                break;
            }
            case 'removeLastSpawned': {
                if (this._spawnedObjects.length > 0) {
                    const last = this._spawnedObjects.pop();
                    this.scene3d.scene.remove(last);
                    const idx = this.scene3d.objects.indexOf(last);
                    if (idx !== -1) this.scene3d.objects.splice(idx, 1);
                    if (last.geometry) last.geometry.dispose();
                    if (last.material) last.material.dispose();
                }
                break;
            }
            case 'removeAllSpawned': {
                this._spawnedObjects.forEach(s => {
                    this.scene3d.scene.remove(s);
                    const idx = this.scene3d.objects.indexOf(s);
                    if (idx !== -1) this.scene3d.objects.splice(idx, 1);
                    if (s.geometry) s.geometry.dispose();
                    if (s.material) s.material.dispose();
                });
                this._spawnedObjects = [];
                break;
            }
            case 'cloneAt': {
                const cx = parseFloat(v.x) || 0;
                const cy = parseFloat(v.y) || 0;
                const cz = parseFloat(v.z) || 0;
                const cloned = obj.clone();
                cloned.position.set(cx, cy, cz);
                cloned.userData = { ...obj.userData, id: 'clone_' + Date.now(), isClone: true, scripts: [] };
                this.scene3d.scene.add(cloned);
                this.scene3d.objects.push(cloned);
                this._spawnedObjects.push(cloned);
                break;
            }

            // ===== New Sound Blocks =====
            case 'stopAllSounds': {
                if (this.audioCtx) {
                    this.audioCtx.close();
                    this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                }
                break;
            }
            case 'playNote': {
                if (this.audioCtx) {
                    const noteFreqs = {
                        'C4': 261.63, 'D4': 293.66, 'E4': 329.63, 'F4': 349.23,
                        'G4': 392.00, 'A4': 440.00, 'B4': 493.88, 'C5': 523.25
                    };
                    const freq = noteFreqs[v.note] || 261.63;
                    const dur = parseFloat(v.dur) || 0.3;
                    const now = this.audioCtx.currentTime;
                    const osc = this.audioCtx.createOscillator();
                    const g = this.audioCtx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now);
                    g.gain.setValueAtTime(this.soundVolume * 0.3, now);
                    g.gain.setValueAtTime(this.soundVolume * 0.3, now + dur * 0.7);
                    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
                    osc.connect(g);
                    g.connect(this.audioCtx.destination);
                    osc.start(now);
                    osc.stop(now + dur);
                }
                break;
            }
            case 'playDrum': {
                if (this.audioCtx) {
                    const ctx = this.audioCtx;
                    const now = ctx.currentTime;
                    const drumType = v.type || 'kick';
                    switch (drumType) {
                        case 'kick': {
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = 'sine';
                            osc.frequency.setValueAtTime(150, now);
                            osc.frequency.exponentialRampToValueAtTime(30, now + 0.15);
                            g.gain.setValueAtTime(this.soundVolume * 0.5, now);
                            g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                            osc.connect(g);
                            g.connect(ctx.destination);
                            osc.start(now);
                            osc.stop(now + 0.2);
                            break;
                        }
                        case 'snare': {
                            // Noise burst + tone
                            const bufferSize = ctx.sampleRate * 0.15;
                            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                            const data = buffer.getChannelData(0);
                            for (let i = 0; i < bufferSize; i++) {
                                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
                            }
                            const noise = ctx.createBufferSource();
                            noise.buffer = buffer;
                            const noiseGain = ctx.createGain();
                            noiseGain.gain.setValueAtTime(this.soundVolume * 0.4, now);
                            noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                            const filter = ctx.createBiquadFilter();
                            filter.type = 'highpass';
                            filter.frequency.value = 1000;
                            noise.connect(filter);
                            filter.connect(noiseGain);
                            noiseGain.connect(ctx.destination);
                            noise.start(now);
                            // Tone body
                            const osc = ctx.createOscillator();
                            const g = ctx.createGain();
                            osc.type = 'triangle';
                            osc.frequency.setValueAtTime(200, now);
                            osc.frequency.exponentialRampToValueAtTime(100, now + 0.05);
                            g.gain.setValueAtTime(this.soundVolume * 0.3, now);
                            g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                            osc.connect(g);
                            g.connect(ctx.destination);
                            osc.start(now);
                            osc.stop(now + 0.1);
                            break;
                        }
                        case 'hihat': {
                            const bufferSize = ctx.sampleRate * 0.08;
                            const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                            const data = buffer.getChannelData(0);
                            for (let i = 0; i < bufferSize; i++) {
                                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
                            }
                            const noise = ctx.createBufferSource();
                            noise.buffer = buffer;
                            const g = ctx.createGain();
                            g.gain.setValueAtTime(this.soundVolume * 0.2, now);
                            g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
                            const filter = ctx.createBiquadFilter();
                            filter.type = 'highpass';
                            filter.frequency.value = 5000;
                            noise.connect(filter);
                            filter.connect(g);
                            g.connect(ctx.destination);
                            noise.start(now);
                            break;
                        }
                        case 'clap': {
                            // Multiple short noise bursts
                            for (let b = 0; b < 3; b++) {
                                const offset = b * 0.01;
                                const bufferSize = ctx.sampleRate * 0.04;
                                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                                const data = buffer.getChannelData(0);
                                for (let i = 0; i < bufferSize; i++) {
                                    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
                                }
                                const noise = ctx.createBufferSource();
                                noise.buffer = buffer;
                                const g = ctx.createGain();
                                g.gain.setValueAtTime(this.soundVolume * 0.3, now + offset);
                                g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.08);
                                const filter = ctx.createBiquadFilter();
                                filter.type = 'bandpass';
                                filter.frequency.value = 2000;
                                filter.Q.value = 1;
                                noise.connect(filter);
                                filter.connect(g);
                                g.connect(ctx.destination);
                                noise.start(now + offset);
                            }
                            break;
                        }
                    }
                }
                break;
            }

            // ===== Custom Sound ====
            case 'playCustomSound': {
                const soundName = v.sound;
                if (soundName && soundName !== '(none)') {
                    this._playCustomSound(soundName);
                }
                break;
            }

            // ===== Animation Blocks =====
            case 'playAnimation': {
                const animName = v.anim;
                if (animName && animName !== '(none)' && obj.userData.animations && obj.userData.animations[animName]) {
                    // Remove any existing keyframe animation for this object
                    this.activeAnimations = this.activeAnimations.filter(a => !(a.type === 'keyframe' && a.object === obj));
                    const animData = obj.userData.animations[animName];
                    this.activeAnimations.push({
                        type: 'keyframe', object: obj, elapsed: 0,
                        keyframes: animData.keyframes, loop: false
                    });
                }
                break;
            }
            case 'playAnimationLoop': {
                const animName2 = v.anim;
                if (animName2 && animName2 !== '(none)' && obj.userData.animations && obj.userData.animations[animName2]) {
                    this.activeAnimations = this.activeAnimations.filter(a => !(a.type === 'keyframe' && a.object === obj));
                    const animData2 = obj.userData.animations[animName2];
                    this.activeAnimations.push({
                        type: 'keyframe', object: obj, elapsed: 0,
                        keyframes: animData2.keyframes, loop: true
                    });
                }
                break;
            }
            case 'stopAnimation': {
                this.activeAnimations = this.activeAnimations.filter(a => !(a.type === 'keyframe' && a.object === obj));
                break;
            }

            // ===== New Variables Blocks =====
            case 'showMessage': {
                const text = v.text || 'You win!';
                const time = (parseFloat(v.time) || 3) * 1000;
                const msgEl = document.createElement('div');
                msgEl.style.cssText = `
                    position: fixed;
                    top: 30%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    background: rgba(0,0,0,0.8);
                    color: white;
                    padding: 24px 48px;
                    border-radius: 16px;
                    font-size: 28px !important;
                    font-weight: 700;
                    z-index: 10000;
                    pointer-events: none;
                    text-align: center;
                    backdrop-filter: blur(8px);
                    transition: opacity 0.5s;
                `;
                msgEl.textContent = text;
                document.body.appendChild(msgEl);
                // Fade out near end
                setTimeout(() => {
                    msgEl.style.opacity = '0';
                }, time - 500);
                setTimeout(() => {
                    msgEl.remove();
                }, time);
                await this.sleep(time);
                break;
            }
            case 'gameOver': {
                const result = v.result || 'win';
                const overlay = document.createElement('div');
                overlay.style.cssText = `
                    position: absolute;
                    top: 0; left: 0; right: 0; bottom: 0;
                    z-index: 90;
                    background: ${result === 'win' ? 'rgba(40,120,40,0.85)' : 'rgba(120,30,30,0.85)'};
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10001;
                    backdrop-filter: blur(4px);
                `;
                const title = document.createElement('div');
                title.style.cssText = 'color:white;font-size:56px !important;font-weight:800;margin-bottom:16px;text-shadow:0 4px 12px rgba(0,0,0,0.4);';
                title.textContent = result === 'win' ? 'YOU WIN!' : 'GAME OVER';
                const sub = document.createElement('div');
                sub.style.cssText = 'color:rgba(255,255,255,0.8);font-size:20px !important;font-weight:500;margin-bottom:32px;';
                sub.textContent = `Score: ${this.variables.score || 0}`;
                const btn = document.createElement('button');
                btn.style.cssText = 'background:white;color:#333;border:none;padding:12px 36px;border-radius:12px;font-size:18px !important;font-weight:600;cursor:pointer;';
                btn.textContent = 'Press ESC to exit';
                overlay.appendChild(title);
                overlay.appendChild(sub);
                overlay.appendChild(btn);
                (this._getElement('playOverlay', 'play-overlay') || document.getElementById('viewport-container') || document.body).appendChild(overlay);
                btn.addEventListener('click', () => {
                    overlay.remove();
                    this.stop();
                });
                // Also remove overlay when game stops
                const checkStop = setInterval(() => {
                    if (!this.isRunning) {
                        overlay.remove();
                        clearInterval(checkStop);
                    }
                }, 200);
                break;
            }
            case 'saveCheckpoint': {
                if (this.playerController) {
                    this._checkpoint = {
                        position: this.playerController.mesh.position.clone(),
                        velocity: this.playerController.velocity.clone(),
                        variables: { ...this.variables }
                    };
                }
                break;
            }
            case 'loadCheckpoint': {
                if (this.playerController && this._checkpoint) {
                    this.playerController.mesh.position.copy(this._checkpoint.position);
                    this.playerController.velocity.copy(this._checkpoint.velocity);
                    Object.assign(this.variables, this._checkpoint.variables);
                }
                break;
            }

            // ===== Shooting Blocks =====
            case 'fireFromPlayer': {
                if (!this.playerController) break;
                if (!this._canFire(this.playerController.mesh)) break;
                const cam = this.scene3d.camera;
                const spawnPos = cam.position.clone();
                const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
                spawnPos.add(fwd.clone().multiplyScalar(1));
                const speed = parseFloat(v.speed) || 30;
                this._createProjectile(spawnPos, fwd.multiplyScalar(speed), v.color || '#ff0000', this.playerController.mesh);
                this._playShootSound();
                break;
            }
            case 'fireAtPlayer': {
                if (!this.playerController) break;
                if (!this._canFire(obj)) break;
                const spawnPos = obj.position.clone();
                spawnPos.y += 0.5;
                const targetPos = this.playerController.mesh.position.clone();
                targetPos.y += 0.5;
                const dir = new THREE.Vector3().subVectors(targetPos, spawnPos).normalize();
                const speed = parseFloat(v.speed) || 20;
                this._createProjectile(spawnPos, dir.multiplyScalar(speed), v.color || '#ff4400', obj);
                this._playShootSound();
                break;
            }
            case 'fireForward': {
                if (!this._canFire(obj)) break;
                const spawnPos = obj.position.clone();
                const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(obj.quaternion);
                spawnPos.add(fwd.clone().multiplyScalar(1));
                const speed = parseFloat(v.speed) || 25;
                this._createProjectile(spawnPos, fwd.multiplyScalar(speed), v.color || '#00ccff', obj);
                this._playShootSound();
                break;
            }
            case 'setProjectileDamage': {
                const id = obj.userData.id;
                if (!this._projectileConfig.has(id)) this._projectileConfig.set(id, {});
                this._projectileConfig.get(id).damage = parseFloat(v.damage) || 10;
                break;
            }
            case 'setFireRate': {
                const id = obj.userData.id;
                const cooldown = parseFloat(v.seconds) || 0.3;
                if (!this._fireRates.has(id)) {
                    this._fireRates.set(id, { cooldown, lastFired: 0 });
                } else {
                    this._fireRates.get(id).cooldown = cooldown;
                }
                break;
            }
            case 'setProjectileSize': {
                const id = obj.userData.id;
                if (!this._projectileConfig.has(id)) this._projectileConfig.set(id, {});
                this._projectileConfig.get(id).size = parseFloat(v.size) || 0.15;
                break;
            }
            case 'setProjectileLifetime': {
                const id = obj.userData.id;
                if (!this._projectileConfig.has(id)) this._projectileConfig.set(id, {});
                this._projectileConfig.get(id).lifetime = parseFloat(v.seconds) || 3;
                break;
            }

            // ===== Health/Damage =====
            case 'setMaxHealth': {
                this.maxHealth = parseFloat(v.value) || 100;
                break;
            }
            case 'setHealth': {
                this.variables.health = parseFloat(v.value) || 100;
                break;
            }
            case 'changeHealth': {
                const amt = parseFloat(v.amount) || 0;
                if (amt < 0 && this.gameTimer < this._invincibleUntil) break;
                this.variables.health = Math.max(0, Math.min(this.maxHealth,
                    (this.variables.health || 0) + amt));
                break;
            }
            case 'heal': {
                const healAmt = parseFloat(v.amount) || 25;
                this.variables.health = Math.min(this.maxHealth,
                    (this.variables.health || 0) + healAmt);
                this.playSynthSound('powerup');
                break;
            }
            case 'showHealthBar': {
                this._showingHealthBar = true;
                break;
            }
            case 'setContactDamage': {
                this._contactDamage.set(obj.userData.id, parseFloat(v.damage) || 10);
                break;
            }
            case 'setInvincibility': {
                this._invincibleUntil = this.gameTimer + (parseFloat(v.seconds) || 1);
                break;
            }

            // ===== Enemies =====
            case 'setAsEnemy': {
                const health = parseFloat(v.health) || 50;
                this._enemies.set(obj.userData.id, { health, maxHealth: health, showBar: false });
                break;
            }
            case 'enemyFollow': {
                this.activeAnimations.push({
                    type: 'followPlayer', object: obj,
                    speed: parseFloat(v.speed) || 3, elapsed: 0
                });
                break;
            }
            case 'enemyPatrol': {
                this.activeAnimations.push({
                    type: 'patrol', object: obj,
                    baseX: obj.position.x,
                    distance: parseFloat(v.dist) || 5,
                    speed: parseFloat(v.speed) || 2, elapsed: 0
                });
                break;
            }
            case 'enemyWander': {
                this.activeAnimations.push({
                    type: 'wander', object: obj,
                    radius: parseFloat(v.radius) || 5,
                    speed: parseFloat(v.speed) || 1.5,
                    baseX: obj.position.x, baseZ: obj.position.z,
                    targetX: obj.position.x, targetZ: obj.position.z,
                    elapsed: 0, nextChange: 0
                });
                break;
            }
            case 'enemyAttackTouch': {
                this._contactDamage.set(obj.userData.id, parseFloat(v.damage) || 10);
                break;
            }
            case 'enemyAttackRanged': {
                const interval = (parseFloat(v.seconds) || 2) * 1000;
                const damage = parseFloat(v.damage) || 5;
                const attackInterval = setInterval(() => {
                    if (!this.isRunning || !obj.visible) { clearInterval(attackInterval); return; }
                    if (!this.playerController) return;
                    const dist = obj.position.distanceTo(this.playerController.mesh.position);
                    if (dist < 15) {
                        const spawnPos = obj.position.clone(); spawnPos.y += 0.5;
                        const targetPos = this.playerController.mesh.position.clone(); targetPos.y += 0.5;
                        const dir = new THREE.Vector3().subVectors(targetPos, spawnPos).normalize();
                        if (!this._projectileConfig.has(obj.userData.id)) {
                            this._projectileConfig.set(obj.userData.id, {});
                        }
                        this._projectileConfig.get(obj.userData.id).damage = damage;
                        this._createProjectile(spawnPos, dir.multiplyScalar(15), '#ff4400', obj);
                    }
                }, interval);
                this._timerIntervals.push(attackInterval);
                break;
            }
            case 'setEnemyHealth': {
                const data = this._enemies.get(obj.userData.id);
                if (data) {
                    data.health = parseFloat(v.value) || 50;
                    data.maxHealth = Math.max(data.maxHealth, data.health);
                }
                break;
            }
            case 'showEnemyHealthBar': {
                const data = this._enemies.get(obj.userData.id);
                if (data) data.showBar = true;
                break;
            }

            // ===== Items/Inventory =====
            case 'setAsPickup': {
                const config = this._pickupConfig.get(obj.userData.id) || {};
                config.type = v.type || 'key';
                if (!config.name) config.name = config.type;
                if (!config.effect) config.effect = 'none';
                if (!config.effectAmount) config.effectAmount = 0;
                this._pickupConfig.set(obj.userData.id, config);
                break;
            }
            case 'setPickupName': {
                const config = this._pickupConfig.get(obj.userData.id) || { type: 'custom', effect: 'none', effectAmount: 0 };
                config.name = v.name || 'Item';
                this._pickupConfig.set(obj.userData.id, config);
                break;
            }
            case 'setPickupEffect': {
                const config = this._pickupConfig.get(obj.userData.id) || { type: 'custom', name: 'Item' };
                config.effect = v.effect || 'none';
                config.effectAmount = parseFloat(v.amount) || 25;
                this._pickupConfig.set(obj.userData.id, config);
                break;
            }
            case 'addToInventory': {
                const itemName = v.item || 'Item';
                const existing = this.inventory.find(i => i.name === itemName);
                if (existing) { existing.count++; }
                else { this.inventory.push({ name: itemName, type: 'custom', count: 1 }); }
                break;
            }
            case 'removeFromInventory': {
                const itemName = v.item || 'Item';
                const idx = this.inventory.findIndex(i => i.name === itemName);
                if (idx !== -1) {
                    this.inventory[idx].count--;
                    if (this.inventory[idx].count <= 0) this.inventory.splice(idx, 1);
                }
                break;
            }
            case 'ifHasItem': {
                const hasItem = this.inventory.some(i => i.name === (v.item || 'Item') && i.count > 0);
                if (hasItem && cmd.children) {
                    await this.executeCommands(obj, cmd.children);
                }
                break;
            }
            case 'useItem': {
                const uItemName = v.item || 'Item';
                const uIdx = this.inventory.findIndex(i => i.name === uItemName && i.count > 0);
                if (uIdx !== -1) {
                    this.inventory[uIdx].count--;
                    if (this.inventory[uIdx].count <= 0) this.inventory.splice(uIdx, 1);
                }
                break;
            }
            case 'showInventory': {
                this._showingInventory = true;
                break;
            }

            // ===== Music =====
            case 'playMusic': {
                this._startMusic(v.track || 'adventure');
                break;
            }
            case 'stopMusic': {
                this._stopMusic();
                break;
            }
            case 'setMusicVolume': {
                this._musicVolume = (parseFloat(v.percent) || 50) / 100;
                if (this._musicNodes && this._musicNodes.masterGain) {
                    this._musicNodes.masterGain.gain.value = this._musicVolume;
                }
                break;
            }

            // ===== More Motion Blocks =====
            case 'zigzag': {
                this.activeAnimations.push({
                    type: 'zigzag', object: obj,
                    baseX: obj.position.x,
                    width: parseFloat(v.w) || 3,
                    speed: parseFloat(v.s) || 2,
                    phase: 0, elapsed: 0
                });
                break;
            }
            case 'spiral': {
                this.activeAnimations.push({
                    type: 'spiral', object: obj,
                    baseX: obj.position.x,
                    baseZ: obj.position.z,
                    radius: parseFloat(v.r) || 3,
                    speed: parseFloat(v.s) || 1,
                    angle: 0, elapsed: 0
                });
                break;
            }
            case 'hover': {
                this.activeAnimations.push({
                    type: 'hover', object: obj,
                    baseY: obj.position.y,
                    height: parseFloat(v.h) || 0.5,
                    speed: parseFloat(v.s) || 1.5,
                    phase: 0, elapsed: 0
                });
                break;
            }
            case 'teleportObject': {
                obj.position.set(
                    parseFloat(v.x) || 0,
                    parseFloat(v.y) || 5,
                    parseFloat(v.z) || 0
                );
                break;
            }
            case 'launchUp': {
                const launchForce = parseFloat(v.force) || 10;
                this.activeAnimations.push({
                    type: 'launchArc', object: obj,
                    vy: launchForce,
                    groundY: obj.position.y,
                    elapsed: 0
                });
                break;
            }
            case 'moveToward': {
                if (this.playerController) {
                    const mtSpeed = parseFloat(v.speed) || 3;
                    const mtDist = parseFloat(v.dist) || 2;
                    const pp = this.playerController.mesh.position;
                    const dx = pp.x - obj.position.x;
                    const dz = pp.z - obj.position.z;
                    const dist = Math.sqrt(dx * dx + dz * dz);
                    if (dist > mtDist) {
                        const step = mtSpeed * (1 / 60);
                        obj.position.x += (dx / dist) * step;
                        obj.position.z += (dz / dist) * step;
                        obj.rotation.y = Math.atan2(dx, dz);
                    }
                }
                break;
            }

            // ===== Game Logic Blocks =====
            case 'setLives': {
                this._lives = parseInt(v.n) || 3;
                break;
            }
            case 'changeLives': {
                this._lives += parseInt(v.n) || -1;
                break;
            }
            case 'showLives': {
                this._showingLives = true;
                break;
            }
            case 'showDialog': {
                const dialogText = v.text || 'Hello!';
                const overlay = document.createElement('div');
                overlay.style.cssText = `
                    position:absolute;top:0;left:0;right:0;bottom:0;
                    background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;
                    z-index:90;backdrop-filter:blur(4px);
                `;
                const box = document.createElement('div');
                box.style.cssText = `
                    background:white;color:#333;padding:32px 48px;border-radius:16px;
                    font-size:20px !important;font-weight:500;text-align:center;max-width:400px;
                    box-shadow:0 8px 32px rgba(0,0,0,0.3);
                `;
                box.textContent = dialogText;
                const btn = document.createElement('button');
                btn.textContent = 'OK';
                btn.style.cssText = `
                    display:block;margin:20px auto 0;padding:10px 32px;border:none;
                    background:#4C97FF;color:white;border-radius:8px;font-size:16px !important;
                    font-weight:600;cursor:pointer;
                `;
                box.appendChild(btn);
                overlay.appendChild(box);
                (this._getElement('playOverlay', 'play-overlay') || document.getElementById('viewport-container') || document.body).appendChild(overlay);
                await new Promise(resolve => {
                    btn.addEventListener('click', () => { overlay.remove(); resolve(); });
                });
                break;
            }
            case 'nextLevel': {
                this.variables.level = (this.variables.level || 1) + 1;
                this.triggerEvent('onLevelStart');
                break;
            }
            case 'startCountdown': {
                const secs = parseFloat(v.seconds) || 60;
                this._countdown = secs;
                if (this._countdownInterval) clearInterval(this._countdownInterval);
                this._countdownInterval = setInterval(() => {
                    if (!this.isRunning) { clearInterval(this._countdownInterval); return; }
                    this._countdown -= 1;
                    if (this._countdown <= 0) {
                        this._countdown = 0;
                        clearInterval(this._countdownInterval);
                        this._countdownInterval = null;
                        this.triggerEvent('onTimerDone');
                    }
                }, 1000);
                break;
            }
            case 'showTimer': {
                this._showingTimer = true;
                break;
            }

            // ===== Visual Effects Blocks =====
            case 'screenShake': {
                const intensity = parseFloat(v.intensity) || 5;
                const cam = this.scene3d.camera;
                const origPos = cam.position.clone();
                let shakeTime = 0;
                const shakeAnim = () => {
                    if (shakeTime > 300 || !this.isRunning) {
                        cam.position.copy(origPos);
                        return;
                    }
                    cam.position.x = origPos.x + (Math.random() - 0.5) * intensity * 0.02;
                    cam.position.y = origPos.y + (Math.random() - 0.5) * intensity * 0.02;
                    shakeTime += 16;
                    requestAnimationFrame(shakeAnim);
                };
                shakeAnim();
                break;
            }
            case 'fadeOut': {
                const fadeSecs = parseFloat(v.seconds) || 1;
                if (!this._screenOverlay) {
                    this._screenOverlay = document.createElement('div');
                    this._screenOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;transition-property:opacity;';
                    document.body.appendChild(this._screenOverlay);
                }
                this._screenOverlay.style.background = 'black';
                this._screenOverlay.style.opacity = '0';
                this._screenOverlay.style.transitionDuration = fadeSecs + 's';
                requestAnimationFrame(() => { this._screenOverlay.style.opacity = '1'; });
                await this.sleep(fadeSecs * 1000);
                break;
            }
            case 'fadeIn': {
                const fadeInSecs = parseFloat(v.seconds) || 1;
                if (this._screenOverlay) {
                    this._screenOverlay.style.transitionDuration = fadeInSecs + 's';
                    this._screenOverlay.style.opacity = '0';
                    await this.sleep(fadeInSecs * 1000);
                    this._screenOverlay.remove();
                    this._screenOverlay = null;
                }
                break;
            }
            case 'flashScreen': {
                const flashColor = v.color || '#ffffff';
                const flashEl = document.createElement('div');
                flashEl.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;background:${flashColor};opacity:0.8;transition:opacity 0.2s;`;
                document.body.appendChild(flashEl);
                requestAnimationFrame(() => { flashEl.style.opacity = '0'; });
                setTimeout(() => flashEl.remove(), 300);
                break;
            }
            case 'slowMotion': {
                const slowSpeed = parseFloat(v.speed) || 0.3;
                const slowDur = (parseFloat(v.seconds) || 3) * 1000;
                this._timeScale = slowSpeed;
                setTimeout(() => { this._timeScale = 1; }, slowDur);
                break;
            }
            case 'cameraZoom': {
                const factor = parseFloat(v.factor) || 1.5;
                const zoomTime = parseFloat(v.time) || 0.5;
                const cam2 = this.scene3d.camera;
                if (this._originalFov === null) this._originalFov = cam2.fov;
                this.activeAnimations.push({
                    type: 'cameraZoom',
                    startFov: cam2.fov,
                    targetFov: (this._originalFov || 60) / factor,
                    duration: zoomTime,
                    elapsed: 0, elapsed2: 0
                });
                break;
            }
            case 'cameraReset': {
                if (this._originalFov !== null) {
                    const cam3 = this.scene3d.camera;
                    this.activeAnimations.push({
                        type: 'cameraZoom',
                        startFov: cam3.fov,
                        targetFov: this._originalFov,
                        duration: 0.3,
                        elapsed: 0, elapsed2: 0
                    });
                }
                break;
            }
            case 'screenTint': {
                const tintColor = v.color || '#ff0000';
                const tintOpacity = (parseFloat(v.opacity) || 30) / 100;
                if (!this._screenOverlay) {
                    this._screenOverlay = document.createElement('div');
                    this._screenOverlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:9999;';
                    document.body.appendChild(this._screenOverlay);
                }
                this._screenOverlay.style.background = tintColor;
                this._screenOverlay.style.opacity = String(tintOpacity);
                break;
            }

            case 'showScreen': {
                const screenName = v.screen;
                const screenDef = (this._uiScreens || []).find(s => s.name === screenName);
                if (!screenDef) break;
                // Remove if already showing
                if (this._activeScreens.has(screenName)) {
                    this._activeScreens.get(screenName).remove();
                }
                // Create DOM overlay
                const overlay = document.createElement('div');
                overlay.className = 'game-ui-screen';
                overlay.style.background = screenDef.bgColor;
                overlay.dataset.screenName = screenName;
                // Render each element (panels first, then text, then buttons for z-order)
                const sorted = [...screenDef.elements].sort((a, b) => {
                    const order = { panel: 0, text: 1, button: 2 };
                    return (order[a.type] || 0) - (order[b.type] || 0);
                });
                const runtime = this;
                sorted.forEach(el => {
                    const div = document.createElement('div');
                    div.className = 'game-ui-element';
                    if (el.type === 'button') {
                        div.classList.add('game-ui-button');
                    }
                    div.style.cssText = `
                        left:${el.x}%;top:${el.y}%;width:${el.width}%;height:${el.height}%;
                        font-size:${el.fontSize}px !important;color:${el.color};
                        background:${el.bgColor === 'transparent' ? 'transparent' : el.bgColor};
                        text-align:${el.align};display:flex;align-items:center;padding:0 12px;
                        justify-content:${el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start'};
                        border-radius:${el.type === 'button' ? '8px' : el.type === 'panel' ? '6px' : '0'};
                        ${el.type === 'button' ? 'box-shadow:0 3px 10px rgba(0,0,0,0.3);font-weight:600;cursor:pointer;' : ''}
                    `;
                    div.textContent = el.text || '';
                    if (el.type === 'button') {
                        div.addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (el.action && runtime.isRunning) {
                                runtime.triggerEvent('onMessage', { msg: el.action });
                            }
                        });
                    }
                    overlay.appendChild(div);
                });
                (this._getElement('playOverlay', 'play-overlay') || document.getElementById('viewport-container') || document.body).appendChild(overlay);
                this._activeScreens.set(screenName, overlay);
                break;
            }
            case 'hideScreen': {
                const hsName = v.screen;
                if (this._activeScreens.has(hsName)) {
                    this._activeScreens.get(hsName).remove();
                    this._activeScreens.delete(hsName);
                }
                break;
            }
            case 'hideAllScreens': {
                this._activeScreens.forEach(el => el.remove());
                this._activeScreens.clear();
                break;
            }
            case 'uiSetText': {
                const scrOverlay = this._activeScreens.get(v.screen);
                if (!scrOverlay) break;
                const oldText = v.old || '';
                const newText = v.new || '';
                scrOverlay.querySelectorAll('.game-ui-element').forEach(el => {
                    if (el.textContent.trim() === oldText.trim()) el.textContent = newText;
                });
                break;
            }
            case 'uiSetColor': {
                const scrOverlay2 = this._activeScreens.get(v.screen);
                if (!scrOverlay2) break;
                const elName = (v.element || '').trim();
                scrOverlay2.querySelectorAll('.game-ui-element').forEach(el => {
                    if (el.textContent.trim() === elName) el.style.background = v.color;
                });
                break;
            }
            case 'uiSetVisible': {
                const scrOverlay3 = this._activeScreens.get(v.screen);
                if (!scrOverlay3) break;
                const elName2 = (v.element || '').trim();
                const showIt = v.action === 'show';
                scrOverlay3.querySelectorAll('.game-ui-element').forEach(el => {
                    if (el.textContent.trim() === elName2) {
                        el.style.display = showIt ? 'flex' : 'none';
                    }
                });
                break;
            }
            case 'uiAddText': {
                // Add to the last shown screen
                let lastScr = null;
                this._activeScreens.forEach(s => lastScr = s);
                if (!lastScr) break;
                const newEl = document.createElement('div');
                newEl.className = 'game-ui-element';
                newEl.style.cssText = `left:${v.x||50}%;top:${v.y||50}%;font-size:24px !important;color:#ffffff;display:flex;align-items:center;justify-content:center;`;
                newEl.textContent = v.text || 'Hello';
                lastScr.appendChild(newEl);
                break;
            }
            case 'uiAddButton': {
                let lastScr2 = null;
                this._activeScreens.forEach(s => lastScr2 = s);
                if (!lastScr2) break;
                const btnEl = document.createElement('div');
                btnEl.className = 'game-ui-element game-ui-button';
                btnEl.style.cssText = `left:50%;top:80%;width:25%;height:7%;font-size:18px !important;color:#fff;background:#4C97FF;display:flex;align-items:center;justify-content:center;border-radius:8px;box-shadow:0 3px 10px rgba(0,0,0,0.3);font-weight:600;cursor:pointer;padding:0 12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;`;
                btnEl.textContent = v.text || 'Click';
                const runtime2 = this;
                const btnMsg = v.msg || 'clicked';
                btnEl.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (runtime2.isRunning) runtime2.triggerEvent('onMessage', { msg: btnMsg });
                });
                lastScr2.appendChild(btnEl);
                break;
            }
            case 'uiClearScreen': {
                const scrOverlay6 = this._activeScreens.get(v.screen);
                if (!scrOverlay6) break;
                scrOverlay6.innerHTML = '';
                break;
            }
            case 'uiShowNumber': {
                const nlabel = v.label || 'Score';
                this._numberDisplays.set(nlabel, parseFloat(v.value) || 0);
                this.updateHUD();
                break;
            }
            case 'uiSetNumber': {
                const nlabel2 = v.label || 'Score';
                if (this._numberDisplays.has(nlabel2)) {
                    this._numberDisplays.set(nlabel2, parseFloat(v.value) || 0);
                    this.updateHUD();
                }
                break;
            }
            case 'uiChangeNumber': {
                const nlabel3 = v.label || 'Score';
                if (this._numberDisplays.has(nlabel3)) {
                    this._numberDisplays.set(nlabel3, (this._numberDisplays.get(nlabel3) || 0) + (parseFloat(v.value) || 1));
                    this.updateHUD();
                }
                break;
            }
            case 'uiTextOverlay': {
                const txtOverlay = document.createElement('div');
                txtOverlay.className = 'game-ui-screen';
                txtOverlay.style.cssText = 'display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:85;';
                const txtEl = document.createElement('div');
                txtEl.style.cssText = 'font-size:48px !important;color:#fff;font-weight:700;text-shadow:0 2px 12px rgba(0,0,0,0.6);font-family:Inter,sans-serif;text-align:center;';
                txtEl.textContent = v.text || 'Text';
                txtOverlay.appendChild(txtEl);
                (this._getElement('playOverlay', 'play-overlay') || document.getElementById('viewport-container') || document.body).appendChild(txtOverlay);
                const dur = (parseFloat(v.time) || 2) * 1000;
                setTimeout(() => {
                    txtEl.style.opacity = '0';
                    txtEl.style.transition = 'opacity 0.4s ease';
                    setTimeout(() => txtOverlay.remove(), 400);
                }, dur);
                break;
            }

            default: {
                // Handle custom block calls (customCall_xxx)
                if (cmd.code.startsWith('customCall_')) {
                    const customId = cmd.code.replace('customCall_', '');
                    const defCode = 'customDef_' + customId;
                    // Find the define hat's commands on this object
                    for (const rs of this.runningScripts) {
                        if (rs.object === obj && rs.script.trigger === defCode) {
                            await this.executeCommands(obj, rs.script.commands);
                            break;
                        }
                    }
                }
                break;
            }
        }
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ===== HUD =====

    addHUDElement(varName) {
        if (this.hudElements.includes(varName)) return;
        this.hudElements.push(varName);
    }

    updateHUD() {
        const hud = this._getElement('gameHud', 'game-hud');
        if (!hud) return;
        hud.innerHTML = '';

        this.hudElements.forEach(varName => {
            const el = document.createElement('div');
            el.style.cssText = 'background:rgba(0,0,0,0.6);color:white;padding:8px 16px;border-radius:8px;font-size:14px !important;font-weight:600;backdrop-filter:blur(8px);';
            el.textContent = `${varName}: ${this.variables[varName] ?? 0}`;
            hud.appendChild(el);
        });

        // Health bar
        if (this._showingHealthBar) {
            const barContainer = document.createElement('div');
            barContainer.style.cssText = 'background:rgba(0,0,0,0.6);padding:8px 16px;border-radius:8px;backdrop-filter:blur(8px);min-width:150px;';
            const label = document.createElement('div');
            label.style.cssText = 'color:white;font-size:11px !important;font-weight:600;margin-bottom:4px;';
            label.textContent = `Health: ${Math.max(0, Math.round(this.variables.health))} / ${this.maxHealth}`;
            const barBg = document.createElement('div');
            barBg.style.cssText = 'background:rgba(255,255,255,0.2);border-radius:4px;height:10px;overflow:hidden;';
            const barFill = document.createElement('div');
            const healthPct = Math.max(0, Math.min(100, (this.variables.health / this.maxHealth) * 100));
            const barColor = healthPct > 50 ? '#2ecc71' : healthPct > 25 ? '#f1c40f' : '#e74c3c';
            barFill.style.cssText = `background:${barColor};height:100%;width:${healthPct}%;border-radius:4px;`;
            barBg.appendChild(barFill);
            barContainer.appendChild(label);
            barContainer.appendChild(barBg);
            hud.appendChild(barContainer);
        }

        // Inventory
        if (this._showingInventory && this.inventory.length > 0) {
            const invContainer = document.createElement('div');
            invContainer.style.cssText = 'background:rgba(0,0,0,0.6);padding:8px 12px;border-radius:8px;backdrop-filter:blur(8px);';
            const invTitle = document.createElement('div');
            invTitle.style.cssText = 'color:white;font-size:11px !important;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;';
            invTitle.textContent = 'Inventory';
            invContainer.appendChild(invTitle);
            this.inventory.forEach(item => {
                const row = document.createElement('div');
                row.style.cssText = 'color:rgba(255,255,255,0.9);font-size:12px !important;padding:2px 0;';
                const icon = item.type === 'key' ? '🔑' : item.type === 'potion' ? '🧪' : item.type === 'powerup' ? '⚡' : item.type === 'gem' ? '💎' : item.type === 'coin' ? '🪙' : '📦';
                row.textContent = `${icon} ${item.name}${item.count > 1 ? ' x' + item.count : ''}`;
                invContainer.appendChild(row);
            });
            hud.appendChild(invContainer);
        }

        // Lives display
        if (this._showingLives) {
            const livesEl = document.createElement('div');
            livesEl.style.cssText = 'background:rgba(0,0,0,0.6);color:white;padding:8px 16px;border-radius:8px;font-size:16px !important;font-weight:600;backdrop-filter:blur(8px);';
            livesEl.textContent = '❤'.repeat(Math.max(0, this._lives)) + (this._lives <= 0 ? ' 0' : '');
            hud.appendChild(livesEl);
        }

        // Countdown timer display
        if (this._showingTimer && this._countdown !== null) {
            const timerEl = document.createElement('div');
            timerEl.style.cssText = 'background:rgba(0,0,0,0.6);color:white;padding:8px 16px;border-radius:8px;font-size:16px !important;font-weight:700;backdrop-filter:blur(8px);font-variant-numeric:tabular-nums;';
            const mins = Math.floor(this._countdown / 60);
            const secs = Math.floor(this._countdown % 60);
            timerEl.textContent = `⏱ ${mins}:${secs.toString().padStart(2, '0')}`;
            if (this._countdown <= 10) timerEl.style.color = '#e74c3c';
            hud.appendChild(timerEl);
        }

        // Number displays
        if (this._numberDisplays.size > 0) {
            this._numberDisplays.forEach((value, label) => {
                const numEl = document.createElement('div');
                numEl.style.cssText = 'background:rgba(0,0,0,0.6);color:white;padding:8px 16px;border-radius:8px;font-size:16px !important;font-weight:600;backdrop-filter:blur(8px);display:flex;align-items:center;gap:8px;';
                const labelSpan = document.createElement('span');
                labelSpan.style.cssText = 'color:rgba(255,255,255,0.7);font-size:12px !important;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;';
                labelSpan.textContent = label;
                const valueSpan = document.createElement('span');
                valueSpan.style.cssText = 'font-size:18px !important;font-weight:700;font-variant-numeric:tabular-nums;';
                valueSpan.textContent = Number.isInteger(value) ? value : value.toFixed(1);
                numEl.appendChild(labelSpan);
                numEl.appendChild(valueSpan);
                hud.appendChild(numEl);
            });
        }
    }

    // ===== Speech Bubbles =====

    showSpeechBubble(obj, text, duration) {
        // Create a simple HTML overlay speech bubble
        const bubble = document.createElement('div');
        bubble.className = 'speech-bubble-3d';
        bubble.textContent = text;
        bubble.style.cssText = `
            position: fixed;
            background: white;
            color: #333;
            padding: 8px 14px;
            border-radius: 12px;
            font-size: 13px !important;
            font-weight: 500;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            pointer-events: none;
            z-index: 1000;
            transform: translate(-50%, -100%);
            white-space: nowrap;
        `;
        document.body.appendChild(bubble);

        // Update position each frame
        const updatePos = () => {
            if (!bubble.parentElement || !this.isRunning) {
                bubble.remove();
                return;
            }
            const pos = obj.position.clone();
            pos.y += 2;
            pos.project(this.scene3d.camera);
            const rect = this.scene3d.canvas.getBoundingClientRect();
            bubble.style.left = ((pos.x + 1) / 2 * rect.width + rect.left) + 'px';
            bubble.style.top = ((-pos.y + 1) / 2 * rect.height + rect.top) + 'px';
            requestAnimationFrame(updatePos);
        };
        updatePos();

        setTimeout(() => bubble.remove(), duration * 1000);
    }

    // ===== Health System =====

    _checkHealthZero() {
        if (this._healthWasAboveZero && this.variables.health <= 0) {
            this._healthWasAboveZero = false;
            this.triggerEvent('onHealthZero');
        }
        if (this.variables.health > 0) {
            this._healthWasAboveZero = true;
        }
    }

    _checkLivesZero() {
        if (this._livesWasAboveZero && this._lives <= 0) {
            this._livesWasAboveZero = false;
            this.triggerEvent('onLivesZero');
        }
        if (this._lives > 0) {
            this._livesWasAboveZero = true;
        }
    }

    // ===== Enemy System =====

    updateEnemyHealthBars() {
        this._enemies.forEach((data, objId) => {
            if (!data.showBar) return;
            const obj = this.scene3d.objects.find(o => o.userData.id === objId);
            if (!obj || !obj.visible) {
                const bar = this._enemyBars.get(objId);
                if (bar) bar.style.display = 'none';
                return;
            }

            let bar = this._enemyBars.get(objId);
            if (!bar) {
                bar = document.createElement('div');
                bar.style.cssText = 'position:fixed;pointer-events:none;z-index:999;transform:translate(-50%,-100%);';
                bar.innerHTML = '<div style="background:rgba(0,0,0,0.5);border-radius:4px;padding:2px;width:60px;height:8px;"><div class="enemy-bar-fill" style="background:#e74c3c;height:100%;border-radius:3px;"></div></div>';
                document.body.appendChild(bar);
                this._enemyBars.set(objId, bar);
            }

            bar.style.display = '';
            const pos = obj.position.clone();
            pos.y += 2.2;
            pos.project(this.scene3d.camera);
            const rect = this.scene3d.canvas.getBoundingClientRect();
            bar.style.left = ((pos.x + 1) / 2 * rect.width + rect.left) + 'px';
            bar.style.top = ((-pos.y + 1) / 2 * rect.height + rect.top) + 'px';

            const pct = Math.max(0, (data.health / data.maxHealth) * 100);
            const fill = bar.querySelector('.enemy-bar-fill');
            if (fill) fill.style.width = pct + '%';
        });
    }

    _checkEnemyDeath(obj) {
        const data = this._enemies.get(obj.userData.id);
        if (!data || data.health > 0) return;

        this.triggerEvent('onEnemyDefeated', {}, obj);
        this.playSynthSound('boom');
        this._spawnImpactEffect(obj.position.clone(), '#ff4444');

        obj.visible = false;
        obj.userData.collidable = false;

        const bar = this._enemyBars.get(obj.userData.id);
        if (bar) { bar.remove(); this._enemyBars.delete(obj.userData.id); }
    }

    // ===== Inventory System =====

    _collectPickup(obj, config) {
        const itemName = config.name || config.type || 'item';

        const existing = this.inventory.find(i => i.name === itemName);
        if (existing) { existing.count++; }
        else { this.inventory.push({ name: itemName, type: config.type, count: 1 }); }

        switch (config.effect) {
            case 'heal':
                this.variables.health = Math.min(this.maxHealth,
                    (this.variables.health || 0) + (config.effectAmount || 25));
                this.playSynthSound('powerup');
                break;
            case 'speed boost':
                if (this.playerController) this.playerController.speed += (config.effectAmount || 2);
                this.playSynthSound('powerup');
                break;
            case 'score':
                this.variables.score = (this.variables.score || 0) + (config.effectAmount || 10);
                this.playSynthSound('coin');
                break;
            default:
                this.playSynthSound('coin');
        }

        obj.visible = false;
        obj.userData.collidable = false;
        this.triggerEvent('onItemCollected', { item: itemName }, obj);
    }

    // ===== Spawn Helper =====

    _createSpawnedMesh(shape, color) {
        let geometry, material;
        const c = (color instanceof THREE.Color) ? color : new THREE.Color(color);
        switch (shape) {
            case 'sphere':
                geometry = new THREE.SphereGeometry(0.5, 16, 16);
                break;
            case 'cylinder':
                geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 16);
                break;
            case 'cone':
                geometry = new THREE.ConeGeometry(0.5, 1, 16);
                break;
            case 'wall':
                geometry = new THREE.BoxGeometry(3, 2, 0.3);
                break;
            case 'platform':
                geometry = new THREE.BoxGeometry(3, 0.3, 3);
                break;
            case 'pyramid': {
                const pyrGeom = new THREE.ConeGeometry(0.7, 1, 4);
                pyrGeom.rotateY(Math.PI / 4);
                geometry = pyrGeom;
                break;
            }
            case 'coin':
                geometry = new THREE.CylinderGeometry(0.4, 0.4, 0.08, 16);
                material = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.8, roughness: 0.2 });
                break;
            case 'gem':
                geometry = new THREE.OctahedronGeometry(0.4);
                material = new THREE.MeshStandardMaterial({ color: 0xff00ff, metalness: 0.6, roughness: 0.2 });
                break;
            default: // box
                geometry = new THREE.BoxGeometry(1, 1, 1);
                break;
        }
        if (!material) {
            material = new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 });
        }
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = {
            id: 'spawned_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
            name: shape, type: shape, collidable: true, isClone: true, scripts: []
        };
        return mesh;
    }

    // ===== Music System =====

    _getMusicTracks() {
        return {
            adventure: {
                bpm: 120,
                melody: [
                    { note: 'C4', dur: 0.25 }, { note: 'E4', dur: 0.25 },
                    { note: 'G4', dur: 0.5 }, { note: 'A4', dur: 0.25 },
                    { note: 'G4', dur: 0.25 }, { note: 'E4', dur: 0.5 },
                    { note: 'D4', dur: 0.25 }, { note: 'E4', dur: 0.25 },
                    { note: 'C4', dur: 0.5 }, { note: null, dur: 0.5 }
                ],
                bass: [
                    { note: 'C2', dur: 1 }, { note: 'G2', dur: 1 },
                    { note: 'A2', dur: 1 }, { note: 'F2', dur: 1 }
                ],
                waveform: 'triangle'
            },
            chill: {
                bpm: 80,
                melody: [
                    { note: 'F4', dur: 0.5 }, { note: 'A4', dur: 0.5 },
                    { note: 'C5', dur: 1 }, { note: 'A4', dur: 0.5 },
                    { note: 'G4', dur: 0.5 }, { note: 'F4', dur: 1 }
                ],
                bass: [
                    { note: 'F2', dur: 2 }, { note: 'C3', dur: 2 }
                ],
                waveform: 'sine'
            },
            action: {
                bpm: 140,
                melody: [
                    { note: 'A3', dur: 0.125 }, { note: 'A3', dur: 0.125 },
                    { note: 'C4', dur: 0.25 }, { note: 'D4', dur: 0.25 },
                    { note: 'E4', dur: 0.25 }, { note: 'A3', dur: 0.125 },
                    { note: 'A3', dur: 0.125 }, { note: 'G3', dur: 0.25 },
                    { note: 'E3', dur: 0.5 }
                ],
                bass: [
                    { note: 'A1', dur: 0.5 }, { note: 'A1', dur: 0.5 },
                    { note: 'E2', dur: 0.5 }, { note: 'G2', dur: 0.5 }
                ],
                waveform: 'sawtooth'
            },
            mystery: {
                bpm: 70,
                melody: [
                    { note: 'D4', dur: 1 }, { note: 'F4', dur: 0.5 },
                    { note: 'E4', dur: 0.5 }, { note: 'D4', dur: 0.5 },
                    { note: 'C4', dur: 0.5 }, { note: 'D4', dur: 1 }
                ],
                bass: [
                    { note: 'D2', dur: 2 }, { note: 'A2', dur: 2 }
                ],
                waveform: 'sine'
            },
            retro: {
                bpm: 130,
                melody: [
                    { note: 'C4', dur: 0.25 }, { note: 'D4', dur: 0.25 },
                    { note: 'E4', dur: 0.25 }, { note: 'G4', dur: 0.25 },
                    { note: 'E4', dur: 0.25 }, { note: 'D4', dur: 0.25 },
                    { note: 'C4', dur: 0.5 }
                ],
                bass: [
                    { note: 'C2', dur: 0.5 }, { note: 'G2', dur: 0.5 },
                    { note: 'E2', dur: 0.5 }, { note: 'C2', dur: 0.5 }
                ],
                waveform: 'square'
            }
        };
    }

    _startMusic(trackName) {
        this._stopMusic();
        if (trackName === 'none' || !this.audioCtx) return;

        const tracks = this._getMusicTracks();
        const track = tracks[trackName];
        if (!track) return;

        this._musicTrack = trackName;

        const noteFreqs = {
            'A1': 55, 'B1': 61.74, 'C2': 65.41, 'D2': 73.42, 'E2': 82.41,
            'F2': 87.31, 'G2': 98, 'A2': 110, 'B2': 123.47, 'C3': 130.81,
            'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196, 'A3': 220,
            'B3': 246.94, 'C4': 261.63, 'D4': 293.66, 'E4': 329.63,
            'F4': 349.23, 'G4': 392, 'A4': 440, 'B4': 493.88, 'C5': 523.25
        };

        const ctx = this.audioCtx;
        const beatDur = 60 / track.bpm;
        const masterGain = ctx.createGain();
        masterGain.gain.value = this._musicVolume;
        masterGain.connect(ctx.destination);

        let melodyIdx = 0;
        let bassIdx = 0;

        const scheduleLoop = () => {
            if (!this.isRunning || this._musicTrack !== trackName) return;
            const now = ctx.currentTime;

            const melNote = track.melody[melodyIdx % track.melody.length];
            if (melNote.note) {
                const freq = noteFreqs[melNote.note] || 440;
                const dur = melNote.dur * beatDur;
                const osc = ctx.createOscillator();
                osc.type = track.waveform;
                osc.frequency.value = freq;
                const g = ctx.createGain();
                g.gain.setValueAtTime(0.15, now);
                g.gain.setValueAtTime(0.15, now + dur * 0.7);
                g.gain.exponentialRampToValueAtTime(0.001, now + dur);
                osc.connect(g);
                g.connect(masterGain);
                osc.start(now);
                osc.stop(now + dur);
            }
            melodyIdx++;

            if (melodyIdx % 2 === 0) {
                const bassNote = track.bass[bassIdx % track.bass.length];
                if (bassNote.note) {
                    const freq = noteFreqs[bassNote.note] || 65;
                    const dur = bassNote.dur * beatDur;
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    const g = ctx.createGain();
                    g.gain.setValueAtTime(0.1, now);
                    g.gain.exponentialRampToValueAtTime(0.001, now + dur);
                    osc.connect(g);
                    g.connect(masterGain);
                    osc.start(now);
                    osc.stop(now + dur);
                }
                bassIdx++;
            }
        };

        const melNote = track.melody[0];
        const intervalMs = (melNote.dur || 0.25) * beatDur * 1000;
        const interval = setInterval(scheduleLoop, intervalMs);

        this._musicNodes = { masterGain, interval };
    }

    _stopMusic() {
        if (this._musicNodes) {
            clearInterval(this._musicNodes.interval);
            if (this._musicNodes.masterGain) this._musicNodes.masterGain.gain.value = 0;
            this._musicNodes = null;
        }
        this._musicTrack = 'none';
    }

    // ===== Custom Sound Playback =====

    _playCustomSound(name) {
        if (!this.audioCtx || !this._customSoundBuffers) return;
        const buffer = this._customSoundBuffers[name];
        if (!buffer) return;
        const source = this.audioCtx.createBufferSource();
        source.buffer = buffer;
        const gain = this.audioCtx.createGain();
        gain.gain.value = this.soundVolume * 0.5;
        source.connect(gain);
        gain.connect(this.audioCtx.destination);
        source.start();
    }

    // ===== Keyframe Interpolation =====

    _interpolateKeyframes(obj, keyframes, time) {
        if (!keyframes || keyframes.length === 0) return;
        if (keyframes.length === 1 || time <= keyframes[0].time) {
            const kf = keyframes[0];
            obj.position.set(kf.position.x, kf.position.y, kf.position.z);
            obj.rotation.set(THREE.MathUtils.degToRad(kf.rotation.x), THREE.MathUtils.degToRad(kf.rotation.y), THREE.MathUtils.degToRad(kf.rotation.z));
            obj.scale.set(kf.scale.x, kf.scale.y, kf.scale.z);
            return;
        }
        if (time >= keyframes[keyframes.length - 1].time) {
            const kf = keyframes[keyframes.length - 1];
            obj.position.set(kf.position.x, kf.position.y, kf.position.z);
            obj.rotation.set(THREE.MathUtils.degToRad(kf.rotation.x), THREE.MathUtils.degToRad(kf.rotation.y), THREE.MathUtils.degToRad(kf.rotation.z));
            obj.scale.set(kf.scale.x, kf.scale.y, kf.scale.z);
            return;
        }
        let a = keyframes[0], b = keyframes[1];
        for (let i = 0; i < keyframes.length - 1; i++) {
            if (time >= keyframes[i].time && time <= keyframes[i + 1].time) {
                a = keyframes[i]; b = keyframes[i + 1]; break;
            }
        }
        const range = b.time - a.time;
        const raw = range > 0 ? (time - a.time) / range : 0;
        const t = raw < 0.5 ? 2 * raw * raw : 1 - Math.pow(-2 * raw + 2, 2) / 2;
        obj.position.set(
            a.position.x + (b.position.x - a.position.x) * t,
            a.position.y + (b.position.y - a.position.y) * t,
            a.position.z + (b.position.z - a.position.z) * t
        );
        obj.rotation.set(
            THREE.MathUtils.degToRad(a.rotation.x + (b.rotation.x - a.rotation.x) * t),
            THREE.MathUtils.degToRad(a.rotation.y + (b.rotation.y - a.rotation.y) * t),
            THREE.MathUtils.degToRad(a.rotation.z + (b.rotation.z - a.rotation.z) * t)
        );
        obj.scale.set(
            a.scale.x + (b.scale.x - a.scale.x) * t,
            a.scale.y + (b.scale.y - a.scale.y) * t,
            a.scale.z + (b.scale.z - a.scale.z) * t
        );
    }

    // ===== Sound Synthesis =====

    playSynthSound(type) {
        if (!this.audioCtx) return;
        const ctx = this.audioCtx;
        const now = ctx.currentTime;
        const gain = ctx.createGain();
        gain.connect(ctx.destination);
        gain.gain.value = this.soundVolume * 0.3;

        switch (type) {
            case 'pop': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(600, now);
                osc.frequency.exponentialRampToValueAtTime(200, now + 0.1);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            }
            case 'ding': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(880, now);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc.start(now);
                osc.stop(now + 0.5);
                break;
            }
            case 'whoosh': {
                const bufferSize = ctx.sampleRate * 0.3;
                const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
                const data = buffer.getChannelData(0);
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
                }
                const source = ctx.createBufferSource();
                source.buffer = buffer;
                const filter = ctx.createBiquadFilter();
                filter.type = 'bandpass';
                filter.frequency.setValueAtTime(1000, now);
                filter.frequency.exponentialRampToValueAtTime(100, now + 0.3);
                source.connect(filter);
                filter.connect(gain);
                source.start(now);
                break;
            }
            case 'boom': {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(150, now);
                osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);
                osc.connect(gain);
                gain.gain.setValueAtTime(this.soundVolume * 0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.start(now);
                osc.stop(now + 0.4);
                break;
            }
            case 'jump': {
                const osc = ctx.createOscillator();
                osc.type = 'square';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(600, now + 0.1);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            }
            case 'coin': {
                const osc1 = ctx.createOscillator();
                osc1.type = 'square';
                osc1.frequency.setValueAtTime(988, now);
                osc1.connect(gain);
                const osc2 = ctx.createOscillator();
                osc2.type = 'square';
                osc2.frequency.setValueAtTime(1319, now + 0.08);
                const gain2 = ctx.createGain();
                gain2.connect(ctx.destination);
                gain2.gain.value = this.soundVolume * 0.3;
                osc2.connect(gain2);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc1.start(now);
                osc1.stop(now + 0.1);
                osc2.start(now + 0.08);
                osc2.stop(now + 0.3);
                break;
            }
            case 'hurt': {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
                osc.start(now);
                osc.stop(now + 0.3);
                break;
            }
            case 'powerup': {
                for (let i = 0; i < 4; i++) {
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(400 + i * 200, now + i * 0.08);
                    const g = ctx.createGain();
                    g.connect(ctx.destination);
                    g.gain.value = this.soundVolume * 0.2;
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.2);
                    osc.connect(g);
                    osc.start(now + i * 0.08);
                    osc.stop(now + i * 0.08 + 0.2);
                }
                break;
            }
            case 'laser': {
                const osc = ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(1200, now);
                osc.frequency.exponentialRampToValueAtTime(100, now + 0.15);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
                osc.start(now);
                osc.stop(now + 0.2);
                break;
            }
            case 'explosion': {
                // Noise burst + low rumble
                const bufSize = ctx.sampleRate * 0.5;
                const buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
                const d = buf.getChannelData(0);
                for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / bufSize, 2);
                const src = ctx.createBufferSource();
                src.buffer = buf;
                src.connect(gain);
                gain.gain.setValueAtTime(this.soundVolume * 0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                src.start(now);
                const rumble = ctx.createOscillator();
                rumble.type = 'sine';
                rumble.frequency.setValueAtTime(60, now);
                rumble.frequency.exponentialRampToValueAtTime(20, now + 0.4);
                const rg = ctx.createGain();
                rg.connect(ctx.destination);
                rg.gain.value = this.soundVolume * 0.4;
                rg.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                rumble.connect(rg);
                rumble.start(now);
                rumble.stop(now + 0.5);
                break;
            }
            case 'splash': {
                const bufSize2 = ctx.sampleRate * 0.4;
                const buf2 = ctx.createBuffer(1, bufSize2, ctx.sampleRate);
                const d2 = buf2.getChannelData(0);
                for (let i = 0; i < bufSize2; i++) d2[i] = (Math.random() * 2 - 1) * (1 - i / bufSize2);
                const src2 = ctx.createBufferSource();
                src2.buffer = buf2;
                const bp = ctx.createBiquadFilter();
                bp.type = 'bandpass';
                bp.frequency.setValueAtTime(600, now);
                bp.Q.value = 2;
                src2.connect(bp);
                bp.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                src2.start(now);
                break;
            }
            case 'click': {
                const osc = ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1500, now);
                osc.connect(gain);
                gain.gain.setValueAtTime(this.soundVolume * 0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
                osc.start(now);
                osc.stop(now + 0.03);
                break;
            }
            case 'bell': {
                const osc1 = ctx.createOscillator();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(830, now);
                osc1.connect(gain);
                const osc2 = ctx.createOscillator();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(1245, now);
                const g2 = ctx.createGain();
                g2.connect(ctx.destination);
                g2.gain.value = this.soundVolume * 0.15;
                g2.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
                osc2.connect(g2);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 1.0);
                osc1.start(now);
                osc1.stop(now + 1.0);
                osc2.start(now);
                osc2.stop(now + 1.0);
                break;
            }
            case 'alarm': {
                const osc1 = ctx.createOscillator();
                osc1.type = 'square';
                osc1.frequency.setValueAtTime(800, now);
                osc1.connect(gain);
                gain.gain.setValueAtTime(this.soundVolume * 0.2, now);
                // Alternate between two tones
                for (let i = 0; i < 6; i++) {
                    osc1.frequency.setValueAtTime(i % 2 === 0 ? 800 : 600, now + i * 0.1);
                }
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                osc1.start(now);
                osc1.stop(now + 0.6);
                break;
            }
            case 'magic': {
                // Ascending sparkle arpeggio
                const notes = [523, 659, 784, 1047, 1319];
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + i * 0.06);
                    const g = ctx.createGain();
                    g.connect(ctx.destination);
                    g.gain.value = this.soundVolume * 0.2;
                    g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.06 + 0.3);
                    osc.connect(g);
                    osc.start(now + i * 0.06);
                    osc.stop(now + i * 0.06 + 0.3);
                });
                break;
            }
            case 'swoosh': {
                const bufSize3 = ctx.sampleRate * 0.15;
                const buf3 = ctx.createBuffer(1, bufSize3, ctx.sampleRate);
                const d3 = buf3.getChannelData(0);
                for (let i = 0; i < bufSize3; i++) d3[i] = (Math.random() * 2 - 1) * (1 - i / bufSize3);
                const src3 = ctx.createBufferSource();
                src3.buffer = buf3;
                const hp = ctx.createBiquadFilter();
                hp.type = 'highpass';
                hp.frequency.setValueAtTime(2000, now);
                hp.frequency.exponentialRampToValueAtTime(500, now + 0.15);
                src3.connect(hp);
                hp.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                src3.start(now);
                break;
            }
            case 'beep': {
                const osc = ctx.createOscillator();
                osc.type = 'square';
                osc.frequency.setValueAtTime(880, now);
                osc.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            }
            case 'chime': {
                // Two-note doorbell
                const osc1 = ctx.createOscillator();
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(659, now);
                osc1.connect(gain);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                osc1.start(now);
                osc1.stop(now + 0.3);
                const osc2 = ctx.createOscillator();
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(523, now + 0.3);
                const g2 = ctx.createGain();
                g2.connect(ctx.destination);
                g2.gain.value = this.soundVolume * 0.3;
                g2.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
                osc2.connect(g2);
                osc2.start(now + 0.3);
                osc2.stop(now + 0.6);
                break;
            }
        }
    }

    // === Cloud Data Helpers ===
    async _cloudFetch(key) {
        if (!this._cloudCache) this._cloudCache = {};
        if (this._cloudCache[key] !== undefined) return this._cloudCache[key];
        try {
            const projId = window._app?.currentProjectId;
            if (!projId) return '0';
            const resp = await fetch(`/api/cloud-data/${projId}/${encodeURIComponent(key)}`);
            if (!resp.ok) return '0';
            const data = await resp.json();
            this._cloudCache[key] = data.value || '0';
            return this._cloudCache[key];
        } catch { return '0'; }
    }

    async _cloudStore(key, value) {
        try {
            const projId = window._app?.currentProjectId;
            if (!projId) return;
            await fetch(`/api/cloud-data/${projId}/${encodeURIComponent(key)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value })
            });
        } catch { /* silent */ }
    }
}
