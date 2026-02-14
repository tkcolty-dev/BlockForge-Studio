const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cobalt_session';

// Valid avatar IDs (SVG avatars rendered on frontend)
const VALID_AVATARS = ['default','fox','cat','robot','bear','panda','owl','penguin','astronaut','ninja','wizard','dragon','bunny','alien','pirate','ghost'];

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// Database setup
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const avatarDir = path.join(dataDir, 'avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir);

const db = new Database(path.join(dataDir, 'users.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        avatar_color TEXT NOT NULL,
        avatar TEXT DEFAULT 'default',
        created_at INTEGER NOT NULL
    )
`);

// Add avatar column if missing (migration for existing DBs)
try { db.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT "robot"'); } catch (e) { /* already exists */ }

db.exec(`
    CREATE TABLE IF NOT EXISTS shared_projects (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        creator TEXT NOT NULL,
        tags TEXT DEFAULT '[]',
        thumbnail TEXT,
        published_at INTEGER NOT NULL,
        project_data TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )
`);

const AVATAR_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#e67e22', '#1abc9c', '#e91e63', '#00bcd4'];

// Auth middleware
function authenticate(req, res, next) {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: 'Not logged in' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.clearCookie(COOKIE_NAME);
        return res.status(401).json({ error: 'Session expired' });
    }
}

function setAuthCookie(res, user) {
    const token = jwt.sign(
        { id: user.id, username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: user.avatar || 'default' },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
    res.cookie(COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000
    });
}

// ===== CAPTCHA =====

function generateCaptcha() {
    const types = ['twoStep', 'wordMath', 'sequence', 'comparison', 'remainder'];
    const type = types[Math.floor(Math.random() * types.length)];
    let question, answer;

    if (type === 'twoStep') {
        // Two-step math: (a + b) × c, or a × b + c
        const variant = Math.random() < 0.5;
        if (variant) {
            const a = Math.floor(Math.random() * 8) + 2;
            const b = Math.floor(Math.random() * 8) + 2;
            const c = Math.floor(Math.random() * 5) + 2;
            answer = (a + b) * c;
            question = `What is (${a} + ${b}) × ${c}?`;
        } else {
            const a = Math.floor(Math.random() * 6) + 2;
            const b = Math.floor(Math.random() * 6) + 2;
            const c = Math.floor(Math.random() * 10) + 1;
            answer = a * b + c;
            question = `What is ${a} × ${b} + ${c}?`;
        }
    } else if (type === 'wordMath') {
        // Word-based: "If you have X apples and give away Y, how many left?"
        const items = ['apples', 'coins', 'stars', 'gems', 'blocks'];
        const item = items[Math.floor(Math.random() * items.length)];
        const total = Math.floor(Math.random() * 30) + 15;
        const give = Math.floor(Math.random() * (total - 5)) + 3;
        answer = total - give;
        question = `If you have ${total} ${item} and give away ${give}, how many are left?`;
    } else if (type === 'sequence') {
        // What comes next: 2, 4, 6, 8, ?
        const start = Math.floor(Math.random() * 5) + 1;
        const step = Math.floor(Math.random() * 4) + 2;
        const seq = [];
        for (let i = 0; i < 4; i++) seq.push(start + step * i);
        answer = start + step * 4;
        question = `What comes next: ${seq.join(', ')}, ?`;
    } else if (type === 'comparison') {
        // Which is bigger: a × b or c × d?
        const a = Math.floor(Math.random() * 8) + 3;
        const b = Math.floor(Math.random() * 8) + 3;
        const c = Math.floor(Math.random() * 8) + 3;
        const d = Math.floor(Math.random() * 8) + 3;
        const left = a * b;
        const right = c * d;
        if (left === right) {
            answer = left + right;
            question = `What is ${a} × ${b} + ${c} × ${d}?`;
        } else {
            answer = Math.max(left, right);
            question = `Which is bigger: ${a} × ${b} or ${c} × ${d}? (type the bigger number)`;
        }
    } else {
        // Remainder: What is the remainder of a ÷ b?
        const b = Math.floor(Math.random() * 7) + 3;
        const a = Math.floor(Math.random() * 40) + b + 5;
        answer = a % b;
        if (answer === 0) {
            answer = a / b;
            question = `What is ${a} ÷ ${b}?`;
        } else {
            question = `What is the remainder when ${a} is divided by ${b}?`;
        }
    }

    const token = jwt.sign({ answer, ts: Date.now() }, JWT_SECRET, { expiresIn: '10m' });
    return { question, token };
}

// GET /api/captcha
app.get('/api/captcha', (req, res) => {
    const { question, token } = generateCaptcha();
    res.json({ question, token });
});

// GET /api/check-username/:username
app.get('/api/check-username/:username', (req, res) => {
    const username = (req.params.username || '').toLowerCase();
    if (!username || username.length < 3) return res.json({ available: false });
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    res.json({ available: !existing });
});

// ===== Auth Endpoints =====

// POST /api/signup
app.post('/api/signup', async (req, res) => {
    const { username, password, captchaToken, captchaAnswer } = req.body;

    // Validate captcha
    if (!captchaToken || captchaAnswer === undefined || captchaAnswer === '') {
        return res.status(400).json({ error: 'Please solve the bot check' });
    }
    try {
        const decoded = jwt.verify(captchaToken, JWT_SECRET);
        if (String(decoded.answer) !== String(captchaAnswer).trim()) {
            return res.status(400).json({ error: 'Wrong answer to bot check', refreshCaptcha: true });
        }
    } catch {
        return res.status(400).json({ error: 'Bot check expired, try again', refreshCaptcha: true });
    }

    if (!username || typeof username !== 'string' || username.length < 3 || username.length > 20) {
        return res.status(400).json({ error: 'Username must be 3-20 characters' });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
        return res.status(400).json({ error: 'Username can only contain letters, numbers, and underscores' });
    }
    if (!password || typeof password !== 'string' || password.length < 4) {
        return res.status(400).json({ error: 'Password must be at least 4 characters' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.toLowerCase());
    if (existing) {
        return res.status(409).json({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const result = db.prepare(
        'INSERT INTO users (username, display_name, password_hash, avatar_color, avatar, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(username.toLowerCase(), username, hash, avatarColor, 'default', Date.now());

    const user = { id: result.lastInsertRowid, username: username.toLowerCase(), display_name: username, avatar_color: avatarColor, avatar: 'default' };
    setAuthCookie(res, user);

    res.json({ username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: user.avatar });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username.toLowerCase());
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    setAuthCookie(res, user);
    const av = user.avatar || 'default';
    const loginResult = { username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: av.startsWith('custom:') ? 'custom' : av };
    if (av.startsWith('custom:')) loginResult.avatarUrl = '/api/avatars/' + av.replace('custom:', '');
    res.json(loginResult);
});

// GET /api/me
app.get('/api/me', authenticate, (req, res) => {
    // Fetch fresh avatar from DB (JWT may be stale after avatar change)
    const dbUser = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
    const avatar = dbUser ? dbUser.avatar : (req.user.avatar || 'default');
    const result = {
        username: req.user.username,
        displayName: req.user.displayName,
        avatarColor: req.user.avatarColor,
        avatar: avatar.startsWith('custom:') ? 'custom' : avatar
    };
    if (avatar.startsWith('custom:')) {
        result.avatarUrl = '/api/avatars/' + avatar.replace('custom:', '');
    }
    res.json(result);
});

// POST /api/me/avatar — upload profile picture (base64 image)
app.post('/api/me/avatar', authenticate, (req, res) => {
    const { image } = req.body;
    if (!image || typeof image !== 'string') {
        return res.status(400).json({ error: 'No image provided' });
    }

    // Validate base64 data URL
    const match = image.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
    if (!match) {
        return res.status(400).json({ error: 'Invalid image format' });
    }

    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const buffer = Buffer.from(match[2], 'base64');

    // Limit to 500KB
    if (buffer.length > 512000) {
        return res.status(400).json({ error: 'Image too large (max 500KB)' });
    }

    const filename = `${req.user.id}.${ext}`;

    // Delete any old avatar files for this user
    try {
        const existing = fs.readdirSync(avatarDir).filter(f => f.startsWith(req.user.id + '.'));
        existing.forEach(f => fs.unlinkSync(path.join(avatarDir, f)));
    } catch (e) { /* ignore */ }

    fs.writeFileSync(path.join(avatarDir, filename), buffer);
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run('custom:' + filename, req.user.id);

    res.json({ ok: true, avatarUrl: '/api/avatars/' + filename });
});

// DELETE /api/me/avatar — remove custom avatar, revert to default
app.delete('/api/me/avatar', authenticate, (req, res) => {
    const user = db.prepare('SELECT avatar FROM users WHERE id = ?').get(req.user.id);
    if (user && user.avatar && user.avatar.startsWith('custom:')) {
        const filename = user.avatar.replace('custom:', '');
        try { fs.unlinkSync(path.join(avatarDir, filename)); } catch (e) { /* ignore */ }
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run('default', req.user.id);
    res.json({ ok: true });
});

// GET /api/avatars/:filename — serve uploaded avatar images
app.get('/api/avatars/:filename', (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const filePath = path.join(avatarDir, filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
    res.sendFile(filePath);
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
});

// ===== Community Endpoints =====

// GET /api/projects
app.get('/api/projects', (req, res) => {
    const rows = db.prepare(
        'SELECT id, name, description, creator, tags, thumbnail, published_at FROM shared_projects ORDER BY published_at DESC'
    ).all();
    const projects = rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        creator: row.creator,
        tags: JSON.parse(row.tags),
        thumbnail: row.thumbnail,
        publishedAt: row.published_at
    }));
    res.json(projects);
});

// GET /api/projects/:id
app.get('/api/projects/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM shared_projects WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    res.json({
        id: row.id,
        name: row.name,
        description: row.description,
        creator: row.creator,
        tags: JSON.parse(row.tags),
        thumbnail: row.thumbnail,
        publishedAt: row.published_at,
        projectData: JSON.parse(row.project_data)
    });
});

// POST /api/projects
app.post('/api/projects', authenticate, (req, res) => {
    const { id, name, description, tags, thumbnail, projectData } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Title is required' });
    }
    if (!projectData) {
        return res.status(400).json({ error: 'Project data is required' });
    }

    const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(req.user.id);
    const creator = user ? user.display_name : 'Anonymous';

    db.prepare(`
        INSERT OR REPLACE INTO shared_projects (id, user_id, name, description, creator, tags, thumbnail, published_at, project_data)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.user.id, name.trim(), (description || '').trim(), creator, JSON.stringify(tags || []), thumbnail || null, Date.now(), JSON.stringify(projectData));

    res.json({ ok: true });
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', authenticate, (req, res) => {
    const row = db.prepare('SELECT user_id FROM shared_projects WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Project not found' });
    if (row.user_id !== req.user.id) return res.status(403).json({ error: 'Not your project' });
    db.prepare('DELETE FROM shared_projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

// GET /api/projects/check/:id
app.get('/api/projects/check/:id', authenticate, (req, res) => {
    const row = db.prepare('SELECT id, name, description, tags FROM shared_projects WHERE id = ? AND user_id = ?')
        .get(req.params.id, req.user.id);
    if (!row) return res.json({ published: false });
    res.json({ published: true, name: row.name, description: row.description, tags: JSON.parse(row.tags) });
});

app.listen(PORT, () => {
    console.log(`Cobalt Studio running at http://localhost:${PORT}`);
});
