const express = require('express');
const http = require('http');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServer } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_NAME = 'cobalt_session';
const ADMIN_IDS = [1, 2];
const ADMIN_USERNAMES = ['dev_account1'];
function isAdmin(user) { return ADMIN_IDS.includes(user.id) || ADMIN_USERNAMES.includes(user.username); }

// Valid avatar IDs (SVG avatars rendered on frontend)
const VALID_AVATARS = ['default','fox','cat','robot','bear','panda','owl','penguin','astronaut','ninja','wizard','dragon','bunny','alien','pirate','ghost'];

// Profanity filter for usernames
const BANNED_WORDS = [
    'fuck','shit','ass','damn','bitch','bastard','dick','cock','pussy','cunt',
    'whore','slut','fag','faggot','nigger','nigga','retard','rape','penis',
    'vagina','boob','tits','porn','sex','nude','naked','hentai','milf',
    'dildo','anal','oral','cum','jizz','erect','orgasm','fetish','bondage',
    'nazi','hitler','kkk','jihad','terrorist','kill','murder','suicide',
    'pedo','molest','incest','bestiality','zoophil','necro','gore','torture'
];
function containsProfanity(text) {
    const lower = text.toLowerCase().replace(/[_0-9]/g, '');
    return BANNED_WORDS.some(w => lower.includes(w));
}

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

// Parse VCAP_SERVICES for GenAI service
function getGenaiConfig() {
    if (process.env.VCAP_SERVICES) {
        const vcap = JSON.parse(process.env.VCAP_SERVICES);
        const genaiService = (vcap.genai || [])[0];
        if (genaiService && genaiService.credentials) {
            const creds = genaiService.credentials;
            // Top-level api_base includes /openai path; endpoint.api_base does not
            const apiBase = creds.api_base || (creds.endpoint && creds.endpoint.api_base) || '';
            const apiKey = creds.api_key || (creds.endpoint && creds.endpoint.api_key) || '';
            const model = creds.model_name || '';
            return { apiBase, apiKey, model };
        }
    }
    // Local fallback (set env vars for local dev)
    return {
        apiBase: process.env.GENAI_API_BASE || '',
        apiKey: process.env.GENAI_API_KEY || '',
        model: process.env.GENAI_MODEL || ''
    };
}

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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_projects (
            id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            project_data TEXT NOT NULL,
            thumbnail TEXT,
            favorite BOOLEAN DEFAULT false,
            shared BOOLEAN DEFAULT false,
            description TEXT DEFAULT '',
            tags TEXT DEFAULT '[]',
            created_at BIGINT NOT NULL,
            modified_at BIGINT NOT NULL,
            PRIMARY KEY (id, user_id)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_interactions (
            project_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL CHECK (type IN ('like', 'favorite')),
            created_at BIGINT NOT NULL,
            PRIMARY KEY (project_id, user_id, type)
        )
    `);

    // Migration: add view_count column to shared_projects
    await pool.query(`ALTER TABLE shared_projects ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0`);

    // Table for timestamped view events (for trending algorithm)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS project_views (
            id SERIAL PRIMARY KEY,
            project_id TEXT NOT NULL,
            viewed_at TIMESTAMP DEFAULT NOW()
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
    if (containsProfanity(username)) return res.json({ available: false, inappropriate: true });
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
    if (containsProfanity(username)) {
        return res.status(400).json({ error: 'That username is not allowed' });
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

// GET /api/users/:username — public user profile
app.get('/api/users/:username', async (req, res) => {
    const lookup = req.params.username;
    const { rows: userRows } = await pool.query(
        'SELECT id, username, display_name, avatar_color, avatar, created_at FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(display_name) = LOWER($1)',
        [lookup]
    );
    if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = userRows[0];
    const { rows: projRows } = await pool.query(
        'SELECT id, name, description, tags, thumbnail, published_at FROM shared_projects WHERE user_id = $1 ORDER BY published_at DESC',
        [user.id]
    );
    const projects = projRows.map(r => ({
        id: r.id, name: r.name, description: r.description,
        creator: user.display_name,
        tags: JSON.parse(r.tags), thumbnail: r.thumbnail, publishedAt: r.published_at
    }));
    const result = {
        username: user.username, displayName: user.display_name,
        avatarColor: user.avatar_color, avatar: user.avatar && user.avatar.startsWith('custom:') ? 'custom' : (user.avatar || 'default'),
        createdAt: user.created_at, projects, projectCount: projects.length
    };
    if (user.avatar && user.avatar.startsWith('custom:')) {
        result.avatarUrl = '/api/avatars/' + user.avatar.replace('custom:', '');
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

    // AI-based image moderation
    const config = getGenaiConfig();
    if (config.apiBase) {
        try {
            const moderationUrl = config.apiBase.replace(/\/+$/, '') + '/v1/chat/completions';
            const moderationBody = JSON.stringify({
                model: config.model || undefined,
                messages: [
                    { role: 'system', content: 'You are a content moderator for a kids game platform. Respond with ONLY "safe" or "unsafe". An image is unsafe if it contains: nudity, sexual content, gore, violence, hate symbols, drug use, or any content inappropriate for children.' },
                    { role: 'user', content: [
                        { type: 'text', text: 'Is this profile picture safe for a kids platform? Reply only "safe" or "unsafe".' },
                        { type: 'image_url', image_url: { url: image } }
                    ]}
                ],
                max_tokens: 10
            });
            const modRes = await fetch(moderationUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(config.apiKey ? { 'Authorization': 'Bearer ' + config.apiKey } : {})
                },
                body: moderationBody
            });
            if (modRes.ok) {
                const modData = await modRes.json();
                const verdict = modData.choices?.[0]?.message?.content?.trim().toLowerCase() || '';
                if (verdict.includes('unsafe')) {
                    return res.status(400).json({ error: 'This image is not appropriate. Please choose a different picture.' });
                }
            }
        } catch (e) {
            console.error('Image moderation error:', e.message);
            // Allow upload if moderation service fails — don't block users
        }
    }

    const filename = `${req.user.id}.${ext}`;

    // Upsert avatar in database
    await pool.query(
        `INSERT INTO avatars (user_id, filename, mime_type, data) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET filename = $2, mime_type = $3, data = $4`,
        [req.user.id, filename, mimeType, buffer]
    );
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', ['custom:' + filename, req.user.id]);

    // Refresh JWT cookie with updated avatar
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userRows.length > 0) setAuthCookie(res, userRows[0]);

    res.json({ ok: true, avatarUrl: '/api/avatars/' + filename });
});

// DELETE /api/me/avatar — remove custom avatar, revert to default
app.delete('/api/me/avatar', authenticate, async (req, res) => {
    await pool.query('DELETE FROM avatars WHERE user_id = $1', [req.user.id]);
    await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', ['default', req.user.id]);

    // Refresh JWT cookie with updated avatar
    const { rows: userRows } = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
    if (userRows.length > 0) setAuthCookie(res, userRows[0]);

    res.json({ ok: true });
});

// GET /api/avatars/:filename — serve uploaded avatar images from database
app.get('/api/avatars/:filename', async (req, res) => {
    const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '');
    const { rows } = await pool.query('SELECT mime_type, data FROM avatars WHERE filename = $1', [filename]);
    if (rows.length === 0) return res.status(404).send('Not found');
    res.set('Content-Type', rows[0].mime_type);
    res.set('Cache-Control', 'no-cache');
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
    const sort = req.query.sort || 'popular';
    const orderClause = sort === 'newest'
        ? 'ORDER BY sp.published_at DESC'
        : `ORDER BY (
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'like') * 3 +
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'favorite') * 5 +
            (SELECT COUNT(*) FROM emoji_chats WHERE project_id = sp.id) * 1 +
            COALESCE(sp.view_count, 0) * 0.1
          ) DESC, sp.published_at DESC`;
    const { rows } = await pool.query(
        `SELECT sp.id, sp.name, sp.description, sp.creator, sp.tags, sp.thumbnail, sp.published_at,
                u.avatar, u.avatar_color,
                COALESCE(sp.view_count, 0) as view_count,
                (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'like') as like_count,
                (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'favorite') as fav_count,
                (SELECT COUNT(*) FROM emoji_chats WHERE project_id = sp.id) as comment_count
         FROM shared_projects sp
         LEFT JOIN users u ON sp.user_id = u.id
         ${orderClause}`
    );
    const projects = rows.map(row => {
        const proj = {
            id: row.id,
            name: row.name,
            description: row.description,
            creator: row.creator,
            tags: JSON.parse(row.tags),
            thumbnail: row.thumbnail,
            publishedAt: row.published_at,
            creatorAvatarColor: row.avatar_color,
            likeCount: parseInt(row.like_count),
            favoriteCount: parseInt(row.fav_count),
            commentCount: parseInt(row.comment_count),
            viewCount: parseInt(row.view_count)
        };
        if (row.avatar && row.avatar.startsWith('custom:')) {
            proj.creatorAvatarUrl = '/api/avatars/' + row.avatar.replace('custom:', '');
        }
        return proj;
    });
    res.json(projects);
});

// GET /api/projects/trending — projects with most recent engagement
app.get('/api/projects/trending', async (req, res) => {
    try {
        const { rows } = await pool.query(
            `SELECT * FROM (
                SELECT sp.id, sp.name, sp.description, sp.creator, sp.tags, sp.thumbnail, sp.published_at,
                    u.avatar, u.avatar_color,
                    COALESCE(sp.view_count, 0) as view_count,
                    (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'like') as like_count,
                    (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'favorite') as fav_count,
                    (SELECT COUNT(*) FROM emoji_chats WHERE project_id = sp.id) as comment_count,
                    (
                        (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'like' AND created_at > $1) * 3 +
                        (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'favorite' AND created_at > $1) * 5 +
                        (SELECT COUNT(*) FROM emoji_chats WHERE project_id = sp.id AND created_at > $1) * 1 +
                        (SELECT COUNT(*) FROM project_views WHERE project_id = sp.id AND viewed_at > NOW() - INTERVAL '24 hours') * 0.5
                    ) as trending_score
                FROM shared_projects sp
                LEFT JOIN users u ON sp.user_id = u.id
             ) sub
             WHERE trending_score > 0
             ORDER BY trending_score DESC, published_at DESC
             LIMIT 6`,
            [Date.now() - 86400000] // 24 hours ago in ms
        );
        const projects = rows.map(row => {
            const proj = {
                id: row.id,
                name: row.name,
                description: row.description,
                creator: row.creator,
                tags: JSON.parse(row.tags),
                thumbnail: row.thumbnail,
                publishedAt: row.published_at,
                creatorAvatarColor: row.avatar_color,
                likeCount: parseInt(row.like_count),
                favoriteCount: parseInt(row.fav_count),
                commentCount: parseInt(row.comment_count),
                viewCount: parseInt(row.view_count),
                trendingScore: parseFloat(row.trending_score)
            };
            if (row.avatar && row.avatar.startsWith('custom:')) {
                proj.creatorAvatarUrl = '/api/avatars/' + row.avatar.replace('custom:', '');
            }
            return proj;
        });
        res.json(projects);
    } catch (e) {
        console.error('Trending error:', e);
        res.json([]);
    }
});

// GET /api/projects/:id
app.get('/api/projects/:id', async (req, res) => {
    const { rows } = await pool.query(
        `SELECT sp.*, u.avatar, u.avatar_color
         FROM shared_projects sp
         LEFT JOIN users u ON sp.user_id = u.id
         WHERE sp.id = $1`,
        [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    const row = rows[0];
    const result = {
        id: row.id,
        name: row.name,
        description: row.description,
        creator: row.creator,
        tags: JSON.parse(row.tags),
        thumbnail: row.thumbnail,
        publishedAt: row.published_at,
        projectData: JSON.parse(row.project_data),
        creatorAvatarColor: row.avatar_color
    };
    if (row.avatar && row.avatar.startsWith('custom:')) {
        result.creatorAvatarUrl = '/api/avatars/' + row.avatar.replace('custom:', '');
    }
    res.json(result);
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
    await pool.query('DELETE FROM project_interactions WHERE project_id = $1', [req.params.id]);
    await pool.query('DELETE FROM shared_projects WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
});

// PATCH /api/projects/:id — rename shared project
app.patch('/api/projects/:id', authenticate, async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
        return res.status(400).json({ error: 'Name is required' });
    }
    const { rows } = await pool.query('SELECT user_id FROM shared_projects WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Project not found' });
    if (rows[0].user_id !== req.user.id) return res.status(403).json({ error: 'Not your project' });
    await pool.query('UPDATE shared_projects SET name = $1 WHERE id = $2', [name.trim(), req.params.id]);
    await pool.query('UPDATE user_projects SET name = $1 WHERE id = $2 AND user_id = $3', [name.trim(), req.params.id, req.user.id]);
    res.json({ ok: true });
});

// POST /api/projects/:id/like — toggle like
app.post('/api/projects/:id/like', authenticate, async (req, res) => {
    const projectId = req.params.id;
    const { rows: proj } = await pool.query('SELECT id FROM shared_projects WHERE id = $1', [projectId]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { rows: existing } = await pool.query(
        "SELECT project_id FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'like'",
        [projectId, req.user.id]
    );
    if (existing.length > 0) {
        await pool.query("DELETE FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'like'", [projectId, req.user.id]);
        res.json({ liked: false });
    } else {
        await pool.query("INSERT INTO project_interactions (project_id, user_id, type, created_at) VALUES ($1, $2, 'like', $3)", [projectId, req.user.id, Date.now()]);
        res.json({ liked: true });
    }
});

// POST /api/projects/:id/favorite — toggle favorite
app.post('/api/projects/:id/favorite', authenticate, async (req, res) => {
    const projectId = req.params.id;
    const { rows: proj } = await pool.query('SELECT id FROM shared_projects WHERE id = $1', [projectId]);
    if (proj.length === 0) return res.status(404).json({ error: 'Project not found' });
    const { rows: existing } = await pool.query(
        "SELECT project_id FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'favorite'",
        [projectId, req.user.id]
    );
    if (existing.length > 0) {
        await pool.query("DELETE FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'favorite'", [projectId, req.user.id]);
        res.json({ favorited: false });
    } else {
        await pool.query("INSERT INTO project_interactions (project_id, user_id, type, created_at) VALUES ($1, $2, 'favorite', $3)", [projectId, req.user.id, Date.now()]);
        res.json({ favorited: true });
    }
});

// GET /api/projects/:id/stats — get like/favorite counts + user status
app.get('/api/projects/:id/stats', async (req, res) => {
    const projectId = req.params.id;
    const { rows: likesRow } = await pool.query("SELECT COUNT(*) as count FROM project_interactions WHERE project_id = $1 AND type = 'like'", [projectId]);
    const { rows: favsRow } = await pool.query("SELECT COUNT(*) as count FROM project_interactions WHERE project_id = $1 AND type = 'favorite'", [projectId]);
    const { rows: viewRow } = await pool.query("SELECT COALESCE(view_count, 0) as count FROM shared_projects WHERE id = $1", [projectId]);
    const likes = parseInt(likesRow[0].count);
    const favorites = parseInt(favsRow[0].count);
    const viewCount = viewRow.length > 0 ? parseInt(viewRow[0].count) : 0;
    let userLiked = false, userFavorited = false;
    // Check user status from JWT cookie (optional auth)
    const token = req.cookies[COOKIE_NAME];
    if (token) {
        try {
            const user = jwt.verify(token, JWT_SECRET);
            const { rows: ul } = await pool.query("SELECT project_id FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'like'", [projectId, user.id]);
            const { rows: uf } = await pool.query("SELECT project_id FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'favorite'", [projectId, user.id]);
            userLiked = ul.length > 0;
            userFavorited = uf.length > 0;
        } catch { /* invalid token, ignore */ }
    }
    res.json({ likes, favorites, viewCount, userLiked, userFavorited });
});

// GET /api/user/favorites — get user's favorited community projects
app.get('/api/user/favorites', authenticate, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT sp.id, sp.name, sp.description, sp.creator, sp.tags, sp.thumbnail, sp.published_at,
               u.avatar, u.avatar_color,
               COALESCE(sp.view_count, 0) as view_count,
               (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'like') as like_count,
               (SELECT COUNT(*) FROM project_interactions WHERE project_id = sp.id AND type = 'favorite') as fav_count,
               (SELECT COUNT(*) FROM emoji_chats WHERE project_id = sp.id) as comment_count
        FROM project_interactions pi
        JOIN shared_projects sp ON sp.id = pi.project_id
        LEFT JOIN users u ON sp.user_id = u.id
        WHERE pi.user_id = $1 AND pi.type = 'favorite'
        ORDER BY pi.created_at DESC
    `, [req.user.id]);
    const projects = rows.map(row => {
        const proj = {
            id: row.id, name: row.name, description: row.description,
            creator: row.creator, tags: JSON.parse(row.tags),
            thumbnail: row.thumbnail, publishedAt: row.published_at,
            creatorAvatarColor: row.avatar_color,
            likeCount: parseInt(row.like_count),
            favoriteCount: parseInt(row.fav_count),
            commentCount: parseInt(row.comment_count),
            viewCount: parseInt(row.view_count)
        };
        if (row.avatar && row.avatar.startsWith('custom:')) {
            proj.creatorAvatarUrl = '/api/avatars/' + row.avatar.replace('custom:', '');
        }
        return proj;
    });
    res.json(projects);
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
const viewCooldowns = new Map();
let viewCleanupCounter = 0;

// GET /api/projects/:id/emojis — get emoji chat messages
app.get('/api/projects/:id/emojis', async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, username, emoji, created_at FROM emoji_chats WHERE project_id = $1 ORDER BY created_at DESC LIMIT 50',
        [req.params.id]
    );
    res.json(rows);
});

// POST /api/projects/:id/emojis — send emoji message (1-15 emojis)
app.post('/api/projects/:id/emojis', authenticate, async (req, res) => {
    const { emoji } = req.body;
    // Accept a string of 1-15 emojis
    if (!emoji || typeof emoji !== 'string') {
        return res.status(400).json({ error: 'Invalid emoji' });
    }
    const emojiChars = [...emoji];
    if (emojiChars.length === 0 || emojiChars.length > 15 || !emojiChars.every(e => ALLOWED_EMOJIS.includes(e))) {
        return res.status(400).json({ error: 'Invalid emoji (max 15)' });
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

// POST /api/projects/:id/view — record a view
app.post('/api/projects/:id/view', async (req, res) => {
    const projectId = req.params.id;
    const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
    const key = ip + ':' + projectId;
    const now = Date.now();
    const lastView = viewCooldowns.get(key) || 0;
    if (now - lastView < 300000) {
        return res.json({ ok: true, throttled: true });
    }
    viewCooldowns.set(key, now);
    await pool.query('UPDATE shared_projects SET view_count = view_count + 1 WHERE id = $1', [projectId]);
    pool.query('INSERT INTO project_views (project_id) VALUES ($1)', [projectId]).catch(() => {});
    // Periodic cleanup: delete view records older than 48 hours every ~100 views
    viewCleanupCounter++;
    if (viewCleanupCounter >= 100) {
        viewCleanupCounter = 0;
        pool.query("DELETE FROM project_views WHERE viewed_at < NOW() - INTERVAL '48 hours'").catch(() => {});
    }
    res.json({ ok: true });
});

// --- User project cloud sync ---
app.get('/api/user/projects', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT id, name, thumbnail, favorite, shared, description, tags, created_at, modified_at FROM user_projects WHERE user_id = $1',
        [req.user.id]
    );
    res.json(rows);
});

app.get('/api/user/projects/:id', authenticate, async (req, res) => {
    const { rows } = await pool.query(
        'SELECT project_data FROM user_projects WHERE id = $1 AND user_id = $2',
        [req.params.id, req.user.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ project_data: rows[0].project_data });
});

app.put('/api/user/projects/:id', authenticate, async (req, res) => {
    const { name, project_data, thumbnail, favorite, shared, description, tags, created_at, modified_at } = req.body;
    await pool.query(`
        INSERT INTO user_projects (id, user_id, name, project_data, thumbnail, favorite, shared, description, tags, created_at, modified_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (id, user_id) DO UPDATE SET
            name = EXCLUDED.name,
            project_data = EXCLUDED.project_data,
            thumbnail = EXCLUDED.thumbnail,
            favorite = EXCLUDED.favorite,
            shared = EXCLUDED.shared,
            description = EXCLUDED.description,
            tags = EXCLUDED.tags,
            modified_at = EXCLUDED.modified_at
    `, [req.params.id, req.user.id, name, project_data, thumbnail || null, favorite || false, shared || false, description || '', JSON.stringify(tags || []), created_at || Date.now(), modified_at || Date.now()]);
    res.json({ ok: true });
});

app.delete('/api/user/projects/:id', authenticate, async (req, res) => {
    await pool.query('DELETE FROM user_projects WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
});

// ===== AI Build Assistant =====

const AI_SYSTEM_PROMPT = `You are an AI assistant for a 3D block-building game editor called Cobalt Studio. The user will describe a structure or scene they want to build and you must respond with ONLY a JSON array of objects to place in the scene. No explanation, no markdown, no code fences — just the raw JSON array.

Each object in the array must have:
- "type": one of: box, sphere, cylinder, cone, plane, wedge, stairs, pyramid, dome, arch, wall, corner, tree, house, platform, bridge, crate, gem
- "position": {"x": number, "y": number, "z": number} — Y is up. Ground is y=0. Place objects so their base sits on the ground or on other objects.
- "scale": {"x": number, "y": number, "z": number} — default is 1,1,1 for a 1x1x1 unit object
- "color": a hex color string like "#8B4513"
- "name": a short descriptive name for this part

Guidelines:
- Keep structures reasonable (5-40 objects)
- Use realistic proportions: walls are tall and thin, floors are wide and flat, roofs are pyramid or wedge shapes
- Place objects so they connect properly (no floating gaps)
- Use varied colors to make structures visually interesting
- Y=0 is ground level. A box with scale.y=3 centered at y=1.5 has its base on the ground.
- For walls, use box type with thin depth (e.g. scale z=0.2) and tall height
- For floors/roofs, use box type with thin height (e.g. scale y=0.2) and wide x/z

Example response for "a small house":
[{"type":"box","position":{"x":0,"y":1.5,"z":0},"scale":{"x":4,"y":3,"z":4},"color":"#D2B48C","name":"Walls"},{"type":"pyramid","position":{"x":0,"y":3.5,"z":0},"scale":{"x":5,"y":2,"z":5},"color":"#8B0000","name":"Roof"},{"type":"box","position":{"x":0,"y":0.75,"z":2.01},"scale":{"x":1,"y":1.5,"z":0.1},"color":"#654321","name":"Door"},{"type":"box","position":{"x":1.5,"y":1.8,"z":2.01},"scale":{"x":0.8,"y":0.8,"z":0.1},"color":"#87CEEB","name":"Window"}]`;

app.post('/api/ai/build', authenticate, async (req, res) => {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > 500) {
        return res.status(400).json({ error: 'Prompt too long (max 500 characters)' });
    }

    const config = getGenaiConfig();
    if (!config.apiBase) {
        return res.status(503).json({ error: 'AI service not configured' });
    }

    try {
        const url = config.apiBase.replace(/\/+$/, '') + '/v1/chat/completions';
        const body = JSON.stringify({
            model: config.model || undefined,
            messages: [
                { role: 'system', content: AI_SYSTEM_PROMPT },
                { role: 'user', content: prompt.trim() }
            ],
            temperature: 0.7,
            max_tokens: 4096
        });

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(config.apiKey ? { 'Authorization': 'Bearer ' + config.apiKey } : {})
            },
            body
        });

        if (!response.ok) {
            const errText = await response.text().catch(() => '');
            console.error('GenAI API error:', response.status, errText);
            return res.status(502).json({ error: 'AI service error' });
        }

        const data = await response.json();
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) {
            return res.status(502).json({ error: 'Empty AI response' });
        }

        // Extract JSON array from response (handle potential markdown fences)
        let jsonStr = content.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        // Find the JSON array in the response
        const arrStart = jsonStr.indexOf('[');
        const arrEnd = jsonStr.lastIndexOf(']');
        if (arrStart === -1 || arrEnd === -1) {
            return res.status(502).json({ error: 'AI response was not valid JSON' });
        }
        jsonStr = jsonStr.substring(arrStart, arrEnd + 1);

        const objects = JSON.parse(jsonStr);
        if (!Array.isArray(objects)) {
            return res.status(502).json({ error: 'AI response was not an array' });
        }

        // Validate and sanitize each object
        const validTypes = new Set(['box','sphere','cylinder','cone','plane','wedge','stairs','pyramid','dome','arch','wall','corner','tree','house','platform','bridge','crate','gem']);
        const sanitized = objects.slice(0, 50).map(obj => ({
            type: validTypes.has(obj.type) ? obj.type : 'box',
            position: {
                x: Number(obj.position?.x) || 0,
                y: Number(obj.position?.y) || 0,
                z: Number(obj.position?.z) || 0
            },
            scale: {
                x: Math.min(Math.abs(Number(obj.scale?.x) || 1), 50),
                y: Math.min(Math.abs(Number(obj.scale?.y) || 1), 50),
                z: Math.min(Math.abs(Number(obj.scale?.z) || 1), 50)
            },
            color: /^#[0-9a-fA-F]{6}$/.test(obj.color) ? obj.color : '#4a90d9',
            name: (typeof obj.name === 'string' ? obj.name : 'Object').slice(0, 50)
        }));

        res.json({ objects: sanitized });
    } catch (err) {
        console.error('AI build error:', err);
        res.status(500).json({ error: 'Failed to generate structure' });
    }
});

// ===== WebSocket Collab Server =====

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Room data: roomCode → { hostWs, hostUserId, projectName, members: Map<ws, {userId, displayName, avatar}> }
const rooms = new Map();

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return rooms.has(code) ? generateRoomCode() : code;
}

function broadcastToRoom(roomCode, msg, excludeWs) {
    const room = rooms.get(roomCode);
    if (!room) return;
    const data = JSON.stringify(msg);
    for (const [ws] of room.members) {
        if (ws !== excludeWs && ws.readyState === 1) {
            ws.send(data);
        }
    }
}

function getMemberList(room) {
    const list = [];
    for (const [, info] of room.members) {
        const member = { userId: info.userId, displayName: info.displayName, avatar: info.avatar };
        if (info.avatarUrl) member.avatarUrl = info.avatarUrl;
        if (info.avatarColor) member.avatarColor = info.avatarColor;
        list.push(member);
    }
    return list;
}

function removeFromRoom(ws) {
    for (const [code, room] of rooms) {
        if (room.members.has(ws)) {
            const info = room.members.get(ws);
            room.members.delete(ws);

            if (ws === room.hostWs) {
                // Host left — close entire room
                for (const [memberWs] of room.members) {
                    if (memberWs.readyState === 1) {
                        memberWs.send(JSON.stringify({ type: 'room-closed' }));
                    }
                }
                rooms.delete(code);
            } else {
                // Guest left — notify remaining
                broadcastToRoom(code, {
                    type: 'member-left',
                    userId: info.userId,
                    displayName: info.displayName,
                    members: getMemberList(room)
                });
            }
            return;
        }
    }
}

// Authenticate WebSocket upgrade via JWT cookie
server.on('upgrade', (req, socket, head) => {
    // Parse cookies manually
    const cookieHeader = req.headers.cookie || '';
    const cookies = {};
    cookieHeader.split(';').forEach(c => {
        const [k, ...v] = c.trim().split('=');
        if (k) cookies[k] = v.join('=');
    });
    const token = cookies[COOKIE_NAME];
    if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    try {
        const user = jwt.verify(token, JWT_SECRET);
        wss.handleUpgrade(req, socket, head, (ws) => {
            ws._user = user;
            wss.emit('connection', ws, req);
        });
    } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
    }
});

wss.on('connection', (ws) => {
    ws._alive = true;
    ws.on('pong', () => { ws._alive = true; });

    ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw); } catch { return; }
        const user = ws._user;

        switch (msg.type) {
            case 'create-room': {
                // Remove from any existing room first
                removeFromRoom(ws);
                const code = generateRoomCode();
                const room = {
                    hostWs: ws,
                    hostUserId: user.id,
                    projectName: msg.projectName || 'Untitled',
                    members: new Map()
                };
                const avatarVal = user.avatar || 'default';
                const memberInfo = { userId: user.id, displayName: user.displayName, avatar: avatarVal, avatarColor: user.avatarColor };
                if (avatarVal.startsWith('custom:')) memberInfo.avatarUrl = '/api/avatars/' + avatarVal.replace('custom:', '');
                room.members.set(ws, memberInfo);
                rooms.set(code, room);
                ws.send(JSON.stringify({
                    type: 'room-created',
                    roomCode: code,
                    members: getMemberList(room)
                }));
                break;
            }
            case 'join-room': {
                const code = (msg.roomCode || '').toUpperCase().trim();
                const room = rooms.get(code);
                if (!room) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room not found' }));
                    return;
                }
                if (room.members.size >= 4) {
                    ws.send(JSON.stringify({ type: 'error', message: 'Room is full (max 4)' }));
                    return;
                }
                // Remove from any existing room first
                removeFromRoom(ws);
                const jAvatarVal = user.avatar || 'default';
                const jMemberInfo = { userId: user.id, displayName: user.displayName, avatar: jAvatarVal, avatarColor: user.avatarColor };
                if (jAvatarVal.startsWith('custom:')) jMemberInfo.avatarUrl = '/api/avatars/' + jAvatarVal.replace('custom:', '');
                room.members.set(ws, jMemberInfo);

                // Tell the joiner they're in
                ws.send(JSON.stringify({
                    type: 'room-joined',
                    roomCode: code,
                    hostName: room.members.get(room.hostWs)?.displayName || 'Host',
                    members: getMemberList(room)
                }));

                // Tell host to send scene state to new joiner
                if (room.hostWs.readyState === 1) {
                    room.hostWs.send(JSON.stringify({
                        type: 'request-state',
                        userId: user.id,
                        displayName: user.displayName
                    }));
                }

                // Notify all others about the new member
                broadcastToRoom(code, {
                    type: 'member-joined',
                    userId: user.id,
                    displayName: user.displayName,
                    avatar: user.avatar,
                    members: getMemberList(room)
                }, ws);
                break;
            }
            case 'leave-room': {
                removeFromRoom(ws);
                ws.send(JSON.stringify({ type: 'left-room' }));
                break;
            }
            case 'room-state': {
                // Host sends full scene to a specific new joiner
                const targetUserId = msg.targetUserId;
                for (const [code, room] of rooms) {
                    if (room.hostWs === ws) {
                        for (const [memberWs, info] of room.members) {
                            if (info.userId === targetUserId && memberWs.readyState === 1) {
                                memberWs.send(JSON.stringify({
                                    type: 'room-state',
                                    projectData: msg.projectData
                                }));
                            }
                        }
                        break;
                    }
                }
                break;
            }
            case 'add-object':
            case 'remove-object':
            case 'update-transform':
            case 'update-property':
            case 'update-environment':
            case 'vote-request':
            case 'vote-response':
            case 'vote-passed':
            case 'vote-failed': {
                // Relay to all other members in the same room
                for (const [code, room] of rooms) {
                    if (room.members.has(ws)) {
                        broadcastToRoom(code, msg, ws);
                        break;
                    }
                }
                break;
            }
        }
    });

    ws.on('close', () => {
        removeFromRoom(ws);
    });
});

// Heartbeat — ping every 30s, disconnect dead connections
const heartbeat = setInterval(() => {
    wss.clients.forEach(ws => {
        if (!ws._alive) { ws.terminate(); return; }
        ws._alive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => clearInterval(heartbeat));

// Initialize DB and start server
initDb().then(() => {
    server.listen(PORT, () => {
        console.log(`Cobalt Studio running on port ${PORT}`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
