const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin Discord ID
const ADMIN_ID = '1287363175158644757';

// Data storage files
const SCRIPTS_FILE = path.join(__dirname, 'scripts_data.json');

// Ensure data file exists
if (!fs.existsSync(SCRIPTS_FILE)) {
  fs.writeFileSync(SCRIPTS_FILE, JSON.stringify([], null, 2));
}

// Helper functions for local JSON storage
function getScripts() {
  try {
    const data = fs.readFileSync(SCRIPTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
}

function saveScripts(scripts) {
  fs.writeFileSync(SCRIPTS_FILE, JSON.stringify(scripts, null, 2));
}

// Configure Multer for local file & photo uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'public', 'uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'scriptforexe_super_secret_keyboard_cat',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

// Passport Discord Strategy
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.DISCORD_CLIENT_ID || 'YOUR_CLIENT_ID',
    clientSecret: process.env.DISCORD_CLIENT_SECRET || 'YOUR_CLIENT_SECRET',
    callbackURL: process.env.DISCORD_CALLBACK_URL || 'http://localhost:3000/auth/discord/callback',
    scope: ['identify', 'guilds']
  },
  async (accessToken, refreshToken, profile, done) => {
    const isAdmin = profile.id === ADMIN_ID;
    const user = {
      id: profile.id,
      username: profile.username,
      avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
      isAdmin: isAdmin
    };
    return done(null, user);
  }
));

// Auth Routes
app.get('/auth/discord', passport.authenticate('discord'));
app.get('/auth/discord/callback', 
  passport.authenticate('discord', { failureRedirect: '/' }),
  (req, res) => { res.redirect('/'); }
);

app.get('/logout', (req, res) => {
  req.logout(() => {
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

// API Routes for Scripts
app.get('/api/scripts', (req, res) => {
  const scripts = getScripts();
  res.json(scripts);
});

app.get('/api/scripts/:id', (req, res) => {
  const scripts = getScripts();
  const script = scripts.find(s => s.id === req.params.id);
  if (!script) {
    return res.status(404).json({ error: 'Script not found' });
  }
  script.views = (script.views || 0) + 1;
  saveScripts(scripts);
  res.json(script);
});

// Upload endpoint handling both script file & image thumbnail from computer
app.post('/api/upload', upload.fields([
  { name: 'scriptFile', maxCount: 1 },
  { name: 'thumbnail', maxCount: 1 }
]), (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized. Please login with Discord.' });
  }

  const { title, category, description, codeText } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required.' });
  }

  let finalCode = codeText ? codeText.trim() : '';
  
  // If a script file was uploaded from the computer, read its contents
  if (req.files && req.files['scriptFile'] && req.files['scriptFile'][0]) {
    const filePath = req.files['scriptFile'][0].path;
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      if (fileContent) {
        finalCode = fileContent;
      }
    } catch (e) {
      console.error("Error reading uploaded script file:", e);
    }
  }

  let thumbnailUrl = '';
  if (req.files && req.files['thumbnail'] && req.files['thumbnail'][0]) {
    thumbnailUrl = `/uploads/${req.files['thumbnail'][0].filename}`;
  }

  const scripts = getScripts();
  const newScript = {
    id: Date.now().toString(),
    title: title.trim(),
    category: category ? category.trim() : 'Universal',
    description: description ? description.trim() : '',
    code: finalCode,
    thumbnail: thumbnailUrl,
    author: {
      id: req.user.id,
      username: req.user.username
    },
    views: 0,
    createdAt: new Date().toISOString()
  };

  scripts.unshift(newScript);
  saveScripts(scripts);

  res.status(201).json({ success: true, id: newScript.id });
});

// Delete script
app.delete('/api/scripts/:id', (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let scripts = getScripts();
  const script = scripts.find(s => s.id === req.params.id);
  if (!script) {
    return res.status(404).json({ error: 'Script not found' });
  }

  const isOwner = script.author && script.author.id === req.user.id;
  const isAdmin = req.user.id === ADMIN_ID || req.user.isAdmin;

  if (!isOwner && !isAdmin) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  scripts = scripts.filter(s => s.id !== req.params.id);
  saveScripts(scripts);
  res.json({ success: true });
});

// SPA routing fallbacks
app.get('/upload', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'upload.html'));
});

app.get('/script/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'page.html'));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ScriptForExe server running on port ${PORT}`);
});
