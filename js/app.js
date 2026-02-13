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
        this.initSettings();

        this.scene3d.onObjectSelected = (obj) => this.onObjectSelected(obj);
        this.scene3d.onObjectDeselected = () => this.onObjectDeselected();
        this.scene3d.onObjectChanged = (obj) => this.updateProperties(obj);
        this.scene3d.onFPSUpdate((fps) => {
            document.getElementById('info-fps').textContent = fps + ' FPS';
        });

        this.runtime.onStop = () => this.onPlayStop();

        this.loadFromHash();
        this.refreshExplorer();
        this.updateObjectCount();

        // Ensure viewport is properly sized with editor open
        setTimeout(() => this.scene3d.onResize(), 100);

        this.initTutorial();
        this.initTooltips();

        this.toast('BlockForge Studio loaded! Start building your game.');
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
                if (this.scene3d.selectedObject && this.scene3d.selectedObject.material) {
                    const activeSwatch = document.querySelector('.material-swatches .swatch.active');
                    if (activeSwatch) {
                        this.scene3d.selectedObject.material.color.set(activeSwatch.style.background);
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
            'gem': 'diamond'
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
        this.refreshExplorer();

        // Auto-set block code target so drag-and-drop works immediately
        this.blockCode.setTarget(obj);
    }

    onObjectDeselected() {
        document.getElementById('no-selection').classList.remove('hidden');
        document.getElementById('properties-content').classList.add('hidden');
        document.getElementById('material-no-selection').classList.remove('hidden');
        document.getElementById('material-content').classList.add('hidden');

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
        if (obj.material) {
            document.getElementById('prop-color').value = '#' + obj.material.color.getHexString();
            document.getElementById('prop-roughness').value = Math.round(obj.material.roughness * 100);
            document.getElementById('prop-metalness').value = Math.round(obj.material.metalness * 100);
            document.getElementById('prop-opacity').value = Math.round(obj.material.opacity * 100);
        }

        // Update status bar
        document.getElementById('status-pos').textContent =
            `X: ${obj.position.x.toFixed(1)} Y: ${obj.position.y.toFixed(1)} Z: ${obj.position.z.toFixed(1)}`;
    }

    // ===== Materials Panel =====

    initMaterials() {
        // Color picker
        document.getElementById('prop-color').addEventListener('input', (e) => {
            if (this.scene3d.selectedObject && this.scene3d.selectedObject.material) {
                this.scene3d.selectedObject.material.color.set(e.target.value);
            }
        });

        // Color presets
        document.querySelectorAll('.color-presets .swatch').forEach(swatch => {
            swatch.addEventListener('click', () => {
                const color = swatch.dataset.color;
                if (this.scene3d.selectedObject && this.scene3d.selectedObject.material) {
                    this.scene3d.selectedObject.material.color.set(color);
                    document.getElementById('prop-color').value = color;
                }
            });
        });

        // Material type
        document.getElementById('prop-material-type').addEventListener('change', (e) => {
            if (!this.scene3d.selectedObject || !this.scene3d.selectedObject.material) return;
            const mat = this.scene3d.selectedObject.material;
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
            this.updateProperties(this.scene3d.selectedObject);
        });

        // Roughness
        document.getElementById('prop-roughness').addEventListener('input', (e) => {
            if (this.scene3d.selectedObject?.material) {
                this.scene3d.selectedObject.material.roughness = e.target.value / 100;
            }
        });

        // Metalness
        document.getElementById('prop-metalness').addEventListener('input', (e) => {
            if (this.scene3d.selectedObject?.material) {
                this.scene3d.selectedObject.material.metalness = e.target.value / 100;
            }
        });

        // Opacity
        document.getElementById('prop-opacity').addEventListener('input', (e) => {
            if (this.scene3d.selectedObject?.material) {
                const opacity = e.target.value / 100;
                this.scene3d.selectedObject.material.opacity = opacity;
                this.scene3d.selectedObject.material.transparent = opacity < 1;
            }
        });

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
    }

    // ===== Save/Load =====

    initSaveLoad() {
        document.getElementById('btn-save').addEventListener('click', () => this.saveProject());
        document.getElementById('btn-load').addEventListener('click', () => this.loadProject());
        document.getElementById('btn-export').addEventListener('click', () => this.exportGame());
        document.getElementById('btn-share').addEventListener('click', () => this.shareProject());
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
            keyBindings: { ...defaultBindings }
        };

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
    }

    saveProject() {
        const data = {
            version: 1,
            name: 'My Game',
            scene: this.scene3d.serialize(),
            environment: {
                skyColor: document.getElementById('sky-color').value,
                ambientLight: document.getElementById('ambient-light').value,
                fogDensity: document.getElementById('fog-density').value,
                shadows: document.getElementById('shadows-enabled').checked
            }
        };

        localStorage.setItem('blockforge_project', JSON.stringify(data));
        this.toast('Project saved!', 'success');
    }

    loadProject() {
        const raw = localStorage.getItem('blockforge_project');
        if (!raw) {
            this.toast('No saved project found', 'error');
            return;
        }

        try {
            const data = JSON.parse(raw);
            this.scene3d.deserialize(data.scene);

            if (data.environment) {
                document.getElementById('sky-color').value = data.environment.skyColor;
                document.getElementById('ambient-light').value = data.environment.ambientLight;
                document.getElementById('fog-density').value = data.environment.fogDensity;
                document.getElementById('shadows-enabled').checked = data.environment.shadows;

                this.scene3d.setSkyColor(data.environment.skyColor);
                this.scene3d.setAmbientIntensity(data.environment.ambientLight / 100);
                this.scene3d.setFog(parseInt(data.environment.fogDensity));
                this.scene3d.setShadows(data.environment.shadows);
            }

            this.refreshExplorer();
            this.updateObjectCount();
            this.toast('Project loaded!', 'success');
        } catch (e) {
            this.toast('Failed to load project', 'error');
            console.error(e);
        }
    }

    exportGame() {
        const data = {
            version: 1,
            name: 'My Game',
            scene: this.scene3d.serialize(),
            environment: {
                skyColor: document.getElementById('sky-color').value,
                ambientLight: document.getElementById('ambient-light').value,
                fogDensity: document.getElementById('fog-density').value,
                shadows: document.getElementById('shadows-enabled').checked
            }
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'blockforge-game.json';
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
        const data = {
            version: 1,
            name: 'My Game',
            scene: this.scene3d.serialize(),
            environment: {
                skyColor: document.getElementById('sky-color').value,
                ambientLight: document.getElementById('ambient-light').value,
                fogDensity: document.getElementById('fog-density').value,
                shadows: document.getElementById('shadows-enabled').checked
            }
        };
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
        if (!hash || !hash.startsWith('#project=')) return;
        try {
            const encoded = hash.substring('#project='.length);
            const json = decodeURIComponent(escape(atob(encoded)));
            const data = JSON.parse(json);
            this.scene3d.deserialize(data.scene);
            if (data.environment) {
                document.getElementById('sky-color').value = data.environment.skyColor;
                document.getElementById('ambient-light').value = data.environment.ambientLight;
                document.getElementById('fog-density').value = data.environment.fogDensity;
                document.getElementById('shadows-enabled').checked = data.environment.shadows;
                this.scene3d.setSkyColor(data.environment.skyColor);
                this.scene3d.setAmbientIntensity(data.environment.ambientLight / 100);
                this.scene3d.setFog(parseInt(data.environment.fogDensity));
                this.scene3d.setShadows(data.environment.shadows);
            }
            this.refreshExplorer();
            this.updateObjectCount();
            // Clear hash so it doesn't reload on refresh
            history.replaceState(null, '', window.location.pathname);
            this.toast('Shared project loaded!', 'success');
        } catch (e) {
            console.error('Failed to load shared project:', e);
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
        const steps = [
            { icon: 'view_in_ar', title: 'Welcome to BlockForge Studio!', text: 'Build 3D games with blocks - no coding required! This quick tour will show you the basics.' },
            { icon: 'add_box', title: 'Add Objects', text: 'Use the Object Library panel on the left to add 3D shapes, characters, and items to your scene. Click any object to add it.' },
            { icon: 'open_with', title: 'Transform Objects', text: 'Select objects and use the toolbar to Move (G), Rotate (R), or Scale (S) them. Hold Shift+click to select multiple objects.' },
            { icon: 'extension', title: 'Block Coding', text: 'Select an object, then open the Block Editor at the bottom. Drag blocks from the drawer to create scripts - they snap together like puzzle pieces!' },
            { icon: 'play_arrow', title: 'Test Your Game', text: 'Press the Play button or F5 to test your game. Use WASD to move and Space to jump. Press ESC to stop.' },
            { icon: 'palette', title: 'Customize', text: 'Use the Environment panel to change sky color, skybox, lighting, and fog. Open Settings to configure game controls and physics.' },
            { icon: 'share', title: 'Save & Share', text: 'Save your project with Ctrl+S, export it as a file, or click the Share button to get a link you can send to friends!' }
        ];

        const seen = localStorage.getItem('blockforge_tutorial_seen');
        if (seen) return;

        const modal = document.getElementById('tutorial-modal');
        const body = document.getElementById('tutorial-body');
        const prevBtn = document.getElementById('tutorial-prev');
        const nextBtn = document.getElementById('tutorial-next');
        const indicator = document.getElementById('tutorial-step-indicator');
        const closeBtn = document.getElementById('tutorial-close');
        let currentStep = 0;

        const renderStep = () => {
            const step = steps[currentStep];
            body.innerHTML = `
                <div class="tutorial-step">
                    <div class="step-icon"><span class="material-icons-round" style="font-size:48px">${step.icon}</span></div>
                    <h3>${step.title}</h3>
                    <p>${step.text}</p>
                    ${currentStep === steps.length - 1 ? `
                        <div class="tutorial-dont-show">
                            <input type="checkbox" id="tutorial-dont-show-check" checked>
                            <label for="tutorial-dont-show-check">Don't show again</label>
                        </div>
                    ` : ''}
                </div>
            `;
            indicator.textContent = `${currentStep + 1} / ${steps.length}`;
            prevBtn.style.display = currentStep > 0 ? '' : 'none';
            nextBtn.innerHTML = currentStep < steps.length - 1
                ? 'Next <span class="material-icons-round">arrow_forward</span>'
                : 'Get Started! <span class="material-icons-round">rocket_launch</span>';
        };

        prevBtn.addEventListener('click', () => {
            if (currentStep > 0) { currentStep--; renderStep(); }
        });
        nextBtn.addEventListener('click', () => {
            if (currentStep < steps.length - 1) {
                currentStep++;
                renderStep();
            } else {
                // Finish
                const check = document.getElementById('tutorial-dont-show-check');
                if (check && check.checked) {
                    localStorage.setItem('blockforge_tutorial_seen', 'true');
                }
                modal.classList.add('hidden');
            }
        });
        closeBtn.addEventListener('click', () => {
            localStorage.setItem('blockforge_tutorial_seen', 'true');
            modal.classList.add('hidden');
        });

        renderStep();
        modal.classList.remove('hidden');
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
