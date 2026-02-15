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
        CREATE TABLE IF NOT EXISTS comments (
            id SERIAL PRIMARY KEY,
            project_id TEXT NOT NULL REFERENCES shared_projects(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id),
            username TEXT NOT NULL,
            avatar TEXT DEFAULT 'default',
            body TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_warnings (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            reason TEXT NOT NULL,
            created_at BIGINT NOT NULL
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS chat_bans (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            reason TEXT NOT NULL,
            banned_at BIGINT NOT NULL,
            expires_at BIGINT NOT NULL
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

// ===== Chat Moderation =====

const ADMIN_IDS = [2]; // user IDs that can delete any comment

const BLOCKED_WORDS = [
    // profanity
    'fuck', 'shit', 'damn', 'ass', 'bitch', 'bastard', 'crap', 'dick', 'piss', 'cock',
    'cunt', 'twat', 'wanker', 'bollocks', 'arse', 'bugger', 'bloody',
    // slurs
    'nigger', 'nigga', 'faggot', 'fag', 'retard', 'retarded', 'tranny', 'chink', 'spic',
    'kike', 'wetback', 'beaner', 'gook', 'dyke',
    // threats
    'kill you', 'kill yourself', 'kys', 'die', 'murder', 'shoot you', 'bomb', 'stab',
    'rape', 'hang yourself', 'slit your', 'death threat',
    // sexual
    'porn', 'hentai', 'nude', 'naked', 'sex', 'penis', 'vagina', 'boob', 'tits',
    'masturbat', 'orgasm', 'erotic', 'xxx', 'nsfw',
    // hate
    'nazi', 'hitler', 'kkk', 'white power', 'white supremac', 'genocide'
];

// Build regex patterns with word boundaries
const BLOCKED_PATTERNS = BLOCKED_WORDS.map(word => {
    // Multi-word phrases use direct matching, single words use word boundaries
    if (word.includes(' ')) {
        return new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    return new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
});

// Image URL patterns
const IMAGE_PATTERNS = [
    /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp|bmp|svg)/i,
    /https?:\/\/(i\.)?imgur\.com/i,
    /https?:\/\/i\.redd\.it/i,
    /data:image\//i,
    /https?:\/\/\S+\.(mp4|mov|avi|webm)/i
];

function moderateComment(text) {
    // Check for blocked words/phrases
    for (let i = 0; i < BLOCKED_PATTERNS.length; i++) {
        if (BLOCKED_PATTERNS[i].test(text)) {
            return { blocked: true, reason: 'Your comment contains inappropriate language' };
        }
    }

    // Check for image/media URLs
    for (const pattern of IMAGE_PATTERNS) {
        if (pattern.test(text)) {
            return { blocked: true, reason: 'Images and media links are not allowed in comments' };
        }
    }

    // Check for excessive caps (>70% uppercase in messages longer than 5 chars)
    const letters = text.replace(/[^a-zA-Z]/g, '');
    if (letters.length > 5) {
        const upperCount = (text.match(/[A-Z]/g) || []).length;
        if (upperCount / letters.length > 0.7) {
            return { blocked: true, reason: 'Please don\'t use excessive caps' };
        }
    }

    // Check for character spam (same char repeated 5+ times)
    if (/(.)\1{4,}/i.test(text)) {
        return { blocked: true, reason: 'Please don\'t spam repeated characters' };
    }

    return { blocked: false };
}

// Rate limiter: track last comment time per user
const commentCooldowns = new Map();
const COMMENT_COOLDOWN_MS = 5000; // 5 seconds

function checkRateLimit(userId) {
    const now = Date.now();
    const last = commentCooldowns.get(userId);
    if (last && now - last < COMMENT_COOLDOWN_MS) {
        const wait = Math.ceil((COMMENT_COOLDOWN_MS - (now - last)) / 1000);
        return { limited: true, wait };
    }
    return { limited: false };
}

async function checkBan(userId) {
    const { rows } = await pool.query(
        'SELECT expires_at, reason FROM chat_bans WHERE user_id = $1 AND expires_at > $2 ORDER BY expires_at DESC LIMIT 1',
        [userId, Date.now()]
    );
    if (rows.length > 0) {
        const remaining = rows[0].expires_at - Date.now();
        return { banned: true, remaining, reason: rows[0].reason };
    }
    return { banned: false };
}

async function escalate(userId, reason) {
    const now = Date.now();

    // Count existing warnings
    const { rows } = await pool.query('SELECT COUNT(*) as count FROM chat_warnings WHERE user_id = $1', [userId]);
    const warningCount = parseInt(rows[0].count);

    // Add a warning record
    await pool.query('INSERT INTO chat_warnings (user_id, reason, created_at) VALUES ($1, $2, $3)', [userId, reason, now]);

    if (warningCount < 2) {
        // First two offenses: just warn
        return { action: 'warning', count: warningCount + 1 };
    }

    // Calculate ban duration
    let banMs;
    if (warningCount === 2) {
        banMs = 15 * 60 * 1000; // 15 minutes
    } else {
        // Exponential: 1 day, 2 days, 4 days, 8 days...
        const days = Math.pow(2, warningCount - 3);
        banMs = days * 24 * 60 * 60 * 1000;
    }

    const expiresAt = now + banMs;
    await pool.query(
        'INSERT INTO chat_bans (user_id, reason, banned_at, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, reason, now, expiresAt]
    );

    return { action: 'ban', duration: banMs };
}

function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return days + (days === 1 ? ' day' : ' days');
    if (hours > 0) return hours + (hours === 1 ? ' hour' : ' hours');
    if (minutes > 0) return minutes + (minutes === 1 ? ' minute' : ' minutes');
    return seconds + (seconds === 1 ? ' second' : ' seconds');
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

    res.json({ username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: user.avatar });
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
    const loginResult = { username: user.username, displayName: user.display_name, avatarColor: user.avatar_color, avatar: av.startsWith('custom:') ? 'custom' : av };
    if (av.startsWith('custom:')) loginResult.avatarUrl = '/api/avatars/' + av.replace('custom:', '');
    res.json(loginResult);
});

// GET /api/me
app.get('/api/me', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT avatar FROM users WHERE id = $1', [req.user.id]);
    const avatar = rows.length > 0 ? rows[0].avatar : (req.user.avatar || 'default');
    const result = {
        id: req.user.id,
        username: req.user.username,
        displayName: req.user.displayName,
        avatarColor: req.user.avatarColor,
        avatar: avatar.startsWith('custom:') ? 'custom' : avatar,
        isAdmin: ADMIN_IDS.includes(req.user.id)
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

// ===== Comments Endpoints =====

// GET /api/projects/:id/comments
app.get('/api/projects/:id/comments', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, project_id, user_id, username, avatar, body, created_at FROM comments WHERE project_id = $1 ORDER BY created_at DESC LIMIT 100',
        [req.params.id]
    );
    res.json(rows.map(r => ({
        id: r.id,
        projectId: r.project_id,
        userId: r.user_id,
        username: r.username,
        avatar: r.avatar,
        body: r.body,
        createdAt: r.created_at
    })));
});

// POST /api/projects/:id/comments
app.post('/api/projects/:id/comments', authenticate, async (req, res) => {
    const { body } = req.body;
    if (!body || typeof body !== 'string' || !body.trim()) {
        return res.status(400).json({ error: 'Comment body is required' });
    }
    if (body.length > 500) {
        return res.status(400).json({ error: 'Comment must be 500 characters or less' });
    }

    // Check active ban
    const ban = await checkBan(req.user.id);
    if (ban.banned) {
        return res.status(403).json({ error: 'You are banned from commenting for ' + formatDuration(ban.remaining) });
    }

    // Rate limit
    const rateCheck = checkRateLimit(req.user.id);
    if (rateCheck.limited) {
        return res.status(429).json({ error: 'Slow down! Wait ' + rateCheck.wait + ' seconds between comments' });
    }

    // Content moderation
    const modResult = moderateComment(body.trim());
    if (modResult.blocked) {
        const result = await escalate(req.user.id, modResult.reason);
        if (result.action === 'warning') {
            const msg = result.count === 1
                ? 'Warning: ' + modResult.reason + '. Please follow the rules.'
                : 'Final warning: ' + modResult.reason + '. Next offense will result in a ban.';
            return res.status(400).json({ error: msg });
        } else {
            return res.status(403).json({ error: 'You have been banned from commenting for ' + formatDuration(result.duration) + '. Reason: ' + modResult.reason });
        }
    }

    // Record successful comment time for rate limiting
    commentCooldowns.set(req.user.id, Date.now());

    // Verify project exists
    const { rows: proj } = await pool.query('SELECT id FROM shared_projects WHERE id = $1', [req.params.id]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });

    // Get user info
    const { rows: userRows } = await pool.query('SELECT display_name, avatar FROM users WHERE id = $1', [req.user.id]);
    const username = userRows.length > 0 ? userRows[0].display_name : req.user.username;
    const avatar = userRows.length > 0 ? userRows[0].avatar : 'default';

    const { rows } = await pool.query(
        'INSERT INTO comments (project_id, user_id, username, avatar, body, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [req.params.id, req.user.id, username, avatar, body.trim(), Date.now()]
    );

    res.json({
        id: rows[0].id,
        projectId: req.params.id,
        userId: req.user.id,
        username,
        avatar,
        body: body.trim(),
        createdAt: Date.now()
    });
});

// DELETE /api/projects/:id/comments/:commentId
app.delete('/api/projects/:id/comments/:commentId', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT user_id FROM comments WHERE id = $1 AND project_id = $2', [req.params.commentId, req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Comment not found' });
    // Allow admins to delete any comment
    if (rows[0].user_id !== req.user.id && !ADMIN_IDS.includes(req.user.id)) {
        return res.status(403).json({ error: 'Not your comment' });
    }
    await pool.query('DELETE FROM comments WHERE id = $1', [req.params.commentId]);
    res.json({ ok: true });
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
