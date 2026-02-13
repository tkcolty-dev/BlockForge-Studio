/**
 * Runtime - Game play mode engine
 * Handles player controller, physics, script execution, and game logic
 */
class Runtime {
    constructor(scene3d, blockCode) {
        this.scene3d = scene3d;
        this.blockCode = blockCode;
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

        // Audio context for sound effects
        this.audioCtx = null;

        this.onStop = null;

        this._boundKeyDown = (e) => this.onKeyDown(e);
        this._boundKeyUp = (e) => this.onKeyUp(e);
    }

    // ===== Start/Stop =====

    start(settings = {}) {
        if (this.isRunning) return;
        this.isRunning = true;
        this.gameTimer = 0;
        this.variables = { score: 0, health: 100, coins: 0, speed: 5, level: 1 };
        this.activeAnimations = [];
        this.hudElements = [];
        this.runningScripts = [];

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
                opacity: obj.material ? obj.material.opacity : 1
            });
        });

        // Save editor camera state
        this._savedCameraPos = this.scene3d.camera.position.clone();
        this._savedCameraRot = this.scene3d.camera.quaternion.clone();
        this._savedOrbitTarget = this.scene3d.orbitControls.target.clone();

        // Disable editor controls
        this.scene3d.isPlaying = true;
        this.scene3d.orbitControls.enabled = false;
        this.scene3d.transformControls.detach();
        this.scene3d.transformControls.visible = false;
        this.scene3d.deselect();

        // Setup player
        this.initPlayer();

        // Setup input
        document.addEventListener('keydown', this._boundKeyDown);
        document.addEventListener('keyup', this._boundKeyUp);

        // Init audio
        if (!this.audioCtx) {
            this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }

        // Click handler for in-game object interaction (all modes) and point-click movement
        const viewportContainer = this.scene3d.canvas.parentElement;
        this._boundClick = (e) => this.onGameClick(e);
        viewportContainer.addEventListener('click', this._boundClick);

        // Track mouse position for custom crosshair
        this._boundMouseMove = (e) => this.onMouseMove(e);
        document.addEventListener('mousemove', this._boundMouseMove);

        // Show custom crosshair, hide system cursor on viewport
        this._gameCrosshair = document.getElementById('game-crosshair');
        if (this._gameCrosshair) this._gameCrosshair.classList.remove('hidden');
        viewportContainer.style.cursor = 'none';

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
        document.getElementById('play-overlay').classList.remove('hidden');
        document.getElementById('btn-play').classList.add('hidden');
        document.getElementById('btn-stop').classList.remove('hidden');
        document.getElementById('status-mode').textContent = 'Play Mode';
        const viewcube = document.querySelector('.viewcube-wrapper');
        if (viewcube) viewcube.classList.add('hidden');

        // Update controls hint
        const hints = {
            'first-person': 'WASD to move | Arrows to look | Space to jump | Click objects | ESC to stop',
            'third-person': 'WASD to move | Arrows to orbit | Space to jump | Click objects | ESC to stop',
            'top-down': 'WASD to move | Space to jump | Click objects | ESC to stop',
            'point-click': 'Click to move | Space to jump | Click objects | ESC to stop'
        };
        document.querySelector('.play-info span').textContent = hints[this.controlScheme] || hints['first-person'];
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

        // Clean up
        this.scene3d.isPlaying = false;
        this.scene3d.orbitControls.enabled = true;
        this.activeAnimations = [];
        this.runningScripts = [];

        // Restore editor camera
        if (this._savedCameraPos) {
            const cam = this.scene3d.camera;
            cam.rotation.order = 'XYZ';
            cam.up.set(0, 1, 0);
            cam.position.copy(this._savedCameraPos);
            cam.quaternion.copy(this._savedCameraRot);
            this.scene3d.orbitControls.target.copy(this._savedOrbitTarget);
            this.scene3d.orbitControls.update();
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
        const hud = document.getElementById('game-hud');
        hud.innerHTML = '';

        // Remove speech bubbles
        document.querySelectorAll('.speech-bubble-3d').forEach(el => el.remove());

        // Hide play overlay
        document.getElementById('play-overlay').classList.add('hidden');
        document.getElementById('btn-play').classList.remove('hidden');
        document.getElementById('btn-stop').classList.add('hidden');
        document.getElementById('status-mode').textContent = 'Edit Mode';
        const viewcube = document.querySelector('.viewcube-wrapper');
        if (viewcube) viewcube.classList.remove('hidden');

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

        // Create player body
        const playerGeom = new THREE.CylinderGeometry(0.3, 0.3, 1.6, 8);
        const playerMat = showBody
            ? new THREE.MeshStandardMaterial({ color: 0x4c97ff, roughness: 0.6 })
            : new THREE.MeshBasicMaterial({ visible: false });
        const playerMesh = new THREE.Mesh(playerGeom, playerMat);
        playerMesh.position.copy(spawnPos);
        playerMesh.castShadow = showBody;
        playerMesh.receiveShadow = showBody;
        this.scene3d.scene.add(playerMesh);

        // For visible modes, add a head so orientation is clear
        if (showBody) {
            const headGeom = new THREE.SphereGeometry(0.25, 12, 8);
            const headMat = new THREE.MeshStandardMaterial({ color: 0xf5cba7, roughness: 0.6 });
            const head = new THREE.Mesh(headGeom, headMat);
            head.position.y = 1.05;
            head.castShadow = true;
            playerMesh.add(head);

            const noseGeom = new THREE.BoxGeometry(0.08, 0.08, 0.12);
            const noseMat = new THREE.MeshStandardMaterial({ color: 0xe0b090 });
            const nose = new THREE.Mesh(noseGeom, noseMat);
            nose.position.set(0, 1.03, 0.28);
            playerMesh.add(nose);
        }

        this.playerController = {
            mesh: playerMesh,
            velocity: new THREE.Vector3(),
            speed: this.playerSpeed,
            jumpForce: this.playerJumpForce,
            gravity: -20,
            isGrounded: false,
            yaw: 0,
            pitch: 0,
            height: 1.6,
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

        // Point-click movement: raycast against ground plane
        if (this.controlScheme === 'point-click') {
            this.onPointClick(e);
        }
    }

    // ===== Game Loop =====

    update() {
        const dt = 1 / 60; // Fixed timestep
        this.gameTimer += dt;

        this.updatePlayer(dt);
        this.updateAnimations(dt);
        this.checkCollisions();
        this.updateHUD();
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
                // Hitting from below
                else if (newPos.y + 0.2 >= box.min.y && newPos.y + 0.2 <= box.min.y + 0.3 && pc.velocity.y > 0) {
                    pc.velocity.y = 0;
                }
                // Side collision
                else if (playerBottom < box.max.y - 0.3) {
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

        // Update camera based on scheme
        const cam = this.scene3d.camera;
        if (this.controlScheme === 'first-person') {
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
                    const dir = new THREE.Vector3().subVectors(playerPos, anim.object.position);
                    dir.y = 0;
                    if (dir.length() > 1) {
                        dir.normalize().multiplyScalar(anim.speed * dt);
                        anim.object.position.add(dir);
                        // Face player
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
            }
        }
    }

    checkCollisions() {
        if (!this.playerController) return;
        const playerPos = this.playerController.mesh.position;
        const playerRadius = 0.8;

        this.scene3d.objects.forEach(obj => {
            if (!obj.visible) return;
            const box = new THREE.Box3().setFromObject(obj);
            const closestPoint = new THREE.Vector3(
                Math.max(box.min.x, Math.min(playerPos.x, box.max.x)),
                Math.max(box.min.y, Math.min(playerPos.y, box.max.y)),
                Math.max(box.min.z, Math.min(playerPos.z, box.max.z))
            );

            const dist = playerPos.distanceTo(closestPoint);

            if (dist < playerRadius) {
                // Trigger collision scripts
                this.triggerEvent('onCollide', { object: 'player' }, obj);
            }
        });
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
                    font-size: 13px;
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
                let geometry, material;
                switch (shape) {
                    case 'sphere':
                        geometry = new THREE.SphereGeometry(0.5, 16, 16);
                        material = new THREE.MeshStandardMaterial({ color: 0x4c97ff, roughness: 0.4 });
                        break;
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
                        material = new THREE.MeshStandardMaterial({ color: 0x59c059, roughness: 0.4 });
                        break;
                }
                const spawned = new THREE.Mesh(geometry, material);
                spawned.position.copy(spawnPos);
                spawned.castShadow = true;
                spawned.receiveShadow = true;
                spawned.userData = {
                    id: 'spawned_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                    name: shape,
                    type: shape,
                    collidable: true,
                    isClone: true,
                    scripts: []
                };
                this.scene3d.scene.add(spawned);
                this.scene3d.objects.push(spawned);
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
                    font-size: 28px;
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
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: ${result === 'win' ? 'rgba(40,120,40,0.85)' : 'rgba(120,30,30,0.85)'};
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    z-index: 10001;
                    backdrop-filter: blur(4px);
                `;
                const title = document.createElement('div');
                title.style.cssText = 'color:white;font-size:56px;font-weight:800;margin-bottom:16px;text-shadow:0 4px 12px rgba(0,0,0,0.4);';
                title.textContent = result === 'win' ? 'YOU WIN!' : 'GAME OVER';
                const sub = document.createElement('div');
                sub.style.cssText = 'color:rgba(255,255,255,0.8);font-size:20px;font-weight:500;margin-bottom:32px;';
                sub.textContent = `Score: ${this.variables.score || 0}`;
                const btn = document.createElement('button');
                btn.style.cssText = 'background:white;color:#333;border:none;padding:12px 36px;border-radius:12px;font-size:18px;font-weight:600;cursor:pointer;';
                btn.textContent = 'Press ESC to exit';
                overlay.appendChild(title);
                overlay.appendChild(sub);
                overlay.appendChild(btn);
                document.body.appendChild(overlay);
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

            default: {
                // Handle custom block calls (customCall_xxx)
                if (code.startsWith('customCall_')) {
                    const customId = code.replace('customCall_', '');
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
        const hud = document.getElementById('game-hud');
        hud.innerHTML = '';

        this.hudElements.forEach(varName => {
            const el = document.createElement('div');
            el.style.cssText = 'background:rgba(0,0,0,0.6);color:white;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;backdrop-filter:blur(8px);';
            el.textContent = `${varName}: ${this.variables[varName] ?? 0}`;
            hud.appendChild(el);
        });
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
            font-size: 13px;
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
        }
    }
}
