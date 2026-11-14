const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const admin = require('firebase-admin');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Required for secure cookies behind Vercel's proxy
app.set('trust proxy', 1);

// ==========================================
// 1. FIREBASE ADMIN INITIALIZATION
// ==========================================
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      // Fix escaped newlines in private_key if pasted into Vercel UI
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://hyperupload-default-rtdb.firebaseio.com"
      });
    } else {
      const serviceAccount = require('./serviceAccountKey.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: "https://hyperupload-default-rtdb.firebaseio.com"
      });
    }
  } catch (err) {
    console.error("Firebase Admin init failed. Check FIREBASE_SERVICE_ACCOUNT env var:", err.message);
  }
}

// Safely get Firestore instance only if Firebase initialized
const db = admin.apps.length ? admin.firestore() : null;

// ==========================================
// 2. CONFIGURATION & MIDDLEWARE
// ==========================================
const ADMIN_ID = '1287363175158644757';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'scriptforexe_super_secret_key',
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000 
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ==========================================
// 3. PASSPORT DISCORD AUTH SETUP
// ==========================================
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const callbackURL = process.env.DISCORD_CALLBACK_URL || 
  (process.env.NODE_ENV === 'production' 
    ? 'https://www.scriptsforexe.net/auth/discord/callback' 
    : 'http://localhost:3000/auth/discord/callback');

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID || '1566401329134436445',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || 'rYUI4pXr5yOb3acLgpmIqwdVldbaPFKf',
    callbackURL: callbackURL,
    scope: ['identify', 'guilds']
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const isAdmin = profile.id === ADMIN_ID;
      const userData = {
        id: profile.id,
        username: profile.username,
        avatar: profile.avatar 
          ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` 
          : 'https://cdn.discordapp.com/embed/avatars/0.png',
        isAdmin: isAdmin,
        lastLogin: admin.firestore.FieldValue.serverTimestamp()
      };

      if (db) {
        await db.collection('users').doc(profile.id).set(userData, { merge: true });
      }
      return done(null, userData);
    } catch (err) {
      return done(err, null);
    }
  }
));

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', 
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => { res.redirect('/'); }
);

app.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect('/');
  });
});

app.get('/api/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ authenticated: true, user: req.user });
  } else {
    res.json({ authenticated: false });
  }
});

// ==========================================
// 4. SCRIPT REPOSITORY API ENDPOINTS (FIRESTORE)
// ==========================================

// Helper middleware to verify DB is connected
const requireDb = (req, res, next) => {
  if (!db) {
    return res.status(500).json({ error: 'Database not configured. Missing FIREBASE_SERVICE_ACCOUNT in Vercel.' });
  }
  next();
};

// Get all scripts
app.get('/api/scripts', requireDb, async (req, res) => {
  try {
    const snapshot = await db.collection('scripts').orderBy('createdAt', 'desc').get();
    const scripts = [];
    snapshot.forEach(doc => {
      scripts.push({ id: doc.id, ...doc.data() });
    });
    res.json(scripts);
  } catch (err) {
    console.error("Error fetching scripts:", err);
    res.status(500).json({ error: 'Failed to fetch scripts' });
  }
});

// Get single script by ID
app.get('/api/scripts/:id', requireDb, async (req, res) => {
  try {
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();
    
    if (!doc.exists) {
      return res.status(404).json({ error: 'Script not found' });
    }

    await scriptRef.update({ views: admin.firestore.FieldValue.increment(1) });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    console.error("Error fetching script detail:", err);
    res.status(500).json({ error: 'Failed to fetch script' });
  }
});

// Upload new script (Requires Authentication)
app.post('/api/upload', requireDb, async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized. Please login with Discord.' });
  }

  const { title, category, description, code } = req.body;
  if (!title || !code) {
    return res.status(400).json({ error: 'Title and code are required fields.' });
  }

  try {
    const newScript = {
      title: title.trim(),
      category: category ? category.trim() : 'Universal',
      description: description ? description.trim() : '',
      code: code.trim(),
      author: {
        id: req.user.id,
        username: req.user.username
      },
      views: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('scripts').add(newScript);
    res.status(201).json({ success: true, id: docRef.id });
  } catch (err) {
    console.error("Error uploading script:", err);
    res.status(500).json({ error: 'Failed to upload script' });
  }
});

// Delete script (Admin or Author only)
app.delete('/api/scripts/:id', requireDb, async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const scriptRef = db.collection('scripts').doc(req.params.id);
    const doc = await scriptRef.get();

    if (!doc.exists) {
      return res.status(404).json({ error: 'Script not found' });
    }

    const scriptData = doc.data();
    const isOwner = scriptData.author && scriptData.author.id === req.user.id;
    const isAdmin = req.user.id === ADMIN_ID || req.user.isAdmin;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: 'Forbidden: You do not have permission to delete this script.' });
    }

    await scriptRef.delete();
    res.json({ success: true });
  } catch (err) {
    console.error("Error deleting script:", err);
    res.status(500).json({ error: 'Failed to delete script' });
  }
});

// Express 5 compatible fallback to index.html for SPA routing
app.get('/{*splat}', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Only run app.listen() when running locally, NOT on Vercel
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Export the Express app for Vercel Serverless Functions
module.exports = app;
