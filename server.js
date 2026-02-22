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

    // Cloud data variables
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cloud_data (
            project_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value TEXT NOT NULL DEFAULT '0',
            updated_at BIGINT NOT NULL,
            PRIMARY KEY (project_id, key)
        )
    `);

    // Shared templates (community marketplace)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS shared_templates (
            id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            creator TEXT NOT NULL,
            tags TEXT DEFAULT '[]',
            thumbnail TEXT,
            template_data TEXT NOT NULL,
            published_at BIGINT NOT NULL,
            use_count INTEGER DEFAULT 0
        )
    `);

    // Friendships
    await pool.query(`
        CREATE TABLE IF NOT EXISTS friendships (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            friend_id INTEGER NOT NULL REFERENCES users(id),
            status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
            created_at BIGINT NOT NULL,
            UNIQUE(user_id, friend_id)
        )
    `);

    // Activity feed
    await pool.query(`
        CREATE TABLE IF NOT EXISTS activity_feed (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            type TEXT NOT NULL,
            data TEXT DEFAULT '{}',
            created_at BIGINT NOT NULL
        )
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_feed(user_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_friendships_friend ON friendships(friend_id, status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_project_type ON project_interactions(project_id, type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_interactions_user ON project_interactions(user_id, type)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_emoji_chats_project ON emoji_chats(project_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_project_views_project ON project_views(project_id, viewed_at)`);
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

    // Log activity for friends feed
    await pool.query(
        'INSERT INTO activity_feed (user_id, type, data, created_at) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'published_project', JSON.stringify({ projectId: id, name: name.trim() }), Date.now()]
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
    let userId = null;
    const token = req.cookies[COOKIE_NAME];
    if (token) {
        try { userId = jwt.verify(token, JWT_SECRET).id; } catch { /* ignore */ }
    }
    const { rows } = await pool.query(`
        SELECT
            COALESCE(sp.view_count, 0) as view_count,
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = $1 AND type = 'like') as likes,
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = $1 AND type = 'favorite') as favorites,
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'like') as user_liked,
            (SELECT COUNT(*) FROM project_interactions WHERE project_id = $1 AND user_id = $2 AND type = 'favorite') as user_fav
        FROM shared_projects sp WHERE sp.id = $1
    `, [projectId, userId]);
    if (rows.length === 0) return res.json({ likes: 0, favorites: 0, viewCount: 0, userLiked: false, userFavorited: false });
    const r = rows[0];
    res.json({ likes: parseInt(r.likes), favorites: parseInt(r.favorites), viewCount: parseInt(r.view_count), userLiked: parseInt(r.user_liked) > 0, userFavorited: parseInt(r.user_fav) > 0 });
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

const AI_SYSTEM_PROMPT = `You are the AI build engine for Cobalt Studio, a 3D block-building game editor. You translate natural language descriptions into precise 3D object placements. Respond with ONLY a JSON array — no text, no markdown fences, no explanation.

# Object Schema
Each object: {"action":"add|modify|remove","type","position":{"x","y","z"},"rotation":{"x","y","z"},"scale":{"x","y","z"},"color":"#hex6","name":"string","target":"exact object name"}
- "action" defaults to "add" if omitted. Use "modify" or "remove" to change/delete existing objects.
- "target" is required for modify/remove — must match an existing object name exactly (from scene context).
- For "modify": include ONLY the properties to change (e.g. just scale, just color, just position). Omit unchanged properties.
- For "remove": only "action" and "target" are needed. No other fields required.
- rotation is in DEGREES (0-360). Optional — omit if no rotation needed.

# Available Types
Primitives: box, sphere, cylinder, cone, plane, wedge, torus, tube
Architecture: stairs (5-step prefab), pyramid (4-sided cone), dome (half-sphere), arch (2 pillars + curved top), wall (4×2×0.3 slab), corner (L-shaped wall)
Prefabs: tree (trunk+foliage), house (walls+roof+door), platform (3×0.3×3 pad), bridge (planked walkway), crate (wooden box), gem (glowing octahedron), coin (flat disc), light-point (glowing light source)

## Custom Multi-Part Objects
For detailed objects that need sub-parts combined into one unit, use type "custom" with a "customParts" array:
{"type":"custom","position":{"x","y","z"},"scale":{"x","y","z"},"name":"string","customParts":[
  {"shape":"box|sphere|cylinder|cone|pyramid|dome|wedge","offset":{"x","y","z"},"scale":{"x","y","z"},"color":"#hex6"},
  ...
]}
Each part's offset is relative to the custom object's center. Use custom objects for detailed items like furniture, vehicles, lamps, statues, etc.

# Coordinate System
- Y is UP. Ground plane is Y=0.
- Objects are centered on their position. A box with scale.y=3 at y=1.5 has its base on the ground.
- Positive X = right, positive Z = toward camera.

# Spatial Reasoning Rules
1. STACKING: To place object B on top of object A, set B.position.y = A.position.y + A.scale.y/2 + B.scale.y/2
2. ADJACENCY: To place objects side by side, offset by half the sum of their widths in the relevant axis.
3. WALLS: Use box with one thin axis (0.2-0.3). For a room, place 4 walls around a perimeter.
4. FLOORS/CEILINGS: Box with thin y (0.1-0.3), wide x and z.
5. ROOFS: Use pyramid or wedge on top of walls. Set scale wider than the building so it overhangs slightly.
6. WINDOWS/DOORS: Thin boxes (scale z=0.1) placed slightly in front of wall surfaces (offset 0.01-0.05 from wall face).
7. SYMMETRY: Mirror structures across axes for balanced builds. If left tower is at x=-5, right tower is at x=5.
8. GROUND CONTACT: Unless floating is intentional (e.g., floating island), ensure every object chain connects down to y=0.
9. PREFAB ORIGIN: tree, house, bridge, arch, stairs, crate, gem have their own internal geometry. Position is their center; scale uniformly to resize them.

# Rotation Tips
- Use rotation to angle roofs, create sloped surfaces, tilt objects realistically.
- A wedge rotated 180° on Z makes a downward slope. Rotate Y to point it in different directions.
- Cylinder rotated 90° on X or Z becomes a horizontal log, pipe, or beam.
- Use Y rotation to orient walls, bridges, and stairs in any direction (e.g., rotation.y=90 for an east-west wall).
- Slight random rotations (1-5°) on decorative objects like crates, rocks, and trees make scenes look natural instead of grid-like.
- For angled roofs: use box with rotation.x or rotation.z of 20-35° instead of only using pyramid.

# Composition Guidelines
- Use 8-50 objects depending on complexity. Simple items: 5-15. Buildings: 15-30. Scenes: 30-50.
- Add small details that bring builds to life: torches (small cylinders with gem on top), flower pots (small cylinders with sphere), furniture, pathways.
- Use color coherently — pick a palette of 3-5 main colors per structure, with accent colors for details.
- Use contrasting colors for different functional parts (walls vs roof vs trim vs windows).
- Name each object descriptively (e.g., "Left Tower Wall", "Front Window", "Chimney").

# Color Reference
Stone/Concrete: #808080, #A0A0A0, #696969
Wood: #8B4513, #D2691E, #DEB887, #A0522D
Brick: #B22222, #CD5C5C, #8B0000
Foliage: #228B22, #2E8B57, #006400, #90EE90
Water: #1E90FF, #4169E1, #87CEEB
Sand: #F4A460, #D2B48C, #EDC9AF
Metal: #708090, #C0C0C0, #B8860B
Glass: #87CEEB, #B0E0E6, #ADD8E6
Lava/Fire: #FF4500, #FF6347, #FFD700
Ice/Snow: #F0F8FF, #E0FFFF, #B0C4DE
Fantasy: #9B59B6, #8E44AD, #E74C3C, #F39C12

# Style Awareness
If the user mentions a style, adapt accordingly:
- Medieval: stone walls, wooden beams, towers, battlements, torches
- Modern: clean lines, glass (light blue boxes), concrete, flat roofs
- Fantasy: vibrant colors, spires, glowing gems, floating elements
- Sci-fi: metallic colors, domes, cylinders, platforms
- Nature: trees, rocks (grey spheres/boxes), water (blue planes), flowers
- Spooky: dark colors, cobwebs (thin planes), tombstones, dead trees

# Handling Follow-up Requests & Feedback
You can ADD, MODIFY, and REMOVE objects. Read the scene context carefully.

## Adding new objects
When the user asks to add or extend, use action "add" (or omit action). Place new objects that complement existing ones. Do NOT recreate existing objects.

## Modifying existing objects
When the user says things like "make it shorter", "change the color", "move it left", "that's too big", "make it look better" — use action "modify" with "target" set to the exact object name from scene context. Only include the properties to change.
Examples:
- "the tower is too tall" → {"action":"modify","target":"Left Tower","scale":{"x":2,"y":3,"z":2}}
- "make the roof red" → {"action":"modify","target":"Keep Roof","color":"#8B0000"}
- "move the bench to the left" → {"action":"modify","target":"Park Bench","position":{"x":-3,"y":0,"z":0}}

## Removing objects
When the user says "remove that", "delete the tree", "get rid of the fence" — use action "remove" with "target" set to the exact object name.
Examples:
- "remove the tree" → {"action":"remove","target":"Tree"}
- "delete the left tower" → {"action":"remove","target":"Left Tower"}

## Improving / Redesigning
When the user says "make it look better", "improve this", "that looks bad" — analyze what exists in the scene context, then return a MIX of modify (fix proportions, colors, positions), remove (delete ugly/redundant parts), and add (new details, decorations, better structure). Be creative but keep the core design intent.

## Identifying objects
When user says "that" or "it" without specifying — look at conversation history for the most recently discussed/created object. If ambiguous, modify the most prominent object (largest or most central). If the user selected an object, its name will be in the context.

# Examples

"a medieval castle":
[{"type":"box","position":{"x":0,"y":2.5,"z":0},"scale":{"x":10,"y":5,"z":8},"color":"#808080","name":"Main Keep"},{"type":"box","position":{"x":0,"y":5.1,"z":0},"scale":{"x":10.5,"y":0.2,"z":8.5},"color":"#696969","name":"Keep Roof Edge"},{"type":"cylinder","position":{"x":-5.5,"y":3,"z":-4.5},"scale":{"x":2,"y":6,"z":2},"color":"#808080","name":"Left Back Tower"},{"type":"cone","position":{"x":-5.5,"y":6.5,"z":-4.5},"scale":{"x":2.8,"y":2,"z":2.8},"color":"#8B0000","name":"Left Back Roof"},{"type":"cylinder","position":{"x":5.5,"y":3,"z":-4.5},"scale":{"x":2,"y":6,"z":2},"color":"#808080","name":"Right Back Tower"},{"type":"cone","position":{"x":5.5,"y":6.5,"z":-4.5},"scale":{"x":2.8,"y":2,"z":2.8},"color":"#8B0000","name":"Right Back Roof"},{"type":"cylinder","position":{"x":-5.5,"y":3,"z":4.5},"scale":{"x":2,"y":6,"z":2},"color":"#808080","name":"Left Front Tower"},{"type":"cone","position":{"x":-5.5,"y":6.5,"z":4.5},"scale":{"x":2.8,"y":2,"z":2.8},"color":"#8B0000","name":"Left Front Roof"},{"type":"cylinder","position":{"x":5.5,"y":3,"z":4.5},"scale":{"x":2,"y":6,"z":2},"color":"#808080","name":"Right Front Tower"},{"type":"cone","position":{"x":5.5,"y":6.5,"z":4.5},"scale":{"x":2.8,"y":2,"z":2.8},"color":"#8B0000","name":"Right Front Roof"},{"type":"arch","position":{"x":0,"y":0,"z":4.5},"scale":{"x":1.5,"y":1.8,"z":1},"color":"#696969","name":"Castle Gate"},{"type":"box","position":{"x":0,"y":0.75,"z":4.6},"scale":{"x":1.5,"y":2.5,"z":0.15},"color":"#654321","name":"Gate Door"},{"type":"cylinder","position":{"x":-5.5,"y":0.4,"z":6},"scale":{"x":0.15,"y":0.8,"z":0.15},"color":"#8B4513","name":"Left Torch Post"},{"type":"gem","position":{"x":-5.5,"y":0.9,"z":6},"scale":{"x":0.6,"y":0.6,"z":0.6},"color":"#FF6347","name":"Left Torch Flame"},{"type":"cylinder","position":{"x":5.5,"y":0.4,"z":6},"scale":{"x":0.15,"y":0.8,"z":0.15},"color":"#8B4513","name":"Right Torch Post"},{"type":"gem","position":{"x":5.5,"y":0.9,"z":6},"scale":{"x":0.6,"y":0.6,"z":0.6},"color":"#FF6347","name":"Right Torch Flame"}]

"a street lamp" (custom multi-part example):
[{"type":"custom","position":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},"name":"Street Lamp","customParts":[{"shape":"cylinder","offset":{"x":0,"y":1.5,"z":0},"scale":{"x":0.12,"y":3,"z":0.12},"color":"#2C2C2C"},{"shape":"sphere","offset":{"x":0,"y":3.2,"z":0},"scale":{"x":0.5,"y":0.5,"z":0.5},"color":"#FFD700"},{"shape":"dome","offset":{"x":0,"y":3.5,"z":0},"scale":{"x":0.7,"y":0.3,"z":0.7},"color":"#2C2C2C"},{"shape":"cylinder","offset":{"x":0,"y":0.05,"z":0},"scale":{"x":0.4,"y":0.1,"z":0.4},"color":"#2C2C2C"}]}]

"a wooden fence":
[{"type":"cylinder","position":{"x":-2,"y":0.5,"z":0},"scale":{"x":0.12,"y":1,"z":0.12},"color":"#8B4513","name":"Post 1"},{"type":"cylinder","position":{"x":-1,"y":0.5,"z":0},"scale":{"x":0.12,"y":1,"z":0.12},"color":"#8B4513","name":"Post 2"},{"type":"cylinder","position":{"x":0,"y":0.5,"z":0},"scale":{"x":0.12,"y":1,"z":0.12},"color":"#8B4513","name":"Post 3"},{"type":"cylinder","position":{"x":1,"y":0.5,"z":0},"scale":{"x":0.12,"y":1,"z":0.12},"color":"#8B4513","name":"Post 4"},{"type":"cylinder","position":{"x":2,"y":0.5,"z":0},"scale":{"x":0.12,"y":1,"z":0.12},"color":"#8B4513","name":"Post 5"},{"type":"box","position":{"x":0,"y":0.7,"z":0},"scale":{"x":4.2,"y":0.08,"z":0.06},"color":"#A0522D","name":"Top Rail"},{"type":"box","position":{"x":0,"y":0.35,"z":0},"scale":{"x":4.2,"y":0.08,"z":0.06},"color":"#A0522D","name":"Bottom Rail"}]

"a park bench":
[{"type":"custom","position":{"x":0,"y":0,"z":0},"scale":{"x":1,"y":1,"z":1},"name":"Park Bench","customParts":[{"shape":"box","offset":{"x":0,"y":0.45,"z":0},"scale":{"x":2,"y":0.08,"z":0.5},"color":"#8B4513"},{"shape":"box","offset":{"x":0,"y":0.8,"z":-0.22},"scale":{"x":2,"y":0.5,"z":0.06},"color":"#8B4513"},{"shape":"box","offset":{"x":-0.85,"y":0.2,"z":0.15},"scale":{"x":0.06,"y":0.4,"z":0.06},"color":"#3E3E3E"},{"shape":"box","offset":{"x":0.85,"y":0.2,"z":0.15},"scale":{"x":0.06,"y":0.4,"z":0.06},"color":"#3E3E3E"},{"shape":"box","offset":{"x":-0.85,"y":0.2,"z":-0.15},"scale":{"x":0.06,"y":0.4,"z":0.06},"color":"#3E3E3E"},{"shape":"box","offset":{"x":0.85,"y":0.2,"z":-0.15},"scale":{"x":0.06,"y":0.4,"z":0.06},"color":"#3E3E3E"},{"shape":"box","offset":{"x":-0.85,"y":0.55,"z":-0.22},"scale":{"x":0.06,"y":0.2,"z":0.06},"color":"#3E3E3E"},{"shape":"box","offset":{"x":0.85,"y":0.55,"z":-0.22},"scale":{"x":0.06,"y":0.2,"z":0.06},"color":"#3E3E3E"}]}]`;

app.post('/api/ai/build', authenticate, async (req, res) => {
    const { prompt, history, sceneContext } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > 1000) {
        return res.status(400).json({ error: 'Prompt too long (max 1000 characters)' });
    }

    const config = getGenaiConfig();
    if (!config.apiBase) {
        return res.status(503).json({ error: 'AI service not configured' });
    }

    try {
        const url = config.apiBase.replace(/\/+$/, '') + '/v1/chat/completions';

        // Build conversation messages with context
        const messages = [{ role: 'system', content: AI_SYSTEM_PROMPT }];

        // Inject scene context if available
        if (sceneContext && typeof sceneContext === 'string' && sceneContext.length > 0) {
            messages.push({ role: 'system', content: 'Current scene objects already placed:\n' + sceneContext + '\n\nCRITICAL: Output ONLY new objects the user is asking for. Do NOT recreate or re-output any existing objects. Each request should produce ONLY the new objects, not everything combined. Use modify/remove actions only when the user asks to change or delete existing objects.' });
        }

        // Add conversation history (last 6 exchanges max)
        if (Array.isArray(history)) {
            const recentHistory = history.slice(-12); // 6 pairs of user/assistant
            for (const msg of recentHistory) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    messages.push({ role: msg.role, content: String(msg.content).slice(0, 2000) });
                }
            }
        }

        // Add current user prompt
        messages.push({ role: 'user', content: prompt.trim() });

        const body = JSON.stringify({
            model: config.model || undefined,
            messages,
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
        const validTypes = new Set(['box','sphere','cylinder','cone','plane','wedge','torus','tube','stairs','pyramid','dome','arch','wall','corner','tree','house','platform','bridge','crate','gem','coin','light-point','custom']);
        const validShapes = new Set(['box','sphere','cylinder','cone','pyramid','dome','wedge']);
        const validActions = new Set(['add', 'modify', 'remove']);
        const sanitized = objects.slice(0, 50).map(obj => {
            const action = validActions.has(obj.action) ? obj.action : 'add';

            // Remove action — just need target name
            if (action === 'remove') {
                if (typeof obj.target !== 'string' || !obj.target.trim()) return null;
                return { action: 'remove', target: obj.target.slice(0, 50) };
            }

            // Modify action — only changed properties + target
            if (action === 'modify') {
                if (typeof obj.target !== 'string' || !obj.target.trim()) return null;
                const result = { action: 'modify', target: obj.target.slice(0, 50) };
                if (obj.position) {
                    result.position = {
                        x: Number(obj.position.x) || 0,
                        y: Number(obj.position.y) || 0,
                        z: Number(obj.position.z) || 0
                    };
                }
                if (obj.scale) {
                    result.scale = {
                        x: Math.min(Math.abs(Number(obj.scale.x) || 1), 50),
                        y: Math.min(Math.abs(Number(obj.scale.y) || 1), 50),
                        z: Math.min(Math.abs(Number(obj.scale.z) || 1), 50)
                    };
                }
                if (obj.color && /^#[0-9a-fA-F]{6}$/.test(obj.color)) result.color = obj.color;
                if (obj.rotation) {
                    result.rotation = {
                        x: Number(obj.rotation.x) || 0,
                        y: Number(obj.rotation.y) || 0,
                        z: Number(obj.rotation.z) || 0
                    };
                }
                if (typeof obj.name === 'string') result.name = obj.name.slice(0, 50);
                return result;
            }

            // Add action (default)
            const result = {
                action: 'add',
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
            };
            // Add rotation if provided
            if (obj.rotation && (obj.rotation.x || obj.rotation.y || obj.rotation.z)) {
                result.rotation = {
                    x: Number(obj.rotation.x) || 0,
                    y: Number(obj.rotation.y) || 0,
                    z: Number(obj.rotation.z) || 0
                };
            }
            // Add custom parts if type is custom
            if (result.type === 'custom' && Array.isArray(obj.customParts)) {
                result.customParts = obj.customParts.slice(0, 20).map(p => ({
                    shape: validShapes.has(p.shape) ? p.shape : 'box',
                    offset: {
                        x: Number(p.offset?.x) || 0,
                        y: Number(p.offset?.y) || 0,
                        z: Number(p.offset?.z) || 0
                    },
                    scale: {
                        x: Math.min(Math.abs(Number(p.scale?.x) || 1), 20),
                        y: Math.min(Math.abs(Number(p.scale?.y) || 1), 20),
                        z: Math.min(Math.abs(Number(p.scale?.z) || 1), 20)
                    },
                    color: /^#[0-9a-fA-F]{6}$/.test(p.color) ? p.color : '#4a90d9'
                }));
            }
            return result;
        }).filter(Boolean);

        res.json({ objects: sanitized });
    } catch (err) {
        console.error('AI build error:', err);
        res.status(500).json({ error: 'Failed to generate structure' });
    }
});

// ===== AI Script Assistant =====

const AI_SCRIPT_SYSTEM_PROMPT = `You generate block code scripts for a 3D game engine. Output ONLY a JSON array of stacks.

# Block Catalog (blockId | inputs key:type=default)

## Events (hat blocks — must start every stack)
event_start | (none)
event_click | (none)
event_key | key:select[W,A,S,D,Space,E,Q,1,2,3,ArrowUp,ArrowDown,ArrowLeft,ArrowRight]=Space
event_collide | object:select[any,player,coin,npc]=player
event_timer | seconds:number=1
event_message | msg:select[message1,message2,message3,go,stop,reset]=message1
event_health_zero | (none)
event_enemy_defeated | (none)
event_item_collected | (none)
event_lives_zero | (none)
event_level_start | (none)
event_timer_done | (none)
shoot_event_fire | (none)
shoot_event_hit | (none)

## Motion (command)
motion_move | direction:select[forward,backward,left,right,up,down]=forward, amount:number=1
motion_moveto | x:number=0, y:number=0, z:number=0
motion_rotate | axis:select[X,Y,Z]=Y, degrees:number=15
motion_spin | axis:select[X,Y,Z]=Y, speed:number=1
motion_glide | x:number=0, y:number=5, z:number=0, time:number=1
motion_bounce | height:number=2, speed:number=2
motion_follow_player | speed:number=2
motion_patrol | dist:number=5, speed:number=2
motion_orbit | r:number=3, s:number=1
motion_look_at_player | (none)
motion_random_pos | range:number=10
motion_push_from_player | f:number=3
motion_smooth_move | dir:select[forward,backward,left,right,up,down]=forward, amt:number=3, time:number=0.5
motion_align_to_grid | size:number=1
motion_face_direction | dir:select[north,south,east,west,player]=north
motion_set_rotation | x:number=0, y:number=0, z:number=0
motion_zigzag | w:number=3, s:number=2
motion_spiral | r:number=3, s:number=1
motion_hover | h:number=0.5, s:number=1.5
motion_teleport | x:number=0, y:number=5, z:number=0
motion_launch_up | force:number=10
motion_move_toward | speed:number=3, dist:number=2

## Control (command/c-block)
control_wait | seconds:number=1
control_repeat | times:number=10 [c-block]
control_forever | [c-block]
control_if | condition:select[touching player,key pressed,variable > 0,random chance]=touching player [c-block]
control_if_else | condition:select[touching player,key pressed,variable > 0,health < 50,random chance,distance < 3]=touching player [c-block]
control_wait_until | condition:select[touching player,key pressed,timer > 5]=touching player
control_stop | what:select[this script,all scripts,other scripts]=this script
control_broadcast | msg:select[message1,message2,message3,go,stop,reset]=message1
control_while | condition:select[touching player,key pressed,variable > 0,health > 0,timer < 10]=touching player [c-block]
control_for_each | var:select[i,j,count]=i, start:number=1, end:number=10 [c-block]
control_next_level | (none)

## Looks (command)
looks_color | color:color=#ff0000
looks_size | percent:number=100
looks_show | (none)
looks_hide | (none)
looks_glow | color:color=#ffffff, val:number=0.5
looks_opacity | percent:number=50
looks_say | text:text=Hello!, time:number=2
looks_effect | speed:number=1
looks_scale_pulse | min:number=80, max:number=120, spd:number=2
looks_trail | color:color=#ffff00
looks_particles | type:select[burst,sparkle,fire,snow]=burst, color:color=#ffff00
looks_stop_particles | (none)
looks_tint | color:color=#ff0000, amount:number=50
looks_wireframe | state:select[on,off]=on
looks_flash | color:color=#ffffff, times:number=3
looks_billboard_text | text:text=Label
looks_player_color | part:select[body,head,detail]=body, color:color=#4c97ff
looks_npc_color | part:select[body,head,legs]=body, color:color=#3498db

## Physics (command)
physics_gravity | (none)
physics_nogravity | (none)
physics_velocity | x:number=0, y:number=5, z:number=0
physics_impulse | direction:select[up,forward,backward,left,right]=up, force:number=5
physics_anchor | state:select[true,false]=true
physics_destroy | (none)
physics_clone | (none)
physics_teleport_player | x:number=0, y:number=5, z:number=0
physics_explode | force:number=10, radius:number=5
physics_launch_player | force:number=15
physics_set_player_speed | speed:number=8
physics_freeze | (none)
physics_unfreeze | (none)
physics_attract | force:number=3, radius:number=8
physics_set_gravity | g:number=-20
physics_spawn_object | shape:select[box,sphere,cylinder,cone,wall,platform,pyramid,coin,gem]=box, x:number=0, y:number=2, z:number=0
physics_spawn_color | shape:select[box,sphere,cylinder,cone,wall,platform,pyramid]=box, color:color=#4c97ff
physics_spawn_at_player | shape:select[box,sphere,cylinder,cone,wall,platform,pyramid]=box
physics_remove_last | (none)
physics_remove_all | (none)
physics_clone_at | x:number=0, y:number=0, z:number=0
health_set_damage | damage:number=10

## Sound (command)
sound_play | sound:select[pop,ding,whoosh,boom,jump,coin,hurt,powerup,laser,explosion,splash,click,bell,alarm,magic,swoosh,beep,chime]=pop
sound_play_custom | sound:select[DYNAMIC]=<name> — plays a user-uploaded custom sound. ONLY use when the user explicitly names a custom sound. The available custom sound names are provided in context.
sound_volume | percent:number=100
sound_pitch | freq:number=440, dur:number=0.3
sound_stop_all | (none)
sound_play_note | note:select[C4,D4,E4,F4,G4,A4,B4,C5]=C4, dur:number=0.3
sound_drum | type:select[kick,snare,hihat,clap]=kick
sound_play_music | track:select[adventure,chill,action,mystery,retro,none]=adventure
sound_stop_music | (none)
sound_music_volume | percent:number=50

## Variables (command)
var_set | var:select[score,health,coins,speed,level,custom]=score, value:number=0
var_change | var:select[score,health,coins,speed,level,custom]=score, amount:number=1
var_show | var:select[score,health,coins,speed,level,timer]=score
var_if_check | var:select[score,health,coins,speed,level]=score, op:select[>,<,=,>=,<=]=>, value:number=10 [c-block]
var_reset_all | (none)
var_show_message | text:text=You win!, time:number=3
var_game_over | result:select[win,lose]=win
var_save_checkpoint | (none)
var_load_checkpoint | (none)
var_set_lives | n:number=3
var_change_lives | n:number=-1
var_show_lives | (none)
var_show_dialog | text:text=Hello!
var_start_timer | seconds:number=60
var_show_timer | (none)
health_set_max | value:number=100
health_set | value:number=100
health_change | amount:number=-10
health_heal | amount:number=25
health_show_bar | (none)
health_set_invincibility | seconds:number=1

## Shooting (command)
shoot_fire_player | speed:number=30, color:color=#ff0000
shoot_fire_at_player | speed:number=20, color:color=#ff4400
shoot_fire_forward | speed:number=25, color:color=#00ccff
shoot_set_damage | damage:number=10
shoot_set_fire_rate | seconds:number=0.3
shoot_set_size | size:number=0.15
shoot_set_lifetime | seconds:number=3

## Enemies (command)
enemy_set_as | health:number=50
enemy_follow | speed:number=3
enemy_patrol | dist:number=5, speed:number=2
enemy_wander | radius:number=5, speed:number=1.5
enemy_attack_touch | damage:number=10
enemy_attack_ranged | seconds:number=2, damage:number=5
enemy_set_health | value:number=50
enemy_show_health | (none)

## Items (command)
item_set_pickup | type:select[key,potion,powerup,coin,gem,custom]=key
item_set_pickup_name | name:text=Gold Key
item_set_effect | effect:select[heal,speed boost,score,none]=heal, amount:number=25
item_add | item:text=Gold Key
item_remove | item:text=Gold Key
item_has | item:text=Gold Key [c-block]
item_use | item:text=Potion
item_show_inventory | (none)

## Effects (command)
fx_screen_shake | intensity:number=5
fx_fade_out | seconds:number=1
fx_fade_in | seconds:number=1
fx_flash_screen | color:color=#ffffff
fx_slow_motion | speed:number=0.3, seconds:number=3
fx_camera_zoom | factor:number=1.5, time:number=0.5
fx_camera_reset | (none)
fx_screen_tint | color:color=#ff0000, opacity:number=30

## Camera (command)
camera_switch | (none)
camera_switch_back | (none)
camera_look_at | target:select[player,this object,origin]=player
camera_move_to | x:number=0, y:number=5, z:number=10
camera_glide_to | x:number=0, y:number=5, z:number=10, time:number=1
camera_follow | target:select[player,this object]=player, dist:number=8
camera_shake | intensity:number=0.3, time:number=0.5
camera_fov | fov:number=75

## UI (command)
ui_show_text_overlay | text:text=Level 1, time:number=2
ui_show_number | label:text=Score, value:number=0
ui_set_number | label:text=Score, value:number=0
ui_change_number | label:text=Score, value:number=1
ui_add_text | text:text=Hello, x:number=50, y:number=50
ui_add_button | text:text=Click, msg:text=clicked
ui_hide_all | (none)

## HUD / Display (from Variables category)
var_show | var:select[score,health,coins,speed,level,timer]=score — shows variable as persistent HUD element
var_show_message | text:text=You win!, time:number=3 — temporary centered message
var_show_dialog | text:text=Hello! — dialog box
var_show_lives | (none) — shows lives counter on HUD
var_show_timer | (none) — shows timer on HUD
health_show_bar | (none) — shows health bar on HUD
enemy_show_health | (none) — shows enemy health bar above object
looks_say | text:text=Hello!, time:number=2 — speech bubble above object
looks_billboard_text | text:text=Label — permanent label floating above object

# Rules
1. Every NEW stack MUST start with a hat block (event_*,shoot_event_*).
2. Only c-blocks (control_repeat,control_forever,control_if,control_if_else,control_while,control_for_each,var_if_check,item_has) have "children" arrays.
3. Command blocks and c-blocks go inside stacks. Reporters cannot be standalone.
4. Keep scripts focused: one behavior per stack. Use multiple stacks for different triggers.
5. When the user says "also", "add", "make it also", or refers to extending existing behavior, APPEND to an existing stack using "appendToStack" instead of creating a duplicate hat.
6. When the user gives FEEDBACK about existing scripts ("too fast", "too slow", "too big", "change the color", "make it slower", "reduce the damage", "wrong direction", etc.), use "replaceStack" to modify the existing stack with corrected values. Keep all the blocks the same but adjust the values they're complaining about.
7. Think about what the user ACTUALLY wants. "make a door" means a full door system (click to open, animation, sound). "make an enemy" means chase + attack + defeat logic. Be thorough.
8. Use control_forever with children for continuous behaviors (spinning, hovering, patrolling). Use single commands for one-shot actions.
9. Combine multiple effects for polish: add sounds, particles, visual feedback when things happen.
10. CRITICAL: Output ONLY the scripts for the current request. NEVER re-output or include scripts from previous requests. Each response must contain ONLY the new/modified stacks, not all scripts combined.

# Natural Language Rule Handling
When the user provides rules in plain English like "when X happens, do Y":
- Parse the trigger into the appropriate event hat block
- Parse the action into the correct command blocks
- "when player collects N coins" → event_collide(player) + var_change(coins) + var_if_check(coins >= N) with children
- "when score reaches N" → event_timer(1) + control_forever { var_if_check(score >= N) { actions } }
- "if player touches this" → event_collide(player) → actions
- "open the door" → motion_glide(up) + sound_play
- "show text" → var_show_message or looks_say or ui_show_text_overlay
- Multiple rules should each become their own stack with appropriate hat blocks
- Think about what makes gameplay sense, not just literal translation

# Output Format
JSON array of stacks. Include ONLY the new or modified stacks — never re-output existing unchanged scripts.

New stack: { "blocks": [ { "blockId": "...", "values": {...}, "children": [...] } ] }
Append to existing: { "appendToStack": <stack number>, "blocks": [ ...blocks to add... ] }
Replace/modify existing: { "replaceStack": <stack number>, "blocks": [ ...complete replacement blocks... ] }

When appending, do NOT include a hat block — just the command/c-blocks to add.
When replacing, include the FULL stack (including the hat block) with modified values.
Only include "values" keys that differ from defaults. Omit "children" if empty.
Existing scripts context labels stacks as "Stack 1:", "Stack 2:", etc. Use those numbers for appendToStack/replaceStack.

# Common Patterns

Door/Switch: event_click → sound_play(click) → motion_glide(move up/aside) → control_wait → motion_glide(back). Or broadcast a message to trigger another object.
Collectible/Pickup: event_start → hover+spin forever. event_collide(player) → sound(coin) → var_change(coins/score) → particles(sparkle) → destroy.
Enemy: event_start → enemy_set_as → enemy_show_health → chase/patrol/wander → attack. event_enemy_defeated → score + particles + sound.
Jump Pad/Trampoline: event_collide(player) → physics_launch_player → sound(jump) → looks_scale_pulse → particles(burst).
Checkpoint: event_collide(player) → var_save_checkpoint → sound(ding) → looks_glow → looks_say("Checkpoint!").
Health Pickup: event_collide(player) → health_heal → sound(powerup) → particles(sparkle) → physics_destroy.
Hazard/Trap: event_collide(player) → health_change(-25) → sound(hurt) → fx_screen_shake → looks_flash(red) → camera_shake.
NPC/Dialog: event_click → looks_say(text,3) → control_wait(3) → looks_say(more text,3). Or chain multiple dialog lines.
Teleporter: event_collide(player) → sound(magic) → fx_fade_out(0.3) → physics_teleport_player(x,y,z) → fx_fade_in(0.3).
Button/Trigger: event_click → sound(click) → looks_color(green) → control_broadcast(message1). Another object: event_message(message1) → do something.
Timer Challenge: event_start → var_start_timer(60) → var_show_timer. event_timer_done → var_game_over(lose).
Shooting Turret: event_start → control_forever { control_wait(2) → shoot_fire_at_player(15) → sound(laser) }. Or event_timer(2) → fire.
Patrol Guard: event_start → enemy_set_as(30) → enemy_patrol(8,2) → enemy_attack_ranged(3,10). event_enemy_defeated → var_change(score,50).
Moving Platform: event_start → control_forever { motion_glide(up) → wait → motion_glide(down) → wait }. Can also zigzag or orbit.
Destructible: event_start → physics_anchor(true). shoot_event_hit → health_change(-20) → looks_flash(white) → sound(hurt). event_health_zero → physics_explode → particles(burst) → destroy.
Boss: event_start → enemy_set_as(200) → enemy_show_health → looks_size(200). Multiple attack patterns with timers. event_enemy_defeated → fx_slow_motion → var_game_over(win).
Animated Decoration: event_start → control_forever { motion_hover + looks_scale_pulse } or motion_orbit or motion_bounce. Add glow/particles for magic items.
Score System: event_start → var_set(score,0) → var_show(score). Increment via var_change on other events.
Respawn: event_health_zero → fx_fade_out(0.5) → var_change_lives(-1) → var_load_checkpoint → fx_fade_in(0.5) → health_set(100).

# UI & HUD Guide

## How UI blocks work
- var_show(score/health/coins/timer/lives) — creates a PERSISTENT HUD element in the corner. Use once at game start.
- ui_show_number(label, value) — creates a custom number display on screen. Use ui_change_number to update it.
- ui_show_text_overlay(text, time) — big centered text that fades away. Great for "Level 1", "Game Over", announcements.
- var_show_message(text, time) — temporary message text on screen, similar to overlay.
- var_show_dialog(text) — dialog-style popup text.
- looks_say(text, time) — speech bubble ABOVE the object (3D world, not HUD).
- looks_billboard_text(text) — permanent floating label ABOVE the object.
- ui_add_text(text, x, y) — place text on screen at position. x/y are percentages: 50,50 = center. 50,10 = top center. 10,90 = bottom left.
- ui_add_button(text, msg) — adds a clickable button on screen. When clicked, broadcasts the msg. Listen with event_message.
- health_show_bar — persistent health bar on HUD.
- enemy_show_health — health bar floating above THIS object.

## UI positioning (for ui_add_text / ui_add_button)
x and y are PERCENTAGES of screen (0-100):
- Top-left: x=10, y=10
- Top-center: x=50, y=10
- Top-right: x=90, y=10
- Center: x=50, y=50
- Bottom-left: x=10, y=90
- Bottom-center: x=50, y=90
- Bottom-right: x=90, y=90

## When to use what
- Show score/coins/health on screen → var_show or ui_show_number
- Temporary announcement → ui_show_text_overlay
- Label on an object → looks_billboard_text or looks_say
- Interactive button → ui_add_button + event_message listener
- NPC dialog → looks_say (above object) or var_show_dialog (screen popup)
- Enemy health bar → enemy_show_health (floats above enemy)
- Player health bar → health_show_bar (HUD corner)
- Custom HUD number → ui_show_number + ui_change_number

## Color blocks
- looks_color(color) — change the object's main color. Use hex like #ff0000 (red), #00ff00 (green), #0000ff (blue), #ffff00 (yellow), #ff8800 (orange), #aa00ff (purple), #ffffff (white), #000000 (black), #888888 (gray).
- looks_tint(color, amount%) — tint/overlay a color. amount is 0-100.
- looks_glow(color, intensity) — emission glow. intensity 0-1. Great for magic/sci-fi.
- looks_flash(color, times) — flash a color briefly.
- looks_player_color(part, color) — change player body/head/detail color.
- looks_npc_color(part, color) — change NPC body/head/legs color.
- looks_trail(color) — leave a colored trail behind.
- looks_particles(type, color) — emit colored particles (burst/sparkle/fire/snow).
- fx_flash_screen(color) — flash the whole screen a color (damage, pickup, etc).
- fx_screen_tint(color, opacity%) — persistent screen tint overlay.

## Common colors
Red: #ff0000, #e74c3c, #ff4444
Blue: #0000ff, #3498db, #4c97ff, #00ccff
Green: #00ff00, #2ecc71, #22c55e
Yellow: #ffff00, #ffd700, #f1c40f
Orange: #ff8800, #e67e22, #ff6600
Purple: #aa00ff, #9b59b6, #a78bfa
Pink: #ff69b4, #e91e63, #ff1493
White: #ffffff, Cyan: #00ffff, Black: #000000

# Examples

"spin when clicked":
[{"blocks":[{"blockId":"event_click"},{"blockId":"control_forever","children":[{"blockId":"motion_spin","values":{"speed":2}}]}]}]

"collectible coin":
[{"blocks":[{"blockId":"event_start"},{"blockId":"motion_hover"},{"blockId":"control_forever","children":[{"blockId":"motion_spin","values":{"speed":3}}]}]},{"blocks":[{"blockId":"event_collide","values":{"object":"player"}},{"blockId":"sound_play","values":{"sound":"coin"}},{"blockId":"var_change","values":{"var":"coins","amount":1}},{"blockId":"looks_particles","values":{"type":"sparkle","color":"#ffd700"}},{"blockId":"physics_destroy"}]}]

"enemy that chases and attacks":
[{"blocks":[{"blockId":"event_start"},{"blockId":"enemy_set_as","values":{"health":50}},{"blockId":"enemy_show_health"},{"blockId":"enemy_follow","values":{"speed":3}},{"blockId":"enemy_attack_touch","values":{"damage":15}}]},{"blocks":[{"blockId":"event_enemy_defeated"},{"blockId":"var_change","values":{"var":"score","amount":100}},{"blockId":"looks_particles","values":{"type":"burst","color":"#ff4444"}},{"blockId":"sound_play","values":{"sound":"explosion"}},{"blockId":"physics_destroy"}]}]

"door that opens when clicked":
[{"blocks":[{"blockId":"event_click"},{"blockId":"sound_play","values":{"sound":"click"}},{"blockId":"motion_glide","values":{"x":0,"y":3,"z":0,"time":0.5}},{"blockId":"looks_say","values":{"text":"Opened!","time":1}},{"blockId":"control_wait","values":{"seconds":3}},{"blockId":"motion_glide","values":{"x":0,"y":0,"z":0,"time":0.5}},{"blockId":"sound_play","values":{"sound":"whoosh"}}]}]

"jump pad / trampoline":
[{"blocks":[{"blockId":"event_collide","values":{"object":"player"}},{"blockId":"physics_launch_player","values":{"force":20}},{"blockId":"sound_play","values":{"sound":"jump"}},{"blockId":"looks_scale_pulse","values":{"min":80,"max":120,"spd":4}},{"blockId":"looks_particles","values":{"type":"burst","color":"#00ff88"}}]}]

"teleporter":
[{"blocks":[{"blockId":"event_collide","values":{"object":"player"}},{"blockId":"sound_play","values":{"sound":"magic"}},{"blockId":"looks_particles","values":{"type":"sparkle","color":"#aa66ff"}},{"blockId":"fx_fade_out","values":{"seconds":0.3}},{"blockId":"physics_teleport_player","values":{"x":10,"y":1,"z":0}},{"blockId":"fx_fade_in","values":{"seconds":0.3}}]}]

"health pickup":
[{"blocks":[{"blockId":"event_start"},{"blockId":"motion_hover","values":{"h":0.3,"s":1.5}},{"blockId":"looks_glow","values":{"color":"#00ff00","val":0.5}},{"blockId":"control_forever","children":[{"blockId":"motion_spin","values":{"axis":"Y","speed":2}}]}]},{"blocks":[{"blockId":"event_collide","values":{"object":"player"}},{"blockId":"health_heal","values":{"amount":25}},{"blockId":"sound_play","values":{"sound":"powerup"}},{"blockId":"looks_particles","values":{"type":"sparkle","color":"#00ff00"}},{"blockId":"physics_destroy"}]}]

"shooting turret":
[{"blocks":[{"blockId":"event_start"},{"blockId":"looks_glow","values":{"color":"#ff0000","val":0.3}},{"blockId":"motion_look_at_player"},{"blockId":"control_forever","children":[{"blockId":"shoot_fire_at_player","values":{"speed":20,"color":"#ff4400"}},{"blockId":"sound_play","values":{"sound":"laser"}},{"blockId":"control_wait","values":{"seconds":1.5}}]}]}]

"lava / hazard that damages player":
[{"blocks":[{"blockId":"event_collide","values":{"object":"player"}},{"blockId":"health_change","values":{"amount":-20}},{"blockId":"sound_play","values":{"sound":"hurt"}},{"blockId":"fx_flash_screen","values":{"color":"#ff0000"}},{"blockId":"camera_shake","values":{"intensity":0.4,"time":0.3}}]}]

"NPC that talks when clicked":
[{"blocks":[{"blockId":"event_click"},{"blockId":"motion_face_direction","values":{"dir":"player"}},{"blockId":"looks_say","values":{"text":"Hey there, adventurer!","time":3}},{"blockId":"control_wait","values":{"seconds":3}},{"blockId":"looks_say","values":{"text":"Watch out for enemies ahead!","time":3}},{"blockId":"sound_play","values":{"sound":"chime"}}]}]

"moving platform":
[{"blocks":[{"blockId":"event_start"},{"blockId":"control_forever","children":[{"blockId":"motion_glide","values":{"x":0,"y":5,"z":0,"time":2}},{"blockId":"control_wait","values":{"seconds":0.5}},{"blockId":"motion_glide","values":{"x":0,"y":0,"z":0,"time":2}},{"blockId":"control_wait","values":{"seconds":0.5}}]}]}]

"button that triggers another object via broadcast":
[{"blocks":[{"blockId":"event_click"},{"blockId":"sound_play","values":{"sound":"click"}},{"blockId":"looks_color","values":{"color":"#00ff00"}},{"blockId":"control_broadcast","values":{"msg":"go"}},{"blockId":"looks_say","values":{"text":"Activated!","time":2}}]}]

"destructible object":
[{"blocks":[{"blockId":"event_start"},{"blockId":"health_set","values":{"value":50}},{"blockId":"health_show_bar"}]},{"blocks":[{"blockId":"shoot_event_hit"},{"blockId":"health_change","values":{"amount":-10}},{"blockId":"looks_flash","values":{"color":"#ffffff","times":2}},{"blockId":"sound_play","values":{"sound":"hurt"}}]},{"blocks":[{"blockId":"event_health_zero"},{"blockId":"looks_particles","values":{"type":"burst","color":"#ff6600"}},{"blockId":"sound_play","values":{"sound":"explosion"}},{"blockId":"physics_explode","values":{"force":5,"radius":3}},{"blockId":"physics_destroy"}]}]

"boss enemy":
[{"blocks":[{"blockId":"event_start"},{"blockId":"enemy_set_as","values":{"health":200}},{"blockId":"enemy_show_health"},{"blockId":"looks_size","values":{"percent":200}},{"blockId":"looks_glow","values":{"color":"#ff0000","val":0.3}},{"blockId":"enemy_follow","values":{"speed":1.5}}]},{"blocks":[{"blockId":"event_timer","values":{"seconds":2}},{"blockId":"shoot_fire_at_player","values":{"speed":15,"color":"#ff0000"}},{"blockId":"sound_play","values":{"sound":"laser"}}]},{"blocks":[{"blockId":"event_timer","values":{"seconds":5}},{"blockId":"physics_spawn_at_player","values":{"shape":"sphere"}},{"blockId":"sound_play","values":{"sound":"boom"}},{"blockId":"camera_shake","values":{"intensity":0.3,"time":0.5}}]},{"blocks":[{"blockId":"event_enemy_defeated"},{"blockId":"fx_slow_motion","values":{"speed":0.3,"seconds":2}},{"blockId":"looks_particles","values":{"type":"burst","color":"#ffd700"}},{"blockId":"sound_play","values":{"sound":"explosion"}},{"blockId":"var_show_message","values":{"text":"Boss defeated!","time":3}},{"blockId":"var_game_over","values":{"result":"win"}}]}]

Append example — existing Stack 1 has event_start → motion_spin. User says "also make it glow":
[{"appendToStack":1,"blocks":[{"blockId":"looks_glow","values":{"color":"#00ffff","val":0.8}}]}]

Append example — existing Stack 1 has event_start → stuff, Stack 2 has event_click → stuff. User says "also play a sound when clicked":
[{"appendToStack":2,"blocks":[{"blockId":"sound_play","values":{"sound":"pop"}}]}]

Replace example — existing Stack 1 has event_start → control_forever { motion_spin speed=5 }. User says "it spins too fast":
[{"replaceStack":1,"blocks":[{"blockId":"event_start"},{"blockId":"control_forever","children":[{"blockId":"motion_spin","values":{"speed":1}}]}]}]

Replace example — existing Stack 1 has event_click → motion_glide y=3 time=0.5. User says "make it go higher and slower":
[{"replaceStack":1,"blocks":[{"blockId":"event_click"},{"blockId":"motion_glide","values":{"y":8,"time":2}}]}]

Replace example — existing Stack 1 has event_start → enemy_set_as health=50 → enemy_follow speed=3. User says "the enemy is too fast and has too much health":
[{"replaceStack":1,"blocks":[{"blockId":"event_start"},{"blockId":"enemy_set_as","values":{"health":25}},{"blockId":"enemy_follow","values":{"speed":1.5}}]}]

Replace example — existing Stack 1 has event_collide → health_change amount=-20. User says "it does too much damage, make it 5":
[{"replaceStack":1,"blocks":[{"blockId":"event_collide"},{"blockId":"health_change","values":{"amount":-5}}]}]`;

app.post('/api/ai/script', authenticate, async (req, res) => {
    const { prompt, history, existingScripts, explain, replaceMode, customSoundNames } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        return res.status(400).json({ error: 'Prompt is required' });
    }
    if (prompt.length > 1000) {
        return res.status(400).json({ error: 'Prompt too long' });
    }

    const config = getGenaiConfig();
    if (!config.apiBase) {
        return res.status(503).json({ error: 'AI service not configured' });
    }

    try {
        const url = config.apiBase.replace(/\/+$/, '') + '/v1/chat/completions';

        // Explain mode: different system prompt
        if (explain) {
            const messages = [
                { role: 'system', content: 'You explain block code scripts for a 3D game engine. The user will provide scripts and ask what they do. Give a brief, clear explanation in 1-3 sentences. Be specific about behaviors (e.g. "spins continuously when clicked" not "does something on click").' }
            ];
            if (existingScripts) {
                messages.push({ role: 'system', content: 'Current scripts:\n' + existingScripts.slice(0, 3000) });
            }
            messages.push({ role: 'user', content: prompt.trim() });

            const body = JSON.stringify({ model: config.model || undefined, messages, temperature: 0.3, max_tokens: 300 });
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(config.apiKey ? { 'Authorization': 'Bearer ' + config.apiKey } : {}) },
                body
            });
            if (!response.ok) return res.status(502).json({ error: 'AI service error' });
            const data = await response.json();
            const content = data.choices?.[0]?.message?.content || 'Could not generate explanation';
            return res.json({ explanation: content.trim() });
        }

        const messages = [{ role: 'system', content: AI_SCRIPT_SYSTEM_PROMPT }];

        // Inject existing scripts context
        if (existingScripts && typeof existingScripts === 'string' && existingScripts.length > 0) {
            if (replaceMode) {
                messages.push({ role: 'system', content: 'Object currently has these scripts:\n' + existingScripts.slice(0, 3000) + '\n\nThe user wants you to modify/improve these scripts. Return the COMPLETE replacement set of scripts (all stacks). Do NOT use appendToStack — return full new stacks.' });
            } else {
                messages.push({ role: 'system', content: 'Object already has these scripts:\n' + existingScripts.slice(0, 2000) + '\n\nCRITICAL: Output ONLY the new scripts the user is asking for. Do NOT re-output or duplicate any existing scripts. Each request should produce ONLY the new behavior, not everything combined.' });
            }
        }

        // Inject custom sound names
        if (Array.isArray(customSoundNames) && customSoundNames.length > 0) {
            const names = customSoundNames.slice(0, 50).map(n => String(n).slice(0, 100));
            messages.push({ role: 'system', content: 'Custom sounds uploaded by the user: ' + names.join(', ') + '\nWhen the user mentions one of these sound names, use sound_play_custom with that name. Example: {"blockId":"sound_play_custom","values":{"sound":"' + names[0] + '"}}' });
        }

        // Conversation history
        if (Array.isArray(history)) {
            const recent = history.slice(-12);
            for (const msg of recent) {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    messages.push({ role: msg.role, content: String(msg.content).slice(0, 2000) });
                }
            }
        }

        messages.push({ role: 'user', content: prompt.trim() });

        const body = JSON.stringify({
            model: config.model || undefined,
            messages,
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
            console.error('AI script error:', response.status, errText);
            return res.status(502).json({ error: 'AI service error' });
        }

        const data = await response.json();
        const content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        if (!content) {
            return res.status(502).json({ error: 'Empty AI response' });
        }

        // Extract JSON array
        let jsonStr = content.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();

        const arrStart = jsonStr.indexOf('[');
        const arrEnd = jsonStr.lastIndexOf(']');
        if (arrStart === -1 || arrEnd === -1) {
            return res.status(502).json({ error: 'AI response was not valid JSON' });
        }
        jsonStr = jsonStr.substring(arrStart, arrEnd + 1);

        const stacks = JSON.parse(jsonStr);
        if (!Array.isArray(stacks)) {
            return res.status(502).json({ error: 'AI response was not an array' });
        }

        // Sanitize: max 10 stacks, 20 blocks each, 15 children per c-block
        const sanitized = stacks.slice(0, 10).map(stack => {
            if (!stack.blocks || !Array.isArray(stack.blocks)) return null;
            const blocks = stack.blocks.slice(0, 20).map(b => {
                const block = {
                    blockId: typeof b.blockId === 'string' ? b.blockId : '',
                    values: (b.values && typeof b.values === 'object') ? b.values : {}
                };
                if (Array.isArray(b.children) && b.children.length > 0) {
                    block.children = b.children.slice(0, 15).map(c => ({
                        blockId: typeof c.blockId === 'string' ? c.blockId : '',
                        values: (c.values && typeof c.values === 'object') ? c.values : {}
                    }));
                }
                return block;
            });
            const result = { blocks };
            if (typeof stack.replaceStack === 'number' && stack.replaceStack > 0) {
                result.replaceStack = stack.replaceStack;
            } else if (typeof stack.appendToStack === 'number' && stack.appendToStack > 0) {
                result.appendToStack = stack.appendToStack;
            }
            return result;
        }).filter(Boolean);

        res.json({ stacks: sanitized });
    } catch (err) {
        console.error('AI script error:', err);
        res.status(500).json({ error: 'Failed to generate script' });
    }
});

// ===== Cloud Data API =====
const _cloudRateLimit = new Map(); // userId -> { count, resetAt }

app.get('/api/cloud-data/:projectId', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT key, value, updated_at FROM cloud_data WHERE project_id = $1', [req.params.projectId]);
    res.json(rows);
});

app.get('/api/cloud-data/:projectId/:key', authenticate, async (req, res) => {
    const { rows } = await pool.query('SELECT value FROM cloud_data WHERE project_id = $1 AND key = $2', [req.params.projectId, req.params.key]);
    res.json({ value: rows.length ? rows[0].value : '0' });
});

app.put('/api/cloud-data/:projectId/:key', authenticate, async (req, res) => {
    // Rate limit: 10 writes per minute per user
    const now = Date.now();
    let rl = _cloudRateLimit.get(req.user.id);
    if (!rl || now > rl.resetAt) { rl = { count: 0, resetAt: now + 60000 }; _cloudRateLimit.set(req.user.id, rl); }
    rl.count++;
    if (rl.count > 10) return res.status(429).json({ error: 'Rate limit exceeded (10/min)' });

    const value = String(req.body.value ?? '0').slice(0, 1000);
    await pool.query(
        `INSERT INTO cloud_data (project_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, key) DO UPDATE SET value = $3, updated_at = $4`,
        [req.params.projectId, req.params.key, value, now]
    );
    res.json({ ok: true });
});

app.delete('/api/cloud-data/:projectId/:key', authenticate, async (req, res) => {
    await pool.query('DELETE FROM cloud_data WHERE project_id = $1 AND key = $2', [req.params.projectId, req.params.key]);
    res.json({ ok: true });
});

// ===== Template Marketplace API =====

app.get('/api/templates', async (req, res) => {
    const sort = req.query.sort === 'newest' ? 'published_at DESC' : 'use_count DESC';
    const search = req.query.search ? `%${req.query.search}%` : null;
    let query = `SELECT id, name, description, creator, tags, thumbnail, published_at, use_count FROM shared_templates`;
    const params = [];
    if (search) { query += ` WHERE name ILIKE $1 OR description ILIKE $1`; params.push(search); }
    query += ` ORDER BY ${sort} LIMIT 50`;
    const { rows } = await pool.query(query, params);
    res.json(rows.map(r => ({ ...r, tags: JSON.parse(r.tags || '[]') })));
});

app.post('/api/templates', authenticate, async (req, res) => {
    const { name, description, tags, thumbnail, templateData } = req.body;
    if (!name || !templateData) return res.status(400).json({ error: 'Name and data required' });
    const id = 'tmpl_' + crypto.randomBytes(8).toString('hex');
    const { rows: userRows } = await pool.query('SELECT display_name FROM users WHERE id = $1', [req.user.id]);
    const creator = userRows[0]?.display_name || req.user.username;
    await pool.query(
        `INSERT INTO shared_templates (id, user_id, name, description, creator, tags, thumbnail, template_data, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, req.user.id, name.slice(0, 60), (description || '').slice(0, 200), creator, JSON.stringify(tags || []), thumbnail || null, JSON.stringify(templateData), Date.now()]
    );
    // Log activity
    await pool.query('INSERT INTO activity_feed (user_id, type, data, created_at) VALUES ($1, $2, $3, $4)',
        [req.user.id, 'published_template', JSON.stringify({ templateId: id, name }), Date.now()]);
    res.json({ id });
});

app.delete('/api/templates/:id', authenticate, async (req, res) => {
    await pool.query('DELETE FROM shared_templates WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    res.json({ ok: true });
});

app.post('/api/templates/:id/use', async (req, res) => {
    await pool.query('UPDATE shared_templates SET use_count = use_count + 1 WHERE id = $1', [req.params.id]);
    const { rows } = await pool.query('SELECT template_data FROM shared_templates WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    res.json({ templateData: JSON.parse(rows[0].template_data) });
});

// ===== Friends API =====

app.post('/api/friends/request', authenticate, async (req, res) => {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });
    const { rows: targetRows } = await pool.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1)', [username]);
    if (!targetRows.length) return res.status(404).json({ error: 'User not found' });
    const friendId = targetRows[0].id;
    if (friendId === req.user.id) return res.status(400).json({ error: 'Cannot friend yourself' });
    // Check existing
    const { rows: existing } = await pool.query(
        'SELECT id, status FROM friendships WHERE (user_id=$1 AND friend_id=$2) OR (user_id=$2 AND friend_id=$1)', [req.user.id, friendId]);
    if (existing.length) return res.status(400).json({ error: existing[0].status === 'accepted' ? 'Already friends' : 'Request already pending' });
    await pool.query('INSERT INTO friendships (user_id, friend_id, status, created_at) VALUES ($1, $2, $3, $4)', [req.user.id, friendId, 'pending', Date.now()]);
    res.json({ ok: true });
});

app.post('/api/friends/accept', authenticate, async (req, res) => {
    const { friendshipId } = req.body;
    await pool.query('UPDATE friendships SET status = $1 WHERE id = $2 AND friend_id = $3', ['accepted', friendshipId, req.user.id]);
    res.json({ ok: true });
});

app.delete('/api/friends/:id', authenticate, async (req, res) => {
    await pool.query('DELETE FROM friendships WHERE id = $1 AND (user_id = $2 OR friend_id = $2)', [req.params.id, req.user.id]);
    res.json({ ok: true });
});

app.get('/api/friends', authenticate, async (req, res) => {
    const { rows } = await pool.query(`
        SELECT f.id, f.user_id, f.friend_id, f.status, f.created_at,
               u1.username as user_username, u1.display_name as user_display, u1.avatar_color as user_color,
               u2.username as friend_username, u2.display_name as friend_display, u2.avatar_color as friend_color
        FROM friendships f
        JOIN users u1 ON f.user_id = u1.id
        JOIN users u2 ON f.friend_id = u2.id
        WHERE f.user_id = $1 OR f.friend_id = $1
        ORDER BY f.created_at DESC
    `, [req.user.id]);
    const friends = [];
    const pending = [];
    rows.forEach(r => {
        const isRequester = r.user_id === req.user.id;
        const other = isRequester
            ? { username: r.friend_username, displayName: r.friend_display, avatarColor: r.friend_color }
            : { username: r.user_username, displayName: r.user_display, avatarColor: r.user_color };
        const entry = { id: r.id, ...other, status: r.status };
        if (r.status === 'accepted') friends.push(entry);
        else if (r.status === 'pending') pending.push({ ...entry, incoming: !isRequester });
    });
    res.json({ friends, pending });
});

app.get('/api/activity', authenticate, async (req, res) => {
    // Get friend IDs
    const { rows: friendRows } = await pool.query(`
        SELECT CASE WHEN user_id = $1 THEN friend_id ELSE user_id END as fid
        FROM friendships WHERE status = 'accepted' AND (user_id = $1 OR friend_id = $1)
    `, [req.user.id]);
    const friendIds = friendRows.map(r => r.fid);
    if (!friendIds.length) return res.json([]);
    const placeholders = friendIds.map((_, i) => `$${i + 1}`).join(',');
    const { rows } = await pool.query(
        `SELECT a.*, u.display_name, u.avatar_color FROM activity_feed a
         JOIN users u ON a.user_id = u.id
         WHERE a.user_id IN (${placeholders})
         ORDER BY a.created_at DESC LIMIT 30`,
        friendIds
    );
    res.json(rows.map(r => ({ ...r, data: JSON.parse(r.data || '{}') })));
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
    for (const [ws, info] of room.members) {
        const member = { userId: info.userId, displayName: info.displayName, avatar: info.avatar, role: ws === room.hostWs ? 'host' : (info.role || 'editor') };
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
            case 'set-role': {
                // Host-only: change a member's role
                for (const [code, room] of rooms) {
                    if (room.hostWs === ws) {
                        for (const [memberWs, info] of room.members) {
                            if (info.userId === msg.targetUserId) {
                                info.role = msg.role; // 'editor' or 'viewer'
                                memberWs.send(JSON.stringify({ type: 'role-changed', role: msg.role }));
                                broadcastToRoom(code, { type: 'member-update', members: getMemberList(room) });
                                break;
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
            case 'update-character':
            case 'terrain-edit':
            case 'terrain-create':
            case 'terrain-remove': {
                // Reject edit messages from viewers
                for (const [code, room] of rooms) {
                    if (room.members.has(ws)) {
                        const info = room.members.get(ws);
                        if (ws !== room.hostWs && info.role === 'viewer') {
                            ws.send(JSON.stringify({ type: 'error', message: 'Viewers cannot edit' }));
                            return;
                        }
                        broadcastToRoom(code, msg, ws);
                        break;
                    }
                }
                break;
            }
            case 'vote-request':
            case 'vote-response':
            case 'vote-passed':
            case 'vote-failed': {
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
