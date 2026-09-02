require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { stmts, hashToken, newId, newOwnerToken } = require('./db');

const PORT = process.env.PORT || 3000;
const MAX_BODY_LEN = 4000;
const MAX_LIST_LIMIT = 500;
const DEFAULT_LIST_LIMIT = 200;

const VALID_MOODS = new Set([
  'grief', 'gratitude', 'rage', 'wonder', 'longing', 'joy',
  'fear', 'shame', 'relief', 'love', 'confusion', 'peace',
]);

// Canned "nobody" replies, mirroring the frontend's local reply generator.
// Kept server-side too so any client (not just the current frontend) gets a reply.
const REPLIES = {
  grief: ['The void holds that with you.', 'Grief is love with nowhere to land.'],
  gratitude: ['That thankfulness reaches further than you know.', 'Noticed. Held.'],
  rage: ['Your anger is heard. It is allowed here.', 'That truth needed saying.'],
  wonder: ['The world keeps making reasons to stay.', 'Wonder like that is worth keeping.'],
  longing: ['Some words live longer unsaid. This one is safe here.', 'That ache is witnessed.'],
  joy: ['That joy is real. It is recorded now.', 'Nobody heard it. It still counts.'],
  fear: ['Fear named out loud loses some of its grip.', 'You do not have to carry this alone.'],
  shame: ['Brought here, it is already half-forgiven.', 'Said honestly. That takes courage.'],
  relief: ['Nobody is exhaling with you.', 'You made it through. That is real.'],
  love: ['Even held quietly, it is real.', 'That tenderness is not wasted.'],
  confusion: ['Asking the question is its own kind of honest.', 'Unclear is allowed here.'],
  peace: ['It happened. The void witnessed it.', 'That stillness is worth keeping.'],
};

function localReply(mood) {
  const options = REPLIES[mood] || ['The void received this.'];
  return options[Math.floor(Math.random() * options.length)];
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));

const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://letterstonobody.net')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, cb) {
    // allow no-origin requests (curl, server-to-server, some mobile webviews)
    if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
      return cb(null, true);
    }
    return cb(new Error('Not allowed by CORS'));
  },
}));

// Global rate limit
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
}));

// Stricter limit on writes (posting/shredding letters)
const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many letters from this connection. Try again later.' },
});

app.get('/health', (req, res) => {
  res.json({ ok: true, letters: stmts.count.get().c });
});

// List letters — public feed. Optional ?mood=&q=&limit=
app.get('/api/letters', (req, res) => {
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIST_LIMIT;
  limit = Math.min(limit, MAX_LIST_LIMIT);

  const mood = typeof req.query.mood === 'string' ? req.query.mood.trim().toLowerCase() : '';
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (mood && !VALID_MOODS.has(mood)) {
    return res.status(400).json({ error: 'Unknown mood' });
  }

  let rows;
  if (mood && q) {
    rows = stmts.searchByMood.all(mood, `%${q}%`, limit);
  } else if (mood) {
    rows = stmts.listByMood.all(mood, limit);
  } else if (q) {
    rows = stmts.search.all(`%${q}%`, limit);
  } else {
    rows = stmts.listAll.all(limit);
  }

  res.json({ letters: rows.map(toPublicLetter) });
});

// Post a new letter. Returns the letter plus a one-time owner token
// the client must save locally to be able to shred it later.
app.post('/api/letters', writeLimiter, (req, res) => {
  const { mood, body } = req.body || {};

  if (typeof mood !== 'string' || !VALID_MOODS.has(mood)) {
    return res.status(400).json({ error: 'Invalid or missing mood' });
  }
  if (typeof body !== 'string' || !body.trim()) {
    return res.status(400).json({ error: 'Letter body is required' });
  }
  const trimmed = body.trim();
  if (trimmed.length > MAX_BODY_LEN) {
    return res.status(400).json({ error: `Letter is too long (max ${MAX_BODY_LEN} characters)` });
  }

  const id = newId();
  const ownerToken = newOwnerToken();
  const reply = localReply(mood);
  const row = {
    id,
    mood,
    body: trimmed,
    reply,
    owner_token_hash: hashToken(ownerToken),
    created_at: Date.now(),
  };
  stmts.insert.run(row);

  res.status(201).json({
    letter: toPublicLetter(row),
    ownerToken, // client stores this (e.g. localStorage) to be able to shred later
  });
});

// Shred (delete) a letter. Requires the owner token issued at creation time.
app.delete('/api/letters/:id', writeLimiter, (req, res) => {
  const { id } = req.params;
  const ownerToken = req.get('X-Owner-Token') || (req.body && req.body.ownerToken);

  if (!ownerToken) {
    return res.status(401).json({ error: 'Missing owner token' });
  }

  const existing = stmts.getOwnerHash.get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Letter not found' });
  }
  if (existing.owner_token_hash !== hashToken(ownerToken)) {
    return res.status(403).json({ error: 'This letter does not belong to you' });
  }

  stmts.deleteById.run(id);
  res.status(204).end();
});

function toPublicLetter(row) {
  return {
    id: row.id,
    mood: row.mood,
    body: row.body,
    reply: row.reply,
    ts: row.created_at,
  };
}

app.use((err, req, res, next) => {
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Letters to Nobody backend listening on port ${PORT}`);
});
