/**
 * App - Main application controller for Cobalt Studio
 * Wires together Scene3D, BlockCode, Runtime, and UI
 */
class App {
    constructor() {
        const canvas = document.getElementById('viewport');
        if (!canvas) {
            throw new Error('Canvas element #viewport not found in DOM');
        }
        this.scene3d = new Scene3D(canvas);
        this.blockCode = new BlockCode();
        this.runtime = new Runtime(this.scene3d, this.blockCode);
        this.textureManager = new TextureManager();
        window._textureManager = this.textureManager;

        this.undoStack = [];
        this.redoStack = [];

        this.initToolbar();
        this.initPanels();
        this.initObjectLibrary();
        this.initProperties();
        this.initMaterials();
        this.initBlockEditor();
        this.initContextMenu();
        this.initKeyboard();
        this.initEnvironment();
        this.initSaveLoad();
        this.initTemplates();
        this.initSettings();
        this.initCustomObjects();
        this.initUIScreens();
        this.initAuth();
        this.initExplore();
        this.initPublish();
        this.initCollab();
        this.initAIAssistant();

        this.VERSION = '1.0.0';
        this.currentProjectId = null;
        this.projectName = null;
        this.hasUnsavedChanges = false;
        this.lastSaveTime = null;
        this.projectSortBy = 'date';

        // Collab state
        this._collabWs = null;
        this._collabRoom = null;
        this._collabIsHost = false;
        this._collabMembers = [];
        this._collabBroadcastPaused = false;

        this.scene3d.onObjectSelected = (obj) => {
            // Single-select clears any existing multi-select
            this.scene3d.selectedObjects.forEach(o => this.scene3d.removeMultiSelectHighlight(o));
            this.scene3d.selectedObjects = [];
            this.onObjectSelected(obj);
        };
        this.scene3d.onObjectDeselected = () => {
            // Deselect clears any existing multi-select
            this.scene3d.selectedObjects.forEach(o => this.scene3d.removeMultiSelectHighlight(o));
            this.scene3d.selectedObjects = [];
            this.onObjectDeselected();
        };
        this.scene3d.onMultiSelect = (objects) => {
            this.onMultiSelectChanged(objects);
        };
        this.scene3d.onObjectChanged = (obj) => this.updateProperties(obj);
        this.scene3d.onFPSUpdate((fps) => {
            document.getElementById('info-fps').textContent = fps + ' FPS';
        });

        this.runtime.onStop = () => this.onPlayStop();

        // Migrate old single-project storage to multi-project
        this.migrateOldProject();
        this.initTitleScreen();
        this.initConfirmModal();
        this.initShortcutsModal();
        this.initAboutModal();

        // Version + autosave indicator
        document.getElementById('status-version').textContent = 'v' + this.VERSION;
        document.getElementById('status-version').addEventListener('click', () => this.showAboutModal());
        document.getElementById('about-version').textContent = 'Version ' + this.VERSION;
        document.getElementById('splash-version').textContent = 'v' + this.VERSION;

        // Back-to-home button
        document.getElementById('btn-back-home').addEventListener('click', () => this.showTitleScreen());

        // Check for shared project URL
        const loadedFromHash = this.loadFromHash();

        this.refreshExplorer();
        this.updateObjectCount();

        // Ensure viewport is properly sized with editor open
        setTimeout(() => this.scene3d.onResize(), 100);

        this.initTutorial();
        this.initTooltips();

        // Show splash, auth screen, title screen, or go to editor
        const splashSeen = localStorage.getItem('blockforge_splash_seen');
        if (loadedFromHash) {
            this.checkAuth().then(() => {
                this.updateUserDisplay();
                this.updateToolbarProjectName();
                this.toast('Cobalt Studio loaded! Start building your game.');
            });
        } else if (!splashSeen) {
            document.getElementById('splash-screen').classList.remove('hidden');
            document.getElementById('splash-start').addEventListener('click', async () => {
                localStorage.setItem('blockforge_splash_seen', 'true');
                document.getElementById('splash-screen').classList.add('hidden');
                const loggedIn = await this.checkAuth();
                if (loggedIn) {
                    this.updateUserDisplay();
                    this.showTitleScreen();
                } else {
                    this.showAuthScreen();
                }
            });
        } else {
            this.checkAuth().then(loggedIn => {
                if (loggedIn) {
                    this.updateUserDisplay();
                    this.showTitleScreen();
                } else {
                    this.showAuthScreen();
                }
            });
        }

        // Auto-save every 60 seconds (skip for collab guests)
        setInterval(() => {
            if (this.currentProjectId && !this._collabGuest()) {
                this.saveProject(true);
            }
        }, 60000);

        // Update autosave indicator every 30 seconds
        setInterval(() => this.updateAutosaveIndicator(), 30000);
    }

    // ===== Toolbar =====

    initToolbar() {
        // Tool buttons
        const toolBtns = document.querySelectorAll('[data-tool]');
        toolBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                toolBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.scene3d.setTool(btn.dataset.tool);
            });
        });
        // Default to select
        document.getElementById('btn-select').classList.add('active');

        // Rotate angle input
        const rotateAngleInput = document.getElementById('rotate-angle');
        const rotateAxisSelect = document.getElementById('rotate-axis');
        const applyRotation = () => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const deg = parseFloat(rotateAngleInput.value);
            if (isNaN(deg)) return;
            const axis = rotateAxisSelect.value;
            obj.rotation[axis] = THREE.MathUtils.degToRad(deg);
            this.updateProperties(obj);
        };
        rotateAngleInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                applyRotation();
                rotateAngleInput.blur();
            }
        });
        rotateAngleInput.addEventListener('change', applyRotation);

        // Snap
        const snapBtn = document.getElementById('btn-snap');
        snapBtn.classList.add('active');
        snapBtn.addEventListener('click', () => {
            snapBtn.classList.toggle('active');
            const snapSize = parseFloat(document.getElementById('snap-size').value);
            this.scene3d.setSnap(snapBtn.classList.contains('active'), snapSize);
        });

        document.getElementById('snap-size').addEventListener('change', (e) => {
            this.scene3d.setSnap(snapBtn.classList.contains('active'), parseFloat(e.target.value));
        });

        // Play/Stop
        document.getElementById('btn-play').addEventListener('click', () => this.startPlay());
        document.getElementById('btn-stop').addEventListener('click', () => this.stopPlay());

        // Undo/Redo
        document.getElementById('btn-undo').addEventListener('click', () => this.undo());
        document.getElementById('btn-redo').addEventListener('click', () => this.redo());

        // Viewport fullscreen
        document.getElementById('btn-fullscreen-viewport').addEventListener('click', () => {
            this.toggleFullscreenViewport();
        });
    }

    toggleFullscreenViewport() {
        const container = document.getElementById('viewport-container');
        const icon = document.querySelector('#btn-fullscreen-viewport .material-icons-round');

        if (container.classList.contains('fullscreen')) {
            container.classList.remove('fullscreen');
            icon.textContent = 'fullscreen';
        } else {
            container.classList.add('fullscreen');
            icon.textContent = 'fullscreen_exit';
        }

        setTimeout(() => this.scene3d.onResize(), 50);
    }

    startPlay() {
        if (this._collabRoom && this._collabMembers.length > 1) {
            this._collabStartVote('play');
            return;
        }
        this._doStartPlay();
    }

    _doStartPlay() {
        this.runtime.playerColors = this.gameSettings.playerColors;
        this.runtime._uiScreens = this.uiScreens;
        this.runtime.start(this.gameSettings);
    }

    stopPlay() {
        if (this._collabRoom && this._collabMembers.length > 1) {
            this._collabStartVote('stop');
            return;
        }
        this._doStopPlay();
    }

    _doStopPlay() {
        this.runtime.stop();
    }

    onPlayStop() {
        this.refreshExplorer();
    }

    // ===== Panels =====

    initPanels() {
        // Tab switching
        document.querySelectorAll('.panel-tabs').forEach(tabs => {
            tabs.querySelectorAll('.panel-tab').forEach(tab => {
                tab.addEventListener('click', () => {
                    const panel = tabs.parentElement;
                    panel.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
                    panel.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                    tab.classList.add('active');
                    const target = panel.querySelector(`#tab-${tab.dataset.tab}`);
                    if (target) target.classList.add('active');
                });
            });
        });
    }

    // ===== Object Library =====

    initObjectLibrary() {
        // Shape buttons
        document.querySelectorAll('[data-shape]').forEach(btn => {
            btn.addEventListener('click', () => {
                const shape = btn.dataset.shape;
                const obj = this.scene3d.addObject(shape, {
                    position: { x: 0, y: 0.5, z: 0 }
                });
                this.scene3d.selectObject(obj);
                this.refreshExplorer();
                this.updateObjectCount();
                this.saveUndoState();
            });
        });

        // Prefab buttons
        document.querySelectorAll('[data-prefab]').forEach(btn => {
            btn.addEventListener('click', () => {
                const prefab = btn.dataset.prefab;
                const obj = this.scene3d.addObject(prefab, {
                    position: { x: 0, y: 0.5, z: 0 }
                });
                this.scene3d.selectObject(obj);
                this.refreshExplorer();
                this.updateObjectCount();
                this.saveUndoState();
            });
        });

        // Terrain tools
        document.querySelectorAll('[data-terrain]').forEach(btn => {
            btn.addEventListener('click', () => {
                const terrain = btn.dataset.terrain;
                this.addTerrainPiece(terrain);
            });
        });
    }

    addTerrainPiece(type) {
        switch (type) {
            case 'flat': {
                const obj = this.scene3d.addObject('box', {
                    name: 'Ground',
                    position: { x: 0, y: -0.125, z: 0 },
                    scale: { x: 10, y: 0.25, z: 10 },
                    color: '#4a7c3f',
                    anchored: true
                });
                this.scene3d.selectObject(obj);
                break;
            }
            case 'raise': {
                const obj = this.scene3d.addObject('box', {
                    name: 'Hill',
                    position: { x: 0, y: 1, z: 0 },
                    scale: { x: 4, y: 2, z: 4 },
                    color: '#5a8c4f',
                    anchored: true
                });
                this.scene3d.selectObject(obj);
                break;
            }
            case 'water': {
                const obj = this.scene3d.addObject('box', {
                    name: 'Water',
                    position: { x: 0, y: -0.4, z: 0 },
                    scale: { x: 10, y: 0.1, z: 10 },
                    color: '#2980b9'
                });
                if (obj.material) {
                    obj.material.transparent = true;
                    obj.material.opacity = 0.6;
                }
                this.scene3d.selectObject(obj);
                break;
            }
            case 'paint': {
                // Paint the selected object
                const obj = this.scene3d.selectedObject;
                if (obj) {
                    const mat = obj.material || this._getFirstChildMaterial(obj);
                    const activeSwatch = document.querySelector('.material-swatches .swatch.active');
                    if (mat && activeSwatch) {
                        mat.color.set(activeSwatch.style.background);
                        this.scene3d._needsRender = true;
                    }
                }
                return;
            }
        }
        this.refreshExplorer();
        this.updateObjectCount();
        this.saveUndoState();
    }

    // ===== Explorer =====

    refreshExplorer() {
        const tree = document.getElementById('tree-children');
        tree.innerHTML = '';

        this.scene3d.objects.forEach(obj => {
            const item = document.createElement('div');
            item.className = 'tree-item';
            if (this.scene3d.selectedObject === obj) {
                item.classList.add('selected');
            } else if (this.scene3d.selectedObjects.includes(obj)) {
                item.classList.add('multi-selected');
            }

            const iconName = this.getObjectIcon(obj.userData.type);
            item.innerHTML = `
                <span class="material-icons-round tree-icon">${iconName}</span>
                <span>${obj.userData.name}</span>
            `;

            item.addEventListener('click', (e) => {
                if (e.shiftKey) {
                    this.scene3d.selectMultiple(obj);
                } else {
                    this.scene3d.selectObject(obj);
                }
                this.refreshExplorer();
            });

            item.addEventListener('dblclick', () => {
                // Focus camera on object
                this.scene3d.orbitControls.target.copy(obj.position);
            });

            tree.appendChild(item);
        });
    }

    getObjectIcon(type) {
        const icons = {
            'box': 'check_box_outline_blank',
            'sphere': 'circle',
            'cylinder': 'filter_tilt_shift',
            'cone': 'change_history',
            'plane': 'crop_landscape',
            'torus': 'panorama_fish_eye',
            'wedge': 'signal_cellular_alt',
            'stairs': 'stairs',
            'pyramid': 'change_history',
            'dome': 'brightness_low',
            'arch': 'door_front',
            'tube': 'panorama_fish_eye',
            'wall': 'fence',
            'corner': 'border_style',
            'spawn': 'person_pin',
            'light-point': 'lightbulb',
            'coin': 'monetization_on',
            'npc': 'person',
            'tree': 'park',
            'house': 'home',
            'platform': 'view_agenda',
            'bridge': 'drag_handle',
            'crate': 'inventory_2',
            'gem': 'diamond',
            'camera': 'videocam',
            'custom': 'widgets'
        };
        return icons[type] || 'category';
    }

    updateObjectCount() {
        document.getElementById('info-objects').textContent = this.scene3d.objects.length + ' objects';
    }

    // ===== Properties Panel =====

    initProperties() {
        // Name
        document.getElementById('prop-name').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.userData.name = e.target.value;
                this.refreshExplorer();
            }
        });

        // Visibility
        document.getElementById('prop-visible').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.visible = e.target.checked;
                this.scene3d.selectedObject.userData.visible = e.target.checked;
            }
        });

        // Locked
        document.getElementById('prop-locked').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.userData.locked = e.target.checked;
            }
        });

        // Position
        ['x', 'y', 'z'].forEach(axis => {
            document.getElementById(`prop-pos-${axis}`).addEventListener('change', (e) => {
                if (this.scene3d.selectedObject) {
                    this.scene3d.selectedObject.position[axis] = parseFloat(e.target.value) || 0;
                }
            });
        });

        // Rotation
        ['x', 'y', 'z'].forEach(axis => {
            document.getElementById(`prop-rot-${axis}`).addEventListener('change', (e) => {
                if (this.scene3d.selectedObject) {
                    this.scene3d.selectedObject.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
                }
            });
        });

        // Scale
        ['x', 'y', 'z'].forEach(axis => {
            document.getElementById(`prop-scale-${axis}`).addEventListener('change', (e) => {
                if (this.scene3d.selectedObject) {
                    this.scene3d.selectedObject.scale[axis] = parseFloat(e.target.value) || 1;
                }
            });
        });

        // Physics
        document.getElementById('prop-anchored').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.userData.anchored = e.target.checked;
            }
        });

        document.getElementById('prop-collidable').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.userData.collidable = e.target.checked;
            }
        });

        document.getElementById('prop-mass').addEventListener('change', (e) => {
            if (this.scene3d.selectedObject) {
                this.scene3d.selectedObject.userData.mass = parseFloat(e.target.value) || 1;
            }
        });

        // Actions
        document.getElementById('btn-duplicate').addEventListener('click', () => {
            this.duplicateAllSelected();
        });

        document.getElementById('btn-delete').addEventListener('click', () => {
            this.deleteSelected();
        });

        document.getElementById('btn-edit-script').addEventListener('click', () => {
            this.openBlockEditor();
        });
    }

    onObjectSelected(obj) {
        this._hideMultiSelectSummary();
        document.getElementById('no-selection').classList.add('hidden');
        document.getElementById('properties-content').classList.remove('hidden');
        document.getElementById('material-no-selection').classList.add('hidden');
        document.getElementById('material-content').classList.remove('hidden');

        this.updateProperties(obj);
        this.updateNpcColors(obj);
        this.refreshExplorer();

        // Auto-set block code target so drag-and-drop works immediately
        this.blockCode.setTarget(obj);
    }

    onObjectDeselected() {
        this._hideMultiSelectSummary();
        document.getElementById('no-selection').classList.remove('hidden');
        document.getElementById('properties-content').classList.add('hidden');
        document.getElementById('material-no-selection').classList.remove('hidden');
        document.getElementById('material-content').classList.add('hidden');
        document.getElementById('npc-colors-section').classList.add('hidden');

        this.blockCode.setTarget(null);
        this.refreshExplorer();
    }

    onMultiSelectChanged(objects) {
        if (objects.length > 1) {
            // Show multi-select summary in properties panel
            document.getElementById('no-selection').classList.add('hidden');
            document.getElementById('properties-content').classList.add('hidden');
            document.getElementById('material-no-selection').classList.remove('hidden');
            document.getElementById('material-content').classList.add('hidden');
            document.getElementById('npc-colors-section').classList.add('hidden');
            this._showMultiSelectSummary(objects.length);
        } else if (objects.length === 1) {
            this._hideMultiSelectSummary();
            this.onObjectSelected(objects[0]);
        } else {
            this._hideMultiSelectSummary();
            this.onObjectDeselected();
        }
        this.refreshExplorer();
    }

    _showMultiSelectSummary(count) {
        // Hide normal properties, show multi-select overlay
        document.getElementById('properties-content').classList.add('hidden');
        let overlay = document.getElementById('multi-select-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'multi-select-overlay';
            document.getElementById('properties-content').parentNode.insertBefore(
                overlay, document.getElementById('properties-content').nextSibling
            );
        }
        overlay.classList.remove('hidden');
        overlay.innerHTML = `
            <div class="panel-section">
                <div class="section-header"><span>Multi-Selection</span></div>
                <div class="empty-state" style="padding: 16px 0;">
                    <span class="material-icons-round" style="font-size: 32px; color: var(--accent);">select_all</span>
                    <p style="margin: 8px 0 4px;">${count} objects selected</p>
                    <p style="font-size: 11px; color: var(--text-dim);">Shift+Click to add/remove objects</p>
                </div>
            </div>
            <div class="panel-section">
                <div class="section-header"><span>Bulk Actions</span></div>
                <div class="action-buttons">
                    <button class="action-btn" id="btn-multi-duplicate">
                        <span class="material-icons-round">content_copy</span> Duplicate All
                    </button>
                    <button class="action-btn danger" id="btn-multi-delete">
                        <span class="material-icons-round">delete</span> Delete All
                    </button>
                </div>
            </div>
        `;
        document.getElementById('btn-multi-duplicate').addEventListener('click', () => {
            this.duplicateAllSelected();
        });
        document.getElementById('btn-multi-delete').addEventListener('click', () => {
            this.deleteSelected();
        });
    }

    _hideMultiSelectSummary() {
        const overlay = document.getElementById('multi-select-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    updateProperties(obj) {
        if (!obj) return;

        document.getElementById('prop-name').value = obj.userData.name;
        document.getElementById('prop-visible').checked = obj.visible;
        document.getElementById('prop-locked').checked = obj.userData.locked;

        document.getElementById('prop-pos-x').value = parseFloat(obj.position.x.toFixed(2));
        document.getElementById('prop-pos-y').value = parseFloat(obj.position.y.toFixed(2));
        document.getElementById('prop-pos-z').value = parseFloat(obj.position.z.toFixed(2));

        document.getElementById('prop-rot-x').value = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.x).toFixed(1));
        document.getElementById('prop-rot-y').value = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.y).toFixed(1));
        document.getElementById('prop-rot-z').value = parseFloat(THREE.MathUtils.radToDeg(obj.rotation.z).toFixed(1));

        document.getElementById('prop-scale-x').value = parseFloat(obj.scale.x.toFixed(2));
        document.getElementById('prop-scale-y').value = parseFloat(obj.scale.y.toFixed(2));
        document.getElementById('prop-scale-z').value = parseFloat(obj.scale.z.toFixed(2));

        document.getElementById('prop-anchored').checked = obj.userData.anchored;
        document.getElementById('prop-collidable').checked = obj.userData.collidable;
        document.getElementById('prop-mass').value = obj.userData.mass;

        // Update material properties
        const mat = obj.material || this._getFirstChildMaterial(obj);
        if (mat) {
            document.getElementById('prop-color').value = '#' + mat.color.getHexString();
            document.getElementById('prop-roughness').value = Math.round((mat.roughness ?? 0.5) * 100);
            document.getElementById('prop-metalness').value = Math.round((mat.metalness ?? 0) * 100);
            document.getElementById('prop-opacity').value = Math.round((mat.opacity ?? 1) * 100);
        }

        // Update texture swatch highlight
        const texId = obj.userData.textureId || null;
        this._highlightTextureSwatch(texId);
        this._updateTileScaleUI(texId, obj.userData.tileScale || 1);

        // Update status bar
        document.getElementById('status-pos').textContent =
            `X: ${obj.position.x.toFixed(1)} Y: ${obj.position.y.toFixed(1)} Z: ${obj.position.z.toFixed(1)}`;
    }

    _getFirstChildMaterial(obj) {
        let mat = null;
        obj.traverse(child => {
            if (!mat && child.isMesh && child.material) mat = child.material;
        });
        return mat;
    }

    // ===== Materials Panel =====

    initMaterials() {
        // Color picker
        document.getElementById('prop-color').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const mat = obj.material || this._getFirstChildMaterial(obj);
            if (mat) {
                mat.color.set(e.target.value);
                this.scene3d._needsRender = true;
            }
        });

        // Color presets
        document.querySelectorAll('.color-presets .swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                const obj = this.scene3d.selectedObject;
                if (!obj) return;
                const mat = obj.material || this._getFirstChildMaterial(obj);
                if (mat) {
                    mat.color.set(color);
                    document.getElementById('prop-color').value = color;
                    this.scene3d._needsRender = true;
                }
            });
        });

        // Material type
        document.getElementById('prop-material-type').addEventListener('change', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const mat = obj.material || this._getFirstChildMaterial(obj);
            if (!mat) return;
            switch (e.target.value) {
                case 'standard':
                    mat.roughness = 0.6;
                    mat.metalness = 0.1;
                    mat.emissive?.set(0x000000);
                    mat.emissiveIntensity = 0;
                    break;
                case 'metallic':
                    mat.roughness = 0.2;
                    mat.metalness = 0.9;
                    break;
                case 'glass':
                    mat.roughness = 0.1;
                    mat.metalness = 0.1;
                    mat.transparent = true;
                    mat.opacity = 0.3;
                    break;
                case 'emissive':
                    mat.emissive = mat.color.clone();
                    mat.emissiveIntensity = 0.5;
                    break;
                case 'flat':
                    mat.roughness = 1;
                    mat.metalness = 0;
                    break;
            }
            this.scene3d._needsRender = true;
            this.updateProperties(this.scene3d.selectedObject);
        });

        // Roughness
        document.getElementById('prop-roughness').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const mat = obj.material || this._getFirstChildMaterial(obj);
            if (mat) mat.roughness = e.target.value / 100;
        });

        // Metalness
        document.getElementById('prop-metalness').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const mat = obj.material || this._getFirstChildMaterial(obj);
            if (mat) mat.metalness = e.target.value / 100;
        });

        // Opacity
        document.getElementById('prop-opacity').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj) return;
            const mat = obj.material || this._getFirstChildMaterial(obj);
            if (mat) {
                const opacity = e.target.value / 100;
                mat.opacity = opacity;
                mat.transparent = opacity < 1;
            }
        });

        // NPC per-part color inputs
        this.initNpcColorInputs();

        // Terrain material swatches
        document.querySelectorAll('.material-swatches .swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                document.querySelectorAll('.material-swatches .swatch').forEach(s => s.classList.remove('active'));
                swatch.classList.add('active');
            });
        });

        // === Texture swatches ===
        this._buildTextureSwatches();

        // Tile scale slider
        const tileSlider = document.getElementById('prop-tile-scale');
        const tileValue = document.getElementById('tile-scale-value');
        tileSlider.addEventListener('input', (e) => {
            const val = parseInt(e.target.value);
            tileValue.textContent = val;
            const obj = this.scene3d.selectedObject;
            if (!obj || !obj.userData.textureId) return;
            obj.userData.tileScale = val;
            this.textureManager.applyTexture(obj, obj.userData.textureId, val);
            this.scene3d._needsRender = true;
        });
    }

    _buildTextureSwatches() {
        const container = document.getElementById('texture-swatches');
        container.innerHTML = '';

        // "None" button
        const noneBtn = document.createElement('button');
        noneBtn.className = 'texture-swatch-none active';
        noneBtn.title = 'No Texture';
        noneBtn.innerHTML = '<span class="material-icons-round" style="font-size:16px">close</span>';
        noneBtn.addEventListener('click', () => this._setTexture(null));
        container.appendChild(noneBtn);

        // Category groups
        this.textureManager.categories.forEach(cat => {
            const label = document.createElement('div');
            label.className = 'texture-category-label';
            label.textContent = cat.name;
            container.appendChild(label);

            cat.ids.forEach(id => {
                const btn = document.createElement('button');
                btn.className = 'texture-swatch';
                btn.title = this.textureManager.labels[id];
                btn.dataset.textureId = id;
                btn.style.backgroundImage = `url(${this.textureManager.getPreviewDataURL(id)})`;
                btn.addEventListener('click', () => this._setTexture(id));
                container.appendChild(btn);
            });
        });
    }

    _setTexture(textureId) {
        const obj = this.scene3d.selectedObject;
        if (!obj) return;

        const tileScale = textureId ? (obj.userData.tileScale || 1) : 1;
        this.textureManager.applyTexture(obj, textureId, tileScale);
        this.scene3d._needsRender = true;
        this._highlightTextureSwatch(textureId);
        this._updateTileScaleUI(textureId, tileScale);
    }

    _highlightTextureSwatch(activeId) {
        const container = document.getElementById('texture-swatches');
        container.querySelectorAll('.texture-swatch, .texture-swatch-none').forEach(el => {
            el.classList.remove('active');
        });
        if (!activeId) {
            container.querySelector('.texture-swatch-none')?.classList.add('active');
        } else {
            container.querySelector(`[data-texture-id="${activeId}"]`)?.classList.add('active');
        }
    }

    _updateTileScaleUI(textureId, tileScale) {
        const row = document.getElementById('tile-scale-row');
        if (textureId) {
            row.classList.remove('hidden');
            document.getElementById('prop-tile-scale').value = tileScale || 1;
            document.getElementById('tile-scale-value').textContent = tileScale || 1;
        } else {
            row.classList.add('hidden');
        }
    }

    // ===== Block Editor =====

    initBlockEditor() {
        const editor = document.getElementById('block-editor');
        const header = document.getElementById('block-editor-header');
        const toggleBtn = document.getElementById('btn-toggle-editor');

        header.addEventListener('click', (e) => {
            if (e.target.closest('.tool-btn') && e.target.closest('.tool-btn') !== toggleBtn) return;
            this.toggleBlockEditor();
        });

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleBlockEditor();
        });

        document.getElementById('btn-clear-script').addEventListener('click', (e) => {
            e.stopPropagation();
            this.showConfirm('Clear Scripts', 'Clear all scripts for this object?', 'Clear', 'danger').then(confirmed => {
                if (confirmed) this.blockCode.clearScripts();
            });
        });

        // Fullscreen toggle
        document.getElementById('btn-fullscreen-editor').addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleFullscreenEditor();
        });
    }

    toggleBlockEditor() {
        const editor = document.getElementById('block-editor');
        const icon = document.querySelector('#btn-toggle-editor .material-icons-round');

        if (editor.classList.contains('expanded')) {
            editor.classList.remove('expanded');
            editor.classList.add('collapsed');
            document.body.classList.remove('editor-expanded');
            icon.textContent = 'expand_less';
        } else {
            editor.classList.remove('collapsed');
            editor.classList.add('expanded');
            document.body.classList.add('editor-expanded');
            icon.textContent = 'expand_more';
        }

        // Trigger resize for viewport
        setTimeout(() => this.scene3d.onResize(), 310);
    }

    toggleFullscreenEditor() {
        const editor = document.getElementById('block-editor');
        const icon = document.querySelector('#btn-fullscreen-editor .material-icons-round');

        if (editor.classList.contains('fullscreen')) {
            editor.classList.remove('fullscreen');
            icon.textContent = 'fullscreen';
            // Restore expanded state
            if (!editor.classList.contains('expanded')) {
                editor.classList.add('expanded');
                document.body.classList.add('editor-expanded');
            }
        } else {
            // Ensure editor is expanded first
            if (!editor.classList.contains('expanded')) {
                editor.classList.remove('collapsed');
                editor.classList.add('expanded');
                document.body.classList.add('editor-expanded');
            }
            editor.classList.add('fullscreen');
            icon.textContent = 'fullscreen_exit';
        }

        setTimeout(() => this.scene3d.onResize(), 310);
    }

    openBlockEditor() {
        if (!this.scene3d.selectedObject) return;

        this.blockCode.setTarget(this.scene3d.selectedObject);

        const editor = document.getElementById('block-editor');
        if (!editor.classList.contains('expanded')) {
            this.toggleBlockEditor();
        }
    }

    // ===== Context Menu =====

    initContextMenu() {
        const menu = document.getElementById('context-menu');

        this.scene3d.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (this.scene3d.selectedObject || this.scene3d.selectedObjects.length > 0) {
                menu.classList.remove('hidden');
                menu.style.left = e.clientX + 'px';
                menu.style.top = e.clientY + 'px';
            }
        });

        document.addEventListener('click', () => {
            menu.classList.add('hidden');
        });

        menu.querySelectorAll('.context-item').forEach(item => {
            item.addEventListener('click', () => {
                const action = item.dataset.action;
                switch (action) {
                    case 'duplicate':
                        this.duplicateAllSelected();
                        break;
                    case 'delete':
                        this.deleteSelected();
                        break;
                    case 'group':
                        this.toast('Grouping coming soon!');
                        break;
                    case 'ungroup':
                        this.toast('Ungrouping coming soon!');
                        break;
                    case 'edit-script':
                        this.openBlockEditor();
                        break;
                    case 'properties':
                        // Switch to properties tab
                        document.querySelector('#right-panel .panel-tab[data-tab="properties"]').click();
                        break;
                }
                menu.classList.add('hidden');
            });
        });
    }

    deleteSelected() {
        if (this.scene3d.selectedObjects.length > 1) {
            this.saveUndoState();
            const toDelete = [...this.scene3d.selectedObjects];
            toDelete.forEach(obj => this.scene3d.removeObject(obj));
            this.scene3d.selectedObjects = [];
            this.refreshExplorer();
            this.updateObjectCount();
        } else if (this.scene3d.selectedObject) {
            this.saveUndoState();
            this.scene3d.removeObject(this.scene3d.selectedObject);
            this.refreshExplorer();
            this.updateObjectCount();
        }
    }

    duplicateAllSelected() {
        if (this.scene3d.selectedObjects.length > 1) {
            this.saveUndoState();
            let lastDup = null;
            const toDuplicate = [...this.scene3d.selectedObjects];
            toDuplicate.forEach(obj => {
                const dup = this.scene3d.duplicateObject(obj);
                if (dup) lastDup = dup;
            });
            if (lastDup) {
                this.scene3d.selectObject(lastDup);
            }
            this.refreshExplorer();
            this.updateObjectCount();
        } else if (this.scene3d.selectedObject) {
            this.saveUndoState();
            const dup = this.scene3d.duplicateObject(this.scene3d.selectedObject);
            if (dup) {
                this.scene3d.selectObject(dup);
                this.refreshExplorer();
                this.updateObjectCount();
            }
        }
    }

    _nudgeSelected(key, shift) {
        const obj = this.scene3d.selectedObject;
        if (!obj) return;
        const step = shift ? (this.scene3d.snapEnabled ? this.scene3d.snapSize * 4 : 4)
                          : (this.scene3d.snapEnabled ? this.scene3d.snapSize : 1);

        // Get camera forward/right projected onto the XZ plane
        const cam = this.scene3d.camera;
        const forward = new THREE.Vector3();
        cam.getWorldDirection(forward);
        forward.y = 0;
        forward.normalize();
        const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

        let dx = 0, dz = 0;
        switch (key) {
            case 'ArrowUp':    dx += forward.x; dz += forward.z; break;
            case 'ArrowDown':  dx -= forward.x; dz -= forward.z; break;
            case 'ArrowLeft':  dx -= right.x;   dz -= right.z;   break;
            case 'ArrowRight': dx += right.x;   dz += right.z;   break;
        }

        obj.position.x += dx * step;
        obj.position.z += dz * step;

        // Snap to grid if enabled
        if (this.scene3d.snapEnabled) {
            const ss = this.scene3d.snapSize;
            obj.position.x = Math.round(obj.position.x / ss) * ss;
            obj.position.z = Math.round(obj.position.z / ss) * ss;
        }

        this.scene3d._needsRender = true;
        this.updateProperties(obj);

        // Broadcast transform to collab members
        if (this.scene3d.onObjectChanged) {
            this.scene3d.onObjectChanged(obj);
        }
    }

    // ===== Keyboard Shortcuts =====

    initKeyboard() {
        // Global ESC handler for project page viewer
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (!this._ppScene3d) return;

            e.preventDefault();

            // If viewer runtime is running, stop it
            if (this._ppRuntime && this._ppRuntime.isRunning) {
                this._ppStopPlay();
            }

            // If viewer is fullscreen, exit fullscreen
            const ppContainer = document.getElementById('pp-viewport-container');
            if (ppContainer && ppContainer.classList.contains('pp-fullscreen')) {
                this._ppToggleFullscreen();
            }
        });

        document.addEventListener('keydown', (e) => {
            if (!this.currentProjectId) return;
            if (this.runtime.isRunning) return;
            if (this._ppScene3d) return; // Don't fire editor shortcuts while project page viewer is open
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

            switch (e.key) {
                case 'v':
                case 'V':
                    if (!e.ctrlKey && !e.metaKey) {
                        document.getElementById('btn-select').click();
                    }
                    break;
                case 'g':
                case 'G':
                    document.getElementById('btn-move').click();
                    break;
                case 'r':
                case 'R':
                    document.getElementById('btn-rotate').click();
                    break;
                case 's':
                case 'S':
                    if (!e.ctrlKey && !e.metaKey) {
                        document.getElementById('btn-scale').click();
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    this.deleteSelected();
                    break;
                case 'd':
                case 'D':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.duplicateAllSelected();
                    }
                    break;
                case 'a':
                case 'A':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.scene3d.deselectAll();
                        this.scene3d.objects.forEach(obj => {
                            this.scene3d.selectMultiple(obj);
                        });
                    }
                    break;
                case 'z':
                case 'Z':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        if (e.shiftKey) this.redo();
                        else this.undo();
                    }
                    break;
                case 'y':
                case 'Y':
                    if (e.ctrlKey || e.metaKey) {
                        e.preventDefault();
                        this.redo();
                    }
                    break;
                case 'F5':
                    e.preventDefault();
                    if (this.runtime.isRunning) this.stopPlay();
                    else this.startPlay();
                    break;

                case 'ArrowUp':
                case 'ArrowDown':
                case 'ArrowLeft':
                case 'ArrowRight':
                    e.preventDefault();
                    this._nudgeSelected(e.key, e.shiftKey);
                    break;
                case 'Escape':
                    if (this.runtime.isRunning) {
                        this.stopPlay();
                    } else if (document.getElementById('viewport-container').classList.contains('fullscreen')) {
                        this.toggleFullscreenViewport();
                    } else if (document.getElementById('block-editor').classList.contains('fullscreen')) {
                        this.toggleFullscreenEditor();
                    } else {
                        this.scene3d.deselectAll();
                    }
                    break;
            }

            // Ctrl+C to copy
            if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                this.copySelected();
            }
            // Ctrl+V to paste
            if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) {
                e.preventDefault();
                this.pasteObjects();
            }
            // Ctrl+S to save
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                this.saveProject();
            }
            // ? to toggle shortcuts
            if (e.key === '?' || (e.shiftKey && e.key === '/')) {
                this.toggleShortcutsModal();
            }
        });
    }

    // ===== Environment =====

    initEnvironment() {
        const sendEnv = (prop, value) => {
            if (this._collabBroadcastPaused) return;
            this._collabSend({ type: 'update-environment', prop, value });
        };

        document.getElementById('sky-color').addEventListener('input', (e) => {
            this.scene3d.setSkyColor(e.target.value);
            sendEnv('skyColor', e.target.value);
        });

        document.getElementById('skybox-type').addEventListener('change', (e) => {
            this.scene3d.setSkybox(e.target.value);
            sendEnv('skybox', e.target.value);
        });

        document.getElementById('ambient-light').addEventListener('input', (e) => {
            this.scene3d.setAmbientIntensity(e.target.value / 100);
            sendEnv('ambientLight', e.target.value);
        });

        document.getElementById('fog-density').addEventListener('input', (e) => {
            this.scene3d.setFog(parseInt(e.target.value));
            sendEnv('fogDensity', e.target.value);
        });

        document.getElementById('shadows-enabled').addEventListener('change', (e) => {
            this.scene3d.setShadows(e.target.checked);
            sendEnv('shadows', e.target.checked);
        });

        document.getElementById('weather-type').addEventListener('change', (e) => {
            this.scene3d.setWeather(e.target.value);
            sendEnv('weather', e.target.value);
        });

        document.getElementById('bg-music').addEventListener('change', (e) => {
            this.gameSettings.bgMusic = e.target.value;
        });

        document.getElementById('music-volume').addEventListener('input', (e) => {
            this.gameSettings.musicVolume = parseInt(e.target.value);
        });
    }

    // ===== Save/Load =====

    initSaveLoad() {
        document.getElementById('btn-save').addEventListener('click', () => this.saveProject());
        document.getElementById('btn-load').addEventListener('click', () => this.showTitleScreen());
        document.getElementById('btn-export').addEventListener('click', () => this.exportGame());
        document.getElementById('btn-share').addEventListener('click', () => this.shareProject());

        // Update tooltip for load button
        const loadBtn = document.getElementById('btn-load');
        loadBtn.title = 'My Projects';
        if (loadBtn.dataset.tooltip !== undefined) loadBtn.dataset.tooltip = 'My Projects';
    }

    _updateGuestRestrictions() {
        const isGuest = this._offlineMode;
        document.getElementById('btn-save').classList.toggle('guest-disabled', isGuest);
        document.getElementById('btn-share').classList.toggle('guest-disabled', isGuest);
    }

    // ===== Multi-Project Storage =====

    _storagePrefix() {
        // Namespace by user id so different accounts don't share projects
        if (this._cachedUser && !this._offlineMode && this._cachedUser.username) {
            return 'bf_' + this._cachedUser.username + '_';
        }
        return 'bf_guest_';
    }

    generateProjectId() {
        return 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    getProjectIndex() {
        try {
            // Try user-namespaced key first
            const prefix = this._storagePrefix();
            const data = localStorage.getItem(prefix + 'projects');
            if (data) return JSON.parse(data);
            // Migrate from old shared key if exists and user is logged in
            if (!this._offlineMode) {
                const old = localStorage.getItem('blockforge_projects');
                if (old) return JSON.parse(old);
            }
            return {};
        } catch (e) {
            return {};
        }
    }

    saveProjectIndex(index) {
        const prefix = this._storagePrefix();
        localStorage.setItem(prefix + 'projects', JSON.stringify(index));
    }

    getProjectData(id) {
        try {
            const prefix = this._storagePrefix();
            const data = localStorage.getItem(prefix + 'project_' + id);
            if (data) return JSON.parse(data);
            // Fallback to old shared key
            const old = localStorage.getItem('blockforge_project_' + id);
            if (old) return JSON.parse(old);
            return null;
        } catch (e) {
            return null;
        }
    }

    saveProjectData(id, data) {
        const prefix = this._storagePrefix();
        localStorage.setItem(prefix + 'project_' + id, JSON.stringify(data));
    }

    deleteProjectData(id) {
        const index = this.getProjectIndex();
        // If project was shared, also delete from server
        if (index[id] && index[id].shared) {
            fetch('/api/projects/' + id, {
                method: 'DELETE',
                credentials: 'same-origin'
            }).then(() => {
                this.renderExploreGrid();
            }).catch(() => {});
        }
        // Also delete from cloud sync
        if (this._cachedUser && !this._offlineMode) {
            fetch('/api/user/projects/' + id, {
                method: 'DELETE',
                credentials: 'same-origin'
            }).catch(() => {});
        }
        const prefix = this._storagePrefix();
        localStorage.removeItem(prefix + 'project_' + id);
        // Also clean up old key if it exists
        localStorage.removeItem('blockforge_project_' + id);
        delete index[id];
        this.saveProjectIndex(index);
    }

    _gatherProjectData() {
        return {
            version: 1,
            type: '3d',
            name: this.projectName || 'My Game',
            scene: this.scene3d.serialize(),
            customVariables: this.blockCode.customVariables,
            customMessages: this.blockCode.customMessages,
            customObjects: this.customObjects,
            uiScreens: this.uiScreens,
            environment: {
                skyColor: document.getElementById('sky-color').value,
                skybox: document.getElementById('skybox-type').value,
                ambientLight: document.getElementById('ambient-light').value,
                fogDensity: document.getElementById('fog-density').value,
                shadows: document.getElementById('shadows-enabled').checked,
                weather: document.getElementById('weather-type').value,
                bgMusic: document.getElementById('bg-music').value,
                musicVolume: document.getElementById('music-volume').value,
                playerColors: this.gameSettings.playerColors,
                controlScheme: this.gameSettings.controlScheme,
                speed: this.gameSettings.speed,
                jumpForce: this.gameSettings.jumpForce,
                sensitivity: this.gameSettings.sensitivity,
                keyBindings: this.gameSettings.keyBindings
            }
        };
    }

    _applyProjectData(data) {
        this.scene3d.deserialize(data.scene);

        if (data.customVariables) {
            this.blockCode.customVariables = data.customVariables;
            this.blockCode._updateVariableDropdowns();
        }
        if (data.customMessages) {
            this.blockCode.customMessages = data.customMessages;
            this.blockCode._updateMessageDropdowns();
        }

        if (data.customObjects) {
            this.customObjects = data.customObjects;
            this.renderCustomObjectButtons();
        }

        if (data.uiScreens) {
            this.uiScreens = data.uiScreens;
            this.renderScreenButtons();
            this.blockCode._updateScreenDropdowns(this.uiScreens);
        }

        if (data.environment) {
            document.getElementById('sky-color').value = data.environment.skyColor;
            document.getElementById('ambient-light').value = data.environment.ambientLight;
            document.getElementById('fog-density').value = data.environment.fogDensity;
            document.getElementById('shadows-enabled').checked = data.environment.shadows;

            this.scene3d.setSkyColor(data.environment.skyColor);
            if (data.environment.skybox) {
                document.getElementById('skybox-type').value = data.environment.skybox;
                this.scene3d.setSkybox(data.environment.skybox);
            }
            this.scene3d.setAmbientIntensity(data.environment.ambientLight / 100);
            this.scene3d.setFog(parseInt(data.environment.fogDensity));
            this.scene3d.setShadows(data.environment.shadows);

            if (data.environment.weather) {
                document.getElementById('weather-type').value = data.environment.weather;
                this.scene3d.setWeather(data.environment.weather);
            }
            if (data.environment.bgMusic) {
                document.getElementById('bg-music').value = data.environment.bgMusic;
                this.gameSettings.bgMusic = data.environment.bgMusic;
            }
            if (data.environment.musicVolume) {
                document.getElementById('music-volume').value = data.environment.musicVolume;
                this.gameSettings.musicVolume = parseInt(data.environment.musicVolume);
            }
            if (data.environment.playerColors) {
                this.gameSettings.playerColors = data.environment.playerColors;
                document.getElementById('setting-player-body').value = data.environment.playerColors.body;
                document.getElementById('setting-player-head').value = data.environment.playerColors.head;
                document.getElementById('setting-player-detail').value = data.environment.playerColors.detail;
            }
            if (data.environment.controlScheme) {
                this.gameSettings.controlScheme = data.environment.controlScheme;
                document.querySelectorAll('.control-scheme').forEach(l => {
                    l.classList.toggle('selected', l.dataset.scheme === data.environment.controlScheme);
                });
            }
            if (data.environment.speed) this.gameSettings.speed = data.environment.speed;
            if (data.environment.jumpForce) this.gameSettings.jumpForce = data.environment.jumpForce;
            if (data.environment.sensitivity) this.gameSettings.sensitivity = data.environment.sensitivity;
            if (data.environment.keyBindings) this.gameSettings.keyBindings = data.environment.keyBindings;
        }

        this.refreshExplorer();
        this.updateObjectCount();
    }

    captureThumbnail() {
        try {
            this.scene3d.renderer.render(this.scene3d.scene, this.scene3d.camera);
            const src = this.scene3d.renderer.domElement;
            const c = document.createElement('canvas');
            c.width = 320; c.height = 180;
            c.getContext('2d').drawImage(src, 0, 0, 320, 180);
            return c.toDataURL('image/jpeg', 0.6);
        } catch (e) {
            return null;
        }
    }

    migrateOldProject() {
        const old = localStorage.getItem('blockforge_project');
        if (!old) return;
        try {
            const data = JSON.parse(old);
            const id = this.generateProjectId();
            const now = Date.now();
            this.saveProjectData(id, data);
            const index = this.getProjectIndex();
            index[id] = {
                name: data.name || 'My Game',
                createdAt: now,
                modifiedAt: now,
                thumbnail: null
            };
            this.saveProjectIndex(index);
            localStorage.removeItem('blockforge_project');
        } catch (e) {
            console.error('Migration failed:', e);
        }
    }

    _migrateToNamespacedStorage() {
        // Migrate projects from old shared 'blockforge_projects' key to user-namespaced key
        if (this._offlineMode) return;
        const prefix = this._storagePrefix();
        // Skip if already migrated (user-namespaced key exists)
        if (localStorage.getItem(prefix + 'projects')) return;
        const oldRaw = localStorage.getItem('blockforge_projects');
        if (!oldRaw) return;
        try {
            const oldIndex = JSON.parse(oldRaw);
            // Copy index
            localStorage.setItem(prefix + 'projects', oldRaw);
            // Copy each project's data
            for (const id of Object.keys(oldIndex)) {
                const projData = localStorage.getItem('blockforge_project_' + id);
                if (projData) {
                    localStorage.setItem(prefix + 'project_' + id, projData);
                }
            }
            // Remove old shared keys so other accounts don't pick them up
            localStorage.removeItem('blockforge_projects');
            for (const id of Object.keys(oldIndex)) {
                localStorage.removeItem('blockforge_project_' + id);
            }
        } catch (e) {
            console.error('Storage namespace migration failed:', e);
        }
    }

    // ===== Title Screen =====

    initTitleScreen() {
        document.getElementById('btn-new-project').addEventListener('click', () => this.showNewProjectModal());
        document.getElementById('btn-import-project').addEventListener('click', () => this.importProjectFromFile());
        document.getElementById('btn-title-join-party').addEventListener('click', () => this.joinPartyFromTitle());

        // New project modal
        const modal = document.getElementById('new-project-modal');
        const nameInput = document.getElementById('new-project-name');

        document.getElementById('new-project-cancel').addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        document.getElementById('new-project-create').addEventListener('click', () => {
            this._confirmNewProject();
        });

        nameInput.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') this._confirmNewProject();
            if (e.key === 'Escape') modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        // Template option selection
        document.querySelectorAll('#new-project-modal .template-option').forEach(opt => {
            opt.addEventListener('click', () => {
                document.querySelectorAll('#new-project-modal .template-option').forEach(o => o.classList.remove('selected'));
                opt.classList.add('selected');
            });
        });

        // Search bar
        const searchInput = document.getElementById('project-search');
        searchInput.addEventListener('input', () => this.renderProjectGrid());
        searchInput.addEventListener('keydown', (e) => e.stopPropagation());

        // Sort buttons
        document.getElementById('sort-date').addEventListener('click', () => {
            this.projectSortBy = 'date';
            document.getElementById('sort-date').classList.add('active');
            document.getElementById('sort-name').classList.remove('active');
            this.renderProjectGrid();
        });
        document.getElementById('sort-name').addEventListener('click', () => {
            this.projectSortBy = 'name';
            document.getElementById('sort-name').classList.add('active');
            document.getElementById('sort-date').classList.remove('active');
            this.renderProjectGrid();
        });

        // Logo click returns to title screen
        const logo = document.querySelector('#toolbar .logo');
        if (logo) {
            logo.style.cursor = 'pointer';
            logo.addEventListener('click', () => this.showTitleScreen());
        }
    }

    showNewProjectModal() {
        const modal = document.getElementById('new-project-modal');
        const nameInput = document.getElementById('new-project-name');
        nameInput.value = '';
        // Reset template to empty
        document.querySelectorAll('#new-project-modal .template-option').forEach(o => o.classList.remove('selected'));
        document.querySelector('#new-project-modal .template-option[data-template="empty"]').classList.add('selected');
        modal.classList.remove('hidden');
        setTimeout(() => nameInput.focus(), 50);
    }

    _confirmNewProject() {
        const modal = document.getElementById('new-project-modal');
        const nameInput = document.getElementById('new-project-name');
        const name = nameInput.value.trim() || 'My Game';
        const selectedTemplate = document.querySelector('#new-project-modal .template-option.selected');
        const templateKey = selectedTemplate ? selectedTemplate.dataset.template : 'empty';

        modal.classList.add('hidden');
        this.createNewProject(name, templateKey);
    }

    // ===== Toolbar Project Name + Unsaved Indicator =====

    updateToolbarProjectName() {
        const el = document.getElementById('toolbar-project-name');
        const textEl = document.getElementById('toolbar-project-text');
        const dot = document.getElementById('unsaved-dot');

        if (this.currentProjectId && this.projectName) {
            textEl.textContent = this.projectName;
            el.classList.remove('hidden');
            if (this.hasUnsavedChanges) {
                dot.classList.remove('hidden');
            } else {
                dot.classList.add('hidden');
            }
        } else {
            el.classList.add('hidden');
        }
    }

    // ===== Autosave Indicator =====

    updateAutosaveIndicator() {
        const el = document.getElementById('status-autosave');
        if (!el) return;
        if (!this.currentProjectId || !this.lastSaveTime) {
            el.textContent = '';
            return;
        }
        const diff = Date.now() - this.lastSaveTime;
        const seconds = Math.floor(diff / 1000);
        if (seconds < 10) {
            el.textContent = 'Saved just now';
        } else if (seconds < 60) {
            el.textContent = 'Saved ' + seconds + 's ago';
        } else {
            const minutes = Math.floor(seconds / 60);
            el.textContent = 'Saved ' + minutes + ' min ago';
        }
    }

    // ===== Custom Confirm / Prompt Modals =====

    initConfirmModal() {
        const modal = document.getElementById('confirm-modal');
        const input = document.getElementById('confirm-modal-input');

        document.getElementById('confirm-modal-close').addEventListener('click', () => {
            modal.classList.add('hidden');
            if (this._confirmReject) this._confirmReject(false);
        });

        document.getElementById('confirm-modal-cancel').addEventListener('click', () => {
            modal.classList.add('hidden');
            if (this._confirmReject) this._confirmReject(false);
        });

        document.getElementById('confirm-modal-confirm').addEventListener('click', () => {
            modal.classList.add('hidden');
            if (this._confirmResolve) {
                if (this._confirmIsPrompt) {
                    this._confirmResolve(input.value);
                } else {
                    this._confirmResolve(true);
                }
            }
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.add('hidden');
                if (this._confirmReject) this._confirmReject(false);
            }
        });

        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                document.getElementById('confirm-modal-confirm').click();
            }
            if (e.key === 'Escape') {
                modal.classList.add('hidden');
                if (this._confirmReject) this._confirmReject(false);
            }
        });
    }

    showConfirm(title, message, confirmLabel, type) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const icon = document.getElementById('confirm-modal-icon');
            const titleEl = document.getElementById('confirm-modal-title');
            const msgEl = document.getElementById('confirm-modal-message');
            const confirmBtn = document.getElementById('confirm-modal-confirm');
            const inputWrap = document.getElementById('confirm-modal-input-wrap');

            titleEl.textContent = title || 'Confirm';
            msgEl.textContent = message || '';
            confirmBtn.textContent = confirmLabel || 'OK';
            inputWrap.classList.add('hidden');
            this._confirmIsPrompt = false;

            if (type === 'danger') {
                icon.textContent = 'warning';
                icon.style.color = '#ff4444';
                confirmBtn.style.background = '#ff4444';
                confirmBtn.style.borderColor = '#ff4444';
            } else {
                icon.textContent = 'help_outline';
                icon.style.color = 'var(--accent)';
                confirmBtn.style.background = 'var(--accent)';
                confirmBtn.style.borderColor = 'var(--accent)';
            }
            confirmBtn.style.color = '#fff';

            this._confirmResolve = resolve;
            this._confirmReject = (val) => resolve(val === undefined ? false : val);
            modal.classList.remove('hidden');
        });
    }

    showPrompt(title, message, defaultValue) {
        return new Promise((resolve) => {
            const modal = document.getElementById('confirm-modal');
            const icon = document.getElementById('confirm-modal-icon');
            const titleEl = document.getElementById('confirm-modal-title');
            const msgEl = document.getElementById('confirm-modal-message');
            const confirmBtn = document.getElementById('confirm-modal-confirm');
            const inputWrap = document.getElementById('confirm-modal-input-wrap');
            const input = document.getElementById('confirm-modal-input');

            titleEl.textContent = title || 'Input';
            msgEl.textContent = message || '';
            confirmBtn.textContent = 'OK';
            confirmBtn.style.background = 'var(--accent)';
            confirmBtn.style.borderColor = 'var(--accent)';
            confirmBtn.style.color = '#fff';
            icon.textContent = 'edit';
            icon.style.color = 'var(--accent)';

            inputWrap.classList.remove('hidden');
            input.value = defaultValue || '';
            this._confirmIsPrompt = true;

            this._confirmResolve = resolve;
            this._confirmReject = () => resolve(null);
            modal.classList.remove('hidden');
            setTimeout(() => { input.focus(); input.select(); }, 50);
        });
    }

    // ===== Keyboard Shortcuts Modal =====

    initShortcutsModal() {
        const body = document.getElementById('shortcuts-body');
        const shortcuts = [
            { section: 'Tools', items: [
                ['Select', 'V'], ['Move', 'G'], ['Rotate', 'R'], ['Scale', 'S']
            ]},
            { section: 'Edit', items: [
                ['Undo', 'Ctrl+Z'], ['Redo', 'Ctrl+Shift+Z'], ['Redo', 'Ctrl+Y'],
                ['Copy', 'Ctrl+C'], ['Paste', 'Ctrl+V'], ['Duplicate', 'Ctrl+D'],
                ['Delete', 'Del / Backspace']
            ]},
            { section: 'File', items: [
                ['Save', 'Ctrl+S'], ['Play / Stop', 'F5']
            ]},
            { section: 'View', items: [
                ['Fullscreen Viewport', 'Viewport Button'], ['Deselect', 'Escape'],
                ['Shortcuts', '?']
            ]}
        ];

        body.innerHTML = '';
        shortcuts.forEach(sec => {
            const sectionEl = document.createElement('div');
            sectionEl.className = 'shortcut-section';
            const heading = document.createElement('div');
            heading.className = 'shortcut-section-title';
            heading.textContent = sec.section;
            sectionEl.appendChild(heading);

            sec.items.forEach(([label, key]) => {
                const row = document.createElement('div');
                row.className = 'shortcut-row';
                const labelEl = document.createElement('span');
                labelEl.className = 'shortcut-label';
                labelEl.textContent = label;
                const keyEl = document.createElement('span');
                keyEl.className = 'shortcut-keys';
                key.split('+').forEach((k, i) => {
                    if (i > 0) {
                        const plus = document.createTextNode(' + ');
                        keyEl.appendChild(plus);
                    }
                    const kbd = document.createElement('kbd');
                    kbd.textContent = k.trim();
                    keyEl.appendChild(kbd);
                });
                row.appendChild(labelEl);
                row.appendChild(keyEl);
                sectionEl.appendChild(row);
            });
            body.appendChild(sectionEl);
        });

        document.getElementById('shortcuts-close').addEventListener('click', () => {
            document.getElementById('shortcuts-modal').classList.add('hidden');
        });
        document.getElementById('shortcuts-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('shortcuts-modal')) {
                document.getElementById('shortcuts-modal').classList.add('hidden');
            }
        });
    }

    toggleShortcutsModal() {
        const modal = document.getElementById('shortcuts-modal');
        modal.classList.toggle('hidden');
    }

    // ===== About Modal =====

    initAboutModal() {
        document.getElementById('about-close').addEventListener('click', () => {
            document.getElementById('about-modal').classList.add('hidden');
        });
        document.getElementById('about-modal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('about-modal')) {
                document.getElementById('about-modal').classList.add('hidden');
            }
        });
    }

    showAboutModal() {
        document.getElementById('about-modal').classList.remove('hidden');
    }

    showTitleScreen() {
        // Leave collab room if in one
        if (this._collabRoom) {
            this.collabLeave();
        }
        // Auto-save current project before showing title screen
        if (this.currentProjectId) {
            this.saveProject(true);
        }
        this.currentProjectId = null;
        this.projectName = null;
        this.hasUnsavedChanges = false;
        this.updateToolbarProjectName();
        this.updateUserDisplay();

        document.getElementById('title-screen').classList.remove('hidden');
        document.getElementById('project-search').value = '';
        // Hide/disable features for guest (offline) mode
        const isGuest = this._offlineMode;
        const joinPartyBtn = document.getElementById('btn-title-join-party');
        if (joinPartyBtn) joinPartyBtn.style.display = isGuest ? 'none' : '';
        document.getElementById('btn-new-project').style.display = '';
        document.getElementById('btn-import-project').style.display = '';
        this.renderProjectGrid();
    }

    hideTitleScreen() {
        document.getElementById('title-screen').classList.add('hidden');
        this._updateGuestRestrictions();
        setTimeout(() => this.scene3d.onResize(), 50);
    }

    createNewProject(name, templateKey) {
        const id = this.generateProjectId();
        this.currentProjectId = id;
        this.projectName = name;

        // Reset editor state
        this.scene3d.deserialize([]);
        this.blockCode.customVariables = [];
        this.blockCode.customMessages = [];
        this.blockCode._updateVariableDropdowns();
        this.blockCode._updateMessageDropdowns();
        this.customObjects = [];
        this.renderCustomObjectButtons();
        this.uiScreens = [];
        this.renderScreenButtons();
        this.blockCode._updateScreenDropdowns(this.uiScreens);
        this.undoStack = [];
        this.redoStack = [];

        // Reset environment to defaults
        document.getElementById('sky-color').value = '#87CEEB';
        document.getElementById('skybox-type').value = 'default';
        document.getElementById('ambient-light').value = '60';
        document.getElementById('fog-density').value = '0';
        document.getElementById('shadows-enabled').checked = true;
        document.getElementById('weather-type').value = 'none';
        document.getElementById('bg-music').value = 'none';
        document.getElementById('music-volume').value = '30';
        this.scene3d.setSkyColor('#87CEEB');
        this.scene3d.setSkybox('default');
        this.scene3d.setAmbientIntensity(0.6);
        this.scene3d.setFog(0);
        this.scene3d.setShadows(true);
        this.scene3d.setWeather('none');
        this.gameSettings.bgMusic = 'none';
        this.gameSettings.musicVolume = 30;

        // Apply template if selected
        if (templateKey && templateKey !== 'empty' && this.templates && this.templates[templateKey]) {
            const tmpl = this.templates[templateKey];
            tmpl.scene.forEach(objData => {
                const obj = this.scene3d.addObject(objData.type, {
                    position: objData.position,
                    color: objData.color
                });
                if (obj) {
                    obj.userData.name = objData.name;
                    if (objData.rotation) obj.rotation.set(
                        THREE.MathUtils.degToRad(objData.rotation.x),
                        THREE.MathUtils.degToRad(objData.rotation.y),
                        THREE.MathUtils.degToRad(objData.rotation.z)
                    );
                    if (objData.scale) obj.scale.set(objData.scale.x, objData.scale.y, objData.scale.z);
                    if (objData.anchored !== undefined) obj.userData.anchored = objData.anchored;
                    if (objData.collidable !== undefined) obj.userData.collidable = objData.collidable;
                    if (objData.scripts) obj.userData.scripts = objData.scripts;
                }
            });
            if (tmpl.environment) {
                if (tmpl.environment.skybox) {
                    this.scene3d.setSkybox(tmpl.environment.skybox);
                    document.getElementById('skybox-type').value = tmpl.environment.skybox;
                }
            }
        }

        this.refreshExplorer();
        this.updateObjectCount();

        // Save project
        this.hasUnsavedChanges = false;
        this.saveProject(true);
        this.updateToolbarProjectName();
        this.hideTitleScreen();
        this.toast('New project created: ' + name);
    }

    loadProjectById(id) {
        const data = this.getProjectData(id);
        if (!data) {
            this.toast('Failed to load project', 'error');
            return;
        }

        // Show loading spinner
        const loadingOverlay = document.getElementById('loading-overlay');
        loadingOverlay.classList.remove('hidden');

        const index = this.getProjectIndex();
        this.currentProjectId = id;
        this.projectName = (index[id] && index[id].name) || data.name || 'My Game';

        this.undoStack = [];
        this.redoStack = [];
        this.hasUnsavedChanges = false;
        this.lastSaveTime = index[id] ? index[id].modifiedAt : Date.now();

        // Use rAF + setTimeout to let the loading overlay paint
        requestAnimationFrame(() => {
            setTimeout(() => {
                this._applyProjectData(data);
                this.hideTitleScreen();
                this.updateToolbarProjectName();
                this.updateAutosaveIndicator();
                loadingOverlay.classList.add('hidden');
                this.toast('Opened: ' + this.projectName);
            }, 50);
        });
    }

    duplicateProject(id) {
        const data = this.getProjectData(id);
        if (!data) return;
        const index = this.getProjectIndex();
        const origMeta = index[id] || {};
        const newId = this.generateProjectId();
        const now = Date.now();
        const newName = (origMeta.name || 'Untitled') + ' (Copy)';
        data.name = newName;
        this.saveProjectData(newId, data);
        index[newId] = {
            name: newName,
            createdAt: now,
            modifiedAt: now,
            thumbnail: origMeta.thumbnail || null
        };
        this.saveProjectIndex(index);
        this.renderProjectGrid();
        this.toast('Duplicated: ' + newName, 'success');
    }

    async renameProject(id) {
        const index = this.getProjectIndex();
        const meta = index[id];
        if (!meta) return;
        const newName = await this.showPrompt('Rename Project', 'Enter a new name:', meta.name || 'Untitled');
        if (!newName || newName === meta.name) return;
        meta.name = newName;
        this.saveProjectIndex(index);
        // Also update project data name
        const data = this.getProjectData(id);
        if (data) {
            data.name = newName;
            this.saveProjectData(id, data);
        }
        if (this.currentProjectId === id) {
            this.projectName = newName;
            this.updateToolbarProjectName();
        }
        this.renderProjectGrid();
    }

    renderProjectGrid() {
        const grid = document.getElementById('project-grid');
        const empty = document.getElementById('title-empty');
        const countEl = document.getElementById('project-count');
        const index = this.getProjectIndex();

        // Filter by search query
        const query = (document.getElementById('project-search').value || '').trim().toLowerCase();
        let entries = Object.entries(index);
        if (query) {
            entries = entries.filter(([, meta]) => (meta.name || '').toLowerCase().includes(query));
        }

        // Sort: favorites pinned first, then by sort mode
        entries.sort((a, b) => {
            const aFav = a[1].favorite ? 1 : 0;
            const bFav = b[1].favorite ? 1 : 0;
            if (aFav !== bFav) return bFav - aFav;
            if (this.projectSortBy === 'name') {
                return (a[1].name || '').localeCompare(b[1].name || '');
            }
            return (b[1].modifiedAt || 0) - (a[1].modifiedAt || 0);
        });

        countEl.textContent = Object.keys(index).length;
        grid.innerHTML = '';

        if (entries.length === 0) {
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';

        entries.forEach(([id, meta]) => {
            const card = document.createElement('div');
            card.className = 'project-card';

            const thumb = document.createElement('div');
            thumb.className = 'project-card-thumb';
            if (meta.thumbnail) {
                const img = document.createElement('img');
                img.src = meta.thumbnail;
                img.alt = meta.name;
                thumb.appendChild(img);
            } else {
                const icon = document.createElement('span');
                icon.className = 'material-icons-round thumb-placeholder';
                icon.textContent = 'view_in_ar';
                thumb.appendChild(icon);
            }

            // Favorite star badge (top-left of thumb)
            const starBtn = document.createElement('button');
            starBtn.className = 'project-card-star' + (meta.favorite ? ' active' : '');
            starBtn.innerHTML = '<span class="material-icons-round">' + (meta.favorite ? 'star' : 'star_border') + '</span>';
            starBtn.title = meta.favorite ? 'Remove from favorites' : 'Add to favorites';
            starBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleFavorite(id);
            });
            thumb.appendChild(starBtn);

            // Shared badge
            if (meta.shared) {
                const sharedBadge = document.createElement('span');
                sharedBadge.className = 'project-card-shared-badge';
                sharedBadge.textContent = 'Shared';
                thumb.appendChild(sharedBadge);
            }

            const info = document.createElement('div');
            info.className = 'project-card-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'project-name';
            nameEl.textContent = meta.name || 'Untitled';
            const dateEl = document.createElement('div');
            dateEl.className = 'project-date';
            const timeStr = this._formatRelativeTime(meta.modifiedAt);
            const sizeStr = this._getProjectSize(id);
            dateEl.textContent = timeStr + (sizeStr ? ' · ' + sizeStr : '');
            info.appendChild(nameEl);
            info.appendChild(dateEl);

            // Card action buttons (top-right, shown on hover)
            const actions = document.createElement('div');
            actions.className = 'project-card-actions';

            const exportBtn = document.createElement('button');
            exportBtn.className = 'project-card-action-btn';
            exportBtn.innerHTML = '<span class="material-icons-round">download</span>';
            exportBtn.title = 'Export';
            exportBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportProjectById(id);
            });

            const dupBtn = document.createElement('button');
            dupBtn.className = 'project-card-action-btn';
            dupBtn.innerHTML = '<span class="material-icons-round">content_copy</span>';
            dupBtn.title = 'Duplicate';
            dupBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.duplicateProject(id);
            });

            const renameBtn = document.createElement('button');
            renameBtn.className = 'project-card-action-btn';
            renameBtn.innerHTML = '<span class="material-icons-round">edit</span>';
            renameBtn.title = 'Rename';
            renameBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.renameProject(id);
            });

            const delBtn = document.createElement('button');
            delBtn.className = 'project-card-action-btn project-card-action-delete';
            delBtn.innerHTML = '<span class="material-icons-round">delete_outline</span>';
            delBtn.title = 'Delete';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showConfirm(
                    'Delete Project',
                    'Delete "' + (meta.name || 'Untitled') + '"? This cannot be undone.',
                    'Delete',
                    'danger'
                ).then(confirmed => {
                    if (confirmed) {
                        this.deleteProjectData(id);
                        this.renderProjectGrid();
                    }
                });
            });

            actions.appendChild(exportBtn);
            actions.appendChild(dupBtn);
            actions.appendChild(renameBtn);
            actions.appendChild(delBtn);

            card.appendChild(thumb);
            card.appendChild(info);
            card.appendChild(actions);
            card.addEventListener('click', () => this.loadProjectById(id));
            grid.appendChild(card);
        });
    }

    _formatRelativeTime(timestamp) {
        if (!timestamp) return '';
        const diff = Date.now() - timestamp;
        const seconds = Math.floor(diff / 1000);
        if (seconds < 60) return 'Just now';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return minutes + ' min ago';
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return hours + ' hour' + (hours > 1 ? 's' : '') + ' ago';
        const days = Math.floor(hours / 24);
        if (days < 30) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
        const months = Math.floor(days / 30);
        return months + ' month' + (months > 1 ? 's' : '') + ' ago';
    }

    toggleFavorite(id) {
        const index = this.getProjectIndex();
        const meta = index[id];
        if (!meta) return;
        meta.favorite = !meta.favorite;
        this.saveProjectIndex(index);
        this.renderProjectGrid();
    }

    exportProjectById(id) {
        const data = this.getProjectData(id);
        if (!data) return;
        const index = this.getProjectIndex();
        const meta = index[id] || {};
        const filename = (meta.name || 'cobalt-game').replace(/[^a-z0-9_-]/gi, '_') + '.json';
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.toast('Exported: ' + (meta.name || 'project'), 'success');
    }

    _getProjectSize(id) {
        try {
            const prefix = this._storagePrefix();
            const raw = localStorage.getItem(prefix + 'project_' + id) || localStorage.getItem('blockforge_project_' + id);
            if (!raw) return '';
            const bytes = new Blob([raw]).size;
            if (bytes < 1024) return bytes + ' B';
            if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
            return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
        } catch (e) {
            return '';
        }
    }

    importProjectFromFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    const id = this.generateProjectId();
                    const now = Date.now();
                    this.saveProjectData(id, data);
                    const index = this.getProjectIndex();
                    index[id] = {
                        name: data.name || file.name.replace('.json', ''),
                        createdAt: now,
                        modifiedAt: now,
                        thumbnail: null
                    };
                    this.saveProjectIndex(index);
                    this.renderProjectGrid();
                    this.toast('Project imported!', 'success');
                } catch (err) {
                    this.toast('Failed to import: invalid JSON', 'error');
                }
            };
            reader.readAsText(file);
        });
        input.click();
    }

    // ===== Templates =====

    initTemplates() {
        this.templates = {
            'flat-arena': {
                name: 'Flat Arena',
                desc: 'Battle arena with walls',
                icon: 'sports_mma',
                color: '#e74c3c',
                scene: [
                    { type: 'box', name: 'Arena Floor', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 30, y: 0.5, z: 30 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'North Wall', position: { x: 0, y: 1, z: -15 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 7.5, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'South Wall', position: { x: 0, y: 1, z: 15 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 7.5, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'East Wall', position: { x: 15, y: 1, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 7.5, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'West Wall', position: { x: -15, y: 1, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 7.5, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover1', position: { x: -5, y: 0.4, z: -5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#d4a24e', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover2', position: { x: 5, y: 0.4, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#d4a24e', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover3', position: { x: 5, y: 0.4, z: -5 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#d4a24e', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover4', position: { x: -5, y: 0.4, z: 5 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#d4a24e', anchored: true, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'platformer': {
                name: 'Platformer',
                desc: 'Floating platforms to jump across',
                icon: 'layers',
                color: '#1abc9c',
                scene: [
                    { type: 'platform', name: 'Start Platform', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1, z: 1.5 }, color: '#1abc9c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Platform 2', position: { x: 4, y: 1.5, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#1abc9c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Platform 3', position: { x: 8, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#1abc9c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Platform 4', position: { x: 5, y: 4.5, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 1, z: 0.8 }, color: '#16a085', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Platform 5', position: { x: 9, y: 6, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 1, z: 0.8 }, color: '#16a085', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Platform 6', position: { x: 13, y: 7.5, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#1abc9c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'platform', name: 'Goal Platform', position: { x: 16, y: 9, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1, z: 1.5 }, color: '#f1c40f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Goal Gem', position: { x: 16, y: 10, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#e74c3c', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 1', position: { x: 4, y: 2.5, z: -2 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 2', position: { x: 8, y: 4, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'obstacle-course': {
                name: 'Obstacle Course',
                desc: 'Navigate walls, ramps & gaps',
                icon: 'fitness_center',
                color: '#e67e22',
                scene: [
                    { type: 'box', name: 'Start Area', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 6, y: 0.5, z: 6 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 1', position: { x: 0, y: -0.25, z: -6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.5, z: 6 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Obstacle Wall 1', position: { x: 0, y: 1, z: -7 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.3, y: 0.7, z: 1 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 2', position: { x: 0, y: -0.25, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.5, z: 4 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wedge', name: 'Ramp 1', position: { x: 0, y: 0.5, z: -15 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#e67e22', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'High Path', position: { x: 0, y: 2, z: -19 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.5, z: 6 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Narrow Bridge', position: { x: 4, y: 2, z: -22 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 6, y: 0.5, z: 0.8 }, color: '#8B6914', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Finish Area', position: { x: 8, y: 2, z: -22 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.5, z: 4 }, color: '#f1c40f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Finish Gem', position: { x: 8, y: 3.5, z: -22 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#e74c3c', anchored: false, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'village': {
                name: 'Village',
                desc: 'Houses, trees & paths',
                icon: 'holiday_village',
                color: '#27ae60',
                scene: [
                    { type: 'box', name: 'Ground', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 30, y: 0.5, z: 30 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Main Path', position: { x: 0, y: 0.02, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 3, y: 0.05, z: 20 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Cross Path', position: { x: 0, y: 0.02, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 16, y: 0.05, z: 3 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'house', name: 'House 1', position: { x: -5, y: 0, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#e67e22', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'house', name: 'House 2', position: { x: 5, y: 0, z: -3 }, rotation: { x: 0, y: 180, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#3498db', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'house', name: 'House 3', position: { x: -5, y: 0, z: 4 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 }, color: '#e67e22', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Tree 1', position: { x: -8, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Tree 2', position: { x: 8, y: 0, z: 2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Tree 3', position: { x: -3, y: 0, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Tree 4', position: { x: 7, y: 0, z: -7 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'npc', name: 'Villager', position: { x: 3, y: 0, z: 0 }, rotation: { x: 0, y: -90, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#3498db', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Lamp 1', position: { x: -2, y: 2.5, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Lamp 2', position: { x: 2, y: 2.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: true, collidable: false, mass: 1, scripts: [] }
                ]
            },
            'space-station': {
                name: 'Space Station',
                desc: 'Metallic platforms in the void',
                icon: 'rocket_launch',
                color: '#3498db',
                scene: [
                    { type: 'box', name: 'Main Deck', position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 12, y: 0.3, z: 12 }, color: '#5a6a7a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.3, metalness: 0.8, opacity: 1 }, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Side Deck A', position: { x: -9, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 6, y: 0.3, z: 6 }, color: '#4a5a6a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.3, metalness: 0.8, opacity: 1 }, scripts: [] },
                    { type: 'box', name: 'Side Deck B', position: { x: 9, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 6, y: 0.3, z: 6 }, color: '#4a5a6a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.3, metalness: 0.8, opacity: 1 }, scripts: [] },
                    { type: 'box', name: 'Bridge A', position: { x: -5, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.2, z: 1.5 }, color: '#6a7a8a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.3, metalness: 0.8, opacity: 1 }, scripts: [] },
                    { type: 'box', name: 'Bridge B', position: { x: 5, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.2, z: 1.5 }, color: '#6a7a8a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.3, metalness: 0.8, opacity: 1 }, scripts: [] },
                    { type: 'cylinder', name: 'Tower A', position: { x: -9, y: 3.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 3, z: 0.8 }, color: '#7a8a9a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.2, metalness: 0.9, opacity: 1 }, scripts: [] },
                    { type: 'cylinder', name: 'Tower B', position: { x: 9, y: 3.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 3, z: 0.8 }, color: '#7a8a9a', anchored: true, collidable: true, mass: 1, material: { roughness: 0.2, metalness: 0.9, opacity: 1 }, scripts: [] },
                    { type: 'sphere', name: 'Reactor Core', position: { x: 0, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#00ccff', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Core Light', position: { x: 0, y: 3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#00ccff', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Deck Light A', position: { x: -9, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6600', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Deck Light B', position: { x: 9, y: 4, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6600', anchored: true, collidable: false, mass: 1, scripts: [] }
                ],
                environment: { skybox: 'night' }
            },
            'coin-collector': {
                name: 'Coin Collector',
                desc: 'Open arena with coins & gems',
                icon: 'monetization_on',
                color: '#f1c40f',
                scene: [
                    { type: 'box', name: 'Arena Floor', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 24, y: 0.5, z: 24 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 1', position: { x: 3, y: 0.5, z: 3 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 2', position: { x: -3, y: 0.5, z: 3 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 3', position: { x: 3, y: 0.5, z: -3 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 4', position: { x: -3, y: 0.5, z: -3 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 5', position: { x: 7, y: 0.5, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 6', position: { x: -7, y: 0.5, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 7', position: { x: 0, y: 0.5, z: 7 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 8', position: { x: 0, y: 0.5, z: -7 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Gem 1', position: { x: 8, y: 0.8, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#e74c3c', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Gem 2', position: { x: -8, y: 0.8, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#9b59b6', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Gem 3', position: { x: -8, y: 0.8, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#3498db', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Gem 4', position: { x: 8, y: 0.8, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Pedestal 1', position: { x: 8, y: 0.25, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 0.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Pedestal 2', position: { x: -8, y: 0.25, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 0.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Pedestal 3', position: { x: -8, y: 0.25, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 0.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Pedestal 4', position: { x: 8, y: 0.25, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 0.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'fps-shooter': {
                name: 'FPS Shooter',
                desc: 'Corridor arena with cover & enemies',
                icon: 'gps_fixed',
                color: '#c0392b',
                scene: [
                    { type: 'box', name: 'Floor', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 40, y: 0.5, z: 40 }, color: '#5a5a5a', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 15 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Perimeter walls
                    { type: 'wall', name: 'Wall N', position: { x: 0, y: 1.5, z: -20 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 10, y: 1.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Wall S', position: { x: 0, y: 1.5, z: 20 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 10, y: 1.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Wall E', position: { x: 20, y: 1.5, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 10, y: 1.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Wall W', position: { x: -20, y: 1.5, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 10, y: 1.5, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Cover
                    { type: 'crate', name: 'Cover A', position: { x: -6, y: 0.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#6d4c2a', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover B', position: { x: 6, y: 0.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#6d4c2a', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Mid Wall L', position: { x: -4, y: 1, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Mid Wall R', position: { x: 4, y: 1, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1, z: 1 }, color: '#95a5a6', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Cover C', position: { x: 0, y: 0.5, z: -8 }, rotation: { x: 0, y: 45, z: 0 }, scale: { x: 2.5, y: 2.5, z: 2.5 }, color: '#6d4c2a', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Sniper Wall', position: { x: 0, y: 1, z: -14 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 1, z: 1 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Enemies
                    { type: 'npc', name: 'Enemy 1', position: { x: -8, y: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#c0392b', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'npc', name: 'Enemy 2', position: { x: 8, y: 0, z: -10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#c0392b', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'npc', name: 'Enemy 3', position: { x: 0, y: 0, z: -16 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.2, y: 1.2, z: 1.2 }, color: '#922b21', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Pickups
                    { type: 'gem', name: 'Health Pack', position: { x: -10, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Ammo Pack', position: { x: 10, y: 0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#3498db', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Lighting
                    { type: 'light-point', name: 'Light 1', position: { x: -8, y: 4, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6633', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Light 2', position: { x: 8, y: 4, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6633', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Light 3', position: { x: 0, y: 4, z: 8 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ffcc00', anchored: true, collidable: false, mass: 1, scripts: [] }
                ]
            },
            'dungeon': {
                name: 'Dungeon',
                desc: 'Dark rooms with corridors & traps',
                icon: 'castle',
                color: '#6c3483',
                scene: [
                    // Main room
                    { type: 'box', name: 'Room 1 Floor', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 10, y: 0.5, z: 10 }, color: '#3d3d3d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R1 Wall N', position: { x: 0, y: 1.5, z: -5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R1 Wall S', position: { x: 0, y: 1.5, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2.5, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R1 Wall W', position: { x: -5, y: 1.5, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2.5, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Corridor to room 2
                    { type: 'box', name: 'Corridor Floor', position: { x: 7, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.5, z: 3 }, color: '#2d2d2d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Corr Wall N', position: { x: 7, y: 1.5, z: -1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Corr Wall S', position: { x: 7, y: 1.5, z: 1.5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Room 2
                    { type: 'box', name: 'Room 2 Floor', position: { x: 14, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 8, y: 0.5, z: 8 }, color: '#3d3d3d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R2 Wall N', position: { x: 14, y: 1.5, z: -4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R2 Wall E', position: { x: 18, y: 1.5, z: 0 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 2, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'R2 Wall S', position: { x: 14, y: 1.5, z: 4 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 1.5, z: 1 }, color: '#5d4e37', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Enemies & loot
                    { type: 'npc', name: 'Skeleton', position: { x: 14, y: 0, z: 0 }, rotation: { x: 0, y: -90, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#bdc3c7', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Treasure', position: { x: 16, y: 0.8, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Barrel 1', position: { x: -3, y: 0.4, z: -3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#7d5a3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'crate', name: 'Barrel 2', position: { x: -3, y: 0.4, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#7d5a3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Torches
                    { type: 'light-point', name: 'Torch 1', position: { x: -4, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6600', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Torch 2', position: { x: 7, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff6600', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'light-point', name: 'Torch 3', position: { x: 14, y: 2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#ff4400', anchored: true, collidable: false, mass: 1, scripts: [] }
                ],
                environment: { skybox: 'night' }
            },
            'race-track': {
                name: 'Race Track',
                desc: 'Oval track with checkpoints',
                icon: 'directions_car',
                color: '#2980b9',
                scene: [
                    // Track surface (oval made of rectangles)
                    { type: 'box', name: 'Track Straight N', position: { x: 0, y: -0.1, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 20, y: 0.2, z: 4 }, color: '#444444', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Track Straight S', position: { x: 0, y: -0.1, z: 12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 20, y: 0.2, z: 4 }, color: '#444444', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Track Curve E', position: { x: 12, y: -0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.2, z: 28 }, color: '#444444', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Track Curve W', position: { x: -12, y: -0.1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.2, z: 28 }, color: '#444444', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Infield', position: { x: 0, y: -0.2, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 16, y: 0.1, z: 20 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'Start', position: { x: 0, y: 0.5, z: 12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Barriers
                    { type: 'wall', name: 'Barrier Inner N', position: { x: 0, y: 0.3, z: -10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 5, y: 0.3, z: 1 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Barrier Inner S', position: { x: 0, y: 0.3, z: 10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 5, y: 0.3, z: 1 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Barrier Outer N', position: { x: 0, y: 0.3, z: -14 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 5, y: 0.3, z: 1 }, color: '#ffffff', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'wall', name: 'Barrier Outer S', position: { x: 0, y: 0.3, z: 14 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 5, y: 0.3, z: 1 }, color: '#ffffff', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Start/finish line
                    { type: 'box', name: 'Start Line', position: { x: 0, y: 0.01, z: 12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.02, z: 0.3 }, color: '#ffffff', anchored: true, collidable: false, mass: 1, scripts: [] },
                    // Checkpoints
                    { type: 'box', name: 'Checkpoint 1', position: { x: 12, y: 0.01, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.3, y: 0.02, z: 4 }, color: '#f1c40f', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'box', name: 'Checkpoint 2', position: { x: 0, y: 0.01, z: -12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 4, y: 0.02, z: 0.3 }, color: '#f1c40f', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'box', name: 'Checkpoint 3', position: { x: -12, y: 0.01, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.3, y: 0.02, z: 4 }, color: '#f1c40f', anchored: true, collidable: false, mass: 1, scripts: [] },
                    // Coins on track
                    { type: 'coin', name: 'Coin 1', position: { x: 6, y: 0.4, z: -12 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 2', position: { x: -6, y: 0.4, z: -12 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 3', position: { x: 12, y: 0.4, z: 6 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 4', position: { x: -12, y: 0.4, z: -6 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'tower-defense': {
                name: 'Tower Defense',
                desc: 'Winding path with tower spots',
                icon: 'security',
                color: '#8e44ad',
                scene: [
                    { type: 'box', name: 'Ground', position: { x: 0, y: -0.25, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 30, y: 0.5, z: 30 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: -12, y: 0.5, z: 12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Path (sand-colored)
                    { type: 'box', name: 'Path 1', position: { x: -12, y: 0.02, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.05, z: 14 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 2', position: { x: -6, y: 0.02, z: -1 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 14, y: 0.05, z: 2 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 3', position: { x: 0, y: 0.02, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.05, z: 14 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 4', position: { x: 6, y: 0.02, z: 12 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 14, y: 0.05, z: 2 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Path 5', position: { x: 12, y: 0.02, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.05, z: 20 }, color: '#C2B280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Tower pedestals
                    { type: 'cylinder', name: 'Tower Spot 1', position: { x: -6, y: 0.3, z: 5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.6, z: 2 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'cylinder', name: 'Tower Spot 2', position: { x: -6, y: 0.3, z: -7 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.6, z: 2 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'cylinder', name: 'Tower Spot 3', position: { x: 6, y: 0.3, z: 6 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.6, z: 2 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'cylinder', name: 'Tower Spot 4', position: { x: 6, y: 0.3, z: -5 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 0.6, z: 2 }, color: '#7f8c8d', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // End point
                    { type: 'gem', name: 'Base', position: { x: 12, y: 0.8, z: -7 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 2, y: 2, z: 2 }, color: '#e74c3c', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Enemies on path
                    { type: 'npc', name: 'Creep 1', position: { x: -12, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'npc', name: 'Creep 2', position: { x: 0, y: 0, z: -1 }, rotation: { x: 0, y: 90, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'npc', name: 'Creep 3', position: { x: 0, y: 0, z: 10 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 }, color: '#e74c3c', anchored: true, collidable: true, mass: 1, scripts: [] }
                ]
            },
            'island': {
                name: 'Island',
                desc: 'Tropical island with water',
                icon: 'sailing',
                color: '#16a085',
                scene: [
                    // Water
                    { type: 'box', name: 'Water', position: { x: 0, y: -0.5, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 50, y: 0.1, z: 50 }, color: '#2980b9', anchored: true, collidable: false, mass: 1, material: { roughness: 0.1, metalness: 0.3, opacity: 0.7 }, scripts: [] },
                    // Island
                    { type: 'cylinder', name: 'Island Base', position: { x: 0, y: -0.3, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 16, y: 0.6, z: 16 }, color: '#c2b280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Beach', position: { x: 0, y: 0.01, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 14, y: 0.02, z: 14 }, color: '#f0d9a0', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'box', name: 'Grass', position: { x: 0, y: 0.03, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 10, y: 0.02, z: 10 }, color: '#4a7c3f', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'spawn', name: 'SpawnPoint', position: { x: 0, y: 0.5, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#2ecc71', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Trees
                    { type: 'tree', name: 'Palm 1', position: { x: -3, y: 0, z: -2 }, rotation: { x: 0, y: 30, z: 0 }, scale: { x: 1.2, y: 1.5, z: 1.2 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Palm 2', position: { x: 3, y: 0, z: -3 }, rotation: { x: 0, y: 120, z: 0 }, scale: { x: 1, y: 1.3, z: 1 }, color: '#27ae60', anchored: true, collidable: false, mass: 1, scripts: [] },
                    { type: 'tree', name: 'Palm 3', position: { x: -2, y: 0, z: 3 }, rotation: { x: 0, y: 200, z: 0 }, scale: { x: 0.8, y: 1.1, z: 0.8 }, color: '#2ecc71', anchored: true, collidable: false, mass: 1, scripts: [] },
                    // Hut
                    { type: 'house', name: 'Beach Hut', position: { x: 3, y: 0, z: 2 }, rotation: { x: 0, y: -45, z: 0 }, scale: { x: 0.8, y: 0.8, z: 0.8 }, color: '#c2b280', anchored: true, collidable: true, mass: 1, scripts: [] },
                    // Treasure
                    { type: 'crate', name: 'Chest', position: { x: -4, y: 0.3, z: 0 }, rotation: { x: 0, y: 15, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#8B6914', anchored: true, collidable: true, mass: 1, scripts: [] },
                    { type: 'gem', name: 'Treasure', position: { x: -4, y: 1, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1.5, y: 1.5, z: 1.5 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // Coins scattered
                    { type: 'coin', name: 'Coin 1', position: { x: 1, y: 0.4, z: -4 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 2', position: { x: -3, y: 0.4, z: 4 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    { type: 'coin', name: 'Coin 3', position: { x: 5, y: 0.4, z: 0 }, rotation: { x: 90, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#f1c40f', anchored: false, collidable: true, mass: 1, scripts: [] },
                    // NPC
                    { type: 'npc', name: 'Castaway', position: { x: 2, y: 0, z: 1 }, rotation: { x: 0, y: -90, z: 0 }, scale: { x: 1, y: 1, z: 1 }, color: '#e67e22', anchored: true, collidable: true, mass: 1, scripts: [] }
                ]
            }
        };

        const modal = document.getElementById('templates-modal');
        const grid = document.getElementById('template-grid');
        const closeBtn = document.getElementById('templates-close');

        // Populate template cards
        Object.entries(this.templates).forEach(([key, tmpl]) => {
            const card = document.createElement('div');
            card.className = 'template-card';
            card.dataset.template = key;
            card.innerHTML = `
                <div class="template-card-icon" style="background:${tmpl.color}">
                    <span class="material-icons-round">${tmpl.icon}</span>
                </div>
                <div class="template-card-info">
                    <div class="template-card-title">${tmpl.name}</div>
                    <div class="template-card-desc">${tmpl.desc}</div>
                </div>
            `;
            card.addEventListener('click', () => {
                this.loadTemplate(key);
                modal.classList.add('hidden');
            });
            grid.appendChild(card);
        });

        // Open/close
        document.getElementById('btn-templates').addEventListener('click', () => {
            modal.classList.remove('hidden');
        });
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });
    }

    async loadTemplate(key) {
        const tmpl = this.templates[key];
        if (!tmpl) return;

        // Confirm if scene has objects
        if (this.scene3d.objects.length > 0) {
            const confirmed = await this.showConfirm('Load Template', 'This will replace your current scene. Continue?', 'Load');
            if (!confirmed) return;
        }

        // Load template scene data
        this.scene3d.deserialize(tmpl.scene);

        // Apply environment settings if specified
        if (tmpl.environment) {
            if (tmpl.environment.skybox) {
                this.scene3d.setSkybox(tmpl.environment.skybox);
                document.getElementById('skybox-type').value = tmpl.environment.skybox;
            }
        }

        // Reset undo stack
        this.undoStack = [];
        this.redoStack = [];

        // Refresh explorer and deselect
        this.scene3d.deselect();
        this.refreshExplorer();
        this.updateObjectCount();
        this.toast(`Loaded "${tmpl.name}" template`, 'success');
    }

    // ===== Settings =====

    initSettings() {
        // Available keys for binding
        this.bindableKeys = [
            { code: 'KeyW', label: 'W' },
            { code: 'KeyA', label: 'A' },
            { code: 'KeyS', label: 'S' },
            { code: 'KeyD', label: 'D' },
            { code: 'KeyQ', label: 'Q' },
            { code: 'KeyE', label: 'E' },
            { code: 'KeyR', label: 'R' },
            { code: 'KeyF', label: 'F' },
            { code: 'KeyI', label: 'I' },
            { code: 'KeyJ', label: 'J' },
            { code: 'KeyK', label: 'K' },
            { code: 'KeyL', label: 'L' },
            { code: 'ArrowUp', label: 'Arrow Up' },
            { code: 'ArrowDown', label: 'Arrow Down' },
            { code: 'ArrowLeft', label: 'Arrow Left' },
            { code: 'ArrowRight', label: 'Arrow Right' },
            { code: 'Space', label: 'Space' },
            { code: 'ShiftLeft', label: 'Left Shift' },
            { code: 'ControlLeft', label: 'Left Ctrl' },
            { code: 'Numpad8', label: 'Numpad 8' },
            { code: 'Numpad2', label: 'Numpad 2' },
            { code: 'Numpad4', label: 'Numpad 4' },
            { code: 'Numpad6', label: 'Numpad 6' },
            { code: 'Numpad0', label: 'Numpad 0' }
        ];

        // Default key bindings
        const defaultBindings = {
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

        this.gameSettings = {
            controlScheme: 'first-person',
            speed: 6,
            jumpForce: 8,
            sensitivity: 5,
            mouseOrbit: false,
            keyBindings: { ...defaultBindings },
            playerColors: { body: '#4c97ff', head: '#f5cba7', detail: '#e0b090' },
            graphicsQuality: 'high'
        };

        this.customObjects = [];
        this.uiScreens = [];

        // Populate key binding selects
        document.querySelectorAll('.key-bind-select').forEach(select => {
            const action = select.dataset.action;
            this.bindableKeys.forEach(key => {
                const opt = document.createElement('option');
                opt.value = key.code;
                opt.textContent = key.label;
                select.appendChild(opt);
            });
            select.value = defaultBindings[action] || '';
            select.addEventListener('change', () => {
                this.gameSettings.keyBindings[action] = select.value;
            });
        });

        const modal = document.getElementById('settings-modal');
        document.getElementById('btn-settings').addEventListener('click', () => {
            modal.classList.remove('hidden');
        });
        document.getElementById('settings-close').addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        // Control scheme selection
        document.querySelectorAll('.control-scheme').forEach(label => {
            label.addEventListener('click', () => {
                document.querySelectorAll('.control-scheme').forEach(l => l.classList.remove('selected'));
                label.classList.add('selected');
                this.gameSettings.controlScheme = label.dataset.scheme;
            });
        });

        // Sliders
        const speedSlider = document.getElementById('setting-speed');
        const jumpSlider = document.getElementById('setting-jump');
        const sensSlider = document.getElementById('setting-sensitivity');

        speedSlider.addEventListener('input', (e) => {
            this.gameSettings.speed = parseInt(e.target.value);
            document.getElementById('setting-speed-val').textContent = e.target.value;
        });
        jumpSlider.addEventListener('input', (e) => {
            this.gameSettings.jumpForce = parseInt(e.target.value);
            document.getElementById('setting-jump-val').textContent = e.target.value;
        });
        sensSlider.addEventListener('input', (e) => {
            this.gameSettings.sensitivity = parseInt(e.target.value);
            document.getElementById('setting-sensitivity-val').textContent = e.target.value;
        });

        // Mouse orbit toggle — orbit ON = marquee OFF, orbit OFF = marquee ON
        const mouseOrbitCheckbox = document.getElementById('setting-mouse-orbit');
        mouseOrbitCheckbox.checked = this.gameSettings.mouseOrbit;
        // Apply initial state
        this.scene3d.marqueeEnabled = !this.gameSettings.mouseOrbit;
        mouseOrbitCheckbox.addEventListener('change', (e) => {
            this.gameSettings.mouseOrbit = e.target.checked;
            this.scene3d.orbitControls.enableRotate = e.target.checked;
            this.scene3d.orbitControls.enabled = true;
            this.scene3d.marqueeEnabled = !e.target.checked;
            this.toast(e.target.checked ? 'Mouse orbit enabled' : 'Drag-to-select enabled', 'success');
        });

        // Graphics quality
        const qualityDescriptions = {
            ultra: 'Maximum quality — best visuals, most demanding',
            high: 'Balanced quality and performance',
            medium: 'Reduced quality for smoother gameplay',
            low: 'Minimum quality — best performance'
        };
        const graphicsSelect = document.getElementById('setting-graphics-quality');
        const graphicsDesc = document.getElementById('graphics-quality-desc');
        const savedQuality = localStorage.getItem('blockforge_graphics_quality') || 'high';
        graphicsSelect.value = savedQuality;
        graphicsDesc.textContent = qualityDescriptions[savedQuality];
        this.gameSettings.graphicsQuality = savedQuality;
        this.scene3d.setGraphicsQuality(savedQuality);
        graphicsSelect.addEventListener('change', (e) => {
            const level = e.target.value;
            this.gameSettings.graphicsQuality = level;
            this.scene3d.setGraphicsQuality(level);
            graphicsDesc.textContent = qualityDescriptions[level];
            localStorage.setItem('blockforge_graphics_quality', level);
            this.toast('Graphics set to ' + level.charAt(0).toUpperCase() + level.slice(1), 'success');
        });

        // Character appearance color pickers
        ['body', 'head', 'detail'].forEach(part => {
            const input = document.getElementById(`setting-player-${part}`);
            input.addEventListener('input', (e) => {
                this.gameSettings.playerColors[part] = e.target.value;
            });
        });
    }

    saveProject(silent) {
        if (!this.currentProjectId) return;
        if (this._collabGuest()) {
            if (!silent) this.toast('Only the host can save the project');
            return;
        }

        const data = this._gatherProjectData();
        this.saveProjectData(this.currentProjectId, data);

        // Update index metadata + thumbnail
        const index = this.getProjectIndex();
        const existing = index[this.currentProjectId] || {};
        const thumbnail = this.captureThumbnail();
        index[this.currentProjectId] = {
            name: this.projectName || data.name || 'My Game',
            createdAt: existing.createdAt || Date.now(),
            modifiedAt: Date.now(),
            thumbnail: thumbnail || existing.thumbnail || null,
            favorite: existing.favorite || false,
            shared: existing.shared || false,
            description: existing.description || '',
            tags: existing.tags || []
        };
        this.saveProjectIndex(index);

        // Auto-update published version if project is shared
        if (existing.shared) {
            fetch('/api/projects', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: this.currentProjectId,
                    name: this.projectName || data.name || 'My Game',
                    description: existing.description || '',
                    tags: existing.tags || [],
                    thumbnail: thumbnail || null,
                    projectData: data
                })
            }).catch(() => {});
        }

        // Cloud sync — save to server
        if (this._cachedUser && !this._offlineMode) {
            const entry = index[this.currentProjectId];
            fetch('/api/user/projects/' + this.currentProjectId, {
                method: 'PUT',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: entry.name,
                    project_data: JSON.stringify(data),
                    thumbnail: entry.thumbnail,
                    favorite: entry.favorite,
                    shared: entry.shared,
                    description: entry.description,
                    tags: entry.tags,
                    created_at: entry.createdAt,
                    modified_at: entry.modifiedAt
                })
            }).catch(() => {});
        }

        this.hasUnsavedChanges = false;
        this.lastSaveTime = Date.now();
        this.updateToolbarProjectName();
        this.updateAutosaveIndicator();

        if (!silent) {
            this.toast('Project saved!', 'success');
        }
    }

    loadProject() {
        // Legacy method — now just opens the title screen
        this.showTitleScreen();
    }

    exportGame() {
        const data = this._gatherProjectData();
        const filename = (this.projectName || 'cobalt-game').replace(/[^a-z0-9_-]/gi, '_') + '.json';

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        this.toast('Game exported!', 'success');
    }

    // ===== Undo/Redo =====

    saveUndoState() {
        this.undoStack.push(JSON.stringify(this.scene3d.serialize()));
        if (this.undoStack.length > 50) this.undoStack.shift();
        this.redoStack = [];
        this.hasUnsavedChanges = true;
        this.updateToolbarProjectName();
    }

    undo() {
        if (this._collabRoom) { this.toast('Undo disabled during collaboration'); return; }
        if (this.undoStack.length === 0) return;
        this.redoStack.push(JSON.stringify(this.scene3d.serialize()));
        const state = JSON.parse(this.undoStack.pop());
        this.scene3d.deserialize(state);
        this.refreshExplorer();
        this.updateObjectCount();
        this.toast('Undo');
    }

    redo() {
        if (this._collabRoom) { this.toast('Redo disabled during collaboration'); return; }
        if (this.redoStack.length === 0) return;
        this.undoStack.push(JSON.stringify(this.scene3d.serialize()));
        const state = JSON.parse(this.redoStack.pop());
        this.scene3d.deserialize(state);
        this.refreshExplorer();
        this.updateObjectCount();
        this.toast('Redo');
    }

    // ===== Copy/Paste =====

    copySelected() {
        const objects = this.scene3d.selectedObjects.length > 0
            ? this.scene3d.selectedObjects
            : (this.scene3d.selectedObject ? [this.scene3d.selectedObject] : []);
        if (objects.length === 0) return;

        this._clipboard = objects.map(obj => {
            const data = {
                type: obj.userData.type,
                name: obj.userData.name,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
                color: obj.material?.color ? '#' + obj.material.color.getHexString() : '#4c97ff',
                scripts: obj.userData.scripts ? JSON.parse(JSON.stringify(obj.userData.scripts)) : []
            };
            return data;
        });
        this.toast(`Copied ${this._clipboard.length} object(s)`);
    }

    pasteObjects() {
        if (!this._clipboard || this._clipboard.length === 0) return;
        this._clipboard.forEach(data => {
            const obj = this.scene3d.addObject(data.type, data.color);
            if (obj) {
                obj.position.set(data.position.x + 1, data.position.y, data.position.z + 1);
                obj.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
                obj.scale.set(data.scale.x, data.scale.y, data.scale.z);
                obj.userData.name = data.name + ' Copy';
                obj.userData.scripts = data.scripts;
            }
        });
        this.refreshExplorer();
        this.updateObjectCount();
        this.toast(`Pasted ${this._clipboard.length} object(s)`);
    }

    // ===== Share Link =====

    shareProject() {
        if (this._collabRoom && this._collabMembers.length > 1) {
            this._collabStartVote('share');
            return;
        }
        this.showPublishModal();
    }

    loadFromHash() {
        const hash = window.location.hash;
        if (!hash || !hash.startsWith('#project=')) return false;
        try {
            const encoded = hash.substring('#project='.length);
            const json = decodeURIComponent(escape(atob(encoded)));
            const data = JSON.parse(json);

            // Assign a new project ID so it can be saved
            this.currentProjectId = this.generateProjectId();
            this.projectName = data.name || 'Shared Project';

            this._applyProjectData(data);

            // Save to multi-project storage
            this.saveProject(true);

            // Clear hash so it doesn't reload on refresh
            history.replaceState(null, '', window.location.pathname);
            this.toast('Shared project loaded!', 'success');
            return true;
        } catch (e) {
            console.error('Failed to load shared project:', e);
            return false;
        }
    }

    // ===== Tutorial =====

    initTooltips() {
        const selectors = '#toolbar .tool-btn[title], .viewport-fullscreen-btn[title], #block-editor-header .tool-btn[title]';
        document.querySelectorAll(selectors).forEach(el => {
            el.dataset.tooltip = el.getAttribute('title');
            el.removeAttribute('title');
        });
        // Block editor buttons are at the bottom — show tooltips above
        document.querySelectorAll('#block-editor-header .tool-btn[data-tooltip]').forEach(el => {
            el.dataset.tooltipPos = 'top';
        });
    }

    initTutorial() {
        this.tutorials = {
            'getting-started': {
                title: 'Getting Started',
                icon: 'view_in_ar',
                desc: 'Learn the basics — hands on!',
                steps: [
                    { icon: 'view_in_ar', title: 'Welcome to Cobalt Studio!', text: 'Build 3D games with blocks — no coding required! Let\'s walk through the basics together.' },
                    {
                        icon: 'add_box', title: 'Open the Toolbox',
                        text: 'Click the Toolbox tab on the left panel to see available objects.',
                        target: '.panel-tab[data-tab="library"]',
                        action: { type: 'click', selector: '.panel-tab[data-tab="library"]' }
                    },
                    {
                        icon: 'add_box', title: 'Add a Box',
                        text: 'Click the Box button to add a cube to your scene.',
                        target: '.object-btn[data-shape="box"]',
                        action: { type: 'click', selector: '.object-btn[data-shape="box"]' },
                        prepare: { tab: 'library' }
                    },
                    {
                        icon: 'open_with', title: 'Switch to the Move Tool',
                        text: 'Click the Move tool (or press G) to reposition objects.',
                        target: '#btn-move',
                        action: { type: 'click', selector: '#btn-move' }
                    },
                    {
                        icon: 'near_me', title: 'Select Your Object',
                        text: 'Click on the box you just created in the 3D viewport to select it.',
                        target: '#viewport-container',
                        action: { type: 'select-object' },
                        popover: { position: 'left' }
                    },
                    {
                        icon: 'play_arrow', title: 'Test Your Game',
                        text: 'Click Play to test your game! Press ESC or click Stop to return to editing.',
                        target: '#btn-play',
                        action: { type: 'click', selector: '#btn-play' }
                    },
                    { icon: 'celebration', title: 'You\'re Ready!', text: 'Great job! You know the basics. Try the Block Coding tutorial next to add behaviors to your objects.' }
                ]
            },
            'block-coding': {
                title: 'Block Coding',
                icon: 'extension',
                desc: 'Script objects with blocks — hands on!',
                steps: [
                    { icon: 'extension', title: 'Block Coding', text: 'Let\'s learn how to add behaviors to objects using visual block code!' },
                    {
                        icon: 'near_me', title: 'Select an Object',
                        text: 'Click on any object in the viewport to select it for scripting. If there are none, add one from the Toolbox first.',
                        target: '#viewport-container',
                        action: { type: 'select-object' },
                        popover: { position: 'left' }
                    },
                    {
                        icon: 'category', title: 'Pick a Category',
                        text: 'Click the "Events" category in the block palette to see event blocks.',
                        target: '.palette-category[data-category="events"]',
                        action: { type: 'click', selector: '.palette-category[data-category="events"]' },
                        prepare: { expandEditor: true }
                    },
                    {
                        icon: 'drag_indicator', title: 'Drag a Block',
                        text: 'Drag the "When game starts" block from the drawer into the workspace area on the right.',
                        target: '#block-drawer',
                        action: { type: 'drop-block' },
                        prepare: { expandEditor: true, category: 'events' },
                        popover: { position: 'top' }
                    },
                    {
                        icon: 'layers', title: 'Add a Motion Block',
                        text: 'Now click "Motion" in the palette, then drag a motion block below your event block.',
                        target: '.palette-category[data-category="motion"]',
                        action: { type: 'click', selector: '.palette-category[data-category="motion"]' },
                        prepare: { expandEditor: true }
                    },
                    {
                        icon: 'drag_indicator', title: 'Drag a Motion Block',
                        text: 'Drag any motion block (like "Move forward") from the drawer and snap it below your event block.',
                        target: '#block-drawer',
                        action: { type: 'drop-block' },
                        prepare: { expandEditor: true, category: 'motion' },
                        popover: { position: 'top' }
                    },
                    { icon: 'check_circle', title: 'Well Done!', text: 'You created your first script! Press Play to see it in action. Explore other categories to discover more blocks.' }
                ]
            },
            'building-worlds': {
                title: 'Building Worlds',
                icon: 'terrain',
                desc: 'Design levels with terrain and objects',
                steps: [
                    { icon: 'grid_on', title: 'Use the Grid', text: 'Enable Snap in the toolbar to align objects to a grid. Choose grid sizes from 0.25 to 2 units for precise placement.' },
                    { icon: 'terrain', title: 'Add Terrain', text: 'Switch to the Terrain tab in the left panel. Add flat ground, raise terrain, or add water to build your world.' },
                    { icon: 'format_paint', title: 'Paint Surfaces', text: 'Use terrain paint to apply materials like grass, dirt, sand, stone, snow, or lava to your ground.' },
                    { icon: 'category', title: 'Use Prefabs', text: 'The Prefabs section has ready-made objects: spawn points, lights, coins, NPCs, trees, houses, platforms, and more.' },
                    { icon: 'content_copy', title: 'Duplicate & Arrange', text: 'Select an object and press Ctrl+D to duplicate it. Use Move (G) to position copies and build larger structures.' }
                ]
            },
            'game-mechanics': {
                title: 'Game Mechanics',
                icon: 'sports_esports',
                desc: 'Add gameplay like scoring and physics',
                steps: [
                    { icon: 'speed', title: 'Physics', text: 'Use Physics blocks to add gravity, velocity, and impulse to objects. Make things bounce, fall, and collide!' },
                    { icon: 'scoreboard', title: 'Scoring System', text: 'Use Variable blocks to create a score. Add "Change score by 1" to a coin\'s "When touching player" event to track points.' },
                    { icon: 'favorite', title: 'Health System', text: 'Set a health variable, show it on screen with "Show health on screen", and decrease it when the player touches hazards.' },
                    { icon: 'bolt', title: 'Power-ups', text: 'Make collectible items that boost player speed, launch the player upward, or change game variables when touched.' },
                    { icon: 'emoji_events', title: 'Win & Lose', text: 'Use "If score > 10" to check win conditions, then trigger "Game Over win" or "Game Over lose" to end the game.' }
                ]
            },
            'looks-effects': {
                title: 'Looks & Effects',
                icon: 'palette',
                desc: 'Add visuals, particles, and style',
                steps: [
                    { icon: 'palette', title: 'Colors & Materials', text: 'Select an object and use the Material panel on the right to change color, roughness, metalness, and opacity.' },
                    { icon: 'auto_awesome', title: 'Glow & Flash', text: 'Use Looks blocks to add glow effects, flash colors, or create pulsing scale animations on objects.' },
                    { icon: 'local_fire_department', title: 'Particles', text: 'Add particle effects with "Emit particles" blocks. Choose from burst, sparkle, fire, or snow types with custom colors.' },
                    { icon: 'wb_twilight', title: 'Environment', text: 'Open Settings to change the skybox, sky color, ambient/directional lighting, and fog for atmosphere.' },
                    { icon: 'chat_bubble', title: 'Text & Labels', text: 'Use "Show text" blocks to display speech bubbles or "Show label" for permanent text above objects.' }
                ]
            },
            'keyboard-shortcuts': {
                title: 'Keyboard Shortcuts',
                icon: 'keyboard',
                desc: 'Speed up your workflow',
                steps: [
                    { icon: 'keyboard', title: 'Tool Shortcuts', text: 'V = Select, G = Move, R = Rotate, S = Scale. These shortcuts let you quickly switch between transform tools.' },
                    { icon: 'content_copy', title: 'Edit Shortcuts', text: 'Ctrl+Z = Undo, Ctrl+Y = Redo, Ctrl+D = Duplicate, Delete/Backspace = Delete selected object.' },
                    { icon: 'save', title: 'File Shortcuts', text: 'Ctrl+S = Save project. Your project auto-saves to the browser, but use this to save manually anytime.' },
                    { icon: 'play_arrow', title: 'Play Mode', text: 'F5 = Play/Stop your game. In play mode: WASD to move, Space to jump, Arrow keys to look around, ESC to stop.' },
                    { icon: 'mouse', title: 'Mouse Controls', text: 'Left click = Select. Shift+click = Multi-select. Right-drag = Orbit camera. Scroll = Zoom. Middle-drag = Pan.' }
                ]
            }
        };

        this.guidedTutorial = null;

        const modal = document.getElementById('tutorial-modal');
        const body = document.getElementById('tutorial-body');
        const prevBtn = document.getElementById('tutorial-prev');
        const nextBtn = document.getElementById('tutorial-next');
        const indicator = document.getElementById('tutorial-step-indicator');
        const closeBtn = document.getElementById('tutorial-close');
        const headerTitle = document.getElementById('tutorial-header-title');
        const footer = document.getElementById('tutorial-footer');
        let currentStep = 0;
        let activeSteps = null;

        const showTopicPicker = () => {
            headerTitle.textContent = 'Tutorials';
            footer.style.display = 'none';
            body.innerHTML = '<div class="tutorial-topics">' +
                Object.entries(this.tutorials).map(([key, t]) =>
                    `<div class="tutorial-topic-card" data-tutorial="${key}">
                        <span class="material-icons-round">${t.icon}</span>
                        <div class="topic-title">${t.title}</div>
                        <div class="topic-desc">${t.desc}</div>
                    </div>`
                ).join('') + '</div>';
            body.querySelectorAll('.tutorial-topic-card').forEach(card => {
                card.addEventListener('click', () => startTutorial(card.dataset.tutorial));
            });
        };

        const startTutorial = (key) => {
            const tutorial = this.tutorials[key];
            if (!tutorial) return;

            // Check if this tutorial has interactive steps
            const hasInteractive = tutorial.steps.some(s => s.action || s.target);
            if (hasInteractive) {
                modal.classList.add('hidden');
                if (!this.guidedTutorial) {
                    this.guidedTutorial = new GuidedTutorial(this);
                }
                this.guidedTutorial.start(key, tutorial);
                return;
            }

            // Non-interactive: use modal flow
            activeSteps = tutorial.steps;
            headerTitle.textContent = tutorial.title;
            footer.style.display = 'flex';
            currentStep = 0;
            renderStep();
        };

        const renderStep = () => {
            if (!activeSteps) return;
            const step = activeSteps[currentStep];
            body.innerHTML = `
                <div class="tutorial-step">
                    <div class="step-icon"><span class="material-icons-round" style="font-size:48px">${step.icon}</span></div>
                    <h3>${step.title}</h3>
                    <p>${step.text}</p>
                </div>
            `;
            indicator.textContent = `${currentStep + 1} / ${activeSteps.length}`;
            prevBtn.style.display = currentStep > 0 ? '' : 'none';
            nextBtn.innerHTML = currentStep < activeSteps.length - 1
                ? 'Next <span class="material-icons-round">arrow_forward</span>'
                : 'Done <span class="material-icons-round">check</span>';
        };

        prevBtn.addEventListener('click', () => {
            if (currentStep > 0) { currentStep--; renderStep(); }
        });
        nextBtn.addEventListener('click', () => {
            if (activeSteps && currentStep < activeSteps.length - 1) {
                currentStep++;
                renderStep();
            } else {
                showTopicPicker();
            }
        });
        closeBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        // Tutorial toolbar button
        document.getElementById('btn-tutorial').addEventListener('click', () => {
            showTopicPicker();
            modal.classList.remove('hidden');
        });

        // Show getting started on first visit
        const seen = localStorage.getItem('blockforge_tutorial_seen');
        if (!seen) {
            localStorage.setItem('blockforge_tutorial_seen', 'true');
            startTutorial('getting-started');
            modal.classList.remove('hidden');
        }
    }

    // ===== Custom Objects =====

    _getBuilderParts() {
        const rows = document.getElementById('obj-builder-parts').querySelectorAll('.obj-part-row');
        const parts = [];
        rows.forEach(row => {
            parts.push({
                shape: row.querySelector('.part-shape').value,
                color: row.querySelector('.part-color').value,
                offset: {
                    x: parseFloat(row.querySelector('.part-ox').value) || 0,
                    y: parseFloat(row.querySelector('.part-oy').value) || 0,
                    z: parseFloat(row.querySelector('.part-oz').value) || 0
                },
                scale: {
                    x: parseFloat(row.querySelector('.part-sx').value) || 1,
                    y: parseFloat(row.querySelector('.part-sy').value) || 1,
                    z: parseFloat(row.querySelector('.part-sz').value) || 1
                }
            });
        });
        return parts;
    }

    _updateBuilderPreview() {
        const parts = this._getBuilderParts();
        const img = document.getElementById('obj-builder-preview-img');
        if (parts.length === 0) {
            img.src = '';
            return;
        }
        img.src = this._renderCustomObjectThumbnail(parts, 128);
    }

    initCustomObjects() {
        const modal = document.getElementById('object-builder-modal');
        const partsContainer = document.getElementById('obj-builder-parts');
        const closeBtn = document.getElementById('object-builder-close');
        const cancelBtn = document.getElementById('obj-builder-cancel');
        const saveBtn = document.getElementById('obj-builder-save');
        const addPartBtn = document.getElementById('obj-builder-add-part');
        const createBtn = document.getElementById('btn-create-object');

        const shapeOptions = ['box','sphere','cylinder','cone','pyramid','dome','wedge'];

        const addPartRow = () => {
            const row = document.createElement('div');
            row.className = 'obj-part-row';
            const idx = partsContainer.children.length;
            row.innerHTML = `
                <div class="part-header">
                    <span>Part ${idx + 1}</span>
                    <button class="part-remove" title="Remove Part"><span class="material-icons-round">close</span></button>
                </div>
                <div class="obj-part-fields">
                    <label>Shape <select class="part-shape">${shapeOptions.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
                    <label>Color <input type="color" class="part-color" value="#4a90d9"></label>
                    <label>X <input type="number" class="part-ox" value="0" step="0.1"></label>
                    <label>Y <input type="number" class="part-oy" value="0" step="0.1"></label>
                    <label>Z <input type="number" class="part-oz" value="0" step="0.1"></label>
                    <label>SX <input type="number" class="part-sx" value="1" step="0.1"></label>
                    <label>SY <input type="number" class="part-sy" value="1" step="0.1"></label>
                    <label>SZ <input type="number" class="part-sz" value="1" step="0.1"></label>
                </div>
            `;
            row.querySelector('.part-remove').addEventListener('click', () => {
                row.remove();
                this._updateBuilderPreview();
            });
            // Update preview on any field change
            row.querySelectorAll('select, input').forEach(el => {
                el.addEventListener('input', () => this._updateBuilderPreview());
            });
            partsContainer.appendChild(row);
            this._updateBuilderPreview();
        };

        createBtn.addEventListener('click', () => {
            document.getElementById('obj-builder-name').value = 'My Object';
            partsContainer.innerHTML = '';
            addPartRow();
            modal.classList.remove('hidden');
        });

        addPartBtn.addEventListener('click', addPartRow);

        const closeModal = () => modal.classList.add('hidden');
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        saveBtn.addEventListener('click', () => {
            const name = document.getElementById('obj-builder-name').value.trim() || 'My Object';
            const partRows = partsContainer.querySelectorAll('.obj-part-row');
            if (partRows.length === 0) { this.toast('Add at least one part', 'error'); return; }

            const parts = [];
            partRows.forEach(row => {
                parts.push({
                    shape: row.querySelector('.part-shape').value,
                    color: row.querySelector('.part-color').value,
                    offset: {
                        x: parseFloat(row.querySelector('.part-ox').value) || 0,
                        y: parseFloat(row.querySelector('.part-oy').value) || 0,
                        z: parseFloat(row.querySelector('.part-oz').value) || 0
                    },
                    scale: {
                        x: parseFloat(row.querySelector('.part-sx').value) || 1,
                        y: parseFloat(row.querySelector('.part-sy').value) || 1,
                        z: parseFloat(row.querySelector('.part-sz').value) || 1
                    }
                });
            });

            const def = { id: 'custom_' + Date.now(), name, parts };
            this.customObjects.push(def);
            this.renderCustomObjectButtons();
            closeModal();
            this.toast(`Saved "${name}"`, 'success');
        });
    }

    _renderCustomObjectThumbnail(parts, res) {
        res = res || 64;
        const renderer = this.scene3d.renderer;

        // Lazy-init thumbnail scene/camera (reuses existing WebGL context)
        if (!this._thumbScene) {
            this._thumbScene = new THREE.Scene();
            this._thumbCamera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
            this._thumbScene.add(new THREE.AmbientLight(0xffffff, 0.6));
            const dir = new THREE.DirectionalLight(0xffffff, 0.8);
            dir.position.set(2, 3, 4);
            this._thumbScene.add(dir);
        }
        if (!this._thumbTarget || this._thumbTarget.width !== res) {
            if (this._thumbTarget) this._thumbTarget.dispose();
            this._thumbTarget = new THREE.WebGLRenderTarget(res, res);
        }
        const scene = this._thumbScene;
        const camera = this._thumbCamera;

        // Clear previous objects (keep lights)
        for (let i = scene.children.length - 1; i >= 0; i--) {
            if (!scene.children[i].isLight) scene.remove(scene.children[i]);
        }

        // Build the object from parts
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
                default: geom = new THREE.BoxGeometry(1, 1, 1); break;
            }
            const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(part.color || '#4a90d9'), roughness: 0.6, metalness: 0.1 });
            const mesh = new THREE.Mesh(geom, mat);
            mesh.position.set(part.offset?.x || 0, part.offset?.y || 0, part.offset?.z || 0);
            mesh.scale.set(part.scale?.x || 1, part.scale?.y || 1, part.scale?.z || 1);
            group.add(mesh);
        });
        scene.add(group);

        // Fit camera to bounding box
        const box = new THREE.Box3().setFromObject(group);
        const center = box.getCenter(new THREE.Vector3());
        const bsize = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(bsize.x, bsize.y, bsize.z) || 1;
        camera.position.set(center.x + maxDim * 1.2, center.y + maxDim * 0.8, center.z + maxDim * 1.5);
        camera.lookAt(center);

        // Render to offscreen target using existing renderer
        renderer.setRenderTarget(this._thumbTarget);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);

        // Read pixels and draw to a 2D canvas
        const pixels = new Uint8Array(res * res * 4);
        renderer.readRenderTargetPixels(this._thumbTarget, 0, 0, res, res, pixels);
        const canvas = document.createElement('canvas');
        canvas.width = res;
        canvas.height = res;
        const ctx = canvas.getContext('2d');
        const imageData = ctx.createImageData(res, res);
        // Flip Y since WebGL reads bottom-up
        for (let y = 0; y < res; y++) {
            for (let x = 0; x < res; x++) {
                const srcIdx = ((res - 1 - y) * res + x) * 4;
                const dstIdx = (y * res + x) * 4;
                imageData.data[dstIdx] = pixels[srcIdx];
                imageData.data[dstIdx + 1] = pixels[srcIdx + 1];
                imageData.data[dstIdx + 2] = pixels[srcIdx + 2];
                imageData.data[dstIdx + 3] = 255;
            }
        }
        ctx.putImageData(imageData, 0, 0);
        return canvas.toDataURL();
    }

    renderCustomObjectButtons() {
        const grid = document.getElementById('custom-objects-grid');
        grid.innerHTML = '';
        this.customObjects.forEach((def, idx) => {
            const btn = document.createElement('button');
            btn.className = 'object-btn';
            btn.title = def.name;
            const thumbUrl = this._renderCustomObjectThumbnail(def.parts);
            btn.innerHTML = `
                <img src="${thumbUrl}" style="width:40px;height:40px;image-rendering:pixelated;border-radius:4px;">
                <span>${def.name}</span>
                <button class="custom-obj-delete" title="Delete">&times;</button>
            `;
            btn.addEventListener('click', (e) => {
                if (e.target.closest('.custom-obj-delete')) return;
                const obj = this.scene3d.addObject('custom', {
                    position: { x: 0, y: 0.5, z: 0 },
                    customParts: def.parts,
                    customObjectId: def.id
                });
                this.scene3d.selectObject(obj);
                this.refreshExplorer();
                this.updateObjectCount();
                this.saveUndoState();
            });
            btn.querySelector('.custom-obj-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.customObjects.splice(idx, 1);
                this.renderCustomObjectButtons();
            });
            grid.appendChild(btn);
        });
    }

    // ===== UI Screens =====

    initUIScreens() {
        const modal = document.getElementById('screen-editor-modal');
        const closeBtn = document.getElementById('screen-editor-close');
        const cancelBtn = document.getElementById('screen-editor-cancel');
        const saveBtn = document.getElementById('screen-editor-save');
        const deleteBtn = document.getElementById('screen-editor-delete');
        const createBtn = document.getElementById('btn-create-screen');

        this._editingScreenIdx = -1;
        this._editingElements = [];
        this._selectedElementIdx = -1;

        createBtn.addEventListener('click', () => this._openScreenEditor());

        document.getElementById('screen-add-text').addEventListener('click', () => this._addScreenElement('text'));
        document.getElementById('screen-add-button').addEventListener('click', () => this._addScreenElement('button'));
        document.getElementById('screen-add-panel').addEventListener('click', () => this._addScreenElement('panel'));

        const closeModal = () => modal.classList.add('hidden');
        closeBtn.addEventListener('click', closeModal);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

        // Live preview updates
        document.getElementById('screen-editor-bg').addEventListener('input', () => this._updateScreenPreview());
        document.getElementById('screen-editor-bg-opacity').addEventListener('input', () => this._updateScreenPreview());
        document.getElementById('screen-editor-no-bg').addEventListener('change', () => {
            const noBg = document.getElementById('screen-editor-no-bg').checked;
            document.getElementById('screen-editor-bg').disabled = noBg;
            document.getElementById('screen-editor-bg-opacity').disabled = noBg;
            this._updateScreenPreview();
        });

        saveBtn.addEventListener('click', () => this._saveScreen());
        deleteBtn.addEventListener('click', () => this._deleteScreen());
    }

    _openScreenEditor(idx) {
        const modal = document.getElementById('screen-editor-modal');
        this._selectedElementIdx = -1;

        if (idx !== undefined && idx >= 0 && idx < this.uiScreens.length) {
            // Edit existing
            this._editingScreenIdx = idx;
            const screen = this.uiScreens[idx];
            document.getElementById('screen-editor-name').value = screen.name;
            // Parse bgColor rgba
            const noBg = screen.bgColor === 'transparent' || screen.noBg;
            document.getElementById('screen-editor-no-bg').checked = noBg;
            document.getElementById('screen-editor-bg').disabled = noBg;
            document.getElementById('screen-editor-bg-opacity').disabled = noBg;
            if (!noBg) {
                const rgba = screen.bgColor.match(/[\d.]+/g);
                if (rgba && rgba.length >= 4) {
                    const r = parseInt(rgba[0]), g = parseInt(rgba[1]), b = parseInt(rgba[2]);
                    const a = parseFloat(rgba[3]);
                    document.getElementById('screen-editor-bg').value = '#' + [r,g,b].map(c => c.toString(16).padStart(2,'0')).join('');
                    document.getElementById('screen-editor-bg-opacity').value = Math.round(a * 100);
                } else {
                    document.getElementById('screen-editor-bg').value = '#000000';
                    document.getElementById('screen-editor-bg-opacity').value = 80;
                }
            } else {
                document.getElementById('screen-editor-bg').value = '#000000';
                document.getElementById('screen-editor-bg-opacity').value = 0;
            }
            this._editingElements = JSON.parse(JSON.stringify(screen.elements));
            document.getElementById('screen-editor-delete').style.display = '';
        } else {
            // New screen
            this._editingScreenIdx = -1;
            document.getElementById('screen-editor-name').value = 'My Screen';
            document.getElementById('screen-editor-bg').value = '#000000';
            document.getElementById('screen-editor-bg-opacity').value = 80;
            document.getElementById('screen-editor-no-bg').checked = false;
            document.getElementById('screen-editor-bg').disabled = false;
            document.getElementById('screen-editor-bg-opacity').disabled = false;
            this._editingElements = [];
            document.getElementById('screen-editor-delete').style.display = 'none';
        }

        this._renderScreenElementsList();
        this._updateScreenPreview();
        modal.classList.remove('hidden');
    }

    _addScreenElement(type) {
        const msgs = this.blockCode._getAllMessageNames();
        const btnCount = this._editingElements.filter(e => e.type === 'button').length;
        const defaultMsg = msgs[Math.min(btnCount, msgs.length - 1)] || 'message1';
        const yOffset = btnCount * 10;
        const defaults = {
            text: { type: 'text', text: 'Text Label', x: 50, y: 30, width: 60, height: 10, fontSize: 32, color: '#ffffff', bgColor: 'transparent', align: 'center' },
            button: { type: 'button', text: 'Button', x: 50, y: 60 + yOffset, width: 30, height: 8, fontSize: 20, color: '#ffffff', bgColor: '#4C97FF', align: 'center', action: defaultMsg },
            panel: { type: 'panel', text: '', x: 50, y: 50, width: 80, height: 70, fontSize: 16, color: '#ffffff', bgColor: 'rgba(0,0,0,0.5)', align: 'center' }
        };
        this._editingElements.push({ ...defaults[type] });
        this._selectedElementIdx = this._editingElements.length - 1;
        this._renderScreenElementsList();
        this._updateScreenPreview();
    }

    _renderScreenElementsList() {
        const list = document.getElementById('screen-elements-list');
        list.innerHTML = '';

        this._editingElements.forEach((el, idx) => {
            const row = document.createElement('div');
            row.className = 'screen-element-row' + (idx === this._selectedElementIdx ? ' expanded' : '');

            const icons = { text: 'title', button: 'smart_button', panel: 'rectangle' };

            row.innerHTML = `
                <div class="screen-element-header">
                    <span class="material-icons-round">${icons[el.type] || 'layers'}</span>
                    <span style="flex:1;font-weight:500">${el.type.charAt(0).toUpperCase() + el.type.slice(1)}: ${el.text || '(panel)'}</span>
                    <span class="material-icons-round" style="font-size:14px">${row.classList.contains('expanded') ? 'expand_less' : 'expand_more'}</span>
                </div>
                <div class="screen-element-props">
                    <div class="screen-element-prop-row">
                        <label>Text</label>
                        <input type="text" data-field="text" value="${(el.text || '').replace(/"/g, '&quot;')}" style="flex:1">
                    </div>
                    <div class="screen-element-prop-row">
                        <label>X %</label>
                        <input type="number" data-field="x" value="${el.x}" min="0" max="100" step="1">
                        <label>Y %</label>
                        <input type="number" data-field="y" value="${el.y}" min="0" max="100" step="1">
                    </div>
                    <div class="screen-element-prop-row">
                        <label>W %</label>
                        <input type="number" data-field="width" value="${el.width}" min="1" max="100" step="1">
                        <label>H %</label>
                        <input type="number" data-field="height" value="${el.height}" min="1" max="100" step="1">
                    </div>
                    <div class="screen-element-prop-row">
                        <label>Size</label>
                        <input type="number" data-field="fontSize" value="${el.fontSize}" min="8" max="120" step="1" style="width:50px">
                        <label>Color</label>
                        <input type="color" data-field="color" value="${el.color}">
                        <label>BG</label>
                        <input type="color" data-field="bgColor" value="${el.bgColor === 'transparent' || el.bgColor.startsWith('rgba') ? '#000000' : el.bgColor}">
                    </div>
                    <div class="screen-element-prop-row">
                        <label>Align</label>
                        <select data-field="align">
                            <option value="left" ${el.align === 'left' ? 'selected' : ''}>Left</option>
                            <option value="center" ${el.align === 'center' ? 'selected' : ''}>Center</option>
                            <option value="right" ${el.align === 'right' ? 'selected' : ''}>Right</option>
                        </select>
                    </div>
                    ${el.type === 'button' ? `
                    <div class="screen-element-prop-row">
                        <label>On Click</label>
                        <select data-field="action" style="flex:1">
                            ${this.blockCode._getAllMessageNames().map(m =>
                                `<option value="${m}" ${el.action === m ? 'selected' : ''}>${m}</option>`
                            ).join('')}
                        </select>
                    </div>` : ''}
                    <div class="screen-element-actions">
                        ${idx > 0 ? '<button data-move="up"><span class="material-icons-round" style="font-size:14px">arrow_upward</span></button>' : ''}
                        ${idx < this._editingElements.length - 1 ? '<button data-move="down"><span class="material-icons-round" style="font-size:14px">arrow_downward</span></button>' : ''}
                        <button class="danger" data-action="delete"><span class="material-icons-round" style="font-size:14px">delete</span> Remove</button>
                    </div>
                </div>
            `;

            // Toggle expand
            row.querySelector('.screen-element-header').addEventListener('click', () => {
                this._selectedElementIdx = this._selectedElementIdx === idx ? -1 : idx;
                this._renderScreenElementsList();
                this._updateScreenPreview();
            });

            // Property change handlers
            row.querySelectorAll('[data-field]').forEach(input => {
                const handler = () => {
                    const field = input.dataset.field;
                    let val = input.value;
                    if (['x','y','width','height','fontSize'].includes(field)) val = parseFloat(val) || 0;
                    if (field === 'bgColor' && el.type === 'panel') {
                        val = val; // use hex directly for panels
                    }
                    this._editingElements[idx][field] = val;
                    this._updateScreenPreview();
                };
                input.addEventListener('input', handler);
                input.addEventListener('change', handler);
            });

            // Move/delete
            row.querySelectorAll('[data-move]').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const dir = btn.dataset.move;
                    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
                    [this._editingElements[idx], this._editingElements[newIdx]] = [this._editingElements[newIdx], this._editingElements[idx]];
                    if (this._selectedElementIdx === idx) this._selectedElementIdx = newIdx;
                    this._renderScreenElementsList();
                    this._updateScreenPreview();
                });
            });

            const delBtn = row.querySelector('[data-action="delete"]');
            if (delBtn) {
                delBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this._editingElements.splice(idx, 1);
                    this._selectedElementIdx = -1;
                    this._renderScreenElementsList();
                    this._updateScreenPreview();
                });
            }

            list.appendChild(row);
        });
    }

    _updateScreenPreview() {
        const preview = document.getElementById('screen-editor-preview');
        const noBg = document.getElementById('screen-editor-no-bg').checked;

        if (noBg) {
            // Checkerboard pattern to indicate transparency
            preview.style.background = 'repeating-conic-gradient(#808080 0% 25%, #a0a0a0 0% 50%) 50% / 20px 20px';
        } else {
            const bgColor = document.getElementById('screen-editor-bg').value;
            const opacity = parseInt(document.getElementById('screen-editor-bg-opacity').value) / 100;
            const r = parseInt(bgColor.slice(1,3), 16);
            const g = parseInt(bgColor.slice(3,5), 16);
            const b = parseInt(bgColor.slice(5,7), 16);
            preview.style.background = `rgba(${r},${g},${b},${opacity})`;
        }

        // Clear and re-render elements
        preview.innerHTML = '';

        this._editingElements.forEach((el, idx) => {
            const div = document.createElement('div');
            div.className = 'screen-preview-element' + (idx === this._selectedElementIdx ? ' selected' : '');
            div.style.left = el.x + '%';
            div.style.top = el.y + '%';
            div.style.width = el.width + '%';
            div.style.height = el.height + '%';
            div.style.fontSize = Math.max(8, el.fontSize * 0.35) + 'px';
            div.style.color = el.color;
            div.style.textAlign = el.align;
            div.style.display = 'flex';
            div.style.alignItems = 'center';
            div.style.justifyContent = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start';
            div.style.overflow = 'hidden';
            div.style.padding = '2px 4px';

            if (el.type === 'button') {
                div.style.background = el.bgColor;
                div.style.borderRadius = '4px';
                div.style.fontWeight = '600';
            } else if (el.type === 'panel') {
                div.style.background = el.bgColor;
                div.style.borderRadius = '4px';
            } else {
                div.style.background = el.bgColor === 'transparent' ? 'transparent' : el.bgColor;
            }

            div.textContent = el.text || '';

            div.addEventListener('click', () => {
                this._selectedElementIdx = idx;
                this._renderScreenElementsList();
                this._updateScreenPreview();
            });

            preview.appendChild(div);
        });
    }

    _saveScreen() {
        const name = document.getElementById('screen-editor-name').value.trim();
        if (!name) { this.toast('Please enter a screen name', 'error'); return; }

        const noBg = document.getElementById('screen-editor-no-bg').checked;
        let bgColorValue;
        if (noBg) {
            bgColorValue = 'transparent';
        } else {
            const bgColor = document.getElementById('screen-editor-bg').value;
            const opacity = parseInt(document.getElementById('screen-editor-bg-opacity').value) / 100;
            const r = parseInt(bgColor.slice(1,3), 16);
            const g = parseInt(bgColor.slice(3,5), 16);
            const b = parseInt(bgColor.slice(5,7), 16);
            bgColorValue = `rgba(${r},${g},${b},${opacity})`;
        }

        const screenData = {
            id: this._editingScreenIdx >= 0 ? this.uiScreens[this._editingScreenIdx].id : 'screen_' + Date.now(),
            name: name,
            bgColor: bgColorValue,
            noBg: noBg,
            elements: JSON.parse(JSON.stringify(this._editingElements))
        };

        if (this._editingScreenIdx >= 0) {
            this.uiScreens[this._editingScreenIdx] = screenData;
        } else {
            this.uiScreens.push(screenData);
        }

        this.renderScreenButtons();
        this.blockCode._updateScreenDropdowns(this.uiScreens);
        document.getElementById('screen-editor-modal').classList.add('hidden');
        this.toast(`Screen "${name}" saved!`, 'success');
    }

    _deleteScreen() {
        if (this._editingScreenIdx < 0) return;
        const name = this.uiScreens[this._editingScreenIdx].name;
        this.uiScreens.splice(this._editingScreenIdx, 1);
        this.renderScreenButtons();
        this.blockCode._updateScreenDropdowns(this.uiScreens);
        document.getElementById('screen-editor-modal').classList.add('hidden');
        this.toast(`Screen "${name}" deleted`);
    }

    renderScreenButtons() {
        const grid = document.getElementById('ui-screens-grid');
        grid.innerHTML = '';
        this.uiScreens.forEach((screen, idx) => {
            const btn = document.createElement('button');
            btn.className = 'screen-btn';
            btn.title = screen.name;
            btn.innerHTML = `<span class="material-icons-round">web</span><span>${screen.name}</span>`;
            btn.addEventListener('click', () => this._openScreenEditor(idx));
            grid.appendChild(btn);
        });
    }

    // ===== NPC Per-Part Color Editing =====

    updateNpcColors(obj) {
        const section = document.getElementById('npc-colors-section');
        if (!obj || obj.userData.type !== 'npc') {
            section.classList.add('hidden');
            return;
        }
        section.classList.remove('hidden');

        // Get NPC child meshes: body(0), head(1), legL(2), legR(3)
        const meshChildren = [];
        obj.traverse(child => {
            if (child.isMesh && child !== obj && !child.userData.isOutline) meshChildren.push(child);
        });

        if (meshChildren[0]) {
            document.getElementById('prop-npc-body').value = '#' + meshChildren[0].material.color.getHexString();
        }
        if (meshChildren[1]) {
            document.getElementById('prop-npc-head').value = '#' + meshChildren[1].material.color.getHexString();
        }
        if (meshChildren[2]) {
            document.getElementById('prop-npc-legs').value = '#' + meshChildren[2].material.color.getHexString();
        }
    }

    initNpcColorInputs() {
        document.getElementById('prop-npc-body').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj || obj.userData.type !== 'npc') return;
            const meshChildren = [];
            obj.traverse(child => { if (child.isMesh && child !== obj && !child.userData.isOutline) meshChildren.push(child); });
            if (meshChildren[0]) meshChildren[0].material.color.set(e.target.value);
            this.scene3d._needsRender = true;
        });
        document.getElementById('prop-npc-head').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj || obj.userData.type !== 'npc') return;
            const meshChildren = [];
            obj.traverse(child => { if (child.isMesh && child !== obj && !child.userData.isOutline) meshChildren.push(child); });
            if (meshChildren[1]) meshChildren[1].material.color.set(e.target.value);
            this.scene3d._needsRender = true;
        });
        document.getElementById('prop-npc-legs').addEventListener('input', (e) => {
            const obj = this.scene3d.selectedObject;
            if (!obj || obj.userData.type !== 'npc') return;
            const meshChildren = [];
            obj.traverse(child => { if (child.isMesh && child !== obj && !child.userData.isOutline) meshChildren.push(child); });
            if (meshChildren[2]) meshChildren[2].material.color.set(e.target.value);
            if (meshChildren[3]) meshChildren[3].material.color.set(e.target.value);
            this.scene3d._needsRender = true;
        });
    }

    // ===== Avatar Definitions =====

    static AVATARS = {
        default: `<svg viewBox="0 0 64 64"><defs><linearGradient id="dg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4a9eff"/><stop offset="100%" stop-color="#2d6bcc"/></linearGradient><clipPath id="dc"><circle cx="32" cy="32" r="31"/></clipPath></defs><circle cx="32" cy="32" r="31" fill="url(#dg1)"/><g clip-path="url(#dc)"><circle cx="32" cy="23" r="12" fill="#e0e8f0"/><path d="M8 64 Q8 40 32 40 Q56 40 56 64 Z" fill="#e0e8f0"/></g></svg>`,
        fox: `<svg viewBox="0 0 64 64"><defs><linearGradient id="fg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#f0734a"/><stop offset="100%" stop-color="#c0502e"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#fg1)"/><polygon points="16,12 23,27 11,25" fill="#d45a30"/><polygon points="48,12 41,27 53,25" fill="#d45a30"/><polygon points="16,12 23,27 11,25" fill="#fabb9e" opacity=".4"/><polygon points="48,12 41,27 53,25" fill="#fabb9e" opacity=".4"/><ellipse cx="32" cy="32" rx="16" ry="17" fill="#fab1a0"/><ellipse cx="32" cy="40" rx="8" ry="5" fill="#fff"/><circle cx="25" cy="28" r="3" fill="#3b3f4a"/><circle cx="39" cy="28" r="3" fill="#3b3f4a"/><circle cx="25.8" cy="27.2" r="1" fill="#fff"/><circle cx="39.8" cy="27.2" r="1" fill="#fff"/><ellipse cx="32" cy="35" rx="3.5" ry="2.5" fill="#3b3f4a"/><circle cx="32" cy="34.2" r="1" fill="#d45a30"/></svg>`,
        cat: `<svg viewBox="0 0 64 64"><defs><linearGradient id="cg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7a858a"/><stop offset="100%" stop-color="#4a5459"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#cg1)"/><polygon points="15,10 21,27 10,23" fill="#5e686e"/><polygon points="49,10 43,27 54,23" fill="#5e686e"/><polygon points="16,11 21,26 12,23" fill="#fbb" opacity=".25"/><polygon points="48,11 43,26 52,23" fill="#fbb" opacity=".25"/><ellipse cx="32" cy="33" rx="16" ry="16" fill="#b8c4c9"/><circle cx="25" cy="28" r="3.5" fill="#fddf6e"/><circle cx="39" cy="28" r="3.5" fill="#fddf6e"/><ellipse cx="25" cy="28.5" rx="1.3" ry="2.8" fill="#2d3436"/><ellipse cx="39" cy="28.5" rx="1.3" ry="2.8" fill="#2d3436"/><ellipse cx="32" cy="35" rx="2.5" ry="1.8" fill="#ff8fab"/><path d="M32 36.5 L30.5 39" stroke="#b8c4c9" stroke-width=".8" stroke-linecap="round"/><path d="M32 36.5 L33.5 39" stroke="#b8c4c9" stroke-width=".8" stroke-linecap="round"/><line x1="19" y1="31" x2="9" y2="29" stroke="#c4cdd1" stroke-width=".8" stroke-linecap="round"/><line x1="19" y1="33.5" x2="9" y2="34.5" stroke="#c4cdd1" stroke-width=".8" stroke-linecap="round"/><line x1="45" y1="31" x2="55" y2="29" stroke="#c4cdd1" stroke-width=".8" stroke-linecap="round"/><line x1="45" y1="33.5" x2="55" y2="34.5" stroke="#c4cdd1" stroke-width=".8" stroke-linecap="round"/></svg>`,
        robot: `<svg viewBox="0 0 64 64"><defs><linearGradient id="rg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3d4550"/><stop offset="100%" stop-color="#1e2329"/></linearGradient><linearGradient id="rg2" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7a8a9a"/><stop offset="100%" stop-color="#556270"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#rg1)"/><rect x="26" y="8" width="12" height="10" rx="6" fill="url(#rg2)"/><circle cx="32" cy="13" r="2.5" fill="#ff6b6b"/><circle cx="32" cy="13" r="1.5" fill="#ff8787" opacity=".6"/><rect x="16" y="20" width="32" height="26" rx="5" fill="url(#rg2)"/><rect x="11" y="26" width="5" height="12" rx="2.5" fill="#667788"/><rect x="48" y="26" width="5" height="12" rx="2.5" fill="#667788"/><rect x="21" y="26" width="9" height="7" rx="2.5" fill="#74c0ff"/><rect x="34" y="26" width="9" height="7" rx="2.5" fill="#74c0ff"/><rect x="21" y="26" width="9" height="3" rx="1.5" fill="#a8daff" opacity=".5"/><rect x="34" y="26" width="9" height="3" rx="1.5" fill="#a8daff" opacity=".5"/><rect x="25" y="39" width="14" height="3.5" rx="1.75" fill="#74c0ff"/><circle cx="27" cy="40.5" r="1" fill="#a8daff" opacity=".5"/><circle cx="32" cy="40.5" r="1" fill="#a8daff" opacity=".5"/><circle cx="37" cy="40.5" r="1" fill="#a8daff" opacity=".5"/></svg>`,
        bear: `<svg viewBox="0 0 64 64"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b5623a"/><stop offset="100%" stop-color="#8b4420"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#bg1)"/><circle cx="18" cy="14" r="8" fill="#9a5530"/><circle cx="46" cy="14" r="8" fill="#9a5530"/><circle cx="18" cy="14" r="4.5" fill="#daa87a"/><circle cx="46" cy="14" r="4.5" fill="#daa87a"/><circle cx="32" cy="34" r="18" fill="#daa87a"/><circle cx="25" cy="28" r="2.8" fill="#3b3040"/><circle cx="39" cy="28" r="2.8" fill="#3b3040"/><circle cx="25.8" cy="27.2" r=".9" fill="#fff"/><circle cx="39.8" cy="27.2" r=".9" fill="#fff"/><ellipse cx="32" cy="35" rx="6" ry="4.5" fill="#b5623a"/><ellipse cx="32" cy="33.5" rx="3" ry="2" fill="#3b3040"/><path d="M29 37 Q32 40 35 37" stroke="#3b3040" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>`,
        panda: `<svg viewBox="0 0 64 64"><defs><linearGradient id="pg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#eef1f3"/><stop offset="100%" stop-color="#cdd4d9"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#pg1)"/><circle cx="18" cy="14" r="8.5" fill="#2d3436"/><circle cx="46" cy="14" r="8.5" fill="#2d3436"/><circle cx="32" cy="34" r="18" fill="#fff"/><ellipse cx="24" cy="28" rx="6.5" ry="5.5" fill="#2d3436"/><ellipse cx="40" cy="28" rx="6.5" ry="5.5" fill="#2d3436"/><circle cx="24" cy="27.5" r="2.5" fill="#fff"/><circle cx="40" cy="27.5" r="2.5" fill="#fff"/><circle cx="24.5" cy="27" r="1.2" fill="#2d3436"/><circle cx="40.5" cy="27" r="1.2" fill="#2d3436"/><ellipse cx="32" cy="36" rx="4" ry="2.5" fill="#2d3436"/><path d="M28.5 38.5 Q32 41 35.5 38.5" stroke="#2d3436" stroke-width="1" fill="none" stroke-linecap="round"/></svg>`,
        owl: `<svg viewBox="0 0 64 64"><defs><linearGradient id="og1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7e6ee7"/><stop offset="100%" stop-color="#5240b8"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#og1)"/><polygon points="16,15 23,22 18,11" fill="#6a5acd"/><polygon points="48,15 41,22 46,11" fill="#6a5acd"/><ellipse cx="32" cy="34" rx="18" ry="17" fill="#a898f0"/><circle cx="23" cy="27" r="9" fill="#eee8ff"/><circle cx="41" cy="27" r="9" fill="#eee8ff"/><circle cx="23" cy="27" r="4.5" fill="#3b2f7a"/><circle cx="41" cy="27" r="4.5" fill="#3b2f7a"/><circle cx="24.2" cy="25.8" r="1.5" fill="#fff"/><circle cx="42.2" cy="25.8" r="1.5" fill="#fff"/><polygon points="32,32 28.5,38 35.5,38" fill="#ffc857"/><ellipse cx="32" cy="50" rx="7" ry="3" fill="#8b7acc"/><ellipse cx="23" cy="40" rx="5" ry="3" fill="#8b7acc" opacity=".3"/><ellipse cx="41" cy="40" rx="5" ry="3" fill="#8b7acc" opacity=".3"/></svg>`,
        penguin: `<svg viewBox="0 0 64 64"><defs><linearGradient id="png1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3d4550"/><stop offset="100%" stop-color="#1a1e24"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#png1)"/><ellipse cx="14" cy="36" rx="5" ry="10" fill="#2a3038" transform="rotate(-10 14 36)"/><ellipse cx="50" cy="36" rx="5" ry="10" fill="#2a3038" transform="rotate(10 50 36)"/><ellipse cx="32" cy="38" rx="14" ry="16" fill="#f0ece8"/><circle cx="25" cy="24" r="3.5" fill="#fff"/><circle cx="39" cy="24" r="3.5" fill="#fff"/><circle cx="25.5" cy="23.8" r="2" fill="#1a1e24"/><circle cx="39.5" cy="23.8" r="2" fill="#1a1e24"/><circle cx="26" cy="23" r=".7" fill="#fff"/><circle cx="40" cy="23" r=".7" fill="#fff"/><polygon points="32,28 28,34 36,34" fill="#f5a623"/><ellipse cx="27" cy="54" rx="5" ry="2.5" fill="#f5a623"/><ellipse cx="37" cy="54" rx="5" ry="2.5" fill="#f5a623"/></svg>`,
        astronaut: `<svg viewBox="0 0 64 64"><defs><linearGradient id="ag1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1a8de8"/><stop offset="100%" stop-color="#0660a9"/></linearGradient><linearGradient id="ag2" x1=".2" y1="0" x2=".8" y2="1"><stop offset="0%" stop-color="#e8edf2"/><stop offset="100%" stop-color="#b8c4d0"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#ag1)"/><ellipse cx="32" cy="28" rx="17" ry="18" fill="url(#ag2)"/><ellipse cx="32" cy="27" rx="12.5" ry="13" fill="#5ba8e8"/><ellipse cx="32" cy="27" rx="12.5" ry="13" fill="rgba(255,255,255,.12)"/><circle cx="25" cy="25.5" r="2.2" fill="#253040"/><circle cx="39" cy="25.5" r="2.2" fill="#253040"/><path d="M28 31.5 Q32 35 36 31.5" stroke="#253040" stroke-width="1.6" fill="none" stroke-linecap="round"/><circle cx="39" cy="20" r="2.8" fill="rgba(255,255,255,.3)"/><circle cx="37" cy="18" r="1.2" fill="rgba(255,255,255,.2)"/><rect x="20" y="44" width="24" height="12" rx="5" fill="url(#ag2)"/><circle cx="28" cy="49" r="1.5" fill="#e74c3c"/><circle cx="36" cy="49" r="1.5" fill="#3498db"/></svg>`,
        ninja: `<svg viewBox="0 0 64 64"><defs><linearGradient id="ng1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#383e48"/><stop offset="100%" stop-color="#1a1d22"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#ng1)"/><circle cx="32" cy="30" r="15" fill="#ffeaa7"/><rect x="14" y="23" width="36" height="10" rx="3" fill="#2d3136"/><circle cx="25" cy="28" r="3" fill="#fff"/><circle cx="39" cy="28" r="3" fill="#fff"/><circle cx="25.5" cy="27.5" r="1.8" fill="#1a1d22"/><circle cx="39.5" cy="27.5" r="1.8" fill="#1a1d22"/><circle cx="26" cy="27" r=".6" fill="#fff"/><circle cx="40" cy="27" r=".6" fill="#fff"/><path d="M46 24 L54 20 L52 26" fill="#2d3136"/><rect x="14" y="44" width="36" height="12" rx="5" fill="#2d3136"/></svg>`,
        wizard: `<svg viewBox="0 0 64 64"><defs><linearGradient id="wg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#7e6ee7"/><stop offset="100%" stop-color="#4a38a0"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#wg1)"/><polygon points="32,0 20,30 44,30" fill="#5a48b0"/><polygon points="32,0 26,30 38,30" fill="rgba(255,255,255,.08)"/><circle cx="32" cy="7" r="3.5" fill="#ffd700"/><circle cx="32" cy="7" r="2" fill="#ffe566" opacity=".6"/><circle cx="28" cy="18" r="1.2" fill="#ffd700" opacity=".5"/><circle cx="36" cy="14" r="1" fill="#ffd700" opacity=".4"/><circle cx="32" cy="36" r="13" fill="#ffeaa7"/><circle cx="26" cy="34" r="2.3" fill="#3b2f7a"/><circle cx="38" cy="34" r="2.3" fill="#3b2f7a"/><circle cx="26.7" cy="33.4" r=".7" fill="#fff"/><circle cx="38.7" cy="33.4" r=".7" fill="#fff"/><path d="M28 40 Q32 43.5 36 40" stroke="#3b2f7a" stroke-width="1.5" fill="none" stroke-linecap="round"/><path d="M18 48 Q32 56 46 48" fill="#c0b0e0"/><ellipse cx="24" cy="38" rx="2.5" ry="1.2" fill="#e8b4b8" opacity=".3"/><ellipse cx="40" cy="38" rx="2.5" ry="1.2" fill="#e8b4b8" opacity=".3"/></svg>`,
        dragon: `<svg viewBox="0 0 64 64"><defs><linearGradient id="drg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10c9a0"/><stop offset="100%" stop-color="#088a6e"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#drg1)"/><polygon points="20,10 25,24 15,20" fill="#0aa87e"/><polygon points="44,10 39,24 49,20" fill="#0aa87e"/><polygon points="20,10 25,24 15,20" fill="#55efc4" opacity=".3"/><polygon points="44,10 39,24 49,20" fill="#55efc4" opacity=".3"/><ellipse cx="32" cy="33" rx="17" ry="17" fill="#55efc4"/><circle cx="24" cy="27" r="4" fill="#ffd700"/><circle cx="40" cy="27" r="4" fill="#ffd700"/><ellipse cx="24" cy="27.5" rx="1.5" ry="3" fill="#2d3436"/><ellipse cx="40" cy="27.5" rx="1.5" ry="3" fill="#2d3436"/><ellipse cx="29" cy="38" rx="2" ry="1.2" fill="#0aa87e"/><ellipse cx="35" cy="38" rx="2" ry="1.2" fill="#0aa87e"/><path d="M28 41 Q32 44 36 41" stroke="#2d3436" stroke-width="1.3" fill="none" stroke-linecap="round"/><ellipse cx="32" cy="50" rx="10" ry="5" fill="#3dd9a4"/></svg>`,
        bunny: `<svg viewBox="0 0 64 64"><defs><linearGradient id="bng1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#ff85b0"/><stop offset="100%" stop-color="#d45a80"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#bng1)"/><ellipse cx="22" cy="12" rx="5" ry="14" fill="#e8709a"/><ellipse cx="42" cy="12" rx="5" ry="14" fill="#e8709a"/><ellipse cx="22" cy="12" rx="3" ry="11.5" fill="#ffb0c8"/><ellipse cx="42" cy="12" rx="3" ry="11.5" fill="#ffb0c8"/><circle cx="32" cy="35" r="17" fill="#fff"/><circle cx="25" cy="31" r="2.5" fill="#3b3040"/><circle cx="39" cy="31" r="2.5" fill="#3b3040"/><circle cx="25.8" cy="30.2" r=".8" fill="#fff"/><circle cx="39.8" cy="30.2" r=".8" fill="#fff"/><ellipse cx="32" cy="37" rx="2.5" ry="1.8" fill="#ff85b0"/><path d="M29.5 38.5 L32 37 L34.5 38.5" stroke="#ff85b0" stroke-width=".8" fill="none" stroke-linecap="round"/><ellipse cx="23" cy="37" rx="3.5" ry="2" fill="#ffb0c8" opacity=".4"/><ellipse cx="41" cy="37" rx="3.5" ry="2" fill="#ffb0c8" opacity=".4"/></svg>`,
        alien: `<svg viewBox="0 0 64 64"><defs><linearGradient id="alg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#10dcd0"/><stop offset="100%" stop-color="#088a82"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#alg1)"/><ellipse cx="32" cy="30" rx="18" ry="20" fill="#81ecec"/><ellipse cx="23" cy="25" rx="7.5" ry="5.5" fill="#1a3a38"/><ellipse cx="41" cy="25" rx="7.5" ry="5.5" fill="#1a3a38"/><ellipse cx="23" cy="25" rx="4.5" ry="3.5" fill="#55efc4"/><ellipse cx="41" cy="25" rx="4.5" ry="3.5" fill="#55efc4"/><circle cx="22" cy="24" r="1.5" fill="#c8fff0" opacity=".5"/><circle cx="40" cy="24" r="1.5" fill="#c8fff0" opacity=".5"/><ellipse cx="32" cy="38" rx="3.5" ry="2" fill="#1a3a38"/><path d="M28.5 38 Q32 40.5 35.5 38" stroke="#1a3a38" stroke-width=".8" fill="none"/></svg>`,
        pirate: `<svg viewBox="0 0 64 64"><defs><linearGradient id="prg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#e83838"/><stop offset="100%" stop-color="#a82020"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#prg1)"/><circle cx="32" cy="33" r="15" fill="#ffeaa7"/><circle cx="25" cy="30" r="2.8" fill="#3b3040"/><circle cx="25.8" cy="29.2" r=".9" fill="#fff"/><ellipse cx="39" cy="30" rx="6" ry="5" fill="#2d3136"/><ellipse cx="39" cy="30" rx="4.5" ry="3.5" fill="#1a1d22"/><circle cx="40" cy="29.5" r="1" fill="#888" opacity=".4"/><path d="M27 39 Q32 42.5 37 39" stroke="#3b3040" stroke-width="1.6" fill="none" stroke-linecap="round"/><rect x="14" y="17" width="36" height="8" rx="3" fill="#2d3136"/><rect x="14" y="17" width="36" height="4" rx="2" fill="#4a4f58"/><circle cx="32" cy="21" r="2" fill="#ffd700"/></svg>`,
        ghost: `<svg viewBox="0 0 64 64"><defs><linearGradient id="gg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#b8a8ff"/><stop offset="100%" stop-color="#7c6cbf"/></linearGradient></defs><circle cx="32" cy="32" r="31" fill="url(#gg1)"/><ellipse cx="32" cy="26" rx="15" ry="17" fill="#eee8ff"/><ellipse cx="32" cy="26" rx="15" ry="17" fill="rgba(255,255,255,.15)"/><path d="M17 38 L17 54 L23 47 L29 54 L32 49 L35 54 L41 47 L47 54 L47 38" fill="#eee8ff"/><circle cx="25" cy="25" r="4" fill="#3b2f7a"/><circle cx="39" cy="25" r="4" fill="#3b2f7a"/><circle cx="25.8" cy="24" r="1.3" fill="#fff"/><circle cx="39.8" cy="24" r="1.3" fill="#fff"/><ellipse cx="32" cy="34" rx="4" ry="3.5" fill="#3b2f7a"/><ellipse cx="24" cy="30" rx="3" ry="1.5" fill="#d8c8ff" opacity=".3"/><ellipse cx="40" cy="30" rx="3" ry="1.5" fill="#d8c8ff" opacity=".3"/></svg>`,
    };

    // ===== Auth System =====

    _cachedUser = null;
    _captchaToken = null;
    _usernameCheckTimer = null;

    getCurrentUser() {
        return this._cachedUser?.username || null;
    }

    isLoggedIn() {
        return !!this._cachedUser;
    }

    getAvatarSvg(avatarId) {
        return this.constructor.AVATARS[avatarId] || this.constructor.AVATARS.default;
    }

    async checkAuth() {
        try {
            const res = await fetch('/api/me');
            if (res.ok) {
                this._cachedUser = await res.json();
                this._offlineMode = false;
                this._migrateToNamespacedStorage();
                this._syncProjects();
                return true;
            }
        } catch (e) { /* not logged in */ }
        // Fallback: offline/local mode — skip auth, use guest user
        const savedGuest = localStorage.getItem('blockforge_guest_user');
        if (savedGuest) {
            this._cachedUser = JSON.parse(savedGuest);
        } else {
            this._cachedUser = { displayName: 'Guest', avatar: 'default', id: 'local-guest' };
            localStorage.setItem('blockforge_guest_user', JSON.stringify(this._cachedUser));
        }
        this._offlineMode = true;
        return true;
    }

    async _syncProjects() {
        if (this._offlineMode || !this._cachedUser) return;
        try {
            const res = await fetch('/api/user/projects', { credentials: 'same-origin' });
            if (!res.ok) return;
            const serverList = await res.json();
            const serverMap = {};
            for (const s of serverList) serverMap[s.id] = s;

            const localIndex = this.getProjectIndex();
            const allIds = new Set([...Object.keys(localIndex), ...Object.keys(serverMap)]);

            for (const id of allIds) {
                const local = localIndex[id];
                const server = serverMap[id];

                if (local && !server) {
                    // Upload local-only project to server
                    const data = this.getProjectData(id);
                    if (data) {
                        fetch('/api/user/projects/' + id, {
                            method: 'PUT',
                            credentials: 'same-origin',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                name: local.name,
                                project_data: JSON.stringify(data),
                                thumbnail: local.thumbnail,
                                favorite: local.favorite,
                                shared: local.shared,
                                description: local.description,
                                tags: local.tags,
                                created_at: local.createdAt,
                                modified_at: local.modifiedAt
                            })
                        }).catch(() => {});
                    }
                } else if (!local && server) {
                    // Download server-only project
                    try {
                        const dRes = await fetch('/api/user/projects/' + id, { credentials: 'same-origin' });
                        if (dRes.ok) {
                            const { project_data } = await dRes.json();
                            const parsed = JSON.parse(project_data);
                            this.saveProjectData(id, parsed);
                            localIndex[id] = {
                                name: server.name,
                                createdAt: Number(server.created_at),
                                modifiedAt: Number(server.modified_at),
                                thumbnail: server.thumbnail,
                                favorite: server.favorite || false,
                                shared: server.shared || false,
                                description: server.description || '',
                                tags: typeof server.tags === 'string' ? JSON.parse(server.tags) : (server.tags || [])
                            };
                        }
                    } catch (e) { /* skip */ }
                } else if (local && server) {
                    const localTime = local.modifiedAt || 0;
                    const serverTime = Number(server.modified_at) || 0;
                    if (serverTime > localTime) {
                        // Server is newer — download
                        try {
                            const dRes = await fetch('/api/user/projects/' + id, { credentials: 'same-origin' });
                            if (dRes.ok) {
                                const { project_data } = await dRes.json();
                                const parsed = JSON.parse(project_data);
                                this.saveProjectData(id, parsed);
                                localIndex[id] = {
                                    name: server.name,
                                    createdAt: Number(server.created_at),
                                    modifiedAt: Number(server.modified_at),
                                    thumbnail: server.thumbnail,
                                    favorite: server.favorite || false,
                                    shared: server.shared || false,
                                    description: server.description || '',
                                    tags: typeof server.tags === 'string' ? JSON.parse(server.tags) : (server.tags || [])
                                };
                            }
                        } catch (e) { /* skip */ }
                    } else if (localTime > serverTime) {
                        // Local is newer — upload
                        const data = this.getProjectData(id);
                        if (data) {
                            fetch('/api/user/projects/' + id, {
                                method: 'PUT',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                    name: local.name,
                                    project_data: JSON.stringify(data),
                                    thumbnail: local.thumbnail,
                                    favorite: local.favorite,
                                    shared: local.shared,
                                    description: local.description,
                                    tags: local.tags,
                                    created_at: local.createdAt,
                                    modified_at: local.modifiedAt
                                })
                            }).catch(() => {});
                        }
                    }
                }
            }
            this.saveProjectIndex(localIndex);
        } catch (e) {
            console.warn('Project sync failed:', e);
        }
    }

    initAuth() {
        // Tab switching
        document.querySelectorAll('.auth-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.auth-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('#auth-screen .auth-form').forEach(f => f.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.authTab;
                document.getElementById(tab === 'signup' ? 'auth-signup-form' : 'auth-login-form').classList.add('active');
                if (tab === 'signup') this.loadCaptcha();
            });
        });

        // Sign up
        document.getElementById('auth-signup-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignUp();
        });

        // Log in
        document.getElementById('auth-login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogIn();
        });

        // Real-time validation
        const usernameInput = document.getElementById('auth-signup-username');
        const passwordInput = document.getElementById('auth-signup-password');
        const confirmInput = document.getElementById('auth-signup-confirm');
        const captchaInput = document.getElementById('auth-captcha-answer');

        usernameInput.addEventListener('input', () => {
            this._checkUsernameAvailability();
            this._validateSignupForm();
        });
        passwordInput.addEventListener('input', () => this._validateSignupForm());
        confirmInput.addEventListener('input', () => this._validateSignupForm());
        captchaInput.addEventListener('input', () => this._validateSignupForm());

        // Stop keyboard events from propagating
        document.querySelectorAll('#auth-screen input').forEach(input => {
            input.addEventListener('keydown', (e) => e.stopPropagation());
        });

        // Avatar picker modal
        this._initAvatarModal();

        // Title screen avatar click opens picker
        document.getElementById('title-user-avatar').addEventListener('click', () => this.showAvatarPicker());
    }

    _initAvatarModal() {
        const modal = document.getElementById('avatar-modal');
        const closeBtn = document.getElementById('avatar-modal-close');
        const fileInput = document.getElementById('avatar-file-input');
        const uploadBtn = document.getElementById('avatar-upload-btn');
        const removeBtn = document.getElementById('avatar-remove-btn');

        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

        uploadBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!file.type.startsWith('image/')) {
                this.toast('Please select an image file', 'error');
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                this.toast('Image too large', 'error');
                return;
            }

            try {
                const dataUrl = await this._resizeImage(file, 256);
                const res = await fetch('/api/me/avatar', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image: dataUrl })
                });
                if (res.ok) {
                    const data = await res.json();
                    this._cachedUser.avatar = 'custom';
                    this._cachedUser.avatarUrl = data.avatarUrl + '?t=' + Date.now();
                    this.updateUserDisplay();
                    this._updateAvatarPreview();
                    this.toast('Profile picture updated!', 'success');
                } else {
                    const err = await res.json();
                    this.toast(err.error || 'Upload failed', 'error');
                }
            } catch (e) {
                this.toast('Failed to upload image', 'error');
            }
            fileInput.value = '';
        });

        removeBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/me/avatar', { method: 'DELETE' });
                if (res.ok) {
                    this._cachedUser.avatar = 'default';
                    delete this._cachedUser.avatarUrl;
                    this.updateUserDisplay();
                    this._updateAvatarPreview();
                    this.toast('Profile picture removed', 'success');
                }
            } catch (e) {
                this.toast('Failed to remove picture', 'error');
            }
        });
    }

    _resizeImage(file, maxSize) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();
            reader.onload = (e) => {
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    // Crop to square from center
                    const size = Math.min(img.width, img.height);
                    const sx = (img.width - size) / 2;
                    const sy = (img.height - size) / 2;
                    canvas.width = maxSize;
                    canvas.height = maxSize;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, sx, sy, size, size, 0, 0, maxSize, maxSize);
                    resolve(canvas.toDataURL('image/png'));
                };
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    _updateAvatarPreview() {
        const preview = document.getElementById('avatar-preview');
        const removeBtn = document.getElementById('avatar-remove-btn');
        if (!preview) return;
        const user = this._cachedUser;
        if (user && user.avatar === 'custom' && user.avatarUrl) {
            preview.innerHTML = `<img src="${user.avatarUrl}">`;
            removeBtn.style.display = '';
        } else {
            preview.innerHTML = this.getAvatarSvg(user?.avatar || 'default');
            removeBtn.style.display = 'none';
        }
    }

    showAvatarPicker() {
        this._updateAvatarPreview();
        document.getElementById('avatar-modal').classList.remove('hidden');
    }

    async loadCaptcha() {
        try {
            const res = await fetch('/api/captcha');
            if (res.ok) {
                const data = await res.json();
                document.getElementById('auth-captcha-label').textContent = data.question;
                document.getElementById('auth-captcha-answer').value = '';
                this._captchaToken = data.token;
            }
        } catch (e) {
            document.getElementById('auth-captcha-label').textContent = 'Could not load bot check';
        }
        this._validateSignupForm();
    }

    _checkUsernameAvailability() {
        clearTimeout(this._usernameCheckTimer);
        const username = document.getElementById('auth-signup-username').value.trim();
        const hint = document.getElementById('auth-username-hint');

        if (!username || username.length < 3) {
            hint.textContent = username.length > 0 ? 'Must be at least 3 characters' : '';
            hint.className = 'auth-field-hint' + (username.length > 0 ? ' hint-error' : '');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            hint.textContent = 'Only letters, numbers, and underscores';
            hint.className = 'auth-field-hint hint-error';
            return;
        }

        hint.textContent = 'Checking...';
        hint.className = 'auth-field-hint hint-checking';

        this._usernameCheckTimer = setTimeout(async () => {
            try {
                const res = await fetch('/api/check-username/' + encodeURIComponent(username));
                if (res.ok) {
                    const data = await res.json();
                    if (document.getElementById('auth-signup-username').value.trim() === username) {
                        hint.textContent = data.available ? 'Available' : 'Already taken';
                        hint.className = 'auth-field-hint ' + (data.available ? 'hint-success' : 'hint-error');
                        this._validateSignupForm();
                    }
                }
            } catch (e) { /* offline */ }
        }, 400);
    }

    _validateSignupForm() {
        const username = document.getElementById('auth-signup-username').value.trim();
        const password = document.getElementById('auth-signup-password').value;
        const confirm = document.getElementById('auth-signup-confirm').value;
        const captcha = document.getElementById('auth-captcha-answer').value.trim();
        const hint = document.getElementById('auth-username-hint');
        const btn = document.getElementById('auth-signup-btn');

        const usernameOk = username.length >= 3 && username.length <= 20 && /^[a-zA-Z0-9_]+$/.test(username) && hint.classList.contains('hint-success');
        const passwordOk = password.length >= 4;
        const confirmOk = confirm.length > 0 && password === confirm;
        const captchaOk = captcha.length > 0;

        btn.disabled = !(usernameOk && passwordOk && confirmOk && captchaOk);
    }

    async handleSignUp() {
        const username = document.getElementById('auth-signup-username').value.trim();
        const password = document.getElementById('auth-signup-password').value;
        const confirm = document.getElementById('auth-signup-confirm').value;
        const captchaAnswer = document.getElementById('auth-captcha-answer').value.trim();
        const errorEl = document.getElementById('auth-signup-error');

        errorEl.classList.remove('visible');

        if (!username || username.length < 3 || username.length > 20) {
            errorEl.textContent = 'Username must be 3-20 characters';
            errorEl.classList.add('visible');
            return;
        }
        if (!/^[a-zA-Z0-9_]+$/.test(username)) {
            errorEl.textContent = 'Username can only contain letters, numbers, and underscores';
            errorEl.classList.add('visible');
            return;
        }
        if (password.length < 4) {
            errorEl.textContent = 'Password must be at least 4 characters';
            errorEl.classList.add('visible');
            return;
        }
        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match';
            errorEl.classList.add('visible');
            return;
        }
        if (!captchaAnswer) {
            errorEl.textContent = 'Please solve the bot check';
            errorEl.classList.add('visible');
            return;
        }

        try {
            const res = await fetch('/api/signup', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password, captchaToken: this._captchaToken, captchaAnswer })
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error;
                errorEl.classList.add('visible');
                if (data.refreshCaptcha) this.loadCaptcha();
                return;
            }
            this._cachedUser = data;
            this._offlineMode = false;
            this.hideAuthScreen();
            this.updateUserDisplay();
            this._syncProjects().then(() => this.showTitleScreen());
            this.toast('Welcome to Cobalt Studio, ' + data.displayName + '!', 'success');
            // Prompt to choose avatar after signup
            setTimeout(() => this.showAvatarPicker(), 600);
        } catch (e) {
            errorEl.textContent = 'Connection error. Is the server running?';
            errorEl.classList.add('visible');
        }
    }

    async handleLogIn() {
        const username = document.getElementById('auth-login-username').value.trim();
        const password = document.getElementById('auth-login-password').value;
        const errorEl = document.getElementById('auth-login-error');

        errorEl.classList.remove('visible');

        if (!username || !password) {
            errorEl.textContent = 'Please enter username and password';
            errorEl.classList.add('visible');
            return;
        }

        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (!res.ok) {
                errorEl.textContent = data.error;
                errorEl.classList.add('visible');
                return;
            }
            this._cachedUser = data;
            this._offlineMode = false;
            this.hideAuthScreen();
            this.updateUserDisplay();
            this._syncProjects().then(() => this.showTitleScreen());
            this.toast('Welcome back, ' + data.displayName + '!', 'success');
        } catch (e) {
            errorEl.textContent = 'Connection error. Is the server running?';
            errorEl.classList.add('visible');
        }
    }

    async handleSignOut() {
        try { await fetch('/api/logout', { method: 'POST' }); } catch (e) { /* ok */ }
        this._cachedUser = null;
        localStorage.removeItem('blockforge_guest_user');
        this._offlineMode = false;
        this.showAuthScreen();
    }

    showAuthScreen() {
        document.getElementById('auth-screen').classList.remove('hidden');
        document.getElementById('title-screen').classList.add('hidden');
        // Clear fields
        document.getElementById('auth-signup-username').value = '';
        document.getElementById('auth-signup-password').value = '';
        document.getElementById('auth-signup-confirm').value = '';
        document.getElementById('auth-captcha-answer').value = '';
        document.getElementById('auth-login-username').value = '';
        document.getElementById('auth-login-password').value = '';
        document.getElementById('auth-username-hint').textContent = '';
        document.getElementById('auth-username-hint').className = 'auth-field-hint';
        document.getElementById('auth-signup-btn').disabled = true;
        document.querySelectorAll('.auth-error').forEach(e => e.classList.remove('visible'));
        // Load captcha
        this.loadCaptcha();
    }

    hideAuthScreen() {
        document.getElementById('auth-screen').classList.add('hidden');
    }

    // ===== User Display =====

    updateUserDisplay() {
        const user = this._cachedUser;
        if (!user) return;

        const isCustom = user.avatar === 'custom' && user.avatarUrl;
        const avatarHtml = isCustom
            ? `<img src="${user.avatarUrl}" alt="${user.displayName}">`
            : this.getAvatarSvg(user.avatar || 'default');

        // Title screen avatar
        const titleAvatar = document.getElementById('title-user-avatar');
        if (titleAvatar) {
            titleAvatar.innerHTML = avatarHtml;
            titleAvatar.style.background = '';
        }
        const titleName = document.getElementById('title-user-name');
        if (titleName) titleName.textContent = user.displayName;

        // Toolbar avatar
        const toolbarAvatar = document.getElementById('toolbar-user-avatar');
        if (toolbarAvatar) {
            toolbarAvatar.innerHTML = avatarHtml;
            toolbarAvatar.style.background = '';
            toolbarAvatar.title = user.displayName;
        }

        // Admin inbox button
        const inboxBtn = document.getElementById('btn-admin-inbox');
        if (inboxBtn) {
            if (user.isAdmin) {
                inboxBtn.classList.remove('hidden');
                inboxBtn.onclick = () => this._openAdminInbox();
                this._updateInboxBadge();
            } else {
                inboxBtn.classList.add('hidden');
            }
        }
    }

    // ===== Explore =====

    initExplore() {
        this.exploreCategoryFilter = 'all';

        // Tab switching
        document.querySelectorAll('.title-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.title-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.title-tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.titleTab;
                document.getElementById('tab-' + tab).classList.add('active');
                if (tab === 'explore') this.renderExploreGrid();
            });
        });

        // Category filters
        document.querySelectorAll('.explore-cat-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.explore-cat-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.exploreCategoryFilter = btn.dataset.exploreCat;
                this.renderExploreGrid();
            });
        });

        // Explore search
        const exploreSearch = document.getElementById('explore-search');
        if (exploreSearch) {
            exploreSearch.addEventListener('input', () => this.renderExploreGrid());
            exploreSearch.addEventListener('keydown', (e) => e.stopPropagation());
        }

        // Sign out button
        document.getElementById('btn-sign-out').addEventListener('click', () => this.handleSignOut());
    }


    async renderExploreGrid() {
        const communityGrid = document.getElementById('explore-community-grid');
        const communitySection = document.getElementById('explore-community-section');
        const emptyEl = document.getElementById('explore-empty');
        const query = (document.getElementById('explore-search').value || '').trim().toLowerCase();
        const filter = this.exploreCategoryFilter;
        const currentUser = this._cachedUser?.displayName || '';

        communityGrid.innerHTML = '';

        // Get community projects from server
        let projects = [];
        try {
            const res = await fetch('/api/projects');
            if (res.ok) {
                projects = await res.json();
            }
        } catch (e) { /* offline */ }

        if (filter === 'my-shared') {
            projects = projects.filter(p => p.creator && p.creator === currentUser);
        } else if (filter === 'games') {
            projects = projects.filter(p => (p.tags || []).includes('Games'));
        } else if (filter === 'art') {
            projects = projects.filter(p => (p.tags || []).includes('Art'));
        }
        if (query) {
            projects = projects.filter(p =>
                (p.name || '').toLowerCase().includes(query) ||
                (p.description || '').toLowerCase().includes(query) ||
                (p.creator || '').toLowerCase().includes(query)
            );
        }

        // Render projects
        if (projects.length > 0) {
            communitySection.style.display = '';
            projects.forEach(proj => {
                communityGrid.appendChild(this.createExploreCard(proj, false));
            });
        } else {
            communitySection.style.display = 'none';
        }

        // Show empty state
        if (projects.length === 0) {
            emptyEl.style.display = '';
        } else {
            emptyEl.style.display = 'none';
        }
    }

    createExploreCard(project, isFeatured) {
        const card = document.createElement('div');
        card.className = 'explore-card';
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => this.openProjectPage(project));

        const thumb = document.createElement('div');
        thumb.className = 'explore-card-thumb';
        if (project.thumbnail) {
            const img = document.createElement('img');
            img.src = project.thumbnail;
            img.alt = project.name;
            img.style.cssText = 'width:100%;height:100%;object-fit:cover';
            thumb.appendChild(img);
        } else {
            const icon = document.createElement('span');
            icon.className = 'material-icons-round';
            icon.style.cssText = 'font-size:48px;color:var(--bg-lighter);opacity:0.5';
            icon.textContent = 'view_in_ar';
            thumb.appendChild(icon);
        }

        const info = document.createElement('div');
        info.className = 'explore-card-info';

        const nameEl = document.createElement('div');
        nameEl.className = 'explore-card-name';
        nameEl.textContent = project.name || 'Untitled';

        const creatorEl = document.createElement('div');
        creatorEl.className = 'explore-card-creator';
        const creatorName = project.creator || 'Unknown';

        // Creator avatar
        if (project.creatorAvatarUrl) {
            const avatarImg = document.createElement('img');
            avatarImg.src = project.creatorAvatarUrl;
            avatarImg.alt = creatorName;
            avatarImg.style.cssText = 'width:16px;height:16px;border-radius:50%;object-fit:cover;vertical-align:middle;margin-right:4px';
            creatorEl.appendChild(avatarImg);
        }

        creatorEl.appendChild(document.createTextNode('by '));
        const creatorLink = document.createElement('span');
        creatorLink.className = 'clickable-username';
        creatorLink.textContent = creatorName;
        creatorLink.addEventListener('click', (e) => {
            e.stopPropagation();
            this.openProfilePage(creatorName);
        });
        creatorEl.appendChild(creatorLink);

        const descEl = document.createElement('div');
        descEl.className = 'explore-card-desc';
        descEl.textContent = project.description || '';

        info.appendChild(nameEl);
        info.appendChild(creatorEl);
        if (project.description) info.appendChild(descEl);

        card.appendChild(thumb);
        card.appendChild(info);
        return card;
    }

    async openExploreCopy(project) {
        let data = project.projectData;

        // If no projectData inline, fetch from server
        if (!data && project.id) {
            try {
                const res = await fetch('/api/projects/' + project.id);
                if (res.ok) {
                    const full = await res.json();
                    data = full.projectData;
                }
            } catch (e) { /* offline */ }
        }

        if (!data) {
            this.toast('Project data not available', 'error');
            return;
        }

        const id = this.generateProjectId();
        const now = Date.now();
        const name = (project.name || 'Untitled') + ' (Remix)';
        const projectData = JSON.parse(JSON.stringify(data));
        projectData.name = name;

        this.saveProjectData(id, projectData);
        const index = this.getProjectIndex();
        index[id] = {
            name: name,
            createdAt: now,
            modifiedAt: now,
            thumbnail: null
        };
        this.saveProjectIndex(index);

        // Load it
        this.loadProjectById(id);
        this.toast('Opened remix: ' + name, 'success');
    }

    // ===== Publish / Share =====

    initPublish() {
        const modal = document.getElementById('publish-modal');

        document.getElementById('publish-cancel').addEventListener('click', () => {
            modal.classList.add('hidden');
        });

        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        document.getElementById('publish-submit').addEventListener('click', () => {
            this.publishProject();
        });

        document.getElementById('publish-unpublish').addEventListener('click', () => {
            this.unpublishProject();
            modal.classList.add('hidden');
        });

        document.getElementById('publish-copy-link').addEventListener('click', () => {
            const input = document.getElementById('publish-link-input');
            navigator.clipboard.writeText(input.value).then(() => {
                this.toast('Link copied!', 'success');
            }).catch(() => {
                input.select();
                document.execCommand('copy');
                this.toast('Link copied!', 'success');
            });
        });

        // Stop keyboard propagation
        document.querySelectorAll('#publish-modal input, #publish-modal textarea').forEach(el => {
            el.addEventListener('keydown', (e) => e.stopPropagation());
        });
    }

    async showPublishModal() {
        if (!this.currentProjectId) {
            this.toast('Save a project first', 'error');
            return;
        }

        const modal = document.getElementById('publish-modal');
        const titleInput = document.getElementById('publish-title');
        const descInput = document.getElementById('publish-description');
        const shareLinkEl = document.getElementById('publish-share-link');
        const unpublishBtn = document.getElementById('publish-unpublish');

        titleInput.value = this.projectName || '';
        descInput.value = '';

        // Reset tags
        document.querySelectorAll('.publish-tag-checkbox input').forEach(cb => cb.checked = false);

        // Check if already published on server
        let isPublished = false;
        try {
            const res = await fetch('/api/projects/check/' + this.currentProjectId);
            if (res.ok) {
                const info = await res.json();
                isPublished = info.published;
                if (isPublished) {
                    descInput.value = info.description || '';
                    (info.tags || []).forEach(tag => {
                        const cb = document.querySelector(`.publish-tag-checkbox input[value="${tag}"]`);
                        if (cb) cb.checked = true;
                    });
                }
            }
        } catch (e) { /* offline */ }

        if (isPublished) {
            shareLinkEl.classList.add('visible');
            unpublishBtn.classList.remove('hidden');
            this._generateShareLink();
        } else {
            shareLinkEl.classList.remove('visible');
            unpublishBtn.classList.add('hidden');
        }

        modal.classList.remove('hidden');
    }

    async publishProject() {
        const title = document.getElementById('publish-title').value.trim();
        const description = document.getElementById('publish-description').value.trim();
        const tags = [];
        document.querySelectorAll('.publish-tag-checkbox input:checked').forEach(cb => tags.push(cb.value));

        if (!title) {
            this.toast('Please enter a title', 'error');
            return;
        }

        const projectData = this._gatherProjectData();

        try {
            const res = await fetch('/api/projects', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: this.currentProjectId,
                    name: title,
                    description,
                    tags,
                    thumbnail: null,
                    projectData
                })
            });
            if (!res.ok) {
                const err = await res.json();
                this.toast(err.error || 'Failed to publish', 'error');
                return;
            }
        } catch (e) {
            this.toast('Connection error', 'error');
            return;
        }

        // Mark in local project index with publish metadata
        const index = this.getProjectIndex();
        if (index[this.currentProjectId]) {
            index[this.currentProjectId].shared = true;
            index[this.currentProjectId].description = description;
            index[this.currentProjectId].tags = tags;
            this.saveProjectIndex(index);
        }

        // Show share link
        this._generateShareLink();
        document.getElementById('publish-share-link').classList.add('visible');
        document.getElementById('publish-unpublish').classList.remove('hidden');

        this.toast('Project published!', 'success');
    }

    async unpublishProject() {
        if (!this.currentProjectId) return;

        try {
            await fetch('/api/projects/' + this.currentProjectId, { method: 'DELETE' });
        } catch (e) { /* ok */ }

        const index = this.getProjectIndex();
        if (index[this.currentProjectId]) {
            delete index[this.currentProjectId].shared;
            this.saveProjectIndex(index);
        }

        this.toast('Project unpublished', 'success');
    }

    _generateShareLink() {
        try {
            const data = this._gatherProjectData();
            const json = JSON.stringify(data);
            const encoded = btoa(unescape(encodeURIComponent(json)));
            const url = window.location.origin + window.location.pathname + '#project=' + encoded;
            document.getElementById('publish-link-input').value = url;
        } catch (e) {
            document.getElementById('publish-link-input').value = 'Project too large for link sharing';
        }
    }

    // ===== Project Page (Scratch-style) =====

    async openProjectPage(project) {
        // Hide profile page if open
        document.getElementById('profile-page').classList.add('hidden');

        this._ppProject = project;
        this._ppProjectId = project.id;

        // Fetch full project data
        let data = project.projectData;
        if (!data && project.id) {
            try {
                const res = await fetch('/api/projects/' + project.id);
                if (res.ok) {
                    const full = await res.json();
                    data = full.projectData;
                    this._ppProject = full;
                    project = full;
                }
            } catch (e) { /* offline */ }
        }

        if (!data) {
            this.toast('Project data not available', 'error');
            return;
        }

        this._ppProjectData = data;

        // Populate metadata
        document.getElementById('pp-title').textContent = project.name || 'Untitled';
        const ppCreatorEl = document.getElementById('pp-creator');
        ppCreatorEl.textContent = 'by ' + (project.creator || 'Unknown');
        ppCreatorEl.style.cursor = 'pointer';
        ppCreatorEl.onclick = () => this.openProfilePage(project.creator || 'Unknown');
        document.getElementById('pp-description').textContent = project.description || 'No description provided.';
        document.getElementById('pp-creator-name').textContent = project.creator || 'Unknown';

        // Creator avatar
        const avatarEl = document.getElementById('pp-creator-avatar');
        const creatorName = project.creator || 'U';
        if (project.creatorAvatarUrl) {
            avatarEl.innerHTML = `<img src="${project.creatorAvatarUrl}" alt="${this._escHtml(creatorName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
        } else {
            avatarEl.innerHTML = '';
            avatarEl.textContent = creatorName.charAt(0).toUpperCase();
        }
        if (project.creatorAvatarColor) avatarEl.style.background = project.creatorAvatarColor;

        // Tags
        const tags = project.tags || (this._ppProject.tags) || [];
        const tagsSection = document.getElementById('pp-tags-section');
        const tagsContainer = document.getElementById('pp-tags');
        tagsContainer.innerHTML = '';
        if (tags.length > 0) {
            tagsSection.classList.add('has-tags');
            tags.forEach(tag => {
                const el = document.createElement('span');
                el.className = 'pp-tag';
                el.textContent = tag;
                tagsContainer.appendChild(el);
            });
        } else {
            tagsSection.classList.remove('has-tags');
        }

        // Show page
        document.getElementById('project-page').classList.remove('hidden');

        // Wire buttons FIRST so back always works even if viewer init fails
        document.getElementById('pp-back').onclick = () => this.closeProjectPage();
        document.getElementById('pp-btn-play').onclick = () => this._ppStartPlay();
        document.getElementById('pp-btn-stop').onclick = () => this._ppStopPlay();
        document.getElementById('pp-btn-fullscreen').onclick = () => this._ppToggleFullscreen();
        document.getElementById('pp-exit-fullscreen').onclick = () => this._ppToggleFullscreen();
        document.getElementById('pp-remix-btn').onclick = () => this._ppRemix();
        document.getElementById('pp-report-btn').onclick = () => this._ppReport();
        const creatorCard = document.querySelector('.pp-creator-card');
        if (creatorCard) {
            creatorCard.style.cursor = 'pointer';
            creatorCard.onclick = () => this.openProfilePage(project.creator || 'Unknown');
        }
        this._initEmojiChat();

        // Init viewer scene (wrapped in try-catch so page stays navigable)
        try {
            this._initViewerScene();
            this._loadProjectIntoViewer(data);
        } catch (e) {
            console.error('Failed to init viewer:', e);
        }
    }

    _initViewerScene() {
        // Clean up previous viewer if any
        if (this._ppScene3d) {
            this._ppScene3d.dispose();
            this._ppScene3d = null;
        }
        if (this._ppRuntime) {
            if (this._ppRuntime.isRunning) this._ppRuntime.stop();
            this._ppRuntime = null;
        }

        const canvas = document.getElementById('pp-canvas');

        // Create viewer-mode Scene3D
        this._ppScene3d = new Scene3D(canvas, { viewerMode: true });

        // Create a minimal blockCode that can compile scripts using real block definitions
        const blockDefs = BlockCode.prototype.defineBlocks.call({});
        this._ppBlockCode = {
            customVariables: [],
            customMessages: [],
            blocks: blockDefs,
            compileScripts: BlockCode.prototype.compileScripts,
            _compileBlock: BlockCode.prototype._compileBlock
        };

        // Create runtime with domMap pointing to viewer DOM
        this._ppRuntime = new Runtime(this._ppScene3d, this._ppBlockCode, {
            crosshair: document.getElementById('pp-crosshair'),
            playOverlay: document.getElementById('pp-play-overlay'),
            btnPlay: document.getElementById('pp-btn-play'),
            btnStop: document.getElementById('pp-btn-stop'),
            statusMode: null,
            gameHud: document.getElementById('pp-game-hud')
        });

        this._ppRuntime.onStop = () => {
            document.getElementById('pp-btn-play').classList.remove('active');
            document.getElementById('pp-btn-stop').classList.remove('active');
        };
    }

    _loadProjectIntoViewer(data) {
        if (!this._ppScene3d) return;

        // Deserialize scene objects
        if (data.scene) {
            this._ppScene3d.deserialize(data.scene);
        }

        // Apply environment settings
        if (data.environment) {
            const env = data.environment;
            if (env.skyColor) this._ppScene3d.setSkyColor(env.skyColor);
            if (env.skybox) this._ppScene3d.setSkybox(env.skybox);
            if (env.ambientLight) this._ppScene3d.setAmbientIntensity(env.ambientLight / 100);
            if (env.fogDensity) this._ppScene3d.setFog(parseInt(env.fogDensity));
            if (env.shadows !== undefined) this._ppScene3d.setShadows(env.shadows);
            if (env.weather) this._ppScene3d.setWeather(env.weather);
        }

        // Store game settings for play mode
        const env = data.environment || {};
        this._ppGameSettings = {
            controlScheme: env.controlScheme || 'first-person',
            speed: env.speed || 6,
            jumpForce: env.jumpForce || 8,
            sensitivity: env.sensitivity || 5,
            keyBindings: env.keyBindings || {
                moveForward: 'KeyW',
                moveBack: 'KeyS',
                moveLeft: 'KeyA',
                moveRight: 'KeyD',
                lookUp: 'ArrowUp',
                lookDown: 'ArrowDown',
                lookLeft: 'ArrowLeft',
                lookRight: 'ArrowRight',
                jump: 'Space'
            },
            playerColors: env.playerColors || { body: '#4c97ff', head: '#f5cba7', detail: '#e0b090' },
            bgMusic: env.bgMusic || 'none',
            musicVolume: env.musicVolume || 30
        };

        // Store custom variables/messages for the blockcode stub
        if (data.customVariables) this._ppBlockCode.customVariables = data.customVariables;
        if (data.customMessages) this._ppBlockCode.customMessages = data.customMessages;
        if (data.uiScreens) this._ppRuntime._uiScreens = data.uiScreens;

        // Force a render
        this._ppScene3d._needsRender = true;

        // Resize after showing
        setTimeout(() => this._ppScene3d.onResize(), 100);
    }

    _ppStartPlay() {
        if (!this._ppRuntime || this._ppRuntime.isRunning) return;
        this._ppRuntime.playerColors = this._ppGameSettings.playerColors;
        this._ppRuntime._uiScreens = this._ppRuntime._uiScreens || [];
        this._ppRuntime.start(this._ppGameSettings);
        document.getElementById('pp-btn-play').classList.add('active');
        document.getElementById('pp-btn-stop').classList.add('active');
    }

    _ppStopPlay() {
        if (!this._ppRuntime || !this._ppRuntime.isRunning) return;
        this._ppRuntime.stop();
        document.getElementById('pp-btn-play').classList.remove('active');
        document.getElementById('pp-btn-stop').classList.remove('active');
    }

    _ppToggleFullscreen() {
        const container = document.getElementById('pp-viewport-container');
        const icon = document.querySelector('#pp-btn-fullscreen .material-icons-round');
        const exitBtn = document.getElementById('pp-exit-fullscreen');

        if (container.classList.contains('pp-fullscreen')) {
            container.classList.remove('pp-fullscreen');
            icon.textContent = 'fullscreen';
            if (exitBtn) exitBtn.classList.add('hidden');
        } else {
            container.classList.add('pp-fullscreen');
            icon.textContent = 'fullscreen_exit';
            if (exitBtn) exitBtn.classList.remove('hidden');
        }

        setTimeout(() => {
            if (this._ppScene3d) this._ppScene3d.onResize();
        }, 50);
    }

    _ppRemix() {
        if (!this._ppProjectData) return;
        this.closeProjectPage();

        const id = this.generateProjectId();
        const now = Date.now();
        const name = (this._ppProject.name || 'Untitled') + ' (Remix)';
        const projectData = JSON.parse(JSON.stringify(this._ppProjectData));
        projectData.name = name;

        this.saveProjectData(id, projectData);
        const index = this.getProjectIndex();
        index[id] = {
            name: name,
            createdAt: now,
            modifiedAt: now,
            thumbnail: null
        };
        this.saveProjectIndex(index);

        this.loadProjectById(id);
        this.toast('Opened remix: ' + name, 'success');
    }

    closeProjectPage() {
        // Stop viewer runtime
        if (this._ppRuntime && this._ppRuntime.isRunning) {
            this._ppRuntime.stop();
        }

        // Exit fullscreen
        const container = document.getElementById('pp-viewport-container');
        if (container) container.classList.remove('pp-fullscreen');
        const exitBtn = document.getElementById('pp-exit-fullscreen');
        if (exitBtn) exitBtn.classList.add('hidden');

        // Dispose viewer
        if (this._ppScene3d) {
            this._ppScene3d.dispose();
            this._ppScene3d = null;
        }
        this._ppRuntime = null;
        this._ppBlockCode = null;
        this._ppProjectData = null;

        // Clear emoji chat
        if (this._emojiPollTimer) { clearInterval(this._emojiPollTimer); this._emojiPollTimer = null; }
        const emojiFeed = document.getElementById('pp-emoji-feed');
        if (emojiFeed) emojiFeed.innerHTML = '';

        // Hide page
        document.getElementById('project-page').classList.add('hidden');

    }

    // ===== Profile Page =====

    async openProfilePage(username) {
        if (this._offlineMode) {
            this.toast('Sign in to view profiles', 'error');
            return;
        }
        try {
            const res = await fetch('/api/users/' + encodeURIComponent(username));
            if (!res.ok) {
                this.toast('User not found', 'error');
                return;
            }
            const user = await res.json();

            // Populate banner
            document.getElementById('prof-display-name').textContent = user.displayName;
            document.getElementById('prof-username').textContent = '@' + user.username;
            document.getElementById('prof-project-count').textContent = user.projectCount;

            // Member since
            const d = new Date(Number(user.createdAt));
            const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
            document.getElementById('prof-member-since').textContent = 'Member since ' + months[d.getMonth()] + ' ' + d.getFullYear();

            // Avatar
            const avatarEl = document.getElementById('prof-avatar');
            avatarEl.innerHTML = '';
            if (user.avatarUrl) {
                const img = document.createElement('img');
                img.src = user.avatarUrl;
                img.alt = user.displayName;
                avatarEl.appendChild(img);
            } else {
                avatarEl.textContent = (user.displayName || 'U').charAt(0).toUpperCase();
            }
            avatarEl.style.background = user.avatarColor || 'var(--accent)';

            // Project grid
            const grid = document.getElementById('prof-project-grid');
            const empty = document.getElementById('prof-empty');
            grid.innerHTML = '';
            if (user.projects.length > 0) {
                empty.classList.add('hidden');
                user.projects.forEach(proj => {
                    grid.appendChild(this.createExploreCard(proj, false));
                });
            } else {
                empty.classList.remove('hidden');
            }

            // Show page
            document.getElementById('profile-page').classList.remove('hidden');
            document.getElementById('prof-back').onclick = () => this.closeProfilePage();
        } catch (e) {
            this.toast('Failed to load profile', 'error');
        }
    }

    closeProfilePage() {
        document.getElementById('profile-page').classList.add('hidden');
        document.getElementById('prof-project-grid').innerHTML = '';
    }

    // ===== Emoji Chat =====

    _initEmojiChat() {
        const picker = document.getElementById('pp-emoji-picker');
        const emojis = ['👍','❤️','🔥','⭐','😂','😮','🎮','🎨','💎','🏆','👏','🚀','💯','🤩','😎','👾'];
        this._emojiDraft = '';
        picker.innerHTML = '';

        // Compose area: preview + send button
        const compose = document.createElement('div');
        compose.className = 'pp-emoji-compose';
        const preview = document.createElement('span');
        preview.className = 'pp-emoji-compose-preview';
        preview.id = 'pp-emoji-preview';
        preview.textContent = '';
        const sendBtn = document.createElement('button');
        sendBtn.className = 'pp-emoji-send-btn';
        sendBtn.textContent = 'Send';
        sendBtn.onclick = () => this._sendEmojiDraft();
        const clearBtn = document.createElement('button');
        clearBtn.className = 'pp-emoji-clear-btn';
        clearBtn.textContent = '✕';
        clearBtn.title = 'Clear';
        clearBtn.onclick = () => { this._emojiDraft = ''; preview.textContent = ''; };
        compose.appendChild(preview);
        compose.appendChild(clearBtn);
        compose.appendChild(sendBtn);
        picker.appendChild(compose);

        // Emoji grid
        const grid = document.createElement('div');
        grid.className = 'pp-emoji-grid';
        emojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'pp-emoji-btn';
            btn.textContent = emoji;
            btn.onclick = () => {
                if ([...this._emojiDraft].length >= 15) return;
                this._emojiDraft += emoji;
                preview.textContent = this._emojiDraft;
            };
            grid.appendChild(btn);
        });
        picker.appendChild(grid);

        this._loadEmojiChat();
        // Auto-poll every 5 seconds
        this._emojiPollTimer = setInterval(() => this._loadEmojiChat(), 5000);
    }

    async _loadEmojiChat() {
        const feed = document.getElementById('pp-emoji-feed');
        if (!this._ppProject?.id) return;
        try {
            const res = await fetch(`/api/projects/${this._ppProject.id}/emojis`);
            if (!res.ok) return;
            const messages = await res.json();
            feed.innerHTML = '';
            if (messages.length === 0) {
                feed.innerHTML = '<div class="pp-emoji-feed-empty">No messages yet</div>';
            } else {
                messages.forEach(msg => feed.appendChild(this._createEmojiMsg(msg)));
            }
        } catch {}
    }

    async _sendEmojiDraft() {
        if (!this._emojiDraft) return;
        if (!this._ppProject?.id) return;
        if (this._offlineMode) {
            this.toast('Sign in to chat', 'error');
            return;
        }
        const emoji = this._emojiDraft;
        this._emojiDraft = '';
        document.getElementById('pp-emoji-preview').textContent = '';
        try {
            const res = await fetch(`/api/projects/${this._ppProject.id}/emojis`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ emoji })
            });
            const data = await res.json();
            if (res.ok) {
                const feed = document.getElementById('pp-emoji-feed');
                const empty = feed.querySelector('.pp-emoji-feed-empty');
                if (empty) empty.remove();
                feed.prepend(this._createEmojiMsg(data));
            } else {
                this.toast(data.error || 'Failed to send', 'error');
            }
        } catch {
            this.toast('Failed to send', 'error');
        }
    }

    _createEmojiMsg(msg) {
        const el = document.createElement('div');
        el.className = 'pp-emoji-msg';
        const name = document.createElement('span');
        name.className = 'pp-emoji-msg-name clickable-username';
        name.textContent = msg.username || 'Anonymous';
        name.addEventListener('click', () => {
            if (msg.username) this.openProfilePage(msg.username);
        });
        const emoji = document.createElement('span');
        emoji.className = 'pp-emoji-msg-emoji';
        emoji.textContent = msg.emoji;
        el.appendChild(name);
        el.appendChild(emoji);
        return el;
    }

    // ===== Report Project =====

    async _ppReport() {
        if (!this._ppProject || !this._ppProject.id) return;
        if (this._offlineMode) {
            this.toast('Sign in to report projects', 'error');
            return;
        }

        const confirmed = await this.showConfirm(
            'Report Project',
            'Report this project for inappropriate content? This will be reviewed by a moderator.',
            'Report',
            'danger'
        );
        if (!confirmed) return;

        try {
            const res = await fetch(`/api/projects/${this._ppProject.id}/report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Inappropriate content' })
            });
            const data = await res.json();
            if (res.ok) {
                this.toast('Project reported');
            } else {
                this.toast(data.error || 'Failed to report', 'error');
            }
        } catch {
            this.toast('Failed to report project', 'error');
        }
    }

    // ===== Admin Inbox =====

    async _fetchReportCount() {
        try {
            const res = await fetch('/api/reports');
            if (!res.ok) return 0;
            const reports = await res.json();
            return reports.length;
        } catch { return 0; }
    }

    async _updateInboxBadge() {
        const btn = document.getElementById('btn-admin-inbox');
        const badge = document.getElementById('admin-inbox-badge');
        if (!btn || !this._cachedUser?.isAdmin) return;

        const count = await this._fetchReportCount();
        if (count > 0) {
            badge.textContent = count;
            badge.classList.remove('hidden');
        } else {
            badge.classList.add('hidden');
        }
    }

    async _openAdminInbox() {
        // Fetch reports
        let reports;
        try {
            const res = await fetch('/api/reports');
            if (!res.ok) { this.toast('Failed to load reports', 'error'); return; }
            reports = await res.json();
        } catch { this.toast('Failed to load reports', 'error'); return; }

        // Build modal
        const overlay = document.createElement('div');
        overlay.className = 'inbox-modal-overlay';

        const timeAgo = (ts) => {
            const diff = Date.now() - ts;
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            return Math.floor(hrs / 24) + 'd ago';
        };

        let reportsHtml = '';
        if (reports.length === 0) {
            reportsHtml = '<div class="inbox-empty"><span class="material-icons-round" style="font-size:36px;display:block;margin-bottom:8px">check_circle</span>No reports</div>';
        } else {
            reports.forEach(r => {
                reportsHtml += `
                <div class="inbox-report" data-report-id="${r.id}">
                    <div class="inbox-report-header">
                        <span class="inbox-report-project">${this._escHtml(r.project_name || '(deleted project)')}</span>
                        <span class="inbox-report-time">${timeAgo(Number(r.created_at))}</span>
                    </div>
                    <div class="inbox-report-meta">Reported by <strong>${this._escHtml(r.reporter_name || 'Unknown')}</strong> · Creator: ${this._escHtml(r.project_creator || 'Unknown')}</div>
                    <div class="inbox-report-reason">${this._escHtml(r.reason)}</div>
                    <div class="inbox-report-actions">
                        <button class="inbox-dismiss-btn" data-action="dismiss" data-id="${r.id}">Dismiss</button>
                        <button class="inbox-delete-btn" data-action="delete-project" data-id="${r.id}">Delete Project</button>
                    </div>
                </div>`;
            });
        }

        overlay.innerHTML = `
        <div class="inbox-modal">
            <div class="inbox-modal-header">
                <span class="material-icons-round">inbox</span>
                <span>Report Inbox</span>
                <button class="inbox-modal-close"><span class="material-icons-round">close</span></button>
            </div>
            <div class="inbox-modal-body">${reportsHtml}</div>
        </div>`;

        document.body.appendChild(overlay);

        // Close
        overlay.querySelector('.inbox-modal-close').onclick = () => overlay.remove();
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Actions
        overlay.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-action]');
            if (!btn) return;
            const action = btn.dataset.action;
            const reportId = btn.dataset.id;

            if (action === 'dismiss') {
                try {
                    const res = await fetch(`/api/reports/${reportId}`, { method: 'DELETE' });
                    if (res.ok) {
                        btn.closest('.inbox-report').remove();
                        this._updateInboxBadge();
                        if (!overlay.querySelector('.inbox-report')) {
                            overlay.querySelector('.inbox-modal-body').innerHTML = '<div class="inbox-empty"><span class="material-icons-round" style="font-size:36px;display:block;margin-bottom:8px">check_circle</span>No reports</div>';
                        }
                    }
                } catch {}
            } else if (action === 'delete-project') {
                const confirmed = await this.showConfirm('Delete Project', 'Permanently delete this project and all related reports?', 'Delete', 'danger');
                if (!confirmed) return;
                try {
                    const res = await fetch(`/api/reports/${reportId}/project`, { method: 'DELETE' });
                    if (res.ok) {
                        // Remove all reports for same project
                        overlay.querySelectorAll('.inbox-report').forEach(el => {
                            // just remove the one we acted on; the rest will refresh
                        });
                        btn.closest('.inbox-report').remove();
                        this._updateInboxBadge();
                        this.toast('Project deleted');
                        if (!overlay.querySelector('.inbox-report')) {
                            overlay.querySelector('.inbox-modal-body').innerHTML = '<div class="inbox-empty"><span class="material-icons-round" style="font-size:36px;display:block;margin-bottom:8px">check_circle</span>No reports</div>';
                        }
                    }
                } catch {}
            }
        });
    }

    _escHtml(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    // ===== Collaboration (Multiplayer Party) =====

    _collabGuest() {
        return this._collabRoom && !this._collabIsHost;
    }

    // --- Collab vote system (play/stop/share) ---

    _collabStartVote(action) {
        if (this._collabVotePending) {
            this.toast('A vote is already in progress');
            return;
        }
        const userName = this._cachedUser?.displayName || 'Someone';
        this._collabVotePending = action;
        this._collabVoteAccepted = 1; // requester auto-accepts
        this._collabVoteTotal = this._collabMembers.length;
        this._collabVoteDeclined = false;

        this._collabSend({
            type: 'vote-request',
            action: action,
            requester: userName
        });

        const labels = { play: 'Play', stop: 'Stop', share: 'Share' };
        this.toast('Waiting for others to agree to ' + labels[action] + '...');
    }

    async _handleVoteRequest(msg) {
        const labels = { play: 'Play', stop: 'Stop', share: 'Share' };
        const label = labels[msg.action] || msg.action;
        const accepted = await this.showConfirm(
            label + ' Request',
            msg.requester + ' wants to ' + label.toLowerCase() + '. Ready?',
            'Ready',
            'primary'
        );
        this._collabSend({
            type: 'vote-response',
            action: msg.action,
            accepted: !!accepted
        });
    }

    _handleVoteResponse(msg) {
        if (!this._collabVotePending || this._collabVotePending !== msg.action) return;
        if (msg.accepted) {
            this._collabVoteAccepted++;
        } else {
            this._collabVoteDeclined = true;
        }

        // Check if all votes are in
        const votesIn = this._collabVoteAccepted + (this._collabVoteDeclined ? 1 : 0);
        if (this._collabVoteDeclined) {
            const labels = { play: 'Play', stop: 'Stop', share: 'Share' };
            this.toast(labels[msg.action] + ' was declined');
            this._collabSend({ type: 'vote-failed', action: msg.action });
            this._collabVotePending = null;
        } else if (this._collabVoteAccepted >= this._collabVoteTotal) {
            this._collabSend({ type: 'vote-passed', action: msg.action });
            this._collabExecuteAction(msg.action);
            this._collabVotePending = null;
        }
    }

    _collabExecuteAction(action) {
        switch (action) {
            case 'play':
                this._doStartPlay();
                break;
            case 'stop':
                this._doStopPlay();
                break;
            case 'share':
                this.showPublishModal();
                break;
        }
    }

    initCollab() {
        const partyBtn = document.getElementById('btn-party');
        partyBtn.addEventListener('click', () => this.showCollabModal());

        document.getElementById('collab-close').addEventListener('click', () => {
            document.getElementById('collab-modal').classList.add('hidden');
        });
        document.getElementById('collab-modal').addEventListener('click', (e) => {
            if (e.target.classList.contains('modal-overlay')) {
                document.getElementById('collab-modal').classList.add('hidden');
            }
        });

        document.getElementById('collab-create-btn').addEventListener('click', () => this.collabCreateRoom());
        document.getElementById('collab-join-btn').addEventListener('click', () => {
            const code = document.getElementById('collab-code-input').value.trim();
            if (code.length >= 4) this.collabJoinRoom(code);
        });
        document.getElementById('collab-code-input').addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                const code = e.target.value.trim();
                if (code.length >= 4) this.collabJoinRoom(code);
            }
        });
        document.getElementById('collab-leave-btn').addEventListener('click', () => this.collabLeave());
    }

    showCollabModal() {
        const modal = document.getElementById('collab-modal');
        modal.classList.remove('hidden');
        this._updateCollabUI();
    }

    _collabConnect() {
        return new Promise((resolve, reject) => {
            if (this._collabWs && this._collabWs.readyState === WebSocket.OPEN) {
                resolve(this._collabWs);
                return;
            }
            const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
            const ws = new WebSocket(`${proto}//${location.host}`);
            ws.onopen = () => {
                this._collabWs = ws;
                resolve(ws);
            };
            ws.onerror = () => {
                reject(new Error('WebSocket connection failed'));
            };
            ws.onclose = () => {
                if (this._collabRoom) {
                    this.toast('Disconnected from room');
                    this._collabCleanup();
                }
            };
            ws.onmessage = (e) => {
                try {
                    const msg = JSON.parse(e.data);
                    this._handleCollabMessage(msg);
                } catch {}
            };
        });
    }

    _collabCleanup() {
        this._collabRoom = null;
        this._collabIsHost = false;
        this._collabMembers = [];
        this._collabBroadcastPaused = false;

        // Unhook broadcasts
        this.scene3d.onObjectAdded = null;
        this.scene3d.onObjectRemoved = null;
        this.blockCode.onScriptsChanged = null;

        // Re-enable save button
        document.getElementById('btn-save').classList.remove('guest-disabled');

        // Update UI
        document.getElementById('btn-party').classList.remove('in-room');
        document.getElementById('collab-presence-bar').classList.add('hidden');
        this._updateCollabUI();
    }

    _collabSend(msg) {
        if (this._collabWs && this._collabWs.readyState === WebSocket.OPEN) {
            this._collabWs.send(JSON.stringify(msg));
        }
    }

    async collabCreateRoom() {
        if (this._offlineMode) {
            this.toast('Sign in to use multiplayer');
            return;
        }
        if (!this.currentProjectId) {
            this.toast('Open a project first');
            return;
        }
        if (this._collabRoom) {
            this.toast('Already in a room — leave first');
            return;
        }
        try {
            await this._collabConnect();
            this._collabSend({ type: 'create-room', projectName: this.projectName });
        } catch {
            this.toast('Connection failed — are you signed in?');
        }
    }

    async collabJoinRoom(code) {
        if (this._offlineMode) {
            this.toast('Sign in to use multiplayer');
            return;
        }
        if (this._collabRoom) {
            this.toast('Already in a room — leave first');
            return;
        }
        try {
            await this._collabConnect();
            this._collabSend({ type: 'join-room', roomCode: code });
        } catch {
            this.toast('Connection failed — are you signed in?');
        }
    }

    collabLeave() {
        this._collabSend({ type: 'leave-room' });
        if (this._collabWs) {
            this._collabWs.close();
            this._collabWs = null;
        }
        this._collabCleanup();
        this.toast('Left the room');
    }

    async joinPartyFromTitle() {
        if (this._offlineMode) {
            this.toast('Sign in to use multiplayer');
            return;
        }
        const code = await this.showPrompt('Join Party', 'Enter the 6-character room code:', '');
        if (!code || code.trim().length < 4) return;

        // Create a temporary project so the editor is ready to receive scene data
        const id = this.generateProjectId();
        this.currentProjectId = id;
        this.projectName = 'Party Session';
        this.hasUnsavedChanges = false;
        this.scene3d.deserialize([]); // clear scene
        this.hideTitleScreen();
        this.updateToolbarProjectName();
        this.refreshExplorer();
        this.updateObjectCount();

        // Now join the room — the host will send scene state
        this.collabJoinRoom(code.trim());
    }

    _handleCollabMessage(msg) {
        switch (msg.type) {
            case 'room-created': {
                this._collabRoom = msg.roomCode;
                this._collabIsHost = true;
                this._collabMembers = msg.members || [];
                this._hookCollabBroadcasts();
                document.getElementById('btn-party').classList.add('in-room');
                this._updateCollabUI();
                this._updatePresenceBar();
                this.showCollabModal();
                this.toast('Room created: ' + msg.roomCode, 'success');
                break;
            }
            case 'room-joined': {
                this._collabRoom = msg.roomCode;
                this._collabIsHost = false;
                this._collabMembers = msg.members || [];
                this._hookCollabBroadcasts();

                // Disable save for guests
                document.getElementById('btn-save').classList.add('guest-disabled');
                document.getElementById('btn-party').classList.add('in-room');
                this._updateCollabUI();
                this._updatePresenceBar();
                this.showCollabModal();
                this.toast('Joined room: ' + msg.roomCode, 'success');
                break;
            }
            case 'request-state': {
                // Host: send full scene to new joiner
                if (this._collabIsHost) {
                    const data = this._gatherProjectData();
                    this._collabSend({
                        type: 'room-state',
                        targetUserId: msg.userId,
                        projectData: data
                    });
                }
                break;
            }
            case 'room-state': {
                // Guest: receive full scene from host
                if (msg.projectData) {
                    this._collabBroadcastPaused = true;
                    this._applyProjectData(msg.projectData);
                    this.projectName = msg.projectData.name || this.projectName;
                    this.updateToolbarProjectName();
                    this.refreshExplorer();
                    this.updateObjectCount();
                    this._collabBroadcastPaused = false;
                    this.toast('Scene synced from host', 'success');
                }
                break;
            }
            case 'member-joined': {
                this._collabMembers = msg.members || [];
                this._updateCollabUI();
                this._updatePresenceBar();
                this.toast(msg.displayName + ' joined', 'success');
                break;
            }
            case 'member-left': {
                this._collabMembers = msg.members || [];
                this._updateCollabUI();
                this._updatePresenceBar();
                this.toast(msg.displayName + ' left');
                break;
            }
            case 'room-closed': {
                this._collabCleanup();
                this.toast('Room was closed by the host');
                break;
            }
            case 'left-room': {
                this._collabCleanup();
                break;
            }
            case 'error': {
                this.toast(msg.message || 'Room error');
                break;
            }
            case 'add-object': {
                this._collabBroadcastPaused = true;
                const obj = this.scene3d.remoteAddObject(msg.objectType, msg.objectData);
                if (obj && msg.objectData.scripts) {
                    obj.userData.scripts = msg.objectData.scripts;
                }
                this.refreshExplorer();
                this.updateObjectCount();
                this._collabBroadcastPaused = false;
                break;
            }
            case 'remove-object': {
                this._collabBroadcastPaused = true;
                this.scene3d.remoteRemoveObject(msg.collabId);
                this.refreshExplorer();
                this.updateObjectCount();
                this._collabBroadcastPaused = false;
                break;
            }
            case 'update-transform': {
                this.scene3d.remoteUpdateTransform(msg.collabId, msg.position, msg.rotation, msg.scale);
                break;
            }
            case 'update-property': {
                this.scene3d.remoteUpdateProperty(msg.collabId, msg.prop, msg.value);
                if (msg.prop === 'name') this.refreshExplorer();
                if (msg.prop === 'scripts') {
                    const obj = this.scene3d.findByCollabId(msg.collabId);
                    if (obj && obj === this.scene3d.selectedObject) {
                        this.blockCode.workspaceScripts = obj.userData.scripts || [];
                        this.blockCode.renderWorkspace();
                    }
                }
                break;
            }
            case 'update-environment': {
                this._collabBroadcastPaused = true;
                const { prop, value } = msg;
                if (prop === 'skyColor') {
                    document.getElementById('sky-color').value = value;
                    this.scene3d.setSkyColor(value);
                } else if (prop === 'skybox') {
                    document.getElementById('skybox-type').value = value;
                    this.scene3d.setSkybox(value);
                } else if (prop === 'ambientLight') {
                    document.getElementById('ambient-light').value = value;
                    this.scene3d.setAmbientIntensity(value / 100);
                } else if (prop === 'fogDensity') {
                    document.getElementById('fog-density').value = value;
                    this.scene3d.setFog(parseInt(value));
                } else if (prop === 'shadows') {
                    document.getElementById('shadows-enabled').checked = value;
                    this.scene3d.setShadows(value);
                } else if (prop === 'weather') {
                    document.getElementById('weather-type').value = value;
                    this.scene3d.setWeather(value);
                }
                this._collabBroadcastPaused = false;
                break;
            }
            case 'vote-request': {
                this._handleVoteRequest(msg);
                break;
            }
            case 'vote-response': {
                this._handleVoteResponse(msg);
                break;
            }
            case 'vote-passed': {
                this._collabVotePending = null;
                this._collabExecuteAction(msg.action);
                break;
            }
            case 'vote-failed': {
                this._collabVotePending = null;
                const labels = { play: 'Play', stop: 'Stop', share: 'Share' };
                this.toast((labels[msg.action] || msg.action) + ' was declined');
                break;
            }
        }
    }

    _hookCollabBroadcasts() {
        // Object added
        this.scene3d.onObjectAdded = (mesh) => {
            if (this._collabBroadcastPaused) return;
            let color = '#4a90d9';
            if (mesh.material && mesh.material.color) color = '#' + mesh.material.color.getHexString();
            this._collabSend({
                type: 'add-object',
                objectType: mesh.userData.type,
                objectData: {
                    collabId: mesh.userData.collabId,
                    name: mesh.userData.name,
                    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
                    rotation: {
                        x: THREE.MathUtils.radToDeg(mesh.rotation.x),
                        y: THREE.MathUtils.radToDeg(mesh.rotation.y),
                        z: THREE.MathUtils.radToDeg(mesh.rotation.z)
                    },
                    scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
                    color: color,
                    anchored: mesh.userData.anchored,
                    collidable: mesh.userData.collidable,
                    mass: mesh.userData.mass,
                    scripts: mesh.userData.scripts,
                    customParts: mesh.userData.customParts,
                    customObjectId: mesh.userData.customObjectId
                }
            });
        };

        // Object removed
        this.scene3d.onObjectRemoved = (obj) => {
            if (this._collabBroadcastPaused) return;
            this._collabSend({
                type: 'remove-object',
                collabId: obj.userData.collabId
            });
        };

        // Transform changes — throttled
        const origOnChanged = this.scene3d.onObjectChanged;
        let lastTransformBroadcast = 0;
        this.scene3d.onObjectChanged = (obj) => {
            // Call original handler (updates properties panel)
            if (origOnChanged) origOnChanged(obj);

            if (this._collabBroadcastPaused) return;
            const now = Date.now();
            if (now - lastTransformBroadcast < 66) return; // ~15fps
            lastTransformBroadcast = now;
            this._collabSend({
                type: 'update-transform',
                collabId: obj.userData.collabId,
                position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
                rotation: {
                    x: THREE.MathUtils.radToDeg(obj.rotation.x),
                    y: THREE.MathUtils.radToDeg(obj.rotation.y),
                    z: THREE.MathUtils.radToDeg(obj.rotation.z)
                },
                scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
            });
        };

        // Block code script changes
        this.blockCode.onScriptsChanged = (obj, scripts) => {
            if (this._collabBroadcastPaused || !obj.userData.collabId) return;
            this._collabSend({
                type: 'update-property',
                collabId: obj.userData.collabId,
                prop: 'scripts',
                value: JSON.parse(JSON.stringify(scripts))
            });
        };

        // Property changes — hook into property input events
        this._collabPropertyHooks();
    }

    _collabPropertyHooks() {
        const sendProp = (prop, value) => {
            if (this._collabBroadcastPaused || !this.scene3d.selectedObject) return;
            this._collabSend({
                type: 'update-property',
                collabId: this.scene3d.selectedObject.userData.collabId,
                prop, value
            });
        };

        // Color
        const colorPicker = document.getElementById('prop-color');
        colorPicker.addEventListener('input', () => sendProp('color', colorPicker.value));

        // Name
        const nameInput = document.getElementById('prop-name');
        nameInput.addEventListener('change', () => sendProp('name', nameInput.value));

        // Physics
        document.getElementById('prop-anchored').addEventListener('change', (e) => sendProp('anchored', e.target.checked));
        document.getElementById('prop-collidable').addEventListener('change', (e) => sendProp('collidable', e.target.checked));
        document.getElementById('prop-mass').addEventListener('change', (e) => sendProp('mass', parseFloat(e.target.value)));

        // Visibility & locked
        document.getElementById('prop-visible').addEventListener('change', (e) => sendProp('visible', e.target.checked));
        document.getElementById('prop-locked').addEventListener('change', (e) => sendProp('locked', e.target.checked));

        // Material
        document.getElementById('prop-roughness').addEventListener('input', (e) => sendProp('roughness', parseInt(e.target.value) / 100));
        document.getElementById('prop-metalness').addEventListener('input', (e) => sendProp('metalness', parseInt(e.target.value) / 100));
        document.getElementById('prop-opacity').addEventListener('input', (e) => sendProp('opacity', parseInt(e.target.value) / 100));
        document.getElementById('prop-material-type').addEventListener('change', (e) => sendProp('materialType', e.target.value));
    }

    _updateCollabUI() {
        const joinSection = document.getElementById('collab-join-section');
        const activeSection = document.getElementById('collab-active-section');

        if (this._collabRoom) {
            joinSection.classList.add('hidden');
            activeSection.classList.remove('hidden');

            document.getElementById('collab-room-code').textContent = this._collabRoom;
            const badge = document.getElementById('collab-role-badge');
            badge.textContent = this._collabIsHost ? 'HOST' : 'GUEST';
            badge.className = 'collab-role-badge ' + (this._collabIsHost ? 'host' : 'guest');

            // Member list
            const list = document.getElementById('collab-member-list');
            const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
            list.innerHTML = this._collabMembers.map((m, i) => {
                const bgColor = m.avatarColor || colors[i % colors.length];
                const avatarContent = m.avatarUrl
                    ? `<img src="${m.avatarUrl}" alt="${this._escHtml(m.displayName)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
                    : (m.displayName || '?')[0].toUpperCase();
                return `
                <div class="collab-member-item">
                    <div class="collab-member-avatar" style="background:${bgColor}">${avatarContent}</div>
                    <span class="collab-member-name">${this._escHtml(m.displayName)}</span>
                    <span class="collab-member-role">${i === 0 ? 'Host' : 'Guest'}</span>
                </div>`;
            }).join('');
        } else {
            joinSection.classList.remove('hidden');
            activeSection.classList.add('hidden');
            document.getElementById('collab-code-input').value = '';
        }
    }

    _updatePresenceBar() {
        const bar = document.getElementById('collab-presence-bar');
        if (!this._collabRoom || this._collabMembers.length <= 1) {
            bar.classList.add('hidden');
            return;
        }
        bar.classList.remove('hidden');
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6'];
        bar.innerHTML = this._collabMembers.map((m, i) => `
            <div class="collab-presence-dot" style="background:${colors[i % colors.length]}" title="${this._escHtml(m.displayName)}">${(m.displayName || '?')[0].toUpperCase()}</div>
        `).join('');
    }

    // ===== AI Build Assistant =====

    initAIAssistant() {
        const panel = document.getElementById('ai-panel');
        const btn = document.getElementById('btn-ai-assistant');
        const closeBtn = document.getElementById('ai-panel-close');
        const input = document.getElementById('ai-prompt-input');
        const buildBtn = document.getElementById('ai-build-btn');

        btn.addEventListener('click', () => {
            panel.classList.toggle('hidden');
            if (!panel.classList.contains('hidden')) {
                input.focus();
            }
        });

        closeBtn.addEventListener('click', () => {
            panel.classList.add('hidden');
        });

        const submit = () => {
            const prompt = input.value.trim();
            if (!prompt) return;
            input.value = '';
            this._aiGenerateStructure(prompt);
        };

        buildBtn.addEventListener('click', submit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submit();
        });
    }

    _aiAddMessage(text, type) {
        const container = document.getElementById('ai-messages');
        const msg = document.createElement('div');
        msg.className = 'ai-message ' + type;
        if (type === 'ai-user') {
            msg.textContent = text;
        } else {
            msg.innerHTML = '<span class="material-icons-round">' +
                (type === 'ai-result' ? 'check_circle' : type === 'ai-error' ? 'error' : 'auto_awesome') +
                '</span><span>' + text + '</span>';
        }
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
        return msg;
    }

    async _aiGenerateStructure(prompt) {
        const buildBtn = document.getElementById('ai-build-btn');
        const input = document.getElementById('ai-prompt-input');
        const container = document.getElementById('ai-messages');

        // Show user message
        this._aiAddMessage(prompt, 'ai-user');

        // Show loading
        const loadingEl = document.createElement('div');
        loadingEl.className = 'ai-loading';
        loadingEl.innerHTML = '<span class="ai-loading-dots"><span></span><span></span><span></span></span> Generating...';
        container.appendChild(loadingEl);
        container.scrollTop = container.scrollHeight;

        buildBtn.disabled = true;
        input.disabled = true;

        try {
            const res = await fetch('/api/ai/build', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            loadingEl.remove();

            if (!res.ok) {
                const err = await res.json().catch(() => ({ error: 'Request failed' }));
                this._aiAddMessage(err.error || 'Failed to generate', 'ai-error');
                return;
            }

            const data = await res.json();
            const objects = data.objects;

            if (!objects || objects.length === 0) {
                this._aiAddMessage('No objects were generated. Try a different prompt.', 'ai-error');
                return;
            }

            // Calculate offset from camera target so structures appear in front of the user
            const target = this.scene3d.orbitControls.target;
            const offsetX = target.x;
            const offsetZ = target.z;

            this.saveUndoState();

            for (const obj of objects) {
                this.scene3d.addObject(obj.type, {
                    name: obj.name,
                    position: {
                        x: obj.position.x + offsetX,
                        y: obj.position.y,
                        z: obj.position.z + offsetZ
                    },
                    scale: obj.scale,
                    color: obj.color
                });
            }

            this.refreshExplorer();
            this.updateObjectCount();
            this._aiAddMessage('Placed ' + objects.length + ' object' + (objects.length !== 1 ? 's' : '') + '!', 'ai-result');
            this.toast('AI placed ' + objects.length + ' objects', 'success');
        } catch (err) {
            loadingEl.remove();
            this._aiAddMessage('Connection error. Please try again.', 'ai-error');
        } finally {
            buildBtn.disabled = false;
            input.disabled = false;
            input.focus();
        }
    }

    // ===== Toast =====

    toast(message, type = '') {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();

        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = message;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }
}

// ===== Initialize =====
window.addEventListener('DOMContentLoaded', () => {
    try {
        window.app = new App();
    } catch (e) {
        console.error('Cobalt Studio init error:', e);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;padding:40px;color:#ff6b6b;font-family:monospace;background:#1a1a2e;z-index:99999;overflow:auto';
        errDiv.innerHTML = '<h2>Error Initializing Cobalt Studio</h2><pre>' + e.message + '\n\n' + e.stack + '</pre>';
        document.body.appendChild(errDiv);
    }
});
