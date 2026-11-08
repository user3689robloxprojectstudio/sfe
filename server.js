const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1566401329134436445';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YXsJbWZep1P6AYzO8RKfvDD6p5alV3vC';
const CALLBACK_URL = process.env.CALLBACK_URL || 'http://localhost:3000/auth/discord/callback';
const ADMIN_DISCORD_ID = '1287363175158644757';

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
    let users = getUsersCache();
    done(null, users[id] || { id });
});

const activeVisitors = new Map();

function getCloudCache() {
    if (!fs.existsSync('cloud_cache.json')) fs.writeFileSync('cloud_cache.json', JSON.stringify([]));
    try { return JSON.parse(fs.readFileSync('cloud_cache.json')); } catch { return []; }
}
function saveCloudCache(data) { fs.writeFileSync('cloud_cache.json', JSON.stringify(data, null, 2)); }

function getUsersCache() {
    if (!fs.existsSync('users_cache.json')) fs.writeFileSync('users_cache.json', JSON.stringify({}));
    try { return JSON.parse(fs.readFileSync('users_cache.json')); } catch { return {}; }
}
function saveUsersCache(data) { fs.writeFileSync('users_cache.json', JSON.stringify(data, null, 2)); }

function addNotification(userId, message) {
    let users = getUsersCache();
    if (users[userId]) {
        if (!users[userId].notifications) users[userId].notifications = [];
        users[userId].notifications.unshift({ id: Date.now().toString(), message, createdAt: new Date().toISOString() });
        saveUsersCache(users);
    }
}

function addPoints(userId, amount) {
    let users = getUsersCache();
    if (users[userId]) {
        users[userId].points = Math.min(50, (users[userId].points || 0) + amount);
        saveUsersCache(users);
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
}, (accessToken, refreshToken, profile, done) => {
    let users = getUsersCache();
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
            bio: 'Roblox scripter on ScriptsForExe.gg.',
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

    saveUsersCache(users);
    return done(null, users[profile.id]);
}));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });

app.get('/api/me', (req, res) => {
    if (!req.isAuthenticated()) return res.json({ authenticated: false });
    const users = getUsersCache();
    const user = users[req.user.id] || req.user;
    if (user.banned) { req.logout(() => res.json({ authenticated: false })); return; }
    res.json({ authenticated: true, user });
});

app.get('/api/admin/check', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) return res.json({ admin: false });
    res.json({ admin: true });
});

app.get('/api/stats', (req, res) => {
    const users = getUsersCache();
    const scripts = getCloudCache();
    res.json({
        onlineNow: activeVisitors.size,
        totalRegistered: Object.keys(users).length,
        totalScripts: scripts.length,
        totalExecutions: scripts.reduce((acc, s) => acc + (s.views || 0) * 14, 12450)
    });
});

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir });

// --- Unified Script Upload Route ---
app.post('/api/upload', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'scriptFile', maxCount: 1 }, { name: 'code', maxCount: 1 }]), (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const users = getUsersCache();
    if (users[req.user.id] && users[req.user.id].banned) return res.status(403).json({ error: 'Banned' });

    const { title, description, category, gameLink, hasKeySystem, code: bodyCode } = req.body;
    
    let scriptContent = bodyCode || '';
    const scriptFile = req.files && req.files['scriptFile'] ? req.files['scriptFile'][0] : null;
    if (scriptFile) {
        try { scriptContent = fs.readFileSync(scriptFile.path, 'utf8'); } catch { scriptContent = '-- Error reading file'; }
    }

    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
    const imageUrl = imageFile ? `/uploads/${imageFile.filename}` : (req.body.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600');

    const cache = getCloudCache();
    const newScript = {
        id: Date.now().toString(),
        title: title || 'Untitled',
        description: description || 'No description.',
        category: category || 'Roblox',
        gameLink: gameLink || '#',
        hasKeySystem: hasKeySystem === 'on' || hasKeySystem === true || hasKeySystem === 'true',
        image: imageUrl,
        scriptContent: scriptContent,
        code: scriptContent, // Backwards compatibility for both keys
        author: { id: req.user.id, username: users[req.user.id].username, avatar: users[req.user.id].avatar },
        authorId: req.user.id,
        likes: [],
        comments: [],
        views: 0,
        createdAt: new Date().toISOString()
    };

    cache.unshift(newScript);
    saveCloudCache(cache);
    addPoints(req.user.id, 15);
    addNotification(req.user.id, `🎉 You earned 15 points for publishing "${newScript.title}"!`);

    res.json({ success: true, id: newScript.id, scriptId: newScript.id });
});

app.get('/api/scripts', (req, res) => res.json(getCloudCache()));

app.get('/api/scripts/:id', (req, res) => {
    const cache = getCloudCache();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!req.session.viewedScripts) req.session.viewedScripts = [];
    if (!req.session.viewedScripts.includes(script.id)) {
        req.session.viewedScripts.push(script.id);
        script.views = (script.views || 0) + 1;
        saveCloudCache(cache);
    }

    res.json(script);
});

app.post('/api/scripts/:id/like', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const cache = getCloudCache();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!script.likes) script.likes = [];
    const idx = script.likes.indexOf(req.user.id);
    if (idx > -1) {
        script.likes.splice(idx, 1);
    } else {
        script.likes.push(req.user.id);
        addPoints(req.user.id, 5);
        if (script.authorId) {
            addPoints(script.authorId, 10);
            addNotification(script.authorId, `❤️ Someone liked your script "${script.title}"!`);
        }
    }

    saveCloudCache(cache);
    res.json({ success: true, likes: script.likes.length, ...script });
});

app.post('/api/scripts/:id/comment', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Empty' });
    const cache = getCloudCache();
    const script = cache.find(s => s.id === req.params.id);
    if (!script) return res.status(404).json({ error: 'Not found' });

    if (!script.comments) script.comments = [];
    const users = getUsersCache();
    const currentUser = users[req.user.id] || req.user;

    script.comments.push({ 
        id: Date.now().toString(), 
        userId: req.user.id, 
        author: {
            id: req.user.id,
            username: currentUser.username,
            avatar: currentUser.avatar
        },
        username: currentUser.username, 
        text: text.trim(),
        createdAt: new Date().toISOString()
    });
    
    saveCloudCache(cache);
    addPoints(req.user.id, 5);
    res.json({ success: true, comments: script.comments, ...script });
});

// --- User Profile Endpoints (Supports both /api/users/:id and /api/user/:id) ---
const handleUserProfileLookup = (req, res) => {
    const users = getUsersCache();
    const userId = req.params.id;
    let user = users[userId] || Object.values(users).find(u => u.id == userId || u.username === userId);
    
    if (!user) {
        const cache = getCloudCache();
        const foundScript = cache.find(s => s.author && (s.author.id == userId || s.author.username === userId));
        if (foundScript) user = foundScript.author;
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    const cache = getCloudCache();
    res.json({ user, scripts: cache.filter(s => s.authorId === user.id || s.author?.id === user.id) });
};

app.get('/api/users/:id', handleUserProfileLookup);
app.get('/api/user/:id', handleUserProfileLookup);

// --- Admin Panel Users Endpoint ---
app.get('/api/admin/users', (req, res) => {
    if (!req.isAuthenticated() || req.user.id !== ADMIN_DISCORD_ID) {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    const users = getUsersCache();
    const userList = Object.values(users).map(u => ({
        id: u.id,
        username: u.username || 'Unknown',
        avatar: u.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png',
        isAdmin: u.isAdmin || u.id === ADMIN_DISCORD_ID,
        joinedAt: u.joinedAt || 'N/A'
    }));
    res.json(userList);
});

app.get('/api/leaderboard', (req, res) => {
    const users = getUsersCache();
    const list = Object.values(users).map(u => ({
        id: u.id,
        username: u.username,
        avatar: u.avatar,
        points: u.points || 0,
        verified: u.verified
    })).sort((a, b) => b.points - a.points);
    res.json(list);
});

app.post('/api/users/bio', (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { bio } = req.body;
    const users = getUsersCache();
    if (users[req.user.id]) { users[req.user.id].bio = bio; saveUsersCache(users); }
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`ScriptsForExe.gg running on port ${PORT}`));