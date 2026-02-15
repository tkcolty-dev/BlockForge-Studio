const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cobalt_session';
const ADMIN_IDS = [1, 2];
const ADMIN_USERNAMES = ['dev_account1'];
function isAdmin(user) { return ADMIN_IDS.includes(user.id) || ADMIN_USERNAMES.includes(user.username); }

// Valid avatar IDs (SVG avatars rendered on frontend)
const VALID_AVATARS = ['default','fox','cat','robot','bear','panda','owl','penguin','astronaut','ninja','wizard','dragon','bunny','alien','pirate','ghost'];

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

// Parse VCAP_SERVICES for PostgreSQL connection
function getPgConfig() {
    if (process.env.VCAP_SERVICES) {
        const vcap = JSON.parse(process.env.VCAP_SERVICES);
        const pgService = (vcap.postgres || vcap['user-provided'] || [])[0];
        if (pgService && pgService.credentials) {
            const creds = pgService.credentials;
            if (creds.uri) {
                return { connectionString: creds.uri };
            }
            return {
                host: creds.hostname || creds.host || (creds.hosts && creds.hosts[0]),
                port: creds.port,
                database: creds.db || creds.name || creds.dbname || creds.database,
                user: creds.user || creds.username,
                password: creds.password
            };
        }
    }
    // Local fallback
    return {
        host: process.env.PGHOST || 'localhost',
        port: process.env.PGPORT || 5432,
        database: process.env.PGDATABASE || 'cobalt',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres'
    };
}

const pool = new Pool(getPgConfig());

// Database setup
async function initDb() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            avatar_color TEXT NOT NULL,
            avatar TEXT DEFAULT 'default',
            created_at BIGINT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS shared_projects (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            creator TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            thumbnail TEXT,
            published_at BIGINT NOT NULL,
            project_data TEXT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS avatars (
            user_id INTEGER PRIMARY KEY REFERENCES users(id),
            filename TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            data BYTEA NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS reports (
            id SERIAL PRIMARY KEY,
            project_id TEXT NOT NULL,
            reporter_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS emoji_chats (
            id SERIAL PRIMARY KEY,
            project_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            username TEXT NOT NULL,
            emoji TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
    `);
}

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
    const variant = Math.floor(Math.random() * 3);
    let question, answer;

    if (variant === 0) {
        const a = Math.floor(Math.random() * 20) + 1;
        const b = Math.floor(Math.random() * 20) + 1;
        answer = a + b;
        question = `What is ${a} + ${b}?`;
    } else if (variant === 1) {
        const b = Math.floor(Math.random() * 15) + 1;
        const a = b + Math.floor(Math.random() * 15) + 1;
        answer = a - b;
        question = `What is ${a} - ${b}?`;
    } else {
        const a = Math.floor(Math.random() * 10) + 2;
        const b = Math.floor(Math.random() * 10) + 2;
        answer = a * b;
        question = `What is ${a} x ${b}?`;
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
app.get('/api/check-username/:username', async (req, res) => {
    const username = (req.params.username || '').toLowerCase();
    if (!username || username.length < 3) return res.json({ available: false });
    const { rows } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    res.json({ available: rows.length === 0 });
});

// ===== Auth Endpoints =====

// POST /api/signup
app.post('/api/signup', async (req, res) => {
    const { username, password, captchaToken, captchaAnswer } = req.body;

    // Validate captcha
    if (!captchaToken || captchaAnswer === undefined || captchaAnswer === null || String(captchaAnswer).trim() === '') {
        return res.status(400).json({ error: 'Please solve the bot check' });
    }
    try {
        const decoded = jwt.verify(captchaToken, JWT_SECRET);
        const expected = Number(decoded.answer);
        const provided = Number(String(captchaAnswer).trim());
        if (isNaN(expected) || isNaN(provided) || expected !== provided) {
            return res.status(400).json({ error: 'Wrong answer, try again', refreshCaptcha: true });
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

    const { rows: existing } = await pool.query('SELECT id FROM users WHERE username = $1', [username.toLowerCase()]);
    if (existing.length > 0) {
        return res.status(409).json({ error: 'Username already taken' });
    }

    const hash = await bcrypt.hash(password, 10);
    const avatarColor = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];

    const { rows } = await pool.query(
        'INSERT INTO users (username, display_name, password_hash, avatar_color, avatar, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [username.toLowerCase(), username, hash, avatarColor, 'default', Date.now()]
    );

    const user = { id: rows[0].id, username: username.toLowerCase(), display_name: username, avatar_color: avatarColor, avatar: 'default' };
    setAuthCookie(res, user);

    res.json({ username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: user.avatar, isAdmin: isAdmin(user) });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    const { rows } = await pool.query('SELECT * FROM users WHERE username = $1', [username.toLowerCase()]);
    const user = rows[0];
    if (!user) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    setAuthCookie(res, user);
    const av = user.avatar || 'default';
    const loginResult = { username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: av.startsWith('custom:') ? 'custom' : av, isAdmin: isAdmin(user) };
    if (av.startsWith('custom:')) loginResult.avatarUrl = '/api/avatars/' + av.replace('custom:', '');
    res.json(loginResult);
});

// GET /api/me
app.get('/api/me', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
    const avatar = rows.length > 0 ? rows[0].avatar : (req.user.avatar || 'default');
    const result = {
        username: req.user.username,
        displayName: req.user.displayName,
        avatarColor: req.user.avatarColor,
        avatar: avatar.startsWith('custom:') ? 'custom' : avatar,
        isAdmin: isAdmin(req.user)
    };
    if (avatar.startsWith('custom:')) {
        result.avatarUrl = '/api/avatars/' + avatar.replace('custom:', '');
    }
    res.json(result);
});

// POST /api/me/avatar — upload profile picture (base64 image)
app.post('/api/me/avatar', authenticate, async (req, res) => {
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
    const mimeType = `image/${match[1]}`;
    const buffer = Buffer.from(match[2], 'base64');

    // Limit to 500KB
    if (buffer.length > 512000) {
        return res.status(400).json({ error: 'Image too large (max 500KB)' });
    }

    const filename = `${req.user.id}.${ext}`;

    // Upsert avatar in database
    await pool.query(
        `INSERT INTO avatars (user_id, filename, mime_type, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET filename = $2, mime_type = $3, data = $4`,
        [req.user.id, filename, mimeType, buffer]
    );
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', ['custom:' + filename, req.user.id]);

    res.json({ ok: true, avatarUrl: '/api/avatars/' + filename });
});

// DELETE /api/me/avatar — remove custom avatar, revert to default
app.delete('/api/me/avatar', authenticate, async (req, res) => {
    await pool.query('DELETE FROM avatars WHERE user_id = $1', [req.user.id]);
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', ['default', req.user.id]);
    res.json({ ok: true });
});

// GET /api/avatars/:filename — serve uploaded avatar images from database
app.get('/api/avatars/:filename', async (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const { rows } = await pool.query('SELECT mime_type, data FROM avatars WHERE filename = $1', [filename]);
    if (rows.length === 0) return res.status(404).send('Not found');
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(rows[0].data);
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
});

// ===== Community Endpoints =====

// GET /api/projects
app.get('/api/projects', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, name, description, creator, tags, thumbnail, published_at FROM shared_projects ORDER BY published_at DESC'
    );
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
app.get('/api/projects/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM shared_projects WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const row = rows[0];
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
app.post('/api/projects', authenticate, async (req, res) => {
    const { id, name, description, tags, thumbnail, projectData } = req.body;

    if (!name || !name.trim()) {
        return res.status(400).json({ error: 'Title is required' });
    }
    if (!projectData) {
        return res.status(400).json({ error: 'Project data is required' });
    }

    const { rows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.user.id]);
    const creator = rows.length > 0 ? rows[0].display_name : 'Anonymous';

    await pool.query(
        `INSERT INTO shared_projects (id, user_id, name, description, creator, tags, thumbnail, published_at, project_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO UPDATE SET name = $3, description = $4, creator = $5, tags = $6, thumbnail = $7, published_at = $8, project_data = $9`,
        [id, req.user.id, name.trim(), (description || '').trim(), creator, JSON.stringify(tags || []), thumbnail || null, Date.now(), JSON.stringify(projectData)]
    );

    res.json({ ok: true });
});

// DELETE /api/projects/:id
app.delete('/api/projects/:id', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT user_id FROM shared_projects WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Not your project' });
    await pool.query('DELETE FROM shared_projects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
});

// GET /api/projects/check/:id
app.get('/api/projects/check/:id', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, name, description, tags FROM shared_projects WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.json({ published: false });
    res.json({ published: true, name: rows[0].name, description: rows[0].description, tags: JSON.parse(rows[0].tags) });
});

// ===== Report Endpoints =====

// POST /api/projects/:id/report — report a project
app.post('/api/projects/:id/report', authenticate, async (req, res) => {
    const projectId = req.params.id;
    const { reason } = req.body;

    const { rows: proj } = await pool.query('SELECT id FROM shared_projects WHERE id = $1', [projectId]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });

    const { rows: existing } = await pool.query(
        'SELECT id FROM reports WHERE project_id = $1 AND reporter_id = $2',
        [projectId, req.user.id]
    );
    if (existing.length > 0) return res.status(409).json({ error: 'Already reported' });

    await pool.query(
        'INSERT INTO reports (project_id, reporter_id, reason, created_at) VALUES ($1, $2, $3, $4)',
        [projectId, req.user.id, (reason || 'No reason given').slice(0, 500), Date.now()]
    );
    res.json({ ok: true });
});

// GET /api/reports — admin only, list all reports
app.get('/api/reports', authenticate, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await pool.query(`
        SELECT r.id, r.project_id, r.reason, r.created_at,
               sp.name AS project_name, sp.creator AS project_creator,
               u.display_name AS reporter_name
        FROM reports r
        LEFT JOIN shared_projects sp ON sp.id = r.project_id
        LEFT JOIN users u ON u.id = r.reporter_id
        ORDER BY r.created_at DESC
    `);
    res.json(rows);
});

// DELETE /api/reports/:id — admin only, dismiss a report
app.delete('/api/reports/:id', authenticate, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    await pool.query('DELETE FROM reports WHERE id = $1', [parseInt(req.params.id)]);
    res.json({ ok: true });
});

// DELETE /api/reports/:id/project — admin only, delete project + report
app.delete('/api/reports/:id/project', authenticate, async (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Forbidden' });
    const { rows } = await pool.query('SELECT project_id FROM reports WHERE id = $1', [parseInt(req.params.id)]);
    if (rows.length === 0) return res.status(404).json({ error: 'Report not found' });
    const projectId = rows[0].project_id;
    await pool.query('DELETE FROM shared_projects WHERE id = $1', [projectId]);
    await pool.query('DELETE FROM reports WHERE project_id = $1', [projectId]);
    res.json({ ok: true });
});

// ===== Emoji Chat Endpoints =====

const ALLOWED_EMOJIS = ['👍','❤️','🔥','⭐','😂','😮','🎮','🎨','💎','🏆','👏','🚀','💯','🤩','😎','👾'];
const emojiCooldowns = new Map();

// GET /api/projects/:id/emojis — get emoji chat messages
app.get('/api/projects/:id/emojis', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, username, emoji, created_at FROM emoji_chats WHERE project_id = $1 ORDER BY created_at ASC LIMIT 50',
        [req.params.id]
    );
    res.json(rows);
});

// POST /api/projects/:id/emojis — send emoji message
app.post('/api/projects/:id/emojis', authenticate, async (req, res) => {
    const { emoji } = req.body;
    if (!emoji || !ALLOWED_EMOJIS.includes(emoji)) {
        return res.status(400).json({ error: 'Invalid emoji' });
    }

    // Rate limit: 3 second cooldown
    const now = Date.now();
    const lastSent = emojiCooldowns.get(req.user.id) || 0;
    if (now - lastSent < 3000) {
        return res.status(429).json({ error: 'Wait a moment' });
    }
    emojiCooldowns.set(req.user.id, now);

    const { rows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.user.id]);
    const username = rows.length > 0 ? rows[0].display_name : 'Anonymous';

    await pool.query(
        'INSERT INTO emoji_chats (project_id, user_id, username, emoji, created_at) VALUES ($1, $2, $3, $4, $5)',
        [req.params.id, req.user.id, username, emoji, now]
    );
    res.json({ ok: true, username, emoji, created_at: now });
});

// Initialize DB and start server
initDb().then(() => {
    app.listen(PORT, () => {
        console.log(`Cobalt Studio running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
