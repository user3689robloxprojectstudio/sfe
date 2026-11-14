const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const admin = require('firebase-admin');

// Initialize Firebase Admin (Make sure GOOGLE_APPLICATION_CREDENTIALS or your environment variables are configured)
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 3000;

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1566401329134436445';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || 'YXsJbWZep1P6AYzO8RKfvDD6p5alV3vC';
const CALLBACK_URL = process.env.CALLBACK_URL || 'https://scriptsforexenet.vercel.app/auth/discord/callback';
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
passport.deserializeUser(async (id, done) => {
    try {
        const userDoc = await db.collection('users').doc(id).get();
        if (userDoc.exists) {
            done(null, { id, ...userDoc.data() });
        } else {
            done(null, { id });
        }
    } catch {
        done(null, { id });
    }
});

const activeVisitors = new Map();

// Firebase Helper Functions
async function getUsersCache() {
    const users = {};
    const snapshot = await db.collection('users').get();
    snapshot.forEach(doc => {
        users[doc.id] = doc.data();
    });
    return users;
}

async function saveUser(userId, userData) {
    await db.collection('users').doc(userId).set(userData, { merge: true });
}

async function addNotification(userId, message) {
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
        const userData = doc.data();
        const notifications = userData.notifications || [];
        notifications.unshift({ id: Date.now().toString(), message, createdAt: new Date().toISOString() });
        await userRef.update({ notifications });
    }
}

async function addPoints(userId, amount) {
    const userRef = db.collection('users').doc(userId);
    const doc = await userRef.get();
    if (doc.exists) {
        const userData = doc.data();
        const points = Math.min(50, (userData.points || 0) + amount);
        await userRef.update({ points });
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
    let userAvatar = profile.avatar 
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.${profile.avatar.startsWith('a_') ? 'gif' : 'png'}?size=256`
        : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(profile.id) >> 22n) % 6n)}.png`;

    const realUsername = profile.username || profile.global_name || 'User_' + profile.id.slice(-4);
    const isAdmin = profile.id === ADMIN_DISCORD_ID;

    const userRef = db.collection('users').doc(profile.id);
    const doc = await userRef.get();

    let userData;
    if (!doc.exists) {
        userData = {
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
        userData = doc.data();
        userData.username = realUsername;
        userData.avatar = userAvatar;
        userData.isAdmin = isAdmin;
    }

    await userRef.set(userData, { merge: true });
    return done(null, userData);
}));

app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/logout', (req, res) => { req.logout(() => res.redirect('/')); });

app.get('/api/me', async (req, res) => {
    if (!req.isAuthenticated()) return res.json({ authenticated: false });
    const userDoc = await db.collection('users').doc(req.user.id).get();
    if (!userDoc.exists) return res.json({ authenticated: false });
    const user = userDoc.data();
    if (user.banned) { req.logout(() => res.json({ authenticated: false })); return; }
    res.json({ authenticated: true, user });
});

const upload = multer({ dest: os.tmpdir() });

app.post('/api/upload', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'scriptFile', maxCount: 1 }, { name: 'code', maxCount: 1 }]), async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const userDoc = await db.collection('users').doc(req.user.id).get();
    if (!userDoc.exists || userDoc.data().banned) return res.status(403).json({ error: 'Banned' });

    const userData = userDoc.data();
    const { title, description, category, gameLink, hasKeySystem, code: bodyCode } = req.body;
    let scriptContent = bodyCode || '';
    const scriptFile = req.files && req.files['scriptFile'] ? req.files['scriptFile'][0] : null;
    if (scriptFile) {
        try { scriptContent = fs.readFileSync(scriptFile.path, 'utf8'); } catch { scriptContent = '-- Error reading file'; }
    }

    let imageUrl = req.body.image || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600';
    const imageFile = req.files && req.files['image'] ? req.files['image'][0] : null;
    if (imageFile) {
        try {
            const bitmap = fs.readFileSync(imageFile.path);
            imageUrl = `data:${imageFile.mimetype};base64,${bitmap.toString('base64')}`;
        } catch {}
    }

    const newScript = {
        title: title || 'Untitled',
        description: description || 'No description.',
        category: category || 'Roblox',
        gameLink: gameLink || '#',
        hasKeySystem: hasKeySystem === 'on' || hasKeySystem === true || hasKeySystem === 'true',
        image: imageUrl,
        scriptContent: scriptContent,
        code: scriptContent,
        author: { id: req.user.id, username: userData.username, avatar: userData.avatar },
        authorId: req.user.id,
        likes: [],
        comments: [],
        views: 0,
        createdAt: new Date().toISOString()
    };

    const docRef = await db.collection('scripts').add(newScript);
    await addPoints(req.user.id, 15);
    res.json({ success: true, id: docRef.id });
});

app.get('/api/scripts', async (req, res) => {
    const snapshot = await db.collection('scripts').orderBy('createdAt', 'desc').get();
    const scripts = [];
    snapshot.forEach(doc => {
        scripts.push({ id: doc.id, ...doc.data() });
    });
    res.json(scripts);
});

app.get('/api/scripts/:id', async (req, res) => {
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    let script = { id: doc.id, ...doc.data() };

    if (!req.session.viewedScripts) req.session.viewedScripts = [];
    if (!req.session.viewedScripts.includes(script.id)) {
        req.session.viewedScripts.push(script.id);
        script.views = (script.views || 0) + 1;
        await scriptRef.update({ views: script.views });
    }
    res.json(script);
});

app.delete('/api/scripts/:id', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Post not found' });

    const script = doc.data();
    const isOwner = script.authorId === req.user.id || script.author?.id === req.user.id;
    const userDoc = await db.collection('users').doc(req.user.id).get();
    const isAdmin = userDoc.exists && userDoc.data().isAdmin || req.user.id === ADMIN_DISCORD_ID;

    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    await scriptRef.delete();
    res.json({ success: true, message: 'Deleted successfully' });
});

app.post('/api/scripts/:id/like', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    let script = doc.data();
    if (!script.likes) script.likes = [];
    const idx = script.likes.indexOf(req.user.id);
    if (idx > -1) {
        script.likes.splice(idx, 1);
    } else {
        script.likes.push(req.user.id);
        await addPoints(req.user.id, 5);
    }
    await scriptRef.update({ likes: script.likes });
    res.json({ success: true, likes: script.likes.length, id: doc.id, ...script });
});

app.post('/api/scripts/:id/comment', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Empty' });
    
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });

    let script = doc.data();
    if (!script.comments) script.comments = [];
    const userDoc = await db.collection('users').doc(req.user.id).get();
    const currentUser = userDoc.exists ? userDoc.data() : req.user;

    script.comments.push({ 
        id: Date.now().toString(), 
        userId: req.user.id, 
        author: { id: req.user.id, username: currentUser.username, avatar: currentUser.avatar },
        username: currentUser.username, 
        text: text.trim(),
        createdAt: new Date().toISOString()
    });
    
    await scriptRef.update({ comments: script.comments });
    res.json({ success: true, comments: script.comments, id: doc.id, ...script });
});

app.get('/api/users/:id', async (req, res) => {
    const userId = req.params.id;
    const userDoc = await db.collection('users').doc(userId).get();
    let user = userDoc.exists ? userDoc.data() : null;
    
    if (!user) {
        const users = await getUsersCache();
        user = Object.values(users).find(u => u.id == userId || u.username === userId);
    }
    if (!user) return res.status(404).json({ error: 'User not found' });

    const snapshot = await db.collection('scripts').where('authorId', '==', user.id).get();
    const scripts = [];
    snapshot.forEach(doc => scripts.push({ id: doc.id, ...doc.data() }));

    res.json({ user, scripts });
});

app.post('/api/users/bio', async (req, res) => {
    if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
    const { bio } = req.body;
    const userRef = db.collection('users').doc(req.user.id);
    const doc = await userRef.get();
    if (doc.exists) {
        await userRef.update({ bio: bio || '' });
        return res.json({ success: true });
    }
    res.status(404).json({ error: 'User not found' });
});

if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => console.log(`ScriptForExe.net running locally on port ${PORT}`));
}

module.exports = app;
