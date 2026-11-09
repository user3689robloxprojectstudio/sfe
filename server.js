const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1566401329134436445';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YXsJbWZep1P6AYzO8RKfvDD6p5alV3vC';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://scriptsforexenet.vercel.app/auth/discord/callback';
const ADMIN_DISCORD_ID = '1287363175158644757';

const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY || '';
const JSONBIN_BIN_ID = process.env.JSONBIN_BIN_ID || '';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
    secret: 'scriptsforexe_layout_key_77!',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser((id, done) => {
    getUsersCache().then(users => {
        done(null, users[id] || { id });
    }).catch(() => done(null, { id }));
});

const activeVisitors = new Map();
let memoryCloudCache = [];
let memoryUsersCache = {};

async function getCloudData() {
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        try {
            if (fs.existsSync('cloud_cache.json')) {
                return JSON.parse(fs.readFileSync('cloud_cache.json', 'utf8'));
            }
        } catch {}
        return memoryCloudCache;
    }
    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        const data = await response.json();
        return data.record?.scripts || memoryCloudCache;
    } catch {
        return memoryCloudCache;
    }
}

async function saveCloudData(scripts) {
    memoryCloudCache = scripts;
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        try { fs.writeFileSync('cloud_cache.json', JSON.stringify(scripts, null, 2)); } catch {}
        return;
    }
    try {
        const getRes = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        const currentData = await getRes.json();
        const users = currentData.record?.users || memoryUsersCache;

        await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
            body: JSON.stringify({ scripts, users })
        });
    } catch {}
}

async function getUsersCache() {
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        try {
            if (fs.existsSync('users_cache.json')) {
                return JSON.parse(fs.readFileSync('users_cache.json', 'utf8'));
            }
        } catch {}
        return memoryUsersCache;
    }
    try {
        const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        const data = await response.json();
        return data.record?.users || memoryUsersCache;
    } catch {
        return memoryUsersCache;
    }
}

async function saveUsersCache(users) {
    memoryUsersCache = users;
    if (!JSONBIN_API_KEY || !JSONBIN_BIN_ID) {
        try { fs.writeFileSync('users_cache.json', JSON.stringify(users, null, 2)); } catch {}
        return;
    }
    try {
        const getRes = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, {
            headers: { 'X-Master-Key': JSONBIN_API_KEY }
        });
        const currentData = await getRes.json();
        const scripts = currentData.record?.scripts || memoryCloudCache;

        await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Master-Key': JSONBIN_API_KEY },
            body: JSON.stringify({ scripts, users })
        });
    } catch {}
}

async function addNotification(userId, message) {
    let users = await getUsersCache();
    if (users[userId]) {
        if (!users[userId].notifications) users[userId].notifications = [];
        users[userId].notifications.unshift({ id: Date.now().toString(), message, createdAt: new Date().toISOString() });
        await saveUsersCache(users);
    }
}

async function addPoints(userId, amount) {
    let users = await getUsersCache();
    if (users[userId]) {
        users[userId].points = Math.min(50, (users[userId].points || 0) + amount);
        await saveUsersCache(users);
    }
}

app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    activeVisitors.set(ip, Date.now());
    const now = Date.now();
    for (let [visitorIp, time] of activeVisitors.entries()) {
        if (now - time > 60000) activeVisitors.delete(visitorIp);
    }
    next();
});

passport.use(new DiscordStrategy({
    clientID: DISCORD_CLIENT_ID,
    clientSecret: DISCORD_CLIENT_SECRET,
    callbackURL: CALLBACK_URL,
    scope: ['identify']
}, async (accessToken, refreshToken, profile, done) => {
    let users = await getUsersCache();
    let userAvatar = profile.avatar 
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${profile.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(profile.id) >> 22n) % 6n)}.png`;

    const realUsername = profile.username || profile.global_name || 'User_' + profile.id.slice(-4);
    const isAdmin = profile.id === ADMIN_DISCORD_ID;

    if (!users[profile.id]) {
        users[profile.id] = {
            id: profile.id,
            username: realUsername,
            avatar: userAvatar,
            bio: 'Roblox scripter on ScriptForExe.net.',
            followers: [],
            following: [],
            points: 10,
            notifications: [],
            verified: false,
            banned: false,
            isAdmin: isAdmin
        };
    } else {
        users[profile.id].username = realUsername;
        users[profile.id].avatar = userAvatar;
        users[profile.id].isAdmin = isAdmin;
    }

    await saveUsersCache(users);
    return done(null, users[profile.id]);
}));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });

app.get('/api/me', async (req, res) => {
    if (!req.isAuthenticated()) return res.json({ authenticated: false });
    const users = await getUsersCache();
    const user = users[req.user.id] || req.user;
    if (user.banned) { req.logout(() => res.json({ authenticated: false })); return; }
    res.json({ authenticated: true, user });
});

app.get('/api/stats', async (req, res) => {
    const users = await getUsersCache();
    const scripts = await getCloudData();
    res.json({
        onlineNow: activeVisitors.size,
        totalRegistered: Object.keys(users).length,
        totalScripts: scripts.length,
        totalExecutions: scripts.reduce((acc, s) => acc + (s.views || 0) * 14, 12450)
    });
});

const upload = multer({ dest: os.tmpdir() });

app.post('/api/upload', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'scriptFile', maxCount: 1 }, { name: 'code', maxCount: 1 }]), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const users = await getUsersCache();
    if (users[req.user.id] && users[req.user.id].banned) return res.status(403).json({ error: 'Banned' });

    const { title, description, category, gameLink, hasKeySystem, code: bodyCode } = req.body;
    
    let scriptContent = bodyCode || '';
    const scriptFile = req.files && req.files['scriptFile'] ? req.files['scriptFile'][0] : null;
    if (scriptFile) {
        try { scriptContent = fs.readFileSync(scriptFile.path, 'utf8'); } catch { scriptContent = '-- Error reading file'; }
    }

    // Convert uploaded image to Base64 to prevent Vercel 404 broken image errors
    let imageUrl = req.body.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600';
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
    if (imageFile) {
        try {
            const bitmap = fs.readFileSync(imageFile.path);
            imageUrl = `data:${imageFile.mimetype};base64,${bitmap.toString('base64')}`;
        } catch {}
    }

    const cache = await getCloudData();
    const newScript = {
        id: Date.now().toString(),
        title: title || 'Untitled',
        description: description || 'No description.',
        category: category || 'Roblox',
        gameLink: gameLink || '#',
        hasKeySystem: hasKeySystem === 'on' || hasKeySystem === true || hasKeySystem === 'true',
        image: imageUrl,
        scriptContent: scriptContent,
        code: scriptContent,
        author: { id: req.user.id, username: users[req.user.id].username, avatar: users[req.user.id].avatar },
        authorId: req.user.id,
        likes: [],
        comments: [],
        views: 0,
        createdAt: new Date().toISOString()
    };

    cache.unshift(newScript);
    await saveCloudData(cache);
    await addPoints(req.user.id, 15);
    await addNotification(req.user.id, `🎉 You earned 15 points for publishing "${newScript.title}"!`);

    res.json({ success: true, id: newScript.id, scriptId: newScript.id });
});

app.get('/api/scripts', async (req, res) => res.json(await getCloudData()));

app.get('/api/scripts/:id', async (req, res) => {
    const cache = await getCloudData();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!req.session.viewedScripts) req.session.viewedScripts = [];
    if (!req.session.viewedScripts.includes(script.id)) {
        req.session.viewedScripts.push(script.id);
        script.views = (script.views || 0) + 1;
        await saveCloudData(cache);
    }
    res.json(script);
});

app.delete('/api/scripts/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });

    let cache = await getCloudData();
    const scriptIndex = cache.findIndex(s => s.id === req.params.id);
    if (scriptIndex === -1) return res.status(404).json({ error: 'Post not found' });

    const script = cache[scriptIndex];
    const isOwner = script.authorId === req.user.id || script.author?.id === req.user.id;
    const users = await getUsersCache();
    const isAdmin = users[req.user.id]?.isAdmin || req.user.id === ADMIN_DISCORD_ID;

    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    cache.splice(scriptIndex, 1);
    await saveCloudData(cache);
    res.json({ success: true, message: 'Deleted successfully' });
});

app.post('/api/scripts/:id/like', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const cache = await getCloudData();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!script.likes) script.likes = [];
    const idx = script.likes.indexOf(req.user.id);
    if (idx > -1) {
        script.likes.splice(idx, 1);
    } else {
        script.likes.push(req.user.id);
        await addPoints(req.user.id, 5);
    }
    await saveCloudData(cache);
    res.json({ success: true, likes: script.likes.length, ...script });
});

app.post('/api/scripts/:id/comment', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Empty' });
    const cache = await getCloudData();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!script.comments) script.comments = [];
    const users = await getUsersCache();
    const currentUser = users[req.user.id] || req.user;

    script.comments.push({ 
        id: Date.now().toString(), 
        userId: req.user.id, 
        author: { id: req.user.id, username: currentUser.username, avatar: currentUser.avatar },
        username: currentUser.username, 
        text: text.trim(),
        createdAt: new Date().toISOString()
    });
    
    await saveCloudData(cache);
    res.json({ success: true, comments: script.comments, ...script });
});

app.get('/api/users/:id', async (req, res) => {
    const users = await getUsersCache();
    const userId = req.params.id;
    let user = users[userId] || Object.values(users).find(u => u.id == userId || u.username === userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const cache = await getCloudData();
    res.json({ user, scripts: cache.filter(s => s.authorId === user.id || s.author?.id === user.id) });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`ScriptForExe.net running locally on port ${PORT}`));
}

module.exports = app;
