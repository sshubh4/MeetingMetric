const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'meetingmetric-dev-secret-change-in-production';
const JWT_EXPIRES = '7d';

if (!process.env.JWT_SECRET) {
  console.warn('\x1b[33m⚠  JWT_SECRET not set — using insecure default. Set JWT_SECRET in .env for production.\x1b[0m');
}

function hashPassword(password) {
  return bcrypt.hashSync(password, 10);
}

function verifyPassword(password, hash) {
  return bcrypt.compareSync(password, hash);
}

function createUser(email, password, { fullName, organisation, role } = {}) {
  const password_hash = hashPassword(password);
  const created_at = new Date().toISOString();
  const em = email.toLowerCase().trim();
  const row = db
    .prepare(
      'INSERT INTO users (email, password_hash, created_at, full_name, organisation, role) VALUES (?, ?, ?, ?, ?, ?) RETURNING id'
    )
    .get(em, password_hash, created_at, fullName || null, organisation || null, role || null);
  return { id: row.id, email: em, fullName: fullName || null };
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
}

function signToken(userId, email, extra = {}) {
  return jwt.sign({ sub: userId, email, ...extra }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = verifyToken(h.slice(7));
  if (!payload) return res.status(401).json({ error: 'Invalid token' });
  req.user = { id: payload.sub, email: payload.email };
  next();
}

module.exports = {
  hashPassword,
  verifyPassword,
  createUser,
  getUserByEmail,
  signToken,
  verifyToken,
  authMiddleware,
};
