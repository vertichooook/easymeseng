const crypto = require('crypto');
const config = require('../config');
const q = require('../database/queries');

const COOKIE_NAME = 'messenger_session';
const SESSION_DAYS = 14;

function cookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    signed: true,
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000
  };
}

function createSession(res, userId) {
  const id = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  q.createSession.run(id, userId, expires);
  res.cookie(COOKIE_NAME, id, cookieOptions());
}

function clearSession(req, res) {
  const id = req.signedCookies?.[COOKIE_NAME];
  if (id) q.deleteSession.run(id);
  res.clearCookie(COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
}

function getUserFromRequest(req) {
  const id = req.signedCookies?.[COOKIE_NAME];
  if (!id) return null;
  const row = q.findSession.get(id);
  if (!row || new Date(`${row.expires_at}Z`).getTime() <= Date.now()) {
    if (row) q.deleteSession.run(id);
    return null;
  }
  return { id: row.id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url, created_at: row.created_at };
}

function attachUser(req, _res, next) {
  req.user = getUserFromRequest(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Требуется вход в аккаунт.' });
  return next();
}

module.exports = { COOKIE_NAME, attachUser, requireAuth, createSession, clearSession, getUserFromRequest };
