/**
 * TextureManager - Procedural canvas-based texture generator for Cobalt Studio
 * Generates 20 built-in textures, caches THREE.CanvasTexture instances, and provides preview data URLs.
 */
class TextureManager {
    constructor() {
        this._cache = new Map();       // id -> THREE.CanvasTexture
        this._previews = new Map();    // id -> dataURL string
        this.SIZE = 128;

        this.categories = [
            { name: 'Nature',   ids: ['grass', 'dirt', 'sand', 'snow'] },
            { name: 'Stone',    ids: ['stone', 'brick', 'cobblestone'] },
            { name: 'Wood',     ids: ['wood_planks', 'wood_log', 'bamboo'] },
            { name: 'Metal',    ids: ['metal_plate', 'metal_grid', 'rust'] },
            { name: 'Fantasy',  ids: ['lava', 'ice', 'crystal', 'magic'] },
            { name: 'Patterns', ids: ['checkerboard', 'stripes', 'polka_dots'] }
        ];

        this.allIds = this.categories.flatMap(c => c.ids);
        this.labels = {
            grass: 'Grass', dirt: 'Dirt', sand: 'Sand', snow: 'Snow',
            stone: 'Stone', brick: 'Brick', cobblestone: 'Cobble',
            wood_planks: 'Planks', wood_log: 'Log', bamboo: 'Bamboo',
            metal_plate: 'Metal', metal_grid: 'Grid', rust: 'Rust',
            lava: 'Lava', ice: 'Ice', crystal: 'Crystal', magic: 'Magic',
            checkerboard: 'Checker', stripes: 'Stripes', polka_dots: 'Dots'
        };
    }

    /** Get (or create + cache) a THREE.CanvasTexture for the given id */
    getTexture(id, tileScale) {
        tileScale = tileScale || 1;
        if (!this.allIds.includes(id)) return null;

        const key = id;
        if (this._cache.has(key)) {
            const tex = this._cache.get(key);
            tex.repeat.set(tileScale, tileScale);
            return tex;
        }

        const canvas = this._generateCanvas(id);
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.magFilter = THREE.NearestFilter;
        tex.minFilter = THREE.NearestFilter;
        tex.repeat.set(tileScale, tileScale);
        tex.colorSpace = THREE.SRGBColorSpace;
        this._cache.set(key, tex);
        return tex;
    }

    /** Return a small data URL preview (64x64) for UI swatches */
    getPreviewDataURL(id) {
        if (this._previews.has(id)) return this._previews.get(id);
        const canvas = this._generateCanvas(id, 64);
        const url = canvas.toDataURL();
        this._previews.set(id, url);
        return url;
    }

    /** Internal: generate a canvas with the procedural pattern */
    _generateCanvas(id, size) {
        size = size || this.SIZE;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        const s = size;

        const gen = this._generators[id];
        if (gen) gen(ctx, s);
        else { ctx.fillStyle = '#ff00ff'; ctx.fillRect(0, 0, s, s); }

        return canvas;
    }

    /** Seeded random for deterministic textures */
    _srand(seed) {
        let s = seed;
        return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646; };
    }
}

// Static generators — each draws on ctx of size s
TextureManager.prototype._generators = {

    // ===== Nature =====
    grass(ctx, s) {
        ctx.fillStyle = '#4a7c3f';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 42);
        for (let i = 0; i < s * 4; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const g = 60 + Math.floor(rng() * 40);
            ctx.fillStyle = `rgb(${30 + Math.floor(rng() * 30)},${g + 40},${20 + Math.floor(rng() * 20)})`;
            ctx.fillRect(x, y, 2, 2);
        }
        // Grass blade strokes
        ctx.strokeStyle = 'rgba(80,140,50,0.6)';
        ctx.lineWidth = 1;
        for (let i = 0; i < s; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (rng() - 0.5) * 4, y - 3 - rng() * 5);
            ctx.stroke();
        }
    },

    dirt(ctx, s) {
        ctx.fillStyle = '#8B7355';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 7);
        for (let i = 0; i < s * 3; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const v = 100 + Math.floor(rng() * 50);
            ctx.fillStyle = `rgb(${v},${v - 20},${v - 40})`;
            ctx.fillRect(x, y, 1 + Math.floor(rng() * 3), 1 + Math.floor(rng() * 3));
        }
        // Pebbles
        for (let i = 0; i < 8; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            ctx.fillStyle = `rgba(${70 + Math.floor(rng() * 40)},${60 + Math.floor(rng() * 30)},${40 + Math.floor(rng() * 20)},0.8)`;
            ctx.beginPath();
            ctx.arc(x, y, 2 + rng() * 3, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    sand(ctx, s) {
        ctx.fillStyle = '#C2B280';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 99);
        for (let i = 0; i < s * 5; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const v = 180 + Math.floor(rng() * 30);
            ctx.fillStyle = `rgb(${v},${v - 10},${v - 50})`;
            ctx.fillRect(x, y, 1, 1);
        }
        // Wave lines
        ctx.strokeStyle = 'rgba(160,140,90,0.3)';
        ctx.lineWidth = 1;
        for (let row = 0; row < 4; row++) {
            ctx.beginPath();
            const yBase = s * 0.2 + row * (s * 0.2);
            for (let x = 0; x < s; x += 2) {
                ctx.lineTo(x, yBase + Math.sin(x * 0.15 + row) * 3);
            }
            ctx.stroke();
        }
    },

    snow(ctx, s) {
        ctx.fillStyle = '#e8e8f0';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 55);
        for (let i = 0; i < s * 3; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const v = 220 + Math.floor(rng() * 35);
            ctx.fillStyle = `rgb(${v},${v},${v + (rng() > 0.5 ? 5 : 0)})`;
            ctx.fillRect(x, y, 2, 2);
        }
        // Sparkle dots
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        for (let i = 0; i < 12; i++) {
            ctx.fillRect(Math.floor(rng() * s), Math.floor(rng() * s), 1, 1);
        }
    },

    // ===== Stone =====
    stone(ctx, s) {
        ctx.fillStyle = '#808080';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 13);
        // Noise
        for (let i = 0; i < s * 4; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const v = 100 + Math.floor(rng() * 60);
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.fillRect(x, y, 2 + Math.floor(rng() * 3), 2 + Math.floor(rng() * 3));
        }
        // Cracks
        ctx.strokeStyle = 'rgba(50,50,50,0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            ctx.beginPath();
            let x = Math.floor(rng() * s), y = Math.floor(rng() * s);
            ctx.moveTo(x, y);
            for (let j = 0; j < 4; j++) {
                x += (rng() - 0.5) * 20;
                y += (rng() - 0.5) * 20;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    },

    brick(ctx, s) {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(0, 0, s, s);
        const bw = s / 4, bh = s / 8;
        const rng = TextureManager.prototype._srand.call(null, 21);
        ctx.strokeStyle = '#6B6050';
        ctx.lineWidth = 2;
        for (let row = 0; row < 8; row++) {
            const offset = (row % 2) * (bw / 2);
            for (let col = -1; col < 5; col++) {
                const x = col * bw + offset;
                const y = row * bh;
                const r = 120 + Math.floor(rng() * 40);
                const g = 50 + Math.floor(rng() * 30);
                const b = 20 + Math.floor(rng() * 15);
                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x + 1, y + 1, bw - 2, bh - 2);
                ctx.strokeRect(x, y, bw, bh);
            }
        }
    },

    cobblestone(ctx, s) {
        ctx.fillStyle = '#707070';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 33);
        // Random roundish stones
        for (let i = 0; i < 20; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const rx = 6 + Math.floor(rng() * 10);
            const ry = 5 + Math.floor(rng() * 8);
            const v = 80 + Math.floor(rng() * 60);
            ctx.fillStyle = `rgb(${v},${v},${v + 5})`;
            ctx.beginPath();
            ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(40,40,40,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    },

    // ===== Wood =====
    wood_planks(ctx, s) {
        ctx.fillStyle = '#A0784C';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 17);
        const plankH = s / 4;
        for (let i = 0; i < 4; i++) {
            const y = i * plankH;
            const r = 140 + Math.floor(rng() * 30);
            const g = 100 + Math.floor(rng() * 25);
            const b = 50 + Math.floor(rng() * 20);
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(0, y + 1, s, plankH - 2);
            // Wood grain lines
            ctx.strokeStyle = `rgba(${r - 30},${g - 20},${b - 10},0.3)`;
            ctx.lineWidth = 1;
            for (let l = 0; l < 6; l++) {
                const ly = y + 3 + Math.floor(rng() * (plankH - 6));
                ctx.beginPath();
                ctx.moveTo(0, ly);
                for (let x = 0; x < s; x += 4) {
                    ctx.lineTo(x, ly + Math.sin(x * 0.1 + rng()) * 1.5);
                }
                ctx.stroke();
            }
            // Plank borders
            ctx.fillStyle = 'rgba(60,40,20,0.3)';
            ctx.fillRect(0, y, s, 1);
            ctx.fillRect(0, y + plankH - 1, s, 1);
        }
    },

    wood_log(ctx, s) {
        ctx.fillStyle = '#7A5C3E';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 61);
        // Bark texture — vertical streaks
        for (let i = 0; i < 30; i++) {
            const x = Math.floor(rng() * s);
            const w = 2 + Math.floor(rng() * 4);
            const v = 90 + Math.floor(rng() * 40);
            ctx.fillStyle = `rgb(${v},${v - 20},${v - 40})`;
            ctx.fillRect(x, 0, w, s);
        }
        // Horizontal cracks
        ctx.strokeStyle = 'rgba(40,25,10,0.4)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
            const y = Math.floor(rng() * s);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(s, y + (rng() - 0.5) * 6);
            ctx.stroke();
        }
    },

    bamboo(ctx, s) {
        ctx.fillStyle = '#7A9E4F';
        ctx.fillRect(0, 0, s, s);
        const segH = s / 6;
        const rng = TextureManager.prototype._srand.call(null, 77);
        for (let i = 0; i < 6; i++) {
            const y = i * segH;
            const g = 130 + Math.floor(rng() * 30);
            ctx.fillStyle = `rgb(${g - 40},${g},${g - 60})`;
            ctx.fillRect(0, y + 1, s, segH - 2);
            // Joint
            ctx.fillStyle = `rgb(${g - 20},${g + 20},${g - 40})`;
            ctx.fillRect(0, y, s, 3);
            // Vertical grain
            ctx.strokeStyle = `rgba(${g - 50},${g - 10},${g - 70},0.2)`;
            ctx.lineWidth = 1;
            for (let j = 0; j < 8; j++) {
                const lx = Math.floor(rng() * s);
                ctx.beginPath();
                ctx.moveTo(lx, y);
                ctx.lineTo(lx, y + segH);
                ctx.stroke();
            }
        }
    },

    // ===== Metal =====
    metal_plate(ctx, s) {
        ctx.fillStyle = '#8899AA';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 45);
        // Brushed metal horizontal lines
        for (let y = 0; y < s; y++) {
            const v = 128 + Math.floor(rng() * 30) - 15;
            ctx.fillStyle = `rgba(${v},${v + 10},${v + 20},0.3)`;
            ctx.fillRect(0, y, s, 1);
        }
        // Rivets in corners
        ctx.fillStyle = '#667788';
        ctx.strokeStyle = '#556677';
        ctx.lineWidth = 1;
        const margin = s * 0.12;
        const rivetR = s * 0.04;
        [[margin, margin], [s - margin, margin], [margin, s - margin], [s - margin, s - margin]].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(x, y, rivetR, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        });
        // Edge highlight
        ctx.strokeStyle = 'rgba(200,210,220,0.3)';
        ctx.lineWidth = 2;
        ctx.strokeRect(2, 2, s - 4, s - 4);
    },

    metal_grid(ctx, s) {
        ctx.fillStyle = '#333333';
        ctx.fillRect(0, 0, s, s);
        const cellSize = s / 8;
        ctx.fillStyle = '#555555';
        ctx.strokeStyle = '#444444';
        ctx.lineWidth = 2;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                const x = col * cellSize + 2;
                const y = row * cellSize + 2;
                ctx.fillStyle = (row + col) % 2 === 0 ? '#4a4a4a' : '#3d3d3d';
                ctx.fillRect(x, y, cellSize - 4, cellSize - 4);
            }
        }
        // Grid lines
        ctx.strokeStyle = '#666666';
        ctx.lineWidth = 2;
        for (let i = 0; i <= 8; i++) {
            ctx.beginPath();
            ctx.moveTo(i * cellSize, 0);
            ctx.lineTo(i * cellSize, s);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, i * cellSize);
            ctx.lineTo(s, i * cellSize);
            ctx.stroke();
        }
    },

    rust(ctx, s) {
        ctx.fillStyle = '#8B4513';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 19);
        // Rust patches
        for (let i = 0; i < 60; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const r = 140 + Math.floor(rng() * 60);
            const g = 50 + Math.floor(rng() * 40);
            ctx.fillStyle = `rgba(${r},${g},${10 + Math.floor(rng() * 20)},${0.3 + rng() * 0.5})`;
            const sz = 3 + Math.floor(rng() * 8);
            ctx.fillRect(x, y, sz, sz);
        }
        // Pitting
        ctx.fillStyle = 'rgba(40,20,5,0.4)';
        for (let i = 0; i < 20; i++) {
            ctx.beginPath();
            ctx.arc(Math.floor(rng() * s), Math.floor(rng() * s), 1 + rng() * 2, 0, Math.PI * 2);
            ctx.fill();
        }
    },

    // ===== Fantasy =====
    lava(ctx, s) {
        ctx.fillStyle = '#1a0500';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 66);
        // Lava veins
        for (let i = 0; i < 12; i++) {
            ctx.strokeStyle = `rgba(${200 + Math.floor(rng() * 55)},${Math.floor(rng() * 80 + 40)},0,${0.4 + rng() * 0.4})`;
            ctx.lineWidth = 2 + rng() * 4;
            ctx.beginPath();
            let x = rng() * s, y = rng() * s;
            ctx.moveTo(x, y);
            for (let j = 0; j < 6; j++) {
                x += (rng() - 0.5) * 40;
                y += (rng() - 0.5) * 40;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
        // Hot spots
        for (let i = 0; i < 8; i++) {
            const x = Math.floor(rng() * s), y = Math.floor(rng() * s);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, 8 + rng() * 10);
            grad.addColorStop(0, `rgba(255,${150 + Math.floor(rng() * 100)},0,0.8)`);
            grad.addColorStop(1, 'rgba(100,20,0,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(x - 15, y - 15, 30, 30);
        }
    },

    ice(ctx, s) {
        ctx.fillStyle = '#B0D8E8';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 88);
        // Crystal facets
        for (let i = 0; i < 15; i++) {
            const x = Math.floor(rng() * s);
            const y = Math.floor(rng() * s);
            const w = 10 + Math.floor(rng() * 20);
            const h = 8 + Math.floor(rng() * 15);
            const b = 200 + Math.floor(rng() * 55);
            ctx.fillStyle = `rgba(${b - 40},${b - 10},${b},0.4)`;
            ctx.fillRect(x, y, w, h);
            ctx.strokeStyle = `rgba(${b},${b},255,0.3)`;
            ctx.lineWidth = 1;
            ctx.strokeRect(x, y, w, h);
        }
        // Frost lines
        ctx.strokeStyle = 'rgba(220,240,255,0.5)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 6; i++) {
            ctx.beginPath();
            let x = rng() * s, y = rng() * s;
            ctx.moveTo(x, y);
            for (let j = 0; j < 3; j++) {
                x += (rng() - 0.5) * 30;
                y += (rng() - 0.5) * 30;
                ctx.lineTo(x, y);
            }
            ctx.stroke();
        }
    },

    crystal(ctx, s) {
        ctx.fillStyle = '#6A0DAD';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 123);
        // Crystal shards
        for (let i = 0; i < 12; i++) {
            const cx = Math.floor(rng() * s);
            const cy = Math.floor(rng() * s);
            ctx.fillStyle = `rgba(${150 + Math.floor(rng() * 100)},${50 + Math.floor(rng() * 80)},${200 + Math.floor(rng() * 55)},0.6)`;
            ctx.beginPath();
            ctx.moveTo(cx, cy - 8 - rng() * 8);
            ctx.lineTo(cx + 4 + rng() * 5, cy + 4 + rng() * 4);
            ctx.lineTo(cx - 4 - rng() * 5, cy + 4 + rng() * 4);
            ctx.closePath();
            ctx.fill();
        }
        // Glow spots
        for (let i = 0; i < 5; i++) {
            const x = Math.floor(rng() * s), y = Math.floor(rng() * s);
            const grad = ctx.createRadialGradient(x, y, 0, x, y, 6 + rng() * 6);
            grad.addColorStop(0, 'rgba(200,150,255,0.7)');
            grad.addColorStop(1, 'rgba(100,0,200,0)');
            ctx.fillStyle = grad;
            ctx.fillRect(x - 12, y - 12, 24, 24);
        }
    },

    magic(ctx, s) {
        ctx.fillStyle = '#1a1040';
        ctx.fillRect(0, 0, s, s);
        const rng = TextureManager.prototype._srand.call(null, 777);
        // Swirl pattern
        const cx = s / 2, cy = s / 2;
        for (let a = 0; a < Math.PI * 6; a += 0.1) {
            const r = a * 3;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r;
            ctx.fillStyle = `rgba(${100 + Math.floor(rng() * 80)},${50 + Math.floor(rng() * 50)},${200 + Math.floor(rng() * 55)},0.4)`;
            ctx.fillRect(Math.floor(x), Math.floor(y), 3, 3);
        }
        // Stars/sparkles
        ctx.fillStyle = 'rgba(255,255,200,0.9)';
        for (let i = 0; i < 15; i++) {
            const x = Math.floor(rng() * s), y = Math.floor(rng() * s);
            ctx.fillRect(x, y, 1, 1);
            ctx.fillRect(x - 1, y, 3, 1);
            ctx.fillRect(x, y - 1, 1, 3);
        }
        // Rune circles
        ctx.strokeStyle = 'rgba(150,100,255,0.3)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 3; i++) {
            ctx.beginPath();
            ctx.arc(Math.floor(rng() * s), Math.floor(rng() * s), 8 + rng() * 12, 0, Math.PI * 2);
            ctx.stroke();
        }
    },

    // ===== Patterns =====
    checkerboard(ctx, s) {
        const cell = s / 8;
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                ctx.fillStyle = (row + col) % 2 === 0 ? '#e0e0e0' : '#404040';
                ctx.fillRect(col * cell, row * cell, cell, cell);
            }
        }
    },

    stripes(ctx, s) {
        const stripeW = s / 8;
        for (let i = 0; i < 8; i++) {
            ctx.fillStyle = i % 2 === 0 ? '#d0d0d0' : '#505060';
            ctx.fillRect(i * stripeW, 0, stripeW, s);
        }
    },

    polka_dots(ctx, s) {
        ctx.fillStyle = '#e8e0d0';
        ctx.fillRect(0, 0, s, s);
        ctx.fillStyle = '#606080';
        const spacing = s / 4;
        for (let row = 0; row < 5; row++) {
            for (let col = 0; col < 5; col++) {
                const offX = (row % 2) * (spacing / 2);
                ctx.beginPath();
                ctx.arc(col * spacing + offX, row * spacing, s * 0.06, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
};

/**
 * Apply a texture to a THREE.js object (mesh or group).
 * Sets material.map, stores textureId/tileScale in userData.
 * Pass null id to remove texture.
 */
TextureManager.prototype.applyTexture = function(obj, textureId, tileScale, textureManager) {
    tileScale = tileScale || 1;
    const mgr = textureManager || this;

    const apply = (mat) => {
        if (!mat) return;
        if (!textureId) {
            mat.map = null;
            mat.needsUpdate = true;
            return;
        }
        const tex = mgr.getTexture(textureId, tileScale);
        if (tex) {
            mat.map = tex;
            mat.needsUpdate = true;
        }
    };

    if (obj.isMesh) {
        apply(obj.material);
    } else {
        // Group — apply to all child meshes
        obj.traverse(child => {
            if (child.isMesh && child.material) apply(child.material);
        });
    }

    obj.userData.textureId = textureId || null;
    obj.userData.tileScale = textureId ? tileScale : undefined;
};
