const express = require('express');
const bcrypt = require('bcryptjs');
const q = require('../database/queries');
const { createSession, clearSession, requireAuth } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimits');
const { validateUsername, validatePassword } = require('../utils/validators');

const router = express.Router();

router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    const password = validatePassword(req.body.password);
    if (!username.ok) return res.status(400).json({ error: username.message });
    if (!password.ok) return res.status(400).json({ error: password.message });
    if (q.findUserByUsername.get(username.value)) return res.status(409).json({ error: 'Такое имя уже занято.' });

    const hash = await bcrypt.hash(req.body.password, 12);
    const result = q.createUser.run(username.value, hash);
    createSession(res, result.lastInsertRowid);
    return res.status(201).json({ user: q.findUserById.get(result.lastInsertRowid) });
  } catch (error) {
    return next(error);
  }
});

router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const username = validateUsername(req.body.username);
    if (!username.ok) return res.status(400).json({ error: 'Неверное имя пользователя или пароль.' });
    const user = q.findUserByUsername.get(username.value);
    const valid = user && await bcrypt.compare(String(req.body.password || ''), user.password_hash);
    if (!valid) {
      console.warn(`Failed login for username=${username.value}`);
      return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
    }
    createSession(res, user.id);
    return res.json({ user: q.findUserById.get(user.id) });
  } catch (error) {
    return next(error);
  }
});

router.post('/logout', requireAuth, (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
