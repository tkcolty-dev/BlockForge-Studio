/**
 * BlockCode - Scratch-like visual block coding system
 * Drag blocks from drawer to workspace. Drag back to drawer to delete.
 */
class BlockCode {
    constructor() {
        this.categories = this.defineCategories();
        this.blocks = this.defineBlocks();
        this.activeCategory = 'events';
        this.targetObject = null;
        this.workspaceScripts = [];
        this.nextBlockId = 1;

        this.drawer = document.getElementById('block-drawer');
        this.workspace = document.getElementById('workspace-canvas');
        this.palette = document.getElementById('block-palette');
        this.editorBody = document.getElementById('block-editor-body');

        // Drag state
        this._ghost = null;
        this._dragSource = null; // 'drawer' or {stackIdx, blockIdx} or {stackIdx, blockIdx, childIdx}
        this._dragBlockId = null;
        this._dragBlockDef = null;

        this.initPalette();
        this.renderDrawer();
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
            'event_start': { category: 'events', type: 'hat', label: 'When game starts', icon: '🏁', code: 'onStart' },
            'event_click': { category: 'events', type: 'hat', label: 'When this object clicked', icon: '👆', code: 'onClick' },
            'event_key': { category: 'events', type: 'hat', label: 'When key {key} pressed', icon: '⌨', inputs: { key: { type: 'select', options: ['W','A','S','D','Space','E','Q','1','2','3','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'], default: 'Space' } }, code: 'onKey' },
            'event_collide': { category: 'events', type: 'hat', label: 'When touching {object}', icon: '💥', inputs: { object: { type: 'select', options: ['any','player','coin','npc'], default: 'player' } }, code: 'onCollide' },
            'event_timer': { category: 'events', type: 'hat', label: 'Every {seconds} seconds', icon: '⏱', inputs: { seconds: { type: 'number', default: 1 } }, code: 'onTimer' },
            'motion_move': { category: 'motion', type: 'command', label: 'Move {direction} by {amount}', inputs: { direction: { type: 'select', options: ['forward','backward','left','right','up','down'], default: 'forward' }, amount: { type: 'number', default: 1 } }, code: 'move' },
            'motion_moveto': { category: 'motion', type: 'command', label: 'Move to X:{x} Y:{y} Z:{z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, z: { type: 'number', default: 0 } }, code: 'moveTo' },
            'motion_rotate': { category: 'motion', type: 'command', label: 'Rotate {axis} by {degrees}°', inputs: { axis: { type: 'select', options: ['X','Y','Z'], default: 'Y' }, degrees: { type: 'number', default: 15 } }, code: 'rotate' },
            'motion_spin': { category: 'motion', type: 'command', label: 'Spin {axis} forever speed {speed}', inputs: { axis: { type: 'select', options: ['X','Y','Z'], default: 'Y' }, speed: { type: 'number', default: 1 } }, code: 'spin' },
            'motion_glide': { category: 'motion', type: 'command', label: 'Glide to X:{x} Y:{y} Z:{z} in {time}s', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 }, time: { type: 'number', default: 1 } }, code: 'glide' },
            'motion_bounce': { category: 'motion', type: 'command', label: 'Bounce height {height} speed {speed}', inputs: { height: { type: 'number', default: 2 }, speed: { type: 'number', default: 2 } }, code: 'bounce' },
            'motion_follow_player': { category: 'motion', type: 'command', label: 'Follow player speed {speed}', inputs: { speed: { type: 'number', default: 2 } }, code: 'followPlayer' },
            'motion_patrol': { category: 'motion', type: 'command', label: 'Patrol distance {dist} speed {speed}', inputs: { dist: { type: 'number', default: 5 }, speed: { type: 'number', default: 2 } }, code: 'patrol' },
            'motion_orbit': { category: 'motion', type: 'command', label: 'Orbit radius {r} speed {s}', inputs: { r: { type: 'number', default: 3 }, s: { type: 'number', default: 1 } }, code: 'orbit' },
            'motion_look_at_player': { category: 'motion', type: 'command', label: 'Look at player', code: 'lookAtPlayer' },
            'motion_random_pos': { category: 'motion', type: 'command', label: 'Move to random spot range {range}', inputs: { range: { type: 'number', default: 10 } }, code: 'randomPos' },
            'motion_push_from_player': { category: 'motion', type: 'command', label: 'Push away from player force {f}', inputs: { f: { type: 'number', default: 3 } }, code: 'pushFromPlayer' },
            'control_wait': { category: 'control', type: 'command', label: 'Wait {seconds} seconds', inputs: { seconds: { type: 'number', default: 1 } }, code: 'wait' },
            'control_repeat': { category: 'control', type: 'c-block', label: 'Repeat {times} times', inputs: { times: { type: 'number', default: 10 } }, code: 'repeat' },
            'control_forever': { category: 'control', type: 'c-block', label: 'Forever', code: 'forever' },
            'control_if': { category: 'control', type: 'c-block', label: 'If {condition} then', inputs: { condition: { type: 'select', options: ['touching player','key pressed','variable > 0','random chance'], default: 'touching player' } }, code: 'if' },
            'control_if_else': { category: 'control', type: 'c-block', label: 'If {condition} then', inputs: { condition: { type: 'select', options: ['touching player','key pressed','variable > 0','health < 50','random chance','distance < 3'], default: 'touching player' } }, code: 'ifElse' },
            'control_wait_until': { category: 'control', type: 'command', label: 'Wait until {condition}', inputs: { condition: { type: 'select', options: ['touching player','key pressed','timer > 5'], default: 'touching player' } }, code: 'waitUntil' },
            'control_stop': { category: 'control', type: 'command', label: 'Stop {what}', inputs: { what: { type: 'select', options: ['this script','all scripts','other scripts'], default: 'this script' } }, code: 'stop' },
            'looks_color': { category: 'looks', type: 'command', label: 'Set color to {color}', inputs: { color: { type: 'color', default: '#ff0000' } }, code: 'setColor' },
            'looks_size': { category: 'looks', type: 'command', label: 'Set size to {percent}%', inputs: { percent: { type: 'number', default: 100 } }, code: 'setSize' },
            'looks_show': { category: 'looks', type: 'command', label: 'Show', code: 'show' },
            'looks_hide': { category: 'looks', type: 'command', label: 'Hide', code: 'hide' },
            'looks_glow': { category: 'looks', type: 'command', label: 'Glow {color} intensity {val}', inputs: { color: { type: 'color', default: '#ffffff' }, val: { type: 'number', default: 0.5 } }, code: 'glow' },
            'looks_opacity': { category: 'looks', type: 'command', label: 'Set opacity to {percent}%', inputs: { percent: { type: 'number', default: 50 } }, code: 'setOpacity' },
            'looks_say': { category: 'looks', type: 'command', label: 'Show text {text} for {time}s', inputs: { text: { type: 'text', default: 'Hello!' }, time: { type: 'number', default: 2 } }, code: 'say' },
            'looks_effect': { category: 'looks', type: 'command', label: 'Color shift speed {speed}', inputs: { speed: { type: 'number', default: 1 } }, code: 'colorShift' },
            'looks_scale_pulse': { category: 'looks', type: 'command', label: 'Pulse size min {min}% max {max}% speed {spd}', inputs: { min: { type: 'number', default: 80 }, max: { type: 'number', default: 120 }, spd: { type: 'number', default: 2 } }, code: 'scalePulse' },
            'looks_trail': { category: 'looks', type: 'command', label: 'Enable particle trail color {color}', inputs: { color: { type: 'color', default: '#ffff00' } }, code: 'trail' },
            'physics_gravity': { category: 'physics', type: 'command', label: 'Enable gravity', code: 'enableGravity' },
            'physics_nogravity': { category: 'physics', type: 'command', label: 'Disable gravity', code: 'disableGravity' },
            'physics_velocity': { category: 'physics', type: 'command', label: 'Set velocity X:{x} Y:{y} Z:{z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 } }, code: 'setVelocity' },
            'physics_impulse': { category: 'physics', type: 'command', label: 'Apply impulse {direction} force {force}', inputs: { direction: { type: 'select', options: ['up','forward','backward','left','right'], default: 'up' }, force: { type: 'number', default: 5 } }, code: 'impulse' },
            'physics_anchor': { category: 'physics', type: 'command', label: 'Set anchored {state}', inputs: { state: { type: 'select', options: ['true','false'], default: 'true' } }, code: 'setAnchored' },
            'physics_destroy': { category: 'physics', type: 'command', label: 'Destroy this object', code: 'destroy' },
            'physics_clone': { category: 'physics', type: 'command', label: 'Clone this object', code: 'clone' },
            'physics_teleport_player': { category: 'physics', type: 'command', label: 'Teleport player to X:{x} Y:{y} Z:{z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 } }, code: 'teleportPlayer' },
            'physics_explode': { category: 'physics', type: 'command', label: 'Explode force {force} radius {radius}', inputs: { force: { type: 'number', default: 10 }, radius: { type: 'number', default: 5 } }, code: 'explode' },
            'physics_launch_player': { category: 'physics', type: 'command', label: 'Launch player up force {force}', inputs: { force: { type: 'number', default: 15 } }, code: 'launchPlayer' },
            'physics_set_player_speed': { category: 'physics', type: 'command', label: 'Set player speed to {speed}', inputs: { speed: { type: 'number', default: 8 } }, code: 'setPlayerSpeed' },
            'sensing_distance': { category: 'sensing', type: 'reporter', label: 'Distance to player', code: 'distanceToPlayer' },
            'sensing_touching': { category: 'sensing', type: 'reporter', label: 'Touching {object}?', inputs: { object: { type: 'select', options: ['player','any','ground'], default: 'player' } }, code: 'isTouching' },
            'sensing_key_held': { category: 'sensing', type: 'reporter', label: 'Key {key} held?', inputs: { key: { type: 'select', options: ['W','A','S','D','Space','Shift'], default: 'Space' } }, code: 'isKeyHeld' },
            'sensing_timer': { category: 'sensing', type: 'reporter', label: 'Game timer', code: 'getTimer' },
            'sensing_player_grounded': { category: 'sensing', type: 'reporter', label: 'Player on ground?', code: 'playerGrounded' },
            'sensing_random': { category: 'sensing', type: 'reporter', label: 'Random {min} to {max}', inputs: { min: { type: 'number', default: 1 }, max: { type: 'number', default: 10 } }, code: 'random' },
            'sound_play': { category: 'sound', type: 'command', label: 'Play sound {sound}', inputs: { sound: { type: 'select', options: ['pop','ding','whoosh','boom','jump','coin','hurt','powerup'], default: 'pop' } }, code: 'playSound' },
            'sound_volume': { category: 'sound', type: 'command', label: 'Set volume to {percent}%', inputs: { percent: { type: 'number', default: 100 } }, code: 'setVolume' },
            'sound_pitch': { category: 'sound', type: 'command', label: 'Play tone freq {freq} for {dur}s', inputs: { freq: { type: 'number', default: 440 }, dur: { type: 'number', default: 0.3 } }, code: 'playTone' },
            'var_set': { category: 'variables', type: 'command', label: 'Set {var} to {value}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' }, value: { type: 'number', default: 0 } }, code: 'setVar' },
            'var_change': { category: 'variables', type: 'command', label: 'Change {var} by {amount}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' }, amount: { type: 'number', default: 1 } }, code: 'changeVar' },
            'var_show': { category: 'variables', type: 'command', label: 'Show {var} on screen', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','timer'], default: 'score' } }, code: 'showVar' },
            'var_if_check': { category: 'variables', type: 'c-block', label: 'If {var} {op} {value}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level'], default: 'score' }, op: { type: 'select', options: ['>','<','=','>=','<='], default: '>' }, value: { type: 'number', default: 10 } }, code: 'ifVar' },
            'var_reset_all': { category: 'variables', type: 'command', label: 'Reset all variables', code: 'resetVars' }
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

    // ===== Drawer (block source) =====

    renderDrawer() {
        this.drawer.innerHTML = '';
        Object.entries(this.blocks).forEach(([blockId, blockDef]) => {
            if (blockDef.category !== this.activeCategory) return;
            const el = this._createBlockEl(blockDef, null);
            el.dataset.blockId = blockId;
            // Start drag from drawer
            el.addEventListener('pointerdown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                e.preventDefault();
                this._startDrag(e, blockId, blockDef, 'drawer', el);
            });
            this.drawer.appendChild(el);
        });
    }

    // ===== Create a block DOM element =====

    _createBlockEl(blockDef, blockData) {
        const el = document.createElement('div');
        el.className = `block block-${blockDef.category}`;
        if (blockDef.type === 'hat') el.classList.add('hat');
        if (blockDef.type === 'reporter') el.classList.add('reporter');

        if (blockDef.type === 'c-block') {
            el.classList.add('c-block-container');
            const topDiv = document.createElement('div');
            topDiv.className = 'c-block-top';
            topDiv.innerHTML = this._buildLabel(blockDef, blockData);
            el.appendChild(topDiv);
            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'c-block-body';
            el.appendChild(bodyDiv);
            const bottomDiv = document.createElement('div');
            bottomDiv.className = 'c-block-bottom';
            el.appendChild(bottomDiv);
        } else {
            el.innerHTML = this._buildLabel(blockDef, blockData);
        }
        return el;
    }

    _buildLabel(blockDef, instanceData) {
        let label = blockDef.label;
        const icon = blockDef.icon ? `<span style="margin-right:4px">${blockDef.icon}</span>` : '';
        if (blockDef.inputs) {
            Object.entries(blockDef.inputs).forEach(([key, input]) => {
                const currentValue = instanceData?.values?.[key] ?? input.default;
                let replacement;
                if (input.type === 'number') {
                    replacement = `<input type="number" class="block-input" data-input="${key}" value="${currentValue}" step="0.1">`;
                } else if (input.type === 'text') {
                    replacement = `<input type="text" class="block-input" data-input="${key}" value="${currentValue}" style="width:80px">`;
                } else if (input.type === 'select') {
                    const options = input.options.map(opt =>
                        `<option value="${opt}" ${opt == currentValue ? 'selected' : ''}>${opt}</option>`
                    ).join('');
                    replacement = `<select class="block-select" data-input="${key}">${options}</select>`;
                } else if (input.type === 'color') {
                    replacement = `<input type="color" class="block-input" data-input="${key}" value="${currentValue}" style="width:40px;height:20px;padding:0;border-radius:4px">`;
                }
                if (replacement) label = label.replace(`{${key}}`, replacement);
            });
        }
        return icon + label;
    }

    _getDefaults(blockDef) {
        const values = {};
        if (blockDef.inputs) {
            Object.entries(blockDef.inputs).forEach(([key, input]) => {
                values[key] = input.default;
            });
        }
        return values;
    }

    // ===== Drag & Drop System =====

    _startDrag(e, blockId, blockDef, source, sourceEl) {
        // Create ghost element
        const ghost = sourceEl.cloneNode(true);
        ghost.className = sourceEl.className + ' block-ghost';
        ghost.style.width = sourceEl.offsetWidth + 'px';
        document.body.appendChild(ghost);

        this._ghost = ghost;
        this._dragBlockId = blockId;
        this._dragBlockDef = blockDef;
        this._dragSource = source;
        this._ghostOffsetX = e.clientX - sourceEl.getBoundingClientRect().left;
        this._ghostOffsetY = e.clientY - sourceEl.getBoundingClientRect().top;

        this._moveGhost(e);

        // If dragging from workspace, dim the source
        if (source !== 'drawer' && sourceEl) {
            sourceEl.style.opacity = '0.3';
            this._dragSourceEl = sourceEl;
        }

        const onMove = (ev) => this._moveGhost(ev);
        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            this._endDrag(ev);
        };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    _moveGhost(e) {
        if (!this._ghost) return;
        this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
        this._ghost.style.top = (e.clientY - this._ghostOffsetY) + 'px';

        // Highlight delete zone (drawer/palette area)
        const overDeleteZone = this._isOverDeleteZone(e);
        this._ghost.classList.toggle('ghost-deleting', overDeleteZone);
    }

    _isOverDeleteZone(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return false;
        return this.drawer.contains(el) || this.palette.contains(el);
    }

    _isOverWorkspace(e) {
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (!el) return false;
        const ws = document.getElementById('script-workspace');
        return el === ws || ws.contains(el);
    }

    _endDrag(e) {
        if (!this._ghost) return;
        this._ghost.remove();
        this._ghost = null;

        // Restore dimmed source
        if (this._dragSourceEl) {
            this._dragSourceEl.style.opacity = '';
            this._dragSourceEl = null;
        }

        const overDelete = this._isOverDeleteZone(e);
        const overWorkspace = this._isOverWorkspace(e);

        if (!this.targetObject) return;

        if (this._dragSource === 'drawer') {
            // Dragging from drawer -> drop on workspace to add
            if (overWorkspace) {
                this._dropNewBlock(e);
            }
        } else {
            // Dragging from workspace
            if (overDelete) {
                // Drop on drawer/palette = delete
                this._deleteFromSource();
            }
            // Otherwise: block stays where it was (snap back)
        }

        this._dragSource = null;
        this._dragBlockId = null;
        this._dragBlockDef = null;
    }

    _dropNewBlock(e) {
        const blockId = this._dragBlockId;
        const blockDef = this._dragBlockDef;
        const instanceId = this.nextBlockId++;
        const blockData = {
            instanceId, blockId,
            values: this._getDefaults(blockDef),
            children: []
        };

        // Calculate position relative to workspace canvas
        const wsRect = this.workspace.getBoundingClientRect();
        const dropX = e.clientX - wsRect.left;
        const dropY = e.clientY - wsRect.top;

        // Check if dropping into a c-block body
        const cBlockTarget = this._findCBlockBodyAt(e);
        if (cBlockTarget && blockDef.type !== 'hat') {
            const parent = this.workspaceScripts[cBlockTarget.stackIdx]?.blocks[cBlockTarget.blockIdx];
            if (parent) {
                if (!parent.children) parent.children = [];
                parent.children.push(blockData);
                this.renderWorkspace();
                this.saveScriptsToObject();
                return;
            }
        }

        // Check if dropping onto an existing stack (append at end)
        const stackTarget = this._findStackAt(e);
        if (stackTarget !== null && blockDef.type !== 'hat') {
            this.workspaceScripts[stackTarget].blocks.push(blockData);
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        // Create new stack at drop position
        const stack = {
            id: this.nextBlockId++,
            x: Math.max(10, dropX - 20),
            y: Math.max(10, dropY - 10),
            blocks: [blockData]
        };
        this.workspaceScripts.push(stack);
        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    _findStackAt(e) {
        const stacks = this.workspace.querySelectorAll('.script-stack');
        for (const stackEl of stacks) {
            const rect = stackEl.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top - 10 && e.clientY <= rect.bottom + 20) {
                return parseInt(stackEl.dataset.stackIdx);
            }
        }
        return null;
    }

    _findCBlockBodyAt(e) {
        const bodies = this.workspace.querySelectorAll('.c-block-body');
        for (const body of bodies) {
            const rect = body.getBoundingClientRect();
            if (e.clientX >= rect.left && e.clientX <= rect.right &&
                e.clientY >= rect.top && e.clientY <= rect.bottom) {
                const stackIdx = parseInt(body.dataset.stackIdx);
                const blockIdx = parseInt(body.dataset.blockIdx);
                if (!isNaN(stackIdx) && !isNaN(blockIdx)) {
                    return { stackIdx, blockIdx };
                }
            }
        }
        return null;
    }

    _deleteFromSource() {
        const src = this._dragSource;
        if (!src || src === 'drawer') return;

        if (src.childIdx !== undefined) {
            const stack = this.workspaceScripts[src.stackIdx];
            if (!stack) return;
            const parent = stack.blocks[src.blockIdx];
            if (parent && parent.children) {
                parent.children.splice(src.childIdx, 1);
            }
        } else {
            const stack = this.workspaceScripts[src.stackIdx];
            if (!stack) return;
            stack.blocks.splice(src.blockIdx, 1);
            if (stack.blocks.length === 0) {
                this.workspaceScripts.splice(src.stackIdx, 1);
            }
        }
        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    // ===== Workspace Rendering =====

    renderWorkspace() {
        this.workspace.innerHTML = '';

        this.workspaceScripts.forEach((stack, stackIdx) => {
            const stackEl = document.createElement('div');
            stackEl.className = 'script-stack';
            stackEl.style.left = stack.x + 'px';
            stackEl.style.top = stack.y + 'px';
            stackEl.dataset.stackIdx = stackIdx;

            stack.blocks.forEach((blockData, blockIdx) => {
                const blockDef = this.blocks[blockData.blockId];
                if (!blockDef) return;

                const blockEl = this._createWorkspaceBlock(blockData, blockDef, stackIdx, blockIdx);
                stackEl.appendChild(blockEl);
            });

            // Make entire stack draggable by dragging its first block
            this._makeStackDraggable(stackEl, stack);

            this.workspace.appendChild(stackEl);
        });

        // Wire up input change listeners
        this.workspace.querySelectorAll('.block-input, .block-select').forEach(input => {
            input.addEventListener('change', () => this._onInputChange(input));
            input.addEventListener('input', () => this._onInputChange(input));
            input.addEventListener('pointerdown', (e) => e.stopPropagation());
            input.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    _createWorkspaceBlock(blockData, blockDef, stackIdx, blockIdx) {
        const el = document.createElement('div');
        el.className = `block block-${blockDef.category}`;
        if (blockDef.type === 'hat') el.classList.add('hat');
        if (blockDef.type === 'reporter') el.classList.add('reporter');
        el.dataset.instanceId = blockData.instanceId;
        el.dataset.stackIdx = stackIdx;
        el.dataset.blockIdx = blockIdx;

        if (blockDef.type === 'c-block') {
            el.classList.add('c-block-container');
            const topDiv = document.createElement('div');
            topDiv.className = 'c-block-top';
            topDiv.innerHTML = this._buildLabel(blockDef, blockData);
            el.appendChild(topDiv);

            const bodyDiv = document.createElement('div');
            bodyDiv.className = 'c-block-body';
            bodyDiv.dataset.stackIdx = stackIdx;
            bodyDiv.dataset.blockIdx = blockIdx;

            if (blockData.children && blockData.children.length > 0) {
                blockData.children.forEach((childData, childIdx) => {
                    const childDef = this.blocks[childData.blockId];
                    if (!childDef) return;
                    const childEl = this._createWorkspaceBlock(childData, childDef, stackIdx, blockIdx);
                    childEl.dataset.childIdx = childIdx;

                    // Individual block drag from workspace (for deletion or rearranging)
                    childEl.addEventListener('pointerdown', (e) => {
                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                        e.preventDefault();
                        e.stopPropagation();
                        this._startDrag(e, childData.blockId, childDef,
                            { stackIdx, blockIdx, childIdx }, childEl);
                    });

                    bodyDiv.appendChild(childEl);
                });
            }

            el.appendChild(bodyDiv);
            const bottomDiv = document.createElement('div');
            bottomDiv.className = 'c-block-bottom';
            el.appendChild(bottomDiv);
        } else {
            el.innerHTML = this._buildLabel(blockDef, blockData);
        }

        return el;
    }

    _makeStackDraggable(stackEl, stackData) {
        let isDragging = false;
        let startX, startY, origX, origY;

        stackEl.addEventListener('pointerdown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            origX = stackData.x;
            origY = stackData.y;
            stackEl.style.zIndex = '100';
            e.preventDefault();

            const onMove = (ev) => {
                if (!isDragging) return;
                stackData.x = origX + (ev.clientX - startX);
                stackData.y = origY + (ev.clientY - startY);
                stackEl.style.left = stackData.x + 'px';
                stackEl.style.top = stackData.y + 'px';

                // Visual feedback when over delete zone
                stackEl.style.opacity = this._isOverDeleteZone(ev) ? '0.4' : '';
            };

            const onUp = (ev) => {
                isDragging = false;
                stackEl.style.zIndex = '';
                stackEl.style.opacity = '';
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);

                // If dropped on palette/drawer, delete the stack
                if (this._isOverDeleteZone(ev)) {
                    const idx = this.workspaceScripts.indexOf(stackData);
                    if (idx !== -1) {
                        this.workspaceScripts.splice(idx, 1);
                        this.renderWorkspace();
                        this.saveScriptsToObject();
                    }
                }
            };

            document.addEventListener('pointermove', onMove);
            document.addEventListener('pointerup', onUp);
        });
    }

    _onInputChange(inputEl) {
        const blockEl = inputEl.closest('.block');
        const instanceId = parseInt(blockEl.dataset.instanceId);
        const inputKey = inputEl.dataset.input;
        let value = inputEl.value;
        if (inputEl.type === 'number') value = parseFloat(value) || 0;

        for (const stack of this.workspaceScripts) {
            const block = this._findBlock(stack.blocks, instanceId);
            if (block) {
                if (!block.values) block.values = {};
                block.values[inputKey] = value;
                break;
            }
        }
        this.saveScriptsToObject();
    }

    _findBlock(blocks, instanceId) {
        for (const block of blocks) {
            if (block.instanceId === instanceId) return block;
            if (block.children) {
                const found = this._findBlock(block.children, instanceId);
                if (found) return found;
            }
        }
        return null;
    }

    // ===== Target Object =====

    setTarget(obj) {
        this.saveScriptsToObject();
        this.targetObject = obj;
        if (obj) {
            this.workspaceScripts = obj.userData.scripts || [];
            if (!Array.isArray(this.workspaceScripts)) {
                this.workspaceScripts = [];
                obj.userData.scripts = this.workspaceScripts;
            }
            document.getElementById('script-target-name').textContent = obj.userData.name;
        } else {
            this.workspaceScripts = [];
            document.getElementById('script-target-name').textContent = 'No object selected';
        }
        this._syncNextId();
        this.renderWorkspace();
    }

    _syncNextId() {
        const findMax = (blocks) => {
            let max = 0;
            for (const b of blocks) {
                if (b.instanceId > max) max = b.instanceId;
                if (b.children) max = Math.max(max, findMax(b.children));
            }
            return max;
        };
        let maxId = 0;
        for (const stack of this.workspaceScripts) {
            if (stack.id > maxId) maxId = stack.id;
            maxId = Math.max(maxId, findMax(stack.blocks));
        }
        if (maxId >= this.nextBlockId) this.nextBlockId = maxId + 1;
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
            for (let i = 1; i < stack.blocks.length; i++) {
                compiledStack.commands.push(this._compileBlock(stack.blocks[i]));
            }
            compiled.push(compiledStack);
        });
        return compiled;
    }

    _compileBlock(blockData) {
        const blockDef = this.blocks[blockData.blockId];
        if (!blockDef) return null;
        const compiled = {
            code: blockDef.code,
            values: blockData.values || {},
            type: blockDef.type
        };
        if (blockData.children && blockData.children.length > 0) {
            compiled.children = blockData.children.map(child => this._compileBlock(child));
        }
        return compiled;
    }
}
