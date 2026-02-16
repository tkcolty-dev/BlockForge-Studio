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
        this.customBlocks = {}; // user-created blocks
        this.customVariables = []; // user-created variable names
        this.customMessages = []; // user-created message names
        this.onScriptsChanged = null; // collab callback
        this.drawer = document.getElementById('block-drawer');
        this.workspace = document.getElementById('workspace-canvas');
        this.palette = document.getElementById('block-palette');
        this.editorBody = document.getElementById('block-editor-body');

        // Drag state
        this._ghost = null;
        this._dragSource = null;
        this._dragBlockId = null;
        this._dragBlockDef = null;
        this._currentSnapTarget = null;
        this._snapIndicator = null;
        this._excludeStackIdx = null;
        this._draggedBlocks = null;
        this._dragStackData = null;
        this._activeMoveHandler = null;
        this._activeUpHandler = null;

        // Backpack
        this.backpackItems = [];
        this.onBackpackChanged = null;

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
            variables: { name: 'Variables', color: '#FF8C1A', darkColor: '#DB6E00' },
            myblocks: { name: 'My Blocks', color: '#FF6680', darkColor: '#CC4466' },
            shooting: { name: 'Shooting', color: '#E03030', darkColor: '#B01818' },
            enemies: { name: 'Enemies', color: '#CC3333', darkColor: '#991919' },
            items: { name: 'Items', color: '#44BB44', darkColor: '#2D882D' },
            effects: { name: 'Effects', color: '#E67E22', darkColor: '#BA6418' },
            camera: { name: 'Camera', color: '#8E44AD', darkColor: '#6C3483' },
            ui: { name: 'UI', color: '#E91E63', darkColor: '#C2185B' }
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
            'motion_spin': { category: 'motion', type: 'command', label: 'Spin {axis} speed {speed}', inputs: { axis: { type: 'select', options: ['X','Y','Z'], default: 'Y' }, speed: { type: 'number', default: 1 } }, code: 'spin' },
            'motion_glide': { category: 'motion', type: 'command', label: 'Glide to {x} {y} {z} in {time}s', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 }, time: { type: 'number', default: 1 } }, code: 'glide' },
            'motion_bounce': { category: 'motion', type: 'command', label: 'Bounce height {height} speed {speed}', inputs: { height: { type: 'number', default: 2 }, speed: { type: 'number', default: 2 } }, code: 'bounce' },
            'motion_follow_player': { category: 'motion', type: 'command', label: 'Follow player speed {speed}', inputs: { speed: { type: 'number', default: 2 } }, code: 'followPlayer' },
            'motion_patrol': { category: 'motion', type: 'command', label: 'Patrol distance {dist} speed {speed}', inputs: { dist: { type: 'number', default: 5 }, speed: { type: 'number', default: 2 } }, code: 'patrol' },
            'motion_orbit': { category: 'motion', type: 'command', label: 'Orbit radius {r} speed {s}', inputs: { r: { type: 'number', default: 3 }, s: { type: 'number', default: 1 } }, code: 'orbit' },
            'motion_look_at_player': { category: 'motion', type: 'command', label: 'Look at player', code: 'lookAtPlayer' },
            'motion_random_pos': { category: 'motion', type: 'command', label: 'Random pos range {range}', inputs: { range: { type: 'number', default: 10 } }, code: 'randomPos' },
            'motion_push_from_player': { category: 'motion', type: 'command', label: 'Push from player {f}', inputs: { f: { type: 'number', default: 3 } }, code: 'pushFromPlayer' },
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
            'looks_scale_pulse': { category: 'looks', type: 'command', label: 'Pulse {min}% to {max}% speed {spd}', inputs: { min: { type: 'number', default: 80 }, max: { type: 'number', default: 120 }, spd: { type: 'number', default: 2 } }, code: 'scalePulse' },
            'looks_trail': { category: 'looks', type: 'command', label: 'Trail color {color}', inputs: { color: { type: 'color', default: '#ffff00' } }, code: 'trail' },
            'looks_particles': { category: 'looks', type: 'command', label: 'Emit particles {type} color {color}', inputs: { type: { type: 'select', options: ['burst','sparkle','fire','snow'], default: 'burst' }, color: { type: 'color', default: '#ffff00' } }, code: 'emitParticles' },
            'looks_stop_particles': { category: 'looks', type: 'command', label: 'Stop particles', code: 'stopParticles' },
            'physics_gravity': { category: 'physics', type: 'command', label: 'Enable gravity', code: 'enableGravity' },
            'physics_nogravity': { category: 'physics', type: 'command', label: 'Disable gravity', code: 'disableGravity' },
            'physics_velocity': { category: 'physics', type: 'command', label: 'Velocity {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 } }, code: 'setVelocity' },
            'physics_impulse': { category: 'physics', type: 'command', label: 'Impulse {direction} force {force}', inputs: { direction: { type: 'select', options: ['up','forward','backward','left','right'], default: 'up' }, force: { type: 'number', default: 5 } }, code: 'impulse' },
            'physics_anchor': { category: 'physics', type: 'command', label: 'Set anchored {state}', inputs: { state: { type: 'select', options: ['true','false'], default: 'true' } }, code: 'setAnchored' },
            'physics_destroy': { category: 'physics', type: 'command', label: 'Destroy this object', code: 'destroy' },
            'physics_clone': { category: 'physics', type: 'command', label: 'Clone this object', code: 'clone' },
            'physics_teleport_player': { category: 'physics', type: 'command', label: 'Teleport player {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 } }, code: 'teleportPlayer' },
            'physics_explode': { category: 'physics', type: 'command', label: 'Explode {force} radius {radius}', inputs: { force: { type: 'number', default: 10 }, radius: { type: 'number', default: 5 } }, code: 'explode' },
            'physics_launch_player': { category: 'physics', type: 'command', label: 'Launch player force {force}', inputs: { force: { type: 'number', default: 15 } }, code: 'launchPlayer' },
            'physics_set_player_speed': { category: 'physics', type: 'command', label: 'Player speed {speed}', inputs: { speed: { type: 'number', default: 8 } }, code: 'setPlayerSpeed' },
            'sensing_distance': { category: 'sensing', type: 'reporter', label: 'Distance to player', code: 'distanceToPlayer' },
            'sensing_touching': { category: 'sensing', type: 'reporter', label: 'Touching {object}?', inputs: { object: { type: 'select', options: ['player','any','ground'], default: 'player' } }, code: 'isTouching' },
            'sensing_key_held': { category: 'sensing', type: 'reporter', label: 'Key {key} held?', inputs: { key: { type: 'select', options: ['W','A','S','D','Space','Shift'], default: 'Space' } }, code: 'isKeyHeld' },
            'sensing_timer': { category: 'sensing', type: 'reporter', label: 'Game timer', code: 'getTimer' },
            'sensing_player_grounded': { category: 'sensing', type: 'reporter', label: 'Player on ground?', code: 'playerGrounded' },
            'sensing_random': { category: 'sensing', type: 'reporter', label: 'Random {min} to {max}', inputs: { min: { type: 'number', default: 1 }, max: { type: 'number', default: 10 } }, code: 'random' },
            'sound_play': { category: 'sound', type: 'command', label: 'Play sound {sound}', inputs: { sound: { type: 'select', options: ['pop','ding','whoosh','boom','jump','coin','hurt','powerup','laser','explosion','splash','click','bell','alarm','magic','swoosh','beep','chime'], default: 'pop' } }, code: 'playSound' },
            'sound_volume': { category: 'sound', type: 'command', label: 'Set volume to {percent}%', inputs: { percent: { type: 'number', default: 100 } }, code: 'setVolume' },
            'sound_pitch': { category: 'sound', type: 'command', label: 'Tone {freq}hz for {dur}s', inputs: { freq: { type: 'number', default: 440 }, dur: { type: 'number', default: 0.3 } }, code: 'playTone' },
            'var_set': { category: 'variables', type: 'command', label: 'Set {var} to {value}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' }, value: { type: 'number', default: 0 } }, code: 'setVar' },
            'var_change': { category: 'variables', type: 'command', label: 'Change {var} by {amount}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','custom'], default: 'score' }, amount: { type: 'number', default: 1 } }, code: 'changeVar' },
            'var_show': { category: 'variables', type: 'command', label: 'Show {var} on screen', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level','timer'], default: 'score' } }, code: 'showVar' },
            'var_if_check': { category: 'variables', type: 'c-block', label: 'If {var} {op} {value}', inputs: { var: { type: 'select', options: ['score','health','coins','speed','level'], default: 'score' }, op: { type: 'select', options: ['>','<','=','>=','<='], default: '>' }, value: { type: 'number', default: 10 } }, code: 'ifVar' },
            'var_reset_all': { category: 'variables', type: 'command', label: 'Reset all variables', code: 'resetVars' },

            // === New Events ===
            'event_message': { category: 'events', type: 'hat', label: 'When I receive {msg}', icon: '📨', inputs: { msg: { type: 'select', options: ['message1','message2','message3','go','stop','reset'], default: 'message1' } }, code: 'onMessage' },

            // === New Motion ===
            'motion_smooth_move': { category: 'motion', type: 'command', label: 'Glide {dir} {amt} in {time}s', inputs: { dir: { type: 'select', options: ['forward','backward','left','right','up','down'], default: 'forward' }, amt: { type: 'number', default: 3 }, time: { type: 'number', default: 0.5 } }, code: 'smoothMove' },
            'motion_align_to_grid': { category: 'motion', type: 'command', label: 'Snap to grid size {size}', inputs: { size: { type: 'number', default: 1 } }, code: 'snapToGrid' },
            'motion_face_direction': { category: 'motion', type: 'command', label: 'Face {dir}', inputs: { dir: { type: 'select', options: ['north','south','east','west','player'], default: 'north' } }, code: 'faceDirection' },
            'motion_set_rotation': { category: 'motion', type: 'command', label: 'Rotation {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, z: { type: 'number', default: 0 } }, code: 'setRotation' },

            // === New Control ===
            'control_broadcast': { category: 'control', type: 'command', label: 'Broadcast {msg}', inputs: { msg: { type: 'select', options: ['message1','message2','message3','go','stop','reset'], default: 'message1' } }, code: 'broadcast' },
            'control_while': { category: 'control', type: 'c-block', label: 'While {condition}', inputs: { condition: { type: 'select', options: ['touching player','key pressed','variable > 0','health > 0','timer < 10'], default: 'touching player' } }, code: 'while' },
            'control_for_each': { category: 'control', type: 'c-block', label: 'For {var} from {start} to {end}', inputs: { var: { type: 'select', options: ['i','j','count'], default: 'i' }, start: { type: 'number', default: 1 }, end: { type: 'number', default: 10 } }, code: 'forEach' },

            // === New Looks ===
            'looks_tint': { category: 'looks', type: 'command', label: 'Tint {color} amount {amount}%', inputs: { color: { type: 'color', default: '#ff0000' }, amount: { type: 'number', default: 50 } }, code: 'tint' },
            'looks_wireframe': { category: 'looks', type: 'command', label: 'Set wireframe {state}', inputs: { state: { type: 'select', options: ['on','off'], default: 'on' } }, code: 'wireframe' },
            'looks_flash': { category: 'looks', type: 'command', label: 'Flash {color} {times} times', inputs: { color: { type: 'color', default: '#ffffff' }, times: { type: 'number', default: 3 } }, code: 'flash' },
            'looks_billboard_text': { category: 'looks', type: 'command', label: 'Show label {text}', inputs: { text: { type: 'text', default: 'Label' } }, code: 'billboardText' },
            'looks_player_color': { category: 'looks', type: 'command', label: 'Set player {part} color {color}', inputs: { part: { type: 'select', options: ['body','head','detail'], default: 'body' }, color: { type: 'color', default: '#4c97ff' } }, code: 'setPlayerColor' },
            'looks_npc_color': { category: 'looks', type: 'command', label: 'Set NPC {part} color {color}', inputs: { part: { type: 'select', options: ['body','head','legs'], default: 'body' }, color: { type: 'color', default: '#3498db' } }, code: 'setNpcColor' },

            // === Camera ===
            'camera_switch': { category: 'camera', type: 'command', label: 'Use this camera', code: 'cameraSwitch' },
            'camera_switch_back': { category: 'camera', type: 'command', label: 'Use player camera', code: 'cameraSwitchBack' },
            'camera_look_at': { category: 'camera', type: 'command', label: 'Look at {target}', inputs: { target: { type: 'select', options: ['player','this object','origin'], default: 'player' } }, code: 'cameraLookAt' },
            'camera_move_to': { category: 'camera', type: 'command', label: 'Set pos {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 10 } }, code: 'cameraMoveTo' },
            'camera_glide_to': { category: 'camera', type: 'command', label: 'Glide to {x} {y} {z} in {time}s', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 10 }, time: { type: 'number', default: 1 } }, code: 'cameraGlideTo' },
            'camera_follow': { category: 'camera', type: 'command', label: 'Follow {target} dist {dist}', inputs: { target: { type: 'select', options: ['player','this object'], default: 'player' }, dist: { type: 'number', default: 8 } }, code: 'cameraFollow' },
            'camera_shake': { category: 'camera', type: 'command', label: 'Shake {intensity} for {time}s', inputs: { intensity: { type: 'number', default: 0.3 }, time: { type: 'number', default: 0.5 } }, code: 'cameraShake' },
            'camera_fov': { category: 'camera', type: 'command', label: 'Set FOV {fov}', inputs: { fov: { type: 'number', default: 75 } }, code: 'cameraFov' },

            // === New Physics ===
            'physics_freeze': { category: 'physics', type: 'command', label: 'Freeze in place', code: 'freeze' },
            'physics_unfreeze': { category: 'physics', type: 'command', label: 'Unfreeze', code: 'unfreeze' },
            'physics_attract': { category: 'physics', type: 'command', label: 'Attract force {force} range {radius}', inputs: { force: { type: 'number', default: 3 }, radius: { type: 'number', default: 8 } }, code: 'attract' },
            'physics_set_gravity': { category: 'physics', type: 'command', label: 'Gravity {g}', inputs: { g: { type: 'number', default: -20 } }, code: 'setWorldGravity' },
            'physics_spawn_object': { category: 'physics', type: 'command', label: 'Spawn {shape} {x} {y} {z}', inputs: { shape: { type: 'select', options: ['box','sphere','cylinder','cone','wall','platform','pyramid','coin','gem'], default: 'box' }, x: { type: 'number', default: 0 }, y: { type: 'number', default: 2 }, z: { type: 'number', default: 0 } }, code: 'spawnObject' },
            'physics_spawn_color': { category: 'physics', type: 'command', label: 'Spawn {shape} color {color}', inputs: { shape: { type: 'select', options: ['box','sphere','cylinder','cone','wall','platform','pyramid'], default: 'box' }, color: { type: 'color', default: '#4c97ff' } }, code: 'spawnObjectColor' },
            'physics_spawn_at_player': { category: 'physics', type: 'command', label: 'Spawn {shape} at player', inputs: { shape: { type: 'select', options: ['box','sphere','cylinder','cone','wall','platform','pyramid'], default: 'box' } }, code: 'spawnAtPlayer' },
            'physics_remove_last': { category: 'physics', type: 'command', label: 'Remove last spawned', code: 'removeLastSpawned' },
            'physics_remove_all': { category: 'physics', type: 'command', label: 'Remove all spawned', code: 'removeAllSpawned' },
            'physics_clone_at': { category: 'physics', type: 'command', label: 'Clone at {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 0 }, z: { type: 'number', default: 0 } }, code: 'cloneAt' },

            // === New Sound ===
            'sound_stop_all': { category: 'sound', type: 'command', label: 'Stop all sounds', code: 'stopAllSounds' },
            'sound_play_note': { category: 'sound', type: 'command', label: 'Play note {note} for {dur}s', inputs: { note: { type: 'select', options: ['C4','D4','E4','F4','G4','A4','B4','C5'], default: 'C4' }, dur: { type: 'number', default: 0.3 } }, code: 'playNote' },
            'sound_drum': { category: 'sound', type: 'command', label: 'Play drum {type}', inputs: { type: { type: 'select', options: ['kick','snare','hihat','clap'], default: 'kick' } }, code: 'playDrum' },

            // === New Variables ===
            'var_show_message': { category: 'variables', type: 'command', label: 'Show message {text} for {time}s', inputs: { text: { type: 'text', default: 'You win!' }, time: { type: 'number', default: 3 } }, code: 'showMessage' },
            'var_game_over': { category: 'variables', type: 'command', label: 'Game Over {result}', inputs: { result: { type: 'select', options: ['win','lose'], default: 'win' } }, code: 'gameOver' },
            'var_save_checkpoint': { category: 'variables', type: 'command', label: 'Save checkpoint', code: 'saveCheckpoint' },
            'var_load_checkpoint': { category: 'variables', type: 'command', label: 'Load checkpoint', code: 'loadCheckpoint' },

            // ===== Shooting =====
            'shoot_event_fire': { category: 'shooting', type: 'hat', label: 'When player shoots', icon: '🔫', code: 'onShoot' },
            'shoot_event_hit': { category: 'shooting', type: 'hat', label: 'When hit by projectile', icon: '💥', code: 'onProjectileHit' },
            'shoot_fire_player': { category: 'shooting', type: 'command', label: 'Fire from player speed {speed} color {color}', inputs: { speed: { type: 'number', default: 30 }, color: { type: 'color', default: '#ff0000' } }, code: 'fireFromPlayer' },
            'shoot_fire_at_player': { category: 'shooting', type: 'command', label: 'Fire at player speed {speed} color {color}', inputs: { speed: { type: 'number', default: 20 }, color: { type: 'color', default: '#ff4400' } }, code: 'fireAtPlayer' },
            'shoot_fire_forward': { category: 'shooting', type: 'command', label: 'Fire forward speed {speed} color {color}', inputs: { speed: { type: 'number', default: 25 }, color: { type: 'color', default: '#00ccff' } }, code: 'fireForward' },
            'shoot_set_damage': { category: 'shooting', type: 'command', label: 'Set projectile damage {damage}', inputs: { damage: { type: 'number', default: 10 } }, code: 'setProjectileDamage' },
            'shoot_set_fire_rate': { category: 'shooting', type: 'command', label: 'Set fire rate every {seconds}s', inputs: { seconds: { type: 'number', default: 0.3 } }, code: 'setFireRate' },
            'shoot_set_size': { category: 'shooting', type: 'command', label: 'Set projectile size {size}', inputs: { size: { type: 'number', default: 0.15 } }, code: 'setProjectileSize' },
            'shoot_set_lifetime': { category: 'shooting', type: 'command', label: 'Projectile lifetime {seconds}s', inputs: { seconds: { type: 'number', default: 3 } }, code: 'setProjectileLifetime' },

            // ===== Health/Damage =====
            'health_set_max': { category: 'variables', type: 'command', label: 'Set max health to {value}', inputs: { value: { type: 'number', default: 100 } }, code: 'setMaxHealth' },
            'health_set': { category: 'variables', type: 'command', label: 'Set health to {value}', inputs: { value: { type: 'number', default: 100 } }, code: 'setHealth' },
            'health_change': { category: 'variables', type: 'command', label: 'Change health by {amount}', inputs: { amount: { type: 'number', default: -10 } }, code: 'changeHealth' },
            'health_heal': { category: 'variables', type: 'command', label: 'Heal {amount}', inputs: { amount: { type: 'number', default: 25 } }, code: 'heal' },
            'health_show_bar': { category: 'variables', type: 'command', label: 'Show health bar', code: 'showHealthBar' },
            'health_set_damage': { category: 'physics', type: 'command', label: 'Set contact damage {damage}', inputs: { damage: { type: 'number', default: 10 } }, code: 'setContactDamage' },
            'health_set_invincibility': { category: 'variables', type: 'command', label: 'Invincibility for {seconds}s', inputs: { seconds: { type: 'number', default: 1 } }, code: 'setInvincibility' },
            'event_health_zero': { category: 'events', type: 'hat', label: 'When health reaches 0', icon: '💀', code: 'onHealthZero' },

            // ===== Enemies =====
            'enemy_set_as': { category: 'enemies', type: 'command', label: 'Set as enemy health {health}', inputs: { health: { type: 'number', default: 50 } }, code: 'setAsEnemy' },
            'enemy_follow': { category: 'enemies', type: 'command', label: 'Chase player speed {speed}', inputs: { speed: { type: 'number', default: 3 } }, code: 'enemyFollow' },
            'enemy_patrol': { category: 'enemies', type: 'command', label: 'Enemy patrol {dist} speed {speed}', inputs: { dist: { type: 'number', default: 5 }, speed: { type: 'number', default: 2 } }, code: 'enemyPatrol' },
            'enemy_wander': { category: 'enemies', type: 'command', label: 'Wander radius {radius} speed {speed}', inputs: { radius: { type: 'number', default: 5 }, speed: { type: 'number', default: 1.5 } }, code: 'enemyWander' },
            'enemy_attack_touch': { category: 'enemies', type: 'command', label: 'Attack on touch damage {damage}', inputs: { damage: { type: 'number', default: 10 } }, code: 'enemyAttackTouch' },
            'enemy_attack_ranged': { category: 'enemies', type: 'command', label: 'Shoot every {seconds}s dmg {damage}', inputs: { seconds: { type: 'number', default: 2 }, damage: { type: 'number', default: 5 } }, code: 'enemyAttackRanged' },
            'enemy_set_health': { category: 'enemies', type: 'command', label: 'Set enemy health to {value}', inputs: { value: { type: 'number', default: 50 } }, code: 'setEnemyHealth' },
            'enemy_show_health': { category: 'enemies', type: 'command', label: 'Show enemy health bar', code: 'showEnemyHealthBar' },
            'event_enemy_defeated': { category: 'events', type: 'hat', label: 'When this enemy defeated', icon: '💀', code: 'onEnemyDefeated' },

            // ===== Items/Inventory =====
            'item_set_pickup': { category: 'items', type: 'command', label: 'Set as pickup type {type}', inputs: { type: { type: 'select', options: ['key','potion','powerup','coin','gem','custom'], default: 'key' } }, code: 'setAsPickup' },
            'item_set_pickup_name': { category: 'items', type: 'command', label: 'Set pickup name {name}', inputs: { name: { type: 'text', default: 'Gold Key' } }, code: 'setPickupName' },
            'item_set_effect': { category: 'items', type: 'command', label: 'On pickup {effect} {amount}', inputs: { effect: { type: 'select', options: ['heal','speed boost','score','none'], default: 'heal' }, amount: { type: 'number', default: 25 } }, code: 'setPickupEffect' },
            'event_item_collected': { category: 'events', type: 'hat', label: 'When item collected', icon: '🎒', code: 'onItemCollected' },
            'item_add': { category: 'items', type: 'command', label: 'Add {item} to inventory', inputs: { item: { type: 'text', default: 'Gold Key' } }, code: 'addToInventory' },
            'item_remove': { category: 'items', type: 'command', label: 'Remove {item} from inventory', inputs: { item: { type: 'text', default: 'Gold Key' } }, code: 'removeFromInventory' },
            'item_has': { category: 'items', type: 'c-block', label: 'If has {item} in inventory', inputs: { item: { type: 'text', default: 'Gold Key' } }, code: 'ifHasItem' },
            'item_use': { category: 'items', type: 'command', label: 'Use item {item}', inputs: { item: { type: 'text', default: 'Potion' } }, code: 'useItem' },
            'item_show_inventory': { category: 'items', type: 'command', label: 'Show inventory on HUD', code: 'showInventory' },

            // ===== Background Music =====
            'sound_play_music': { category: 'sound', type: 'command', label: 'Play music {track}', inputs: { track: { type: 'select', options: ['adventure','chill','action','mystery','retro','none'], default: 'adventure' } }, code: 'playMusic' },
            'sound_stop_music': { category: 'sound', type: 'command', label: 'Stop music', code: 'stopMusic' },
            'sound_music_volume': { category: 'sound', type: 'command', label: 'Music volume {percent}%', inputs: { percent: { type: 'number', default: 50 } }, code: 'setMusicVolume' },

            // ===== More Motion =====
            'motion_zigzag': { category: 'motion', type: 'command', label: 'Zigzag width {w} speed {s}', inputs: { w: { type: 'number', default: 3 }, s: { type: 'number', default: 2 } }, code: 'zigzag' },
            'motion_spiral': { category: 'motion', type: 'command', label: 'Spiral radius {r} speed {s}', inputs: { r: { type: 'number', default: 3 }, s: { type: 'number', default: 1 } }, code: 'spiral' },
            'motion_hover': { category: 'motion', type: 'command', label: 'Hover height {h} speed {s}', inputs: { h: { type: 'number', default: 0.5 }, s: { type: 'number', default: 1.5 } }, code: 'hover' },
            'motion_teleport': { category: 'motion', type: 'command', label: 'Teleport to {x} {y} {z}', inputs: { x: { type: 'number', default: 0 }, y: { type: 'number', default: 5 }, z: { type: 'number', default: 0 } }, code: 'teleportObject' },
            'motion_launch_up': { category: 'motion', type: 'command', label: 'Launch up force {force}', inputs: { force: { type: 'number', default: 10 } }, code: 'launchUp' },
            'motion_move_toward': { category: 'motion', type: 'command', label: 'Toward player {speed} stop {dist}', inputs: { speed: { type: 'number', default: 3 }, dist: { type: 'number', default: 2 } }, code: 'moveToward' },

            // ===== Game Logic =====
            'var_set_lives': { category: 'variables', type: 'command', label: 'Set lives to {n}', inputs: { n: { type: 'number', default: 3 } }, code: 'setLives' },
            'var_change_lives': { category: 'variables', type: 'command', label: 'Change lives by {n}', inputs: { n: { type: 'number', default: -1 } }, code: 'changeLives' },
            'var_show_lives': { category: 'variables', type: 'command', label: 'Show lives on HUD', code: 'showLives' },
            'event_lives_zero': { category: 'events', type: 'hat', label: 'When lives reach 0', icon: '💀', code: 'onLivesZero' },
            'var_show_dialog': { category: 'variables', type: 'command', label: 'Dialog {text}', inputs: { text: { type: 'text', default: 'Hello!' } }, code: 'showDialog' },
            'control_next_level': { category: 'control', type: 'command', label: 'Next level', code: 'nextLevel' },
            'event_level_start': { category: 'events', type: 'hat', label: 'When level starts', icon: '🎬', code: 'onLevelStart' },
            'var_start_timer': { category: 'variables', type: 'command', label: 'Countdown {seconds}s', inputs: { seconds: { type: 'number', default: 60 } }, code: 'startCountdown' },
            'var_show_timer': { category: 'variables', type: 'command', label: 'Show timer on HUD', code: 'showTimer' },
            'event_timer_done': { category: 'events', type: 'hat', label: 'When timer ends', icon: '⏰', code: 'onTimerDone' },

            // ===== Visual Effects =====
            'fx_screen_shake': { category: 'effects', type: 'command', label: 'Screen shake {intensity}', inputs: { intensity: { type: 'number', default: 5 } }, code: 'screenShake' },
            'fx_fade_out': { category: 'effects', type: 'command', label: 'Fade out {seconds}s', inputs: { seconds: { type: 'number', default: 1 } }, code: 'fadeOut' },
            'fx_fade_in': { category: 'effects', type: 'command', label: 'Fade in {seconds}s', inputs: { seconds: { type: 'number', default: 1 } }, code: 'fadeIn' },
            'fx_flash_screen': { category: 'effects', type: 'command', label: 'Flash screen {color}', inputs: { color: { type: 'color', default: '#ffffff' } }, code: 'flashScreen' },
            'fx_slow_motion': { category: 'effects', type: 'command', label: 'Slow motion {speed}x for {seconds}s', inputs: { speed: { type: 'number', default: 0.3 }, seconds: { type: 'number', default: 3 } }, code: 'slowMotion' },
            'fx_camera_zoom': { category: 'effects', type: 'command', label: 'Camera zoom {factor}x in {time}s', inputs: { factor: { type: 'number', default: 1.5 }, time: { type: 'number', default: 0.5 } }, code: 'cameraZoom' },
            'fx_camera_reset': { category: 'effects', type: 'command', label: 'Reset camera zoom', code: 'cameraReset' },
            'fx_screen_tint': { category: 'effects', type: 'command', label: 'Tint screen {color} {opacity}%', inputs: { color: { type: 'color', default: '#ff0000' }, opacity: { type: 'number', default: 30 } }, code: 'screenTint' },

            // ===== UI Screens =====
            'ui_show_screen': { category: 'ui', type: 'command', label: 'Show screen {screen}', inputs: { screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'showScreen' },
            'ui_hide_screen': { category: 'ui', type: 'command', label: 'Hide screen {screen}', inputs: { screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'hideScreen' },
            'ui_hide_all': { category: 'ui', type: 'command', label: 'Hide all screens', code: 'hideAllScreens' },
            'ui_set_text': { category: 'ui', type: 'command', label: 'Set {old} to {new} on {screen}', inputs: { old: { type: 'text', default: 'Label' }, new: { type: 'text', default: 'New' }, screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'uiSetText' },
            'ui_set_element_color': { category: 'ui', type: 'command', label: 'Recolor {element} {color} on {screen}', inputs: { element: { type: 'text', default: 'Button' }, color: { type: 'color', default: '#4C97FF' }, screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'uiSetColor' },
            'ui_set_element_visible': { category: 'ui', type: 'command', label: '{action} {element} on {screen}', inputs: { action: { type: 'select', options: ['show','hide'], default: 'hide' }, element: { type: 'text', default: 'Button' }, screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'uiSetVisible' },
            'ui_add_text': { category: 'ui', type: 'command', label: 'Add label {text} at {x} {y}', inputs: { text: { type: 'text', default: 'Hello' }, x: { type: 'number', default: 50 }, y: { type: 'number', default: 50 } }, code: 'uiAddText' },
            'ui_add_button': { category: 'ui', type: 'command', label: 'Add btn {text} msg {msg}', inputs: { text: { type: 'text', default: 'Click' }, msg: { type: 'text', default: 'clicked' } }, code: 'uiAddButton' },
            'ui_clear_screen': { category: 'ui', type: 'command', label: 'Clear {screen}', inputs: { screen: { type: 'select', options: ['(none)'], default: '(none)' } }, code: 'uiClearScreen' },
            'ui_show_text_overlay': { category: 'ui', type: 'command', label: 'Flash text {text} for {time}s', inputs: { text: { type: 'text', default: 'Level 1' }, time: { type: 'number', default: 2 } }, code: 'uiTextOverlay' },
            'ui_show_number': { category: 'ui', type: 'command', label: 'Show number {label} value {value}', inputs: { label: { type: 'text', default: 'Score' }, value: { type: 'number', default: 0 } }, code: 'uiShowNumber' },
            'ui_set_number': { category: 'ui', type: 'command', label: 'Set {label} to {value}', inputs: { label: { type: 'text', default: 'Score' }, value: { type: 'number', default: 0 } }, code: 'uiSetNumber' },
            'ui_change_number': { category: 'ui', type: 'command', label: 'Change {label} by {value}', inputs: { label: { type: 'text', default: 'Score' }, value: { type: 'number', default: 1 } }, code: 'uiChangeNumber' },

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

        // Show "New Message" button for Events category
        if (this.activeCategory === 'events') {
            const makeMsgBtn = document.createElement('button');
            makeMsgBtn.className = 'make-block-btn';
            makeMsgBtn.innerHTML = '<span class="material-icons-round">add_circle</span> New Message';
            makeMsgBtn.addEventListener('click', () => this._showMakeMessageDialog());
            this.drawer.appendChild(makeMsgBtn);
        }

        // Show "New Message" button for Control category (for Broadcast block)
        if (this.activeCategory === 'control') {
            const makeMsgBtn2 = document.createElement('button');
            makeMsgBtn2.className = 'make-block-btn';
            makeMsgBtn2.innerHTML = '<span class="material-icons-round">add_circle</span> New Message';
            makeMsgBtn2.addEventListener('click', () => this._showMakeMessageDialog());
            this.drawer.appendChild(makeMsgBtn2);
        }

        // Show "Make a Variable" button for Variables category
        if (this.activeCategory === 'variables') {
            const makeVarBtn = document.createElement('button');
            makeVarBtn.className = 'make-block-btn';
            makeVarBtn.innerHTML = '<span class="material-icons-round">add_circle</span> Make a Variable';
            makeVarBtn.addEventListener('click', () => this._showMakeVariableDialog());
            this.drawer.appendChild(makeVarBtn);
        }

        // Show "Make a Block" button for My Blocks category
        if (this.activeCategory === 'myblocks') {
            const makeBtn = document.createElement('button');
            makeBtn.className = 'make-block-btn';
            makeBtn.innerHTML = '<span class="material-icons-round">add_circle</span> Make a Block';
            makeBtn.addEventListener('click', () => this._showMakeBlockDialog());
            this.drawer.appendChild(makeBtn);
        }

        // Render built-in blocks for the active category
        Object.entries(this.blocks).forEach(([blockId, blockDef]) => {
            if (blockDef.category !== this.activeCategory) return;
            const el = this._createBlockEl(blockDef, null);
            el.dataset.blockId = blockId;
            el.addEventListener('pointerdown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                e.preventDefault();
                this._startDrag(e, blockId, blockDef, 'drawer', el);
            });
            this.drawer.appendChild(el);
        });

        // Render custom blocks for My Blocks category
        if (this.activeCategory === 'myblocks') {
            Object.entries(this.customBlocks).forEach(([blockId, blockDef]) => {
                // Show the hat (definition) block
                const hatEl = this._createBlockEl(blockDef.hat, null);
                hatEl.dataset.blockId = blockId + '_def';
                hatEl.addEventListener('pointerdown', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                    e.preventDefault();
                    this._startDrag(e, blockId + '_def', blockDef.hat, 'drawer', hatEl);
                });
                this.drawer.appendChild(hatEl);

                // Show the call block
                const callEl = this._createBlockEl(blockDef.call, null);
                callEl.dataset.blockId = blockId + '_call';
                callEl.addEventListener('pointerdown', (e) => {
                    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                    e.preventDefault();
                    this._startDrag(e, blockId + '_call', blockDef.call, 'drawer', callEl);
                });
                this.drawer.appendChild(callEl);
            });
        }
    }

    _showMakeBlockDialog() {
        const name = prompt('Block name:', 'my block');
        if (!name || !name.trim()) return;
        const id = 'custom_' + Date.now();
        const safeName = name.trim();

        // Create hat (definition) and call (command) block pair
        this.customBlocks[id] = {
            hat: {
                category: 'myblocks',
                type: 'hat',
                label: 'Define ' + safeName,
                icon: '🧩',
                code: 'customDef_' + id
            },
            call: {
                category: 'myblocks',
                type: 'command',
                label: safeName,
                code: 'customCall_' + id
            }
        };

        // Register blocks so they can be dragged
        this.blocks[id + '_def'] = this.customBlocks[id].hat;
        this.blocks[id + '_call'] = this.customBlocks[id].call;

        this.renderDrawer();
    }

    _showMakeVariableDialog() {
        const name = prompt('Variable name:', 'myVar');
        if (!name || !name.trim()) return;
        const safeName = name.trim().replace(/\s+/g, '_');
        const allVars = this._getAllVariableNames();
        if (allVars.includes(safeName)) {
            alert('A variable with that name already exists.');
            return;
        }
        this.customVariables.push(safeName);
        this._updateVariableDropdowns();
        this.renderDrawer();
    }

    _getAllVariableNames() {
        const builtIn = ['score', 'health', 'coins', 'speed', 'level'];
        return [...builtIn, ...this.customVariables];
    }

    _updateVariableDropdowns() {
        const allVars = this._getAllVariableNames();
        const varBlockIds = ['var_set', 'var_change', 'var_show', 'var_if_check'];
        varBlockIds.forEach(id => {
            const block = this.blocks[id];
            if (block && block.inputs && block.inputs.var) {
                block.inputs.var.options = [...allVars];
            }
        });
    }

    _showMakeMessageDialog() {
        const name = prompt('Message name:', 'myMessage');
        if (!name || !name.trim()) return;
        const safeName = name.trim().replace(/\s+/g, '_');
        const allMsgs = this._getAllMessageNames();
        if (allMsgs.includes(safeName)) {
            alert('A message with that name already exists.');
            return;
        }
        this.customMessages.push(safeName);
        this._updateMessageDropdowns();
        this.renderDrawer();
    }

    _getAllMessageNames() {
        const builtIn = ['message1', 'message2', 'message3', 'go', 'stop', 'reset'];
        return [...builtIn, ...this.customMessages];
    }

    _updateMessageDropdowns() {
        const allMsgs = this._getAllMessageNames();
        const msgBlockIds = ['event_message', 'control_broadcast'];
        msgBlockIds.forEach(id => {
            const block = this.blocks[id];
            if (block && block.inputs && block.inputs.msg) {
                block.inputs.msg.options = [...allMsgs];
            }
        });
    }

    _updateScreenDropdowns(uiScreens) {
        const names = (uiScreens || []).map(s => s.name);
        if (names.length === 0) names.push('(none)');
        const screenBlockIds = ['ui_show_screen', 'ui_hide_screen', 'ui_set_text', 'ui_set_element_color', 'ui_set_element_visible', 'ui_clear_screen'];
        screenBlockIds.forEach(id => {
            const block = this.blocks[id];
            if (block && block.inputs && block.inputs.screen) {
                block.inputs.screen.options = [...names];
                block.inputs.screen.default = names[0];
            }
        });
        // Re-render drawer if currently showing UI category
        if (this.activeCategory === 'ui') {
            this.renderDrawer();
        }
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

    _cleanupDrag() {
        if (this._ghost) { this._ghost.remove(); this._ghost = null; }
        if (this._snapIndicator) { this._snapIndicator.remove(); this._snapIndicator = null; }
        // Remove any stale ghost elements from document.body
        document.querySelectorAll('.block-ghost').forEach(el => el.remove());
        document.querySelectorAll('.block-ghost-stack').forEach(el => el.remove());
        document.querySelectorAll('.snap-indicator').forEach(el => el.remove());
        // Remove stored document-level listeners
        if (this._activeMoveHandler) {
            document.removeEventListener('pointermove', this._activeMoveHandler);
            this._activeMoveHandler = null;
        }
        if (this._activeUpHandler) {
            document.removeEventListener('pointerup', this._activeUpHandler);
            this._activeUpHandler = null;
        }
        this._dragBlockId = null;
        this._dragBlockDef = null;
        this._dragSource = null;
        this._dragSourceEl = null;
        this._draggedBlocks = null;
        this._dragStackData = null;
        this._excludeStackIdx = null;
        this._currentSnapTarget = null;
        this._currentCBlockTarget = null;
        this._highlightCBlockBody(null, false);
        const tray = document.getElementById('backpack-tray');
        if (tray) tray.classList.remove('backpack-drop-active');
    }

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
            this._activeMoveHandler = null;
            this._activeUpHandler = null;
            this._endDrag(ev);
        };
        this._activeMoveHandler = onMove;
        this._activeUpHandler = onUp;
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    _moveGhost(e) {
        if (!this._ghost) return;
        this._ghost.style.left = (e.clientX - this._ghostOffsetX) + 'px';
        this._ghost.style.top = (e.clientY - this._ghostOffsetY) + 'px';

        const overDeleteZone = this._isOverDeleteZone(e);
        this._ghost.classList.toggle('ghost-deleting', overDeleteZone);

        // Backpack hover highlight
        const overBackpack = this._isOverBackpack(e);
        const tray = document.getElementById('backpack-tray');
        if (tray) tray.classList.toggle('backpack-drop-active', overBackpack && !overDeleteZone);

        // Check if dragging a hat block (can't go in c-blocks)
        let isHat = false;
        if (this._dragBlockDef) {
            isHat = this._dragBlockDef.type === 'hat';
        } else if (this._draggedBlocks?.length > 0) {
            isHat = this.blocks[this._draggedBlocks[0].blockId]?.type === 'hat';
        } else if (this._dragStackData?.blocks?.length > 0) {
            isHat = this.blocks[this._dragStackData.blocks[0].blockId]?.type === 'hat';
        }

        // Check c-block body hover (higher priority than snap)
        const cBlockTarget = !overDeleteZone && !isHat ? this._findCBlockBodyAt(e) : null;

        if (cBlockTarget) {
            // Over a c-block body — highlight it and suppress snap
            this._currentSnapTarget = null;
            this._currentCBlockTarget = cBlockTarget;
            this._highlightCBlockBody(cBlockTarget, true);
        } else {
            this._currentCBlockTarget = null;
            this._highlightCBlockBody(null, false);

            // Snap detection - use ghost block's top edge position
            if (!overDeleteZone) {
                const ghostTopY = e.clientY - (this._ghostOffsetY || 0);
                this._currentSnapTarget = this._findSnapTarget(e, ghostTopY);

                // Visually snap ghost to target position when snapping
                if (this._currentSnapTarget) {
                    this._ghost.style.top = this._currentSnapTarget.y + 'px';
                    const stackRect = this._currentSnapTarget.stackEl.getBoundingClientRect();
                    this._ghost.style.left = stackRect.left + 'px';
                }
            } else {
                this._currentSnapTarget = null;
            }
        }
        this._updateSnapIndicator();
    }

    _highlightCBlockBody(target, active) {
        // Remove all existing highlights
        this.workspace.querySelectorAll('.c-block-body.c-block-active').forEach(el => {
            el.classList.remove('c-block-active');
        });
        if (active && target) {
            const bodies = this.workspace.querySelectorAll('.c-block-body');
            for (const body of bodies) {
                if (parseInt(body.dataset.stackIdx) === target.stackIdx &&
                    parseInt(body.dataset.blockIdx) === target.blockIdx) {
                    body.classList.add('c-block-active');
                    break;
                }
            }
        }
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

    _findSnapTarget(e, ghostTopY) {
        const SNAP_DIST = 50;
        const checkY = ghostTopY !== undefined ? ghostTopY : e.clientY;
        let closest = null;
        let closestDist = SNAP_DIST;

        // Determine if dragged content starts with a hat
        let isHat = false;
        if (this._dragBlockDef) {
            isHat = this._dragBlockDef.type === 'hat';
        } else if (this._draggedBlocks?.length > 0) {
            isHat = this.blocks[this._draggedBlocks[0].blockId]?.type === 'hat';
        } else if (this._dragStackData?.blocks?.length > 0) {
            isHat = this.blocks[this._dragStackData.blocks[0].blockId]?.type === 'hat';
        }

        const stacks = this.workspace.querySelectorAll('.script-stack');

        for (const stackEl of stacks) {
            const stackIdx = parseInt(stackEl.dataset.stackIdx);
            if (stackIdx === this._excludeStackIdx) continue;

            const stack = this.workspaceScripts[stackIdx];
            if (!stack) continue;

            const blockEls = Array.from(stackEl.children).filter(el => el.classList.contains('block'));
            if (blockEls.length === 0) continue;

            const stackRect = stackEl.getBoundingClientRect();
            // Must be horizontally near the stack
            if (e.clientX < stackRect.left - 80 || e.clientX > stackRect.right + 80) continue;

            for (let i = 0; i <= blockEls.length; i++) {
                // Hat blocks can only snap to position 0
                if (isHat && i > 0) continue;
                // Don't insert before an existing hat block
                if (i === 0) {
                    const firstDef = this.blocks[stack.blocks[0]?.blockId];
                    if (firstDef?.type === 'hat') continue;
                }

                let gapY;
                if (i === 0) {
                    gapY = blockEls[0].getBoundingClientRect().top;
                } else if (i === blockEls.length) {
                    gapY = blockEls[blockEls.length - 1].getBoundingClientRect().bottom;
                } else {
                    gapY = blockEls[i].getBoundingClientRect().top;
                }

                const dist = Math.abs(checkY - gapY);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = { stackIdx, insertIdx: i, y: gapY, stackEl };
                }
            }
        }
        return closest;
    }

    _updateSnapIndicator() {
        if (!this._snapIndicator) {
            this._snapIndicator = document.createElement('div');
            this._snapIndicator.className = 'snap-indicator';
        }

        if (this._currentSnapTarget) {
            const { stackEl, y } = this._currentSnapTarget;
            const wsRect = this.workspace.getBoundingClientRect();
            const stackRect = stackEl.getBoundingClientRect();

            this._snapIndicator.style.left = (stackRect.left - wsRect.left - 2) + 'px';
            this._snapIndicator.style.top = (y - wsRect.top - 2) + 'px';
            this._snapIndicator.style.width = (stackRect.width + 4) + 'px';
            this._snapIndicator.style.display = 'block';

            if (!this._snapIndicator.parentNode) {
                this.workspace.appendChild(this._snapIndicator);
            }
        } else if (this._snapIndicator) {
            this._snapIndicator.style.display = 'none';
        }
    }

    _hideSnapIndicator() {
        if (this._snapIndicator) {
            this._snapIndicator.style.display = 'none';
        }
        this._currentSnapTarget = null;
    }

    _endDrag(e) {
        if (!this._ghost) return;
        this._ghost.remove();
        this._ghost = null;

        // Hide indicator but preserve snap target for drop logic
        if (this._snapIndicator) this._snapIndicator.style.display = 'none';
        // Clear c-block highlight
        this._highlightCBlockBody(null, false);
        // Clear backpack highlight
        const tray = document.getElementById('backpack-tray');
        if (tray) tray.classList.remove('backpack-drop-active');

        // Restore dimmed source
        if (this._dragSourceEl) {
            this._dragSourceEl.style.opacity = '';
            this._dragSourceEl = null;
        }

        const overDelete = this._isOverDeleteZone(e);
        const overBackpack = this._isOverBackpack(e);

        if (!this.targetObject) {
            this._currentSnapTarget = null;
            this._currentCBlockTarget = null;
            return;
        }

        // Drop single block into backpack from drawer
        if (overBackpack && this._dragSource === 'drawer') {
            const blockDef = this._dragBlockDef;
            const blockData = {
                instanceId: this.nextBlockId++,
                blockId: this._dragBlockId,
                values: this._getDefaults(blockDef),
                children: []
            };
            this.addToBackpack([blockData]);
            this._currentSnapTarget = null;
            this._currentCBlockTarget = null;
            this._dragSource = null;
            this._dragBlockId = null;
            this._dragBlockDef = null;
            return;
        }

        if (this._dragSource === 'drawer') {
            if (!overDelete) {
                this._dropNewBlock(e);
            }
        } else {
            if (overDelete) {
                this._deleteFromSource();
            }
        }

        this._currentSnapTarget = null;
        this._currentCBlockTarget = null;
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

        // 1. Check if dropping into a c-block body (highest priority)
        const cBlockTarget = this._currentCBlockTarget || this._findCBlockBodyAt(e);
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

        // 2. Use snap target to insert into an existing stack
        if (this._currentSnapTarget) {
            const { stackIdx, insertIdx } = this._currentSnapTarget;
            this.workspaceScripts[stackIdx].blocks.splice(insertIdx, 0, blockData);
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        // 3. Create new stack at drop position
        const wsRect = this.workspace.getBoundingClientRect();
        const dropX = e.clientX - wsRect.left;
        const dropY = e.clientY - wsRect.top;

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

    // ===== Stack Split Drag =====

    _startStackSplit(e, stackIdx, blockIdx, blockEl) {
        const stack = this.workspaceScripts[stackIdx];
        if (!stack) return;

        // Create ghost BEFORE modifying data (DOM still intact)
        const ghost = document.createElement('div');
        ghost.className = 'block-ghost-stack';
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.opacity = '0.85';

        // Clone this block and all siblings after it in the stack
        let sibling = blockEl;
        while (sibling) {
            if (sibling.classList.contains('block')) {
                ghost.appendChild(sibling.cloneNode(true));
            }
            sibling = sibling.nextElementSibling;
        }

        document.body.appendChild(ghost);

        this._ghost = ghost;
        this._ghostOffsetX = e.clientX - blockEl.getBoundingClientRect().left;
        this._ghostOffsetY = e.clientY - blockEl.getBoundingClientRect().top;

        // Detach blocks from data
        const detachedBlocks = stack.blocks.splice(blockIdx);
        if (stack.blocks.length === 0) {
            this.workspaceScripts.splice(stackIdx, 1);
        }

        this._draggedBlocks = detachedBlocks;

        // Re-render workspace (shows shortened stack)
        this.renderWorkspace();
        this.saveScriptsToObject();

        this._moveGhost(e);

        const onMove = (ev) => this._moveGhost(ev);
        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            this._activeMoveHandler = null;
            this._activeUpHandler = null;
            this._endSplitDrag(ev);
        };
        this._activeMoveHandler = onMove;
        this._activeUpHandler = onUp;
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    _endSplitDrag(e) {
        if (this._ghost) {
            this._ghost.remove();
            this._ghost = null;
        }
        // Hide indicator but preserve snap target for drop logic
        if (this._snapIndicator) this._snapIndicator.style.display = 'none';
        // Clear c-block highlight
        this._highlightCBlockBody(null, false);
        // Clear backpack highlight
        const tray = document.getElementById('backpack-tray');
        if (tray) tray.classList.remove('backpack-drop-active');

        const blocks = this._draggedBlocks;
        const snapTarget = this._currentSnapTarget;
        const cBlockTarget = this._currentCBlockTarget || this._findCBlockBodyAt(e);
        this._draggedBlocks = null;

        if (!blocks || blocks.length === 0) return;

        // Delete zone
        if (this._isOverDeleteZone(e)) {
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        // Backpack zone — save blocks to backpack and also put them back in workspace
        if (this._isOverBackpack(e)) {
            this.addToBackpack(blocks);
            // Put the blocks back as a new stack (don't remove them from workspace)
            const wsRect = this.workspace.getBoundingClientRect();
            const newStack = {
                id: this.nextBlockId++,
                x: Math.max(10, (e.clientX - wsRect.left) - 20),
                y: Math.max(10, (e.clientY - wsRect.top) - 60),
                blocks: blocks
            };
            this.workspaceScripts.push(newStack);
            this._currentSnapTarget = null;
            this._currentCBlockTarget = null;
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        // Check c-block body target
        if (cBlockTarget) {
            const firstDef = this.blocks[blocks[0].blockId];
            if (firstDef?.type !== 'hat') {
                const parent = this.workspaceScripts[cBlockTarget.stackIdx]?.blocks[cBlockTarget.blockIdx];
                if (parent) {
                    if (!parent.children) parent.children = [];
                    parent.children.push(...blocks);
                    this._currentSnapTarget = null;
                    this._currentCBlockTarget = null;
                    this.renderWorkspace();
                    this.saveScriptsToObject();
                    return;
                }
            }
        }

        // Snap target - insert into existing stack
        if (snapTarget) {
            const { stackIdx, insertIdx } = snapTarget;
            this.workspaceScripts[stackIdx].blocks.splice(insertIdx, 0, ...blocks);
            this._currentSnapTarget = null;
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        this._currentSnapTarget = null;
        this._currentCBlockTarget = null;

        // Create new stack at drop position
        const wsRect = this.workspace.getBoundingClientRect();
        const newStack = {
            id: this.nextBlockId++,
            x: Math.max(10, (e.clientX - wsRect.left) - 20),
            y: Math.max(10, (e.clientY - wsRect.top) - 10),
            blocks: blocks
        };
        this.workspaceScripts.push(newStack);
        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    // ===== Workspace Rendering =====

    renderWorkspace() {
        this.workspace.innerHTML = '';
        // Reset snap indicator reference since innerHTML cleared it
        if (this._snapIndicator) this._snapIndicator = null;

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

        // Mid-stack split: drag a non-first block to detach it and blocks below
        if (blockIdx > 0) {
            el.addEventListener('pointerdown', (e) => {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
                e.preventDefault();
                e.stopPropagation();
                this._startStackSplit(e, stackIdx, blockIdx, el);
            });
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

            this._excludeStackIdx = parseInt(stackEl.dataset.stackIdx);
            this._dragStackData = stackData;

            const onMove = (ev) => {
                if (!isDragging) return;
                stackData.x = origX + (ev.clientX - startX);
                stackData.y = origY + (ev.clientY - startY);
                stackEl.style.left = stackData.x + 'px';
                stackEl.style.top = stackData.y + 'px';

                // Check if first block is a hat
                let isHat = false;
                if (stackData.blocks?.length > 0) {
                    isHat = this.blocks[stackData.blocks[0].blockId]?.type === 'hat';
                }

                const overDelete = this._isOverDeleteZone(ev);
                const overBackpack = this._isOverBackpack(ev);
                const cBlockTarget = !overDelete && !isHat && !overBackpack ? this._findCBlockBodyAt(ev) : null;

                // Backpack hover feedback
                const bpTray = document.getElementById('backpack-tray');
                if (bpTray) bpTray.classList.toggle('backpack-drop-active', overBackpack && !overDelete);

                if (overDelete) {
                    stackEl.style.opacity = '0.4';
                    this._currentSnapTarget = null;
                    this._currentCBlockTarget = null;
                    this._highlightCBlockBody(null, false);
                } else if (cBlockTarget) {
                    stackEl.style.opacity = '';
                    this._currentSnapTarget = null;
                    this._currentCBlockTarget = cBlockTarget;
                    this._highlightCBlockBody(cBlockTarget, true);
                } else {
                    stackEl.style.opacity = '';
                    this._currentCBlockTarget = null;
                    this._highlightCBlockBody(null, false);
                    // Use stack's top edge for snap detection
                    const stackTop = stackEl.getBoundingClientRect().top;
                    this._currentSnapTarget = this._findSnapTarget(ev, stackTop);
                }
                this._updateSnapIndicator();
            };

            const onUp = (ev) => {
                isDragging = false;
                stackEl.style.zIndex = '';
                stackEl.style.opacity = '';
                this._excludeStackIdx = null;
                this._dragStackData = null;
                document.removeEventListener('pointermove', onMove);
                document.removeEventListener('pointerup', onUp);
                this._activeMoveHandler = null;
                this._activeUpHandler = null;
                // Hide indicator but preserve snap target for drop logic
                if (this._snapIndicator) this._snapIndicator.style.display = 'none';
                this._highlightCBlockBody(null, false);
                // Clear backpack highlight
                const bpTray = document.getElementById('backpack-tray');
                if (bpTray) bpTray.classList.remove('backpack-drop-active');

                // Add to backpack (copy, don't remove from workspace)
                if (this._isOverBackpack(ev)) {
                    this.addToBackpack(stackData.blocks);
                    this._currentSnapTarget = null;
                    this._currentCBlockTarget = null;
                    this.saveScriptsToObject();
                    return;
                }

                // Delete stack
                if (this._isOverDeleteZone(ev)) {
                    const idx = this.workspaceScripts.indexOf(stackData);
                    if (idx !== -1) {
                        this.workspaceScripts.splice(idx, 1);
                        this.renderWorkspace();
                        this.saveScriptsToObject();
                    }
                    return;
                }

                // Drop into c-block body
                const cTarget = this._currentCBlockTarget;
                if (cTarget) {
                    const firstDef = this.blocks[stackData.blocks[0]?.blockId];
                    if (firstDef?.type !== 'hat') {
                        const parent = this.workspaceScripts[cTarget.stackIdx]?.blocks[cTarget.blockIdx];
                        if (parent) {
                            if (!parent.children) parent.children = [];
                            parent.children.push(...stackData.blocks);
                            const draggedIdx = this.workspaceScripts.indexOf(stackData);
                            if (draggedIdx !== -1) {
                                this.workspaceScripts.splice(draggedIdx, 1);
                            }
                            this._currentSnapTarget = null;
                            this._currentCBlockTarget = null;
                            this.renderWorkspace();
                            this.saveScriptsToObject();
                            return;
                        }
                    }
                }

                // Merge into another stack at snap point
                if (this._currentSnapTarget) {
                    const { stackIdx: targetIdx, insertIdx } = this._currentSnapTarget;
                    const targetStack = this.workspaceScripts[targetIdx];
                    targetStack.blocks.splice(insertIdx, 0, ...stackData.blocks);
                    const draggedIdx = this.workspaceScripts.indexOf(stackData);
                    if (draggedIdx !== -1) {
                        this.workspaceScripts.splice(draggedIdx, 1);
                    }
                    this.renderWorkspace();
                    this.saveScriptsToObject();
                }

                this._currentSnapTarget = null;
                this._currentCBlockTarget = null;
            };

            this._activeMoveHandler = onMove;
            this._activeUpHandler = onUp;
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
        this._cleanupDrag();
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
            if (this.onScriptsChanged) {
                this.onScriptsChanged(this.targetObject, this.workspaceScripts);
            }
        }
    }

    clearScripts() {
        this.workspaceScripts = [];
        if (this.targetObject) {
            this.targetObject.userData.scripts = [];
        }
        this.renderWorkspace();
    }

    // ===== Backpack =====

    addToBackpack(blocks) {
        if (!blocks || blocks.length === 0) return;
        const cloned = JSON.parse(JSON.stringify(blocks));
        const firstDef = this.blocks[cloned[0].blockId];
        const label = firstDef ? (firstDef.icon || '') + ' ' + firstDef.label.replace(/\{[^}]+\}/g, '...').trim() : 'Script';
        const category = firstDef ? firstDef.category : 'control';
        const color = this.categories[category]?.color || '#888';
        this.backpackItems.push({
            id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
            label,
            color,
            blockCount: cloned.length,
            blocks: cloned
        });
        this.renderBackpack();
        if (this.onBackpackChanged) this.onBackpackChanged(this.backpackItems);
    }

    removeFromBackpack(index) {
        this.backpackItems.splice(index, 1);
        this.renderBackpack();
        if (this.onBackpackChanged) this.onBackpackChanged(this.backpackItems);
    }

    renderBackpack() {
        const container = document.getElementById('backpack-items');
        const countEl = document.getElementById('backpack-count');
        if (!container || !countEl) return;

        container.innerHTML = '';

        if (this.backpackItems.length > 0) {
            countEl.textContent = this.backpackItems.length;
            countEl.classList.add('has-items');
        } else {
            countEl.classList.remove('has-items');
        }

        this.backpackItems.forEach((item, idx) => {
            const el = document.createElement('div');
            el.className = 'backpack-item';
            el.draggable = false;
            el.innerHTML = `
                <div class="backpack-item-color" style="background:${item.color}"></div>
                <div class="backpack-item-label">${item.label}</div>
                <div class="backpack-item-count">${item.blockCount} block${item.blockCount !== 1 ? 's' : ''}</div>
                <button class="backpack-delete" title="Remove">&times;</button>
            `;

            el.querySelector('.backpack-delete').addEventListener('click', (e) => {
                e.stopPropagation();
                this.removeFromBackpack(idx);
            });

            // Drag from backpack to workspace
            el.addEventListener('pointerdown', (e) => {
                if (e.target.closest('.backpack-delete')) return;
                e.preventDefault();
                this._startBackpackDrag(e, item, el);
            });

            container.appendChild(el);
        });
    }

    _startBackpackDrag(e, item, sourceEl) {
        // Deep clone blocks and assign new instanceIds
        const clonedBlocks = JSON.parse(JSON.stringify(item.blocks));
        this._reassignInstanceIds(clonedBlocks);

        // Build ghost from cloned blocks
        const ghost = document.createElement('div');
        ghost.className = 'block-ghost-stack';
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '10000';
        ghost.style.opacity = '0.85';

        clonedBlocks.forEach(blockData => {
            const blockDef = this.blocks[blockData.blockId];
            if (!blockDef) return;
            const blockEl = this._createBlockEl(blockDef, blockData);
            ghost.appendChild(blockEl);
        });

        document.body.appendChild(ghost);

        this._ghost = ghost;
        this._draggedBlocks = clonedBlocks;
        this._ghostOffsetX = e.clientX - sourceEl.getBoundingClientRect().left;
        this._ghostOffsetY = e.clientY - sourceEl.getBoundingClientRect().top;

        this._moveGhost(e);

        const onMove = (ev) => this._moveGhost(ev);
        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            this._activeMoveHandler = null;
            this._activeUpHandler = null;
            this._endBackpackDrag(ev);
        };
        this._activeMoveHandler = onMove;
        this._activeUpHandler = onUp;
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    _endBackpackDrag(e) {
        if (this._ghost) {
            this._ghost.remove();
            this._ghost = null;
        }
        if (this._snapIndicator) this._snapIndicator.style.display = 'none';
        this._highlightCBlockBody(null, false);

        const blocks = this._draggedBlocks;
        const snapTarget = this._currentSnapTarget;
        const cBlockTarget = this._currentCBlockTarget || this._findCBlockBodyAt(e);
        this._draggedBlocks = null;

        if (!blocks || blocks.length === 0) return;

        // Only place in workspace if dropped over workspace area
        if (!this._isOverWorkspace(e)) {
            this._currentSnapTarget = null;
            this._currentCBlockTarget = null;
            return;
        }

        // Check c-block body target
        if (cBlockTarget) {
            const firstDef = this.blocks[blocks[0].blockId];
            if (firstDef?.type !== 'hat') {
                const parent = this.workspaceScripts[cBlockTarget.stackIdx]?.blocks[cBlockTarget.blockIdx];
                if (parent) {
                    if (!parent.children) parent.children = [];
                    parent.children.push(...blocks);
                    this._currentSnapTarget = null;
                    this._currentCBlockTarget = null;
                    this.renderWorkspace();
                    this.saveScriptsToObject();
                    return;
                }
            }
        }

        // Snap to existing stack
        if (snapTarget) {
            const { stackIdx, insertIdx } = snapTarget;
            this.workspaceScripts[stackIdx].blocks.splice(insertIdx, 0, ...blocks);
            this._currentSnapTarget = null;
            this._currentCBlockTarget = null;
            this.renderWorkspace();
            this.saveScriptsToObject();
            return;
        }

        this._currentSnapTarget = null;
        this._currentCBlockTarget = null;

        // Create new stack
        const wsRect = this.workspace.getBoundingClientRect();
        const newStack = {
            id: this.nextBlockId++,
            x: Math.max(10, (e.clientX - wsRect.left) - 20),
            y: Math.max(10, (e.clientY - wsRect.top) - 10),
            blocks: blocks
        };
        this.workspaceScripts.push(newStack);
        this.renderWorkspace();
        this.saveScriptsToObject();
    }

    _reassignInstanceIds(blocks) {
        for (const block of blocks) {
            block.instanceId = this.nextBlockId++;
            if (block.children) {
                this._reassignInstanceIds(block.children);
            }
        }
    }

    _isOverBackpack(e) {
        const tray = document.getElementById('backpack-tray');
        if (!tray) return false;
        const rect = tray.getBoundingClientRect();
        return e.clientX >= rect.left && e.clientX <= rect.right &&
               e.clientY >= rect.top && e.clientY <= rect.bottom;
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
