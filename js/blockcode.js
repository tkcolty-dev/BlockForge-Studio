/**
 * BlockCode - Scratch-like visual block coding system
 * Handles block definitions, drag-and-drop, and script compilation
 */
class BlockCode {
    constructor() {
        this.categories = this.defineCategories();
        this.blocks = this.defineBlocks();
        this.activeCategory = 'events';
        this.targetObject = null;
        this.dragData = null;
        this.workspaceScripts = []; // Array of script stacks for current object
        this.nextBlockId = 1;

        this.drawer = document.getElementById('block-drawer');
        this.workspace = document.getElementById('workspace-canvas');
        this.palette = document.getElementById('block-palette');

        this.initPalette();
        this.renderDrawer();
        this.initWorkspaceDrop();
    }

    defineCategories() {
        return {
            events: { name: 'Events', color: '#FFD500', darkColor: '#CC9E00' },
            motion: { name: 'Motion', color: '#4C97FF', darkColor: '#3373CC' },
            control: { name: 'Control', color: '#FFAB19', darkColor: '#CF8B17' },
            looks: { name: 'Looks', color: '#9966FF', darkColor: '#774DCB' },
            physics: { name: 'Physics', color: '#59C059', darkColor: '#45993D' },
            sensing: { name: 'Sensing', color: '#5CB1D6', darkColor: '#2E8EB8' },
            sound: { name: 'Sound', color: '#CF63CF', darkColor: '#BD42BD' },
            variables: { name: 'Variables', color: '#FF8C1A', darkColor: '#DB6E00' }
        };
    }

    defineBlocks() {
        return {
            // === EVENTS ===
            'event_start': {
                category: 'events',
                type: 'hat',
                label: 'When game starts',
                icon: '🏁',
                code: 'onStart'
            },
            'event_click': {
                category: 'events',
                type: 'hat',
                label: 'When this object clicked',
                icon: '👆',
                code: 'onClick'
            },
            'event_key': {
                category: 'events',
                type: 'hat',
                label: 'When key {key} pressed',
                icon: '⌨',
                inputs: { key: { type: 'select', options: ['W','A','S','D','Space','E','Q','1','2','3','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'], default: 'Space' } },
                code: 'onKey'
            },
            'event_collide': {
                category: 'events',
                type: 'hat',
                label: 'When touching {object}',
                icon: '💥',
                inputs: { object: { type: 'select', options: ['any','player','coin','npc'], default: 'player' } },
                code: 'onCollide'
            },
            'event_timer': {
                category: 'events',
                type: 'hat',
                label: 'Every {seconds} seconds',
                icon: '⏱',
                inputs: { seconds: { type: 'number', default: 1 } },
                code: 'onTimer'
            },

            // === MOTION ===
            'motion_move': {
                category: 'motion',
                type: 'command',
                label: 'Move {direction} by {amount}',
                inputs: {
                    direction: { type: 'select', options: ['forward','backward','left','right','up','down'], default: 'forward' },
                    amount: { type: 'number', default: 1 }
                },
                code: 'move'
            },
            'motion_moveto': {
                category: 'motion',
                type: 'command',
                label: 'Move to X:{x} Y:{y} Z:{z}',
                inputs: {
                    x: { type: 'number', default: 0 },
                    y: { type: 'number', default: 0 },
                    z: { type: 'number', default: 0 }
                },
                code: 'moveTo'
            },
            'motion_rotate': {
                category: 'motion',
                type: 'command',
                label: 'Rotate {axis} by {degrees}°',
                inputs: {
                    axis: { type: 'select', options: ['X','Y','Z'], default: 'Y' },
                    degrees: { type: 'number', default: 15 }
                },
                code: 'rotate'
            },
            'motion_spin': {
                category: 'motion',
                type: 'command',
                label: 'Spin {axis} forever speed {speed}',
                inputs: {
                    axis: { type: 'select', options: ['X','Y','Z'], default: 'Y' },
                    speed: { type: 'number', default: 1 }
                },
                code: 'spin'
            },
            'motion_glide': {
                category: 'motion',
                type: 'command',
                label: 'Glide to X:{x} Y:{y} Z:{z} in {time}s',
                inputs: {
                    x: { type: 'number', default: 0 },
                    y: { type: 'number', default: 5 },
                    z: { type: 'number', default: 0 },
                    time: { type: 'number', default: 1 }
                },
                code: 'glide'
            },
            'motion_bounce': {
                category: 'motion',
                type: 'command',
                label: 'Bounce height {height} speed {speed}',
                inputs: {
                    height: { type: 'number', default: 2 },
                    speed: { type: 'number', default: 2 }
                },
                code: 'bounce'
            },
            'motion_follow_player': {
                category: 'motion',
                type: 'command',
                label: 'Follow player speed {speed}',
                inputs: { speed: { type: 'number', default: 2 } },
                code: 'followPlayer'
            },
            'motion_patrol': {
                category: 'motion',
                type: 'command',
                label: 'Patrol distance {dist} speed {speed}',
                inputs: {
                    dist: { type: 'number', default: 5 },
                    speed: { type: 'number', default: 2 }
                },
                code: 'patrol'
            },

            // === CONTROL ===
            'control_wait': {
                category: 'control',
                type: 'command',
                label: 'Wait {seconds} seconds',
                inputs: { seconds: { type: 'number', default: 1 } },
                code: 'wait'
            },
            'control_repeat': {
                category: 'control',
                type: 'c-block',
                label: 'Repeat {times} times',
                inputs: { times: { type: 'number', default: 10 } },
                code: 'repeat'
            },
            'control_forever': {
                category: 'control',
                type: 'c-block',
                label: 'Forever',
                code: 'forever'
            },
            'control_if': {
                category: 'control',
                type: 'c-block',
                label: 'If {condition} then',
                inputs: { condition: { type: 'select', options: ['touching player','key pressed','variable > 0','random chance'], default: 'touching player' } },
                code: 'if'
            },
            'control_stop': {
                category: 'control',
                type: 'command',
                label: 'Stop {what}',
                inputs: { what: { type: 'select', options: ['this script','all scripts','other scripts'], default: 'this script' } },
                code: 'stop'
            },

            // === LOOKS ===
            'looks_color': {
                category: 'looks',
                type: 'command',
                label: 'Set color to {color}',
                inputs: { color: { type: 'color', default: '#ff0000' } },
                code: 'setColor'
            },
            'looks_size': {
                category: 'looks',
                type: 'command',
                label: 'Set size to {percent}%',
                inputs: { percent: { type: 'number', default: 100 } },
                code: 'setSize'
            },
            'looks_show': {
                category: 'looks',
                type: 'command',
                label: 'Show',
                code: 'show'
            },
            'looks_hide': {
                category: 'looks',
                type: 'command',
                label: 'Hide',
                code: 'hide'
            },
            'looks_glow': {
                category: 'looks',
                type: 'command',
                label: 'Glow {color} intensity {val}',
                inputs: {
                    color: { type: 'color', default: '#ffffff' },
                    val: { type: 'number', default: 0.5 }
                },
                code: 'glow'
            },
            'looks_opacity': {
                category: 'looks',
                type: 'command',
                label: 'Set opacity to {percent}%',
                inputs: { percent: { type: 'number', default: 50 } },
                code: 'setOpacity'
            },
            'looks_say': {
                category: 'looks',
                type: 'command',
                label: 'Show text {text} for {time}s',
                inputs: {
                    text: { type: 'text', default: 'Hello!' },
                    time: { type: 'number', default: 2 }
                },
                code: 'say'
            },
            'looks_effect': {
                category: 'looks',
                type: 'command',
                label: 'Color shift speed {speed}',
                inputs: { speed: { type: 'number', default: 1 } },
                code: 'colorShift'
            },

            // === PHYSICS ===
            'physics_gravity': {
                category: 'physics',
                type: 'command',
                label: 'Enable gravity',
                code: 'enableGravity'
            },
            'physics_nogravity': {
                category: 'physics',
                type: 'command',
                label: 'Disable gravity',
                code: 'disableGravity'
            },
            'physics_velocity': {
                category: 'physics',
                type: 'command',
                label: 'Set velocity X:{x} Y:{y} Z:{z}',
                inputs: {
                    x: { type: 'number', default: 0 },
                    y: { type: 'number', default: 5 },
                    z: { type: 'number', default: 0 }
                },
                code: 'setVelocity'
            },
            'physics_impulse': {
                category: 'physics',
                type: 'command',
                label: 'Apply impulse {direction} force {force}',
                inputs: {
                    direction: { type: 'select', options: ['up','forward','backward','left','right'], default: 'up' },
                    force: { type: 'number', default: 5 }
                },
                code: 'impulse'
            },
            'physics_anchor': {
                category: 'physics',
                type: 'command',
                label: 'Set anchored {state}',
                inputs: { state: { type: 'select', options: ['true','false'], default: 'true' } },
                code: 'setAnchored'
            },
            'physics_destroy': {
                category: 'physics',
                type: 'command',
                label: 'Destroy this object',
                code: 'destroy'
            },
            'physics_clone': {
                category: 'physics',
                type: 'command',
                label: 'Clone this object',
                code: 'clone'
            },
            'physics_teleport_player': {
                category: 'physics',
                type: 'command',
                label: 'Teleport player to X:{x} Y:{y} Z:{z}',
                inputs: {
                    x: { type: 'number', default: 0 },
                    y: { type: 'number', default: 5 },
                    z: { type: 'number', default: 0 }
                },
                code: 'teleportPlayer'
            },

            // === SENSING ===
            'sensing_distance': {
                category: 'sensing',
                type: 'reporter',
                label: 'Distance to player',
                code: 'distanceToPlayer'
            },
            'sensing_touching': {
                category: 'sensing',
                type: 'reporter',
                label: 'Touching {object}?',
                inputs: { object: { type: 'select', options: ['player','any','ground'], default: 'player' } },
                code: 'isTouching'
            },
            'sensing_key_held': {
                category: 'sensing',
                type: 'reporter',
                label: 'Key {key} held?',
                inputs: { key: { type: 'select', options: ['W','A','S','D','Space','Shift'], default: 'Space' } },
                code: 'isKeyHeld'
            },
            'sensing_timer': {
                category: 'sensing',
                type: 'reporter',
                label: 'Game timer',
                code: 'getTimer'
            },

            // === SOUND ===
            'sound_play': {
                category: 'sound',
                type: 'command',
                label: 'Play sound {sound}',
                inputs: { sound: { type: 'select', options: ['pop','ding','whoosh','boom','jump','coin','hurt','powerup'], default: 'pop' } },
                code: 'playSound'
            },
            'sound_volume': {
                category: 'sound',
                type: 'command',
                label: 'Set volume to {percent}%',
                inputs: { percent: { type: 'number', default: 100 } },
                code: 'setVolume'
            },

            // === VARIABLES ===
            'var_set': {
                category: 'variables',
                type: 'command',
                label: 'Set {var} to {value}',
                inputs: {
                    var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' },
                    value: { type: 'number', default: 0 }
                },
                code: 'setVar'
            },
            'var_change': {
                category: 'variables',
                type: 'command',
                label: 'Change {var} by {amount}',
                inputs: {
                    var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' },
                    amount: { type: 'number', default: 1 }
                },
                code: 'changeVar'
            },
            'var_show': {
                category: 'variables',
                type: 'command',
                label: 'Show {var} on screen',
                inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','timer'], default: 'score' } },
                code: 'showVar'
            },

            // === MORE MOTION ===
            'motion_orbit': {
                category: 'motion',
                type: 'command',
                label: 'Orbit around center radius {r} speed {s}',
                inputs: {
                    r: { type: 'number', default: 3 },
                    s: { type: 'number', default: 1 }
                },
                code: 'orbit'
            },
            'motion_look_at_player': {
                category: 'motion',
                type: 'command',
                label: 'Look at player',
                code: 'lookAtPlayer'
            },
            'motion_random_pos': {
                category: 'motion',
                type: 'command',
                label: 'Move to random spot range {range}',
                inputs: { range: { type: 'number', default: 10 } },
                code: 'randomPos'
            },
            'motion_push_from_player': {
                category: 'motion',
                type: 'command',
                label: 'Push away from player force {f}',
                inputs: { f: { type: 'number', default: 3 } },
                code: 'pushFromPlayer'
            },

            // === MORE CONTROL ===
            'control_if_else': {
                category: 'control',
                type: 'c-block',
                label: 'If {condition} then',
                inputs: { condition: { type: 'select', options: ['touching player','key pressed','variable > 0','health < 50','random chance','distance < 3'], default: 'touching player' } },
                code: 'ifElse'
            },
            'control_wait_until': {
                category: 'control',
                type: 'command',
                label: 'Wait until {condition}',
                inputs: { condition: { type: 'select', options: ['touching player','key pressed','timer > 5'], default: 'touching player' } },
                code: 'waitUntil'
            },

            // === MORE LOOKS ===
            'looks_scale_pulse': {
                category: 'looks',
                type: 'command',
                label: 'Pulse size min {min}% max {max}% speed {spd}',
                inputs: {
                    min: { type: 'number', default: 80 },
                    max: { type: 'number', default: 120 },
                    spd: { type: 'number', default: 2 }
                },
                code: 'scalePulse'
            },
            'looks_trail': {
                category: 'looks',
                type: 'command',
                label: 'Enable particle trail color {color}',
                inputs: { color: { type: 'color', default: '#ffff00' } },
                code: 'trail'
            },

            // === MORE PHYSICS ===
            'physics_explode': {
                category: 'physics',
                type: 'command',
                label: 'Explode force {force} radius {radius}',
                inputs: {
                    force: { type: 'number', default: 10 },
                    radius: { type: 'number', default: 5 }
                },
                code: 'explode'
            },
            'physics_launch_player': {
                category: 'physics',
                type: 'command',
                label: 'Launch player up force {force}',
                inputs: { force: { type: 'number', default: 15 } },
                code: 'launchPlayer'
            },
            'physics_set_player_speed': {
                category: 'physics',
                type: 'command',
                label: 'Set player speed to {speed}',
                inputs: { speed: { type: 'number', default: 8 } },
                code: 'setPlayerSpeed'
            },

            // === MORE SENSING ===
            'sensing_player_grounded': {
                category: 'sensing',
                type: 'reporter',
                label: 'Player on ground?',
                code: 'playerGrounded'
            },
            'sensing_object_exists': {
                category: 'sensing',
                type: 'reporter',
                label: 'Object {name} exists?',
                inputs: { name: { type: 'text', default: 'Coin' } },
                code: 'objectExists'
            },
            'sensing_random': {
                category: 'sensing',
                type: 'reporter',
                label: 'Random {min} to {max}',
                inputs: {
                    min: { type: 'number', default: 1 },
                    max: { type: 'number', default: 10 }
                },
                code: 'random'
            },

            // === MORE SOUND ===
            'sound_pitch': {
                category: 'sound',
                type: 'command',
                label: 'Play tone freq {freq} for {dur}s',
                inputs: {
                    freq: { type: 'number', default: 440 },
                    dur: { type: 'number', default: 0.3 }
                },
                code: 'playTone'
            },

            // === MORE VARIABLES ===
            'var_if_check': {
                category: 'variables',
                type: 'c-block',
                label: 'If {var} {op} {value}',
                inputs: {
                    var: { type: 'select', options: ['score','health','coins','speed','level'], default: 'score' },
                    op: { type: 'select', options: ['>','<','=','>=','<='], default: '>' },
                    value: { type: 'number', default: 10 }
                },
                code: 'ifVar'
            },
            'var_reset_all': {
                category: 'variables',
                type: 'command',
                label: 'Reset all variables',
                code: 'resetVars'
            }
        };
    }

    // ===== Palette =====

    initPalette() {
        this.palette.querySelectorAll('.palette-category').forEach(el => {
            el.addEventListener('click', () => {
                this.palette.querySelectorAll('.palette-category').forEach(c => c.classList.remove('active'));
                el.classList.add('active');
                this.activeCategory = el.dataset.category;
                this.renderDrawer();
            });
        });
    }

    // ===== Drawer =====

    renderDrawer() {
        this.drawer.innerHTML = '';

        const cat = this.categories[this.activeCategory];
        Object.entries(this.blocks).forEach(([blockId, blockDef]) => {
            if (blockDef.category !== this.activeCategory) return;

            const blockEl = this.createBlockElement(blockId, blockDef);
            this.drawer.appendChild(blockEl);
        });
    }

    createBlockElement(blockId, blockDef, instanceData = null) {
        const cat = this.categories[blockDef.category];
        const el = document.createElement('div');
        el.className = `block block-${blockDef.category}`;
        if (blockDef.type === 'hat') el.classList.add('hat');
        if (blockDef.type === 'c-block') el.classList.add('c-block-container');

        el.dataset.blockId = blockId;
        el.dataset.instanceId = instanceData?.instanceId || '';

        if (blockDef.type === 'c-block') {
            // C-block with body
            const topDiv = document.createElement('div');
            topDiv.className = 'c-block-top';
            topDiv.innerHTML = this.buildBlockLabel(blockDef, instanceData);
            el.appendChild(topDiv);

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'c-block-body';
            bodyDiv.dataset.dropTarget = 'c-block-body';

            // Render inner blocks if any
            if (instanceData?.children) {
                instanceData.children.forEach(childData => {
                    const childDef = this.blocks[childData.blockId];
                    if (childDef) {
                        const childEl = this.createBlockElement(childData.blockId, childDef, childData);
                        bodyDiv.appendChild(childEl);
                    }
                });
            }

            el.appendChild(bodyDiv);
        } else {
            el.innerHTML = this.buildBlockLabel(blockDef, instanceData);
        }

        // Drag handling
        el.addEventListener('pointerdown', (e) => this.startDrag(e, blockId, blockDef, el, instanceData));

        return el;
    }

    buildBlockLabel(blockDef, instanceData) {
        let label = blockDef.label;
        const icon = blockDef.icon ? `<span style="margin-right:4px">${blockDef.icon}</span>` : '';

        if (blockDef.inputs) {
            Object.entries(blockDef.inputs).forEach(([key, input]) => {
                const currentValue = instanceData?.values?.[key] ?? input.default;

                if (input.type === 'number') {
                    const replacement = `<input type="number" class="block-input" data-input="${key}" value="${currentValue}" step="0.1">`;
                    label = label.replace(`{${key}}`, replacement);
                } else if (input.type === 'text') {
                    const replacement = `<input type="text" class="block-input" data-input="${key}" value="${currentValue}" style="width:80px">`;
                    label = label.replace(`{${key}}`, replacement);
                } else if (input.type === 'select') {
                    const options = input.options.map(opt =>
                        `<option value="${opt}" ${opt === currentValue ? 'selected' : ''}>${opt}</option>`
                    ).join('');
                    const replacement = `<select class="block-select" data-input="${key}">${options}</select>`;
                    label = label.replace(`{${key}}`, replacement);
                } else if (input.type === 'color') {
                    const replacement = `<input type="color" class="block-input" data-input="${key}" value="${currentValue}" style="width:40px;height:20px;padding:0;border-radius:4px">`;
                    label = label.replace(`{${key}}`, replacement);
                }
            });
        }

        return icon + label;
    }

    // ===== Drag and Drop =====

    startDrag(e, blockId, blockDef, sourceEl, instanceData) {
        // Don't drag if clicking an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

        e.preventDefault();
        e.stopPropagation();

        const rect = sourceEl.getBoundingClientRect();
        const isFromWorkspace = sourceEl.closest('#workspace-canvas') !== null;
        const startX = e.clientX;
        const startY = e.clientY;
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        const DRAG_THRESHOLD = 6;
        let ghost = null;
        let isDragging = false;

        const onMove = (ev) => {
            const dx = ev.clientX - startX;
            const dy = ev.clientY - startY;

            // Only start real drag after moving past threshold
            if (!isDragging) {
                if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
                isDragging = true;

                // Create ghost now
                ghost = sourceEl.cloneNode(true);
                ghost.className = sourceEl.className + ' block-ghost';
                ghost.style.width = rect.width + 'px';
                document.body.appendChild(ghost);

                this.dragData = {
                    blockId,
                    blockDef,
                    ghost,
                    offsetX,
                    offsetY,
                    isFromWorkspace,
                    sourceEl,
                    instanceData
                };
            }

            if (ghost) {
                ghost.style.left = (ev.clientX - offsetX) + 'px';
                ghost.style.top = (ev.clientY - offsetY) + 'px';
            }
        };

        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);

            if (ghost) {
                ghost.remove();
            }

            // Only drop if we actually dragged
            if (isDragging && this.dragData) {
                this.handleDrop(ev);
            }

            this.dragData = null;
        };

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    handleDrop(ev) {
        if (!this.dragData) return;

        const workspace = document.getElementById('script-workspace');
        const wsRect = workspace.getBoundingClientRect();

        // Check if dropped on workspace
        if (ev.clientX >= wsRect.left && ev.clientX <= wsRect.right &&
            ev.clientY >= wsRect.top && ev.clientY <= wsRect.bottom) {

            const { blockId, blockDef, isFromWorkspace, instanceData } = this.dragData;

            // If from workspace, check if dropping into a c-block body
            const dropTarget = document.elementFromPoint(ev.clientX, ev.clientY);
            const cBlockBody = dropTarget?.closest('.c-block-body');

            if (cBlockBody && cBlockBody.closest('#workspace-canvas')) {
                // Dropping into a c-block
                this.addBlockToCBlock(blockId, blockDef, cBlockBody, instanceData);
            } else if (blockDef.type === 'hat' || !isFromWorkspace) {
                // Create new script stack
                const x = ev.clientX - wsRect.left + workspace.scrollLeft;
                const y = ev.clientY - wsRect.top + workspace.scrollTop;
                this.addBlockToWorkspace(blockId, blockDef, x, y, instanceData);
            } else if (isFromWorkspace) {
                // Try to snap to nearest stack
                const x = ev.clientX - wsRect.left + workspace.scrollLeft;
                const y = ev.clientY - wsRect.top + workspace.scrollTop;
                this.addBlockToWorkspace(blockId, blockDef, x, y, instanceData);
            }
        } else if (this.dragData.isFromWorkspace) {
            // Dragged out of workspace - remove block
            this.removeBlockFromWorkspace(this.dragData.instanceData);
        }
    }

    addBlockToWorkspace(blockId, blockDef, x, y, existingData) {
        // Check if we can snap to an existing stack
        const snappedStack = this.findSnapTarget(x, y);

        if (snappedStack && blockDef.type !== 'hat') {
            // Add to existing stack
            const instanceId = this.nextBlockId++;
            const blockData = {
                instanceId,
                blockId,
                values: existingData?.values || this.getDefaultValues(blockDef),
                children: existingData?.children || []
            };
            snappedStack.blocks.push(blockData);
        } else {
            // Create new stack
            const instanceId = this.nextBlockId++;
            const blockData = {
                instanceId,
                blockId,
                values: existingData?.values || this.getDefaultValues(blockDef),
                children: existingData?.children || []
            };

            const stack = {
                id: this.nextBlockId++,
                x,
                y,
                blocks: [blockData]
            };
            this.workspaceScripts.push(stack);
        }

        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    addBlockToCBlock(blockId, blockDef, cBlockBodyEl, existingData) {
        // Find the parent block's instance data
        const parentBlockEl = cBlockBodyEl.closest('.block');
        const parentInstanceId = parseInt(parentBlockEl.dataset.instanceId);

        // Find the parent in our data
        for (const stack of this.workspaceScripts) {
            const parent = this.findBlockInStack(stack.blocks, parentInstanceId);
            if (parent) {
                const instanceId = this.nextBlockId++;
                const blockData = {
                    instanceId,
                    blockId,
                    values: existingData?.values || this.getDefaultValues(blockDef),
                    children: []
                };
                if (!parent.children) parent.children = [];
                parent.children.push(blockData);
                break;
            }
        }

        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    findBlockInStack(blocks, instanceId) {
        for (const block of blocks) {
            if (block.instanceId === instanceId) return block;
            if (block.children) {
                const found = this.findBlockInStack(block.children, instanceId);
                if (found) return found;
            }
        }
        return null;
    }

    removeBlockFromWorkspace(instanceData) {
        if (!instanceData) return;
        const instanceId = instanceData.instanceId;

        for (let i = this.workspaceScripts.length - 1; i >= 0; i--) {
            const stack = this.workspaceScripts[i];
            this.removeBlockFromArray(stack.blocks, instanceId);
            if (stack.blocks.length === 0) {
                this.workspaceScripts.splice(i, 1);
            }
        }

        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    removeBlockFromArray(blocks, instanceId) {
        for (let i = blocks.length - 1; i >= 0; i--) {
            if (blocks[i].instanceId === instanceId) {
                blocks.splice(i, 1);
                return true;
            }
            if (blocks[i].children) {
                if (this.removeBlockFromArray(blocks[i].children, instanceId)) return true;
            }
        }
        return false;
    }

    findSnapTarget(x, y) {
        const threshold = 40;
        for (const stack of this.workspaceScripts) {
            const lastBlock = stack.blocks[stack.blocks.length - 1];
            const stackBottom = stack.y + stack.blocks.length * 42;
            const dx = Math.abs(x - stack.x);
            const dy = Math.abs(y - stackBottom);
            if (dx < 120 && dy < threshold) {
                return stack;
            }
        }
        return null;
    }

    getDefaultValues(blockDef) {
        const values = {};
        if (blockDef.inputs) {
            Object.entries(blockDef.inputs).forEach(([key, input]) => {
                values[key] = input.default;
            });
        }
        return values;
    }

    // ===== Workspace Rendering =====

    renderWorkspace() {
        this.workspace.innerHTML = '';

        this.workspaceScripts.forEach(stack => {
            const stackEl = document.createElement('div');
            stackEl.className = 'script-stack';
            stackEl.style.left = stack.x + 'px';
            stackEl.style.top = stack.y + 'px';
            stackEl.dataset.stackId = stack.id;

            stack.blocks.forEach(blockData => {
                const blockDef = this.blocks[blockData.blockId];
                if (!blockDef) return;

                const blockEl = this.createBlockElement(blockData.blockId, blockDef, blockData);
                stackEl.appendChild(blockEl);
            });

            // Make stack draggable
            this.makeStackDraggable(stackEl, stack);

            this.workspace.appendChild(stackEl);
        });

        // Add change listeners to all inputs in workspace
        this.workspace.querySelectorAll('.block-input, .block-select').forEach(input => {
            input.addEventListener('change', () => this.onWorkspaceInputChange(input));
            input.addEventListener('input', () => this.onWorkspaceInputChange(input));
            // Prevent drag when interacting with inputs
            input.addEventListener('pointerdown', (e) => e.stopPropagation());
        });
    }

    onWorkspaceInputChange(inputEl) {
        const blockEl = inputEl.closest('.block');
        const instanceId = parseInt(blockEl.dataset.instanceId);
        const inputKey = inputEl.dataset.input;
        let value = inputEl.value;

        if (inputEl.type === 'number') value = parseFloat(value) || 0;

        // Find and update the block data
        for (const stack of this.workspaceScripts) {
            const block = this.findBlockInStack(stack.blocks, instanceId);
            if (block) {
                if (!block.values) block.values = {};
                block.values[inputKey] = value;
                break;
            }
        }

        this.saveScriptsToObject();
    }

    makeStackDraggable(stackEl, stackData) {
        let isDragging = false;
        let startX, startY, origX, origY;

        stackEl.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            // Only start stack drag if clicking the first block's hat or the stack background
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            origX = stackData.x;
            origY = stackData.y;
            stackEl.style.zIndex = '100';

            const onMove = (ev) => {
                if (!isDragging) return;
                stackData.x = origX + (ev.clientX - startX);
                stackData.y = origY + (ev.clientY - startY);
                stackEl.style.left = stackData.x + 'px';
                stackEl.style.top = stackData.y + 'px';
            };

            const onUp = () => {
                isDragging = false;
                stackEl.style.zIndex = '';
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    initWorkspaceDrop() {
        // Allow dropping on workspace
        const workspace = document.getElementById('script-workspace');
        workspace.addEventListener('dragover', (e) => e.preventDefault());
    }

    // ===== Target Object =====

    setTarget(obj) {
        // Save current scripts first
        this.saveScriptsToObject();

        this.targetObject = obj;
        if (obj) {
            this.workspaceScripts = obj.userData.scripts || [];
            // Fix: ensure proper structure
            if (!Array.isArray(this.workspaceScripts)) {
                this.workspaceScripts = [];
                obj.userData.scripts = this.workspaceScripts;
            }
            document.getElementById('script-target-name').textContent = obj.userData.name;
        } else {
            this.workspaceScripts = [];
            document.getElementById('script-target-name').textContent = 'No object selected';
        }

        this.renderWorkspace();
    }

    saveScriptsToObject() {
        if (this.targetObject) {
            this.targetObject.userData.scripts = this.workspaceScripts;
        }
    }

    clearScripts() {
        this.workspaceScripts = [];
        if (this.targetObject) {
            this.targetObject.userData.scripts = [];
        }
        this.renderWorkspace();
    }

    // ===== Script Compilation =====

    compileScripts(obj) {
        const scripts = obj.userData.scripts || [];
        const compiled = [];

        scripts.forEach(stack => {
            if (!stack.blocks || stack.blocks.length === 0) return;

            const firstBlock = stack.blocks[0];
            const firstDef = this.blocks[firstBlock.blockId];
            if (!firstDef || firstDef.type !== 'hat') return;

            const compiledStack = {
                trigger: firstDef.code,
                triggerValues: firstBlock.values || {},
                commands: []
            };

            // Compile remaining blocks
            for (let i = 1; i < stack.blocks.length; i++) {
                compiledStack.commands.push(this.compileBlock(stack.blocks[i]));
            }

            compiled.push(compiledStack);
        });

        return compiled;
    }

    compileBlock(blockData) {
        const blockDef = this.blocks[blockData.blockId];
        if (!blockDef) return null;

        const compiled = {
            code: blockDef.code,
            values: blockData.values || {},
            type: blockDef.type
        };

        if (blockData.children && blockData.children.length > 0) {
            compiled.children = blockData.children.map(child => this.compileBlock(child));
        }

        return compiled;
    }
}
