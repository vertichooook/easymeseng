const express = require('express');
const crypto = require('crypto');
const config = require('../config');
const q = require('../database/queries');
const { generateRegistrationCode } = require('../database/db');
const { authLimiter } = require('../middleware/rateLimits');

const router = express.Router();
const ADMIN_COOKIE = 'nexus_admin';

function adminCookieOptions() {
  return {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    signed: true,
    path: '/',
    maxAge: 6 * 60 * 60 * 1000
  };
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function requireAdmin(req, res, next) {
  if (!config.adminPassword) return res.status(503).json({ error: 'Админ-пароль не настроен на сервере.' });
  if (req.signedCookies?.[ADMIN_COOKIE] !== 'ok') return res.status(401).json({ error: 'Требуется вход администратора.' });
  return next();
}

function createUniqueCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = generateRegistrationCode();
    if (!q.findRegistrationCode.get(code)) return code;
  }
  throw new Error('Не удалось сгенерировать уникальный код.');
}

router.post('/login', authLimiter, (req, res) => {
  if (!config.adminPassword) return res.status(503).json({ error: 'ADMIN_PASSWORD не задан в .env.' });
  if (!safeEqual(req.body.password, config.adminPassword)) return res.status(401).json({ error: 'Неверный пароль администратора.' });
  res.cookie(ADMIN_COOKIE, 'ok', adminCookieOptions());
  return res.json({ ok: true });
});

router.post('/logout', requireAdmin, (_req, res) => {
  res.clearCookie(ADMIN_COOKIE, { ...adminCookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

router.get('/codes', requireAdmin, (_req, res) => {
  res.json({ codes: q.listRegistrationCodes.all() });
});

router.post('/codes', requireAdmin, (_req, res) => {
  const code = createUniqueCode();
  q.createRegistrationCode.run(code);
  res.status(201).json({ code });
});

module.exports = router;
