/**
 * App - Main application controller for BlockForge Studio
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

        this.currentProjectId = null;
        this.projectName = null;

        this.scene3d.onObjectSelected = (obj) => this.onObjectSelected(obj);
        this.scene3d.onObjectDeselected = () => this.onObjectDeselected();
        this.scene3d.onObjectChanged = (obj) => this.updateProperties(obj);
        this.scene3d.onFPSUpdate((fps) => {
            document.getElementById('info-fps').textContent = fps + ' FPS';
        });

        this.runtime.onStop = () => this.onPlayStop();

        // Migrate old single-project storage to multi-project
        this.migrateOldProject();
        this.initTitleScreen();

        // Check for shared project URL
        const loadedFromHash = this.loadFromHash();

        this.refreshExplorer();
        this.updateObjectCount();

        // Ensure viewport is properly sized with editor open
        setTimeout(() => this.scene3d.onResize(), 100);

        this.initTutorial();
        this.initTooltips();

        // Show title screen if no project was loaded from hash
        if (!loadedFromHash) {
            this.showTitleScreen();
        } else {
            this.toast('BlockForge Studio loaded! Start building your game.');
        }

        // Auto-save every 60 seconds
        setInterval(() => {
            if (this.currentProjectId) {
                this.saveProject(true);
            }
        }, 60000);
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
        this.runtime.playerColors = this.gameSettings.playerColors;
        this.runtime._uiScreens = this.uiScreens;
        this.runtime.start(this.gameSettings);
    }

    stopPlay() {
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
            }

            const iconName = this.getObjectIcon(obj.userData.type);
            item.innerHTML = `
                <span class="material-icons-round tree-icon">${iconName}</span>
                <span>${obj.userData.name}</span>
            `;

            item.addEventListener('click', () => {
                this.scene3d.selectObject(obj);
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
            if (this.scene3d.selectedObject) {
                const dup = this.scene3d.duplicateObject(this.scene3d.selectedObject);
                if (dup) {
                    this.scene3d.selectObject(dup);
                    this.refreshExplorer();
                    this.updateObjectCount();
                    this.saveUndoState();
                }
            }
        });

        document.getElementById('btn-delete').addEventListener('click', () => {
            this.deleteSelected();
        });

        document.getElementById('btn-edit-script').addEventListener('click', () => {
            this.openBlockEditor();
        });
    }

    onObjectSelected(obj) {
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
        document.getElementById('no-selection').classList.remove('hidden');
        document.getElementById('properties-content').classList.add('hidden');
        document.getElementById('material-no-selection').classList.remove('hidden');
        document.getElementById('material-content').classList.add('hidden');
        document.getElementById('npc-colors-section').classList.add('hidden');

        this.blockCode.setTarget(null);
        this.refreshExplorer();
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
            if (confirm('Clear all scripts for this object?')) {
                this.blockCode.clearScripts();
            }
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
            if (this.scene3d.selectedObject) {
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
                        if (this.scene3d.selectedObject) {
                            const dup = this.scene3d.duplicateObject(this.scene3d.selectedObject);
                            if (dup) {
                                this.scene3d.selectObject(dup);
                                this.refreshExplorer();
                                this.updateObjectCount();
                            }
                        }
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
        if (this.scene3d.selectedObject) {
            this.saveUndoState();
            this.scene3d.removeObject(this.scene3d.selectedObject);
            this.refreshExplorer();
            this.updateObjectCount();
        }
    }

    // ===== Keyboard Shortcuts =====

    initKeyboard() {
        document.addEventListener('keydown', (e) => {
            if (!this.currentProjectId) return;
            if (this.runtime.isRunning) return;
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
                        if (this.scene3d.selectedObject) {
                            const dup = this.scene3d.duplicateObject(this.scene3d.selectedObject);
                            if (dup) {
                                this.scene3d.selectObject(dup);
                                this.refreshExplorer();
                                this.updateObjectCount();
                            }
                        }
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
                case 'Escape':
                    if (this.runtime.isRunning) {
                        this.stopPlay();
                    } else if (document.getElementById('viewport-container').classList.contains('fullscreen')) {
                        this.toggleFullscreenViewport();
                    } else if (document.getElementById('block-editor').classList.contains('fullscreen')) {
                        this.toggleFullscreenEditor();
                    } else {
                        this.scene3d.deselect();
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
        });
    }

    // ===== Environment =====

    initEnvironment() {
        document.getElementById('sky-color').addEventListener('input', (e) => {
            this.scene3d.setSkyColor(e.target.value);
        });

        document.getElementById('skybox-type').addEventListener('change', (e) => {
            this.scene3d.setSkybox(e.target.value);
        });

        document.getElementById('ambient-light').addEventListener('input', (e) => {
            this.scene3d.setAmbientIntensity(e.target.value / 100);
        });

        document.getElementById('fog-density').addEventListener('input', (e) => {
            this.scene3d.setFog(parseInt(e.target.value));
        });

        document.getElementById('shadows-enabled').addEventListener('change', (e) => {
            this.scene3d.setShadows(e.target.checked);
        });

        document.getElementById('weather-type').addEventListener('change', (e) => {
            this.scene3d.setWeather(e.target.value);
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

    // ===== Multi-Project Storage =====

    generateProjectId() {
        return 'proj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    }

    getProjectIndex() {
        try {
            return JSON.parse(localStorage.getItem('blockforge_projects') || '{}');
        } catch (e) {
            return {};
        }
    }

    saveProjectIndex(index) {
        localStorage.setItem('blockforge_projects', JSON.stringify(index));
    }

    getProjectData(id) {
        try {
            return JSON.parse(localStorage.getItem('blockforge_project_' + id));
        } catch (e) {
            return null;
        }
    }

    saveProjectData(id, data) {
        localStorage.setItem('blockforge_project_' + id, JSON.stringify(data));
    }

    deleteProjectData(id) {
        localStorage.removeItem('blockforge_project_' + id);
        const index = this.getProjectIndex();
        delete index[id];
        this.saveProjectIndex(index);
    }

    _gatherProjectData() {
        return {
            version: 1,
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
                playerColors: this.gameSettings.playerColors
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

    // ===== Title Screen =====

    initTitleScreen() {
        document.getElementById('btn-new-project').addEventListener('click', () => this.showNewProjectModal());
        document.getElementById('btn-import-project').addEventListener('click', () => this.importProjectFromFile());

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

    showTitleScreen() {
        // Auto-save current project before showing title screen
        if (this.currentProjectId) {
            this.saveProject(true);
        }
        this.currentProjectId = null;
        this.projectName = null;

        document.getElementById('title-screen').classList.remove('hidden');
        this.renderProjectGrid();
    }

    hideTitleScreen() {
        document.getElementById('title-screen').classList.add('hidden');
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
        this.saveProject(true);
        this.hideTitleScreen();
        this.toast('New project created: ' + name);
    }

    loadProjectById(id) {
        const data = this.getProjectData(id);
        if (!data) {
            this.toast('Failed to load project', 'error');
            return;
        }

        const index = this.getProjectIndex();
        this.currentProjectId = id;
        this.projectName = (index[id] && index[id].name) || data.name || 'My Game';

        this.undoStack = [];
        this.redoStack = [];

        this._applyProjectData(data);
        this.hideTitleScreen();
        this.toast('Opened: ' + this.projectName);
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

    renameProject(id) {
        const index = this.getProjectIndex();
        const meta = index[id];
        if (!meta) return;
        const newName = prompt('Rename project:', meta.name || 'Untitled');
        if (!newName || newName === meta.name) return;
        meta.name = newName;
        this.saveProjectIndex(index);
        // Also update project data name
        const data = this.getProjectData(id);
        if (data) {
            data.name = newName;
            this.saveProjectData(id, data);
        }
        this.renderProjectGrid();
    }

    renderProjectGrid() {
        const grid = document.getElementById('project-grid');
        const empty = document.getElementById('title-empty');
        const countEl = document.getElementById('project-count');
        const index = this.getProjectIndex();

        // Sort by modifiedAt descending
        const entries = Object.entries(index).sort((a, b) => (b[1].modifiedAt || 0) - (a[1].modifiedAt || 0));

        countEl.textContent = entries.length;
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

            const info = document.createElement('div');
            info.className = 'project-card-info';
            const nameEl = document.createElement('div');
            nameEl.className = 'project-name';
            nameEl.textContent = meta.name || 'Untitled';
            const dateEl = document.createElement('div');
            dateEl.className = 'project-date';
            dateEl.textContent = this._formatRelativeTime(meta.modifiedAt);
            info.appendChild(nameEl);
            info.appendChild(dateEl);

            // Card action buttons (top-right, shown on hover)
            const actions = document.createElement('div');
            actions.className = 'project-card-actions';

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
                if (confirm('Delete "' + (meta.name || 'Untitled') + '"? This cannot be undone.')) {
                    this.deleteProjectData(id);
                    this.renderProjectGrid();
                }
            });

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

    loadTemplate(key) {
        const tmpl = this.templates[key];
        if (!tmpl) return;

        // Confirm if scene has objects
        if (this.scene3d.objects.length > 0) {
            if (!confirm('This will replace your current scene. Continue?')) return;
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
            playerColors: { body: '#4c97ff', head: '#f5cba7', detail: '#e0b090' }
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

        // Mouse orbit toggle
        const mouseOrbitCheckbox = document.getElementById('setting-mouse-orbit');
        mouseOrbitCheckbox.checked = this.gameSettings.mouseOrbit;
        mouseOrbitCheckbox.addEventListener('change', (e) => {
            this.gameSettings.mouseOrbit = e.target.checked;
            this.scene3d.orbitControls.enableRotate = e.target.checked;
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
            thumbnail: thumbnail || existing.thumbnail || null
        };
        this.saveProjectIndex(index);

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
        const filename = (this.projectName || 'blockforge-game').replace(/[^a-z0-9_-]/gi, '_') + '.json';

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
    }

    undo() {
        if (this.undoStack.length === 0) return;
        this.redoStack.push(JSON.stringify(this.scene3d.serialize()));
        const state = JSON.parse(this.undoStack.pop());
        this.scene3d.deserialize(state);
        this.refreshExplorer();
        this.updateObjectCount();
        this.toast('Undo');
    }

    redo() {
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
        const data = this._gatherProjectData();
        try {
            const json = JSON.stringify(data);
            const encoded = btoa(unescape(encodeURIComponent(json)));
            const url = window.location.origin + window.location.pathname + '#project=' + encoded;
            navigator.clipboard.writeText(url).then(() => {
                this.toast('Share link copied to clipboard!', 'success');
            }).catch(() => {
                // Fallback
                const input = document.createElement('input');
                input.value = url;
                document.body.appendChild(input);
                input.select();
                document.execCommand('copy');
                input.remove();
                this.toast('Share link copied to clipboard!', 'success');
            });
        } catch (e) {
            this.toast('Project too large to share via link', 'error');
        }
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
                    { icon: 'view_in_ar', title: 'Welcome to BlockForge Studio!', text: 'Build 3D games with blocks — no coding required! Let\'s walk through the basics together.' },
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
        console.error('BlockForge init error:', e);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;padding:40px;color:#ff6b6b;font-family:monospace;background:#1a1a2e;z-index:99999;overflow:auto';
        errDiv.innerHTML = '<h2>Error Initializing BlockForge Studio</h2><pre>' + e.message + '\n\n' + e.stack + '</pre>';
        document.body.appendChild(errDiv);
    }
});
