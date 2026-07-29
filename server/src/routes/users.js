const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const { validateUsername, validateDisplayName } = require('../utils/validators');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const users = q.listVisibleUsersForUser.all(req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id);
  res.json({ users });
});

router.get('/search', (req, res) => {
  const raw = String(req.query.q || '').trim().replace(/^@/, '').toLowerCase();
  if (raw.length < 2) return res.json({ users: [] });
  const users = q.searchUsersByUsername.all(req.user.id, `%${raw}%`, raw);
  res.json({ users });
});

router.patch('/me', (req, res, next) => {
  try {
    const updates = {};

    if (req.body.username !== undefined) {
      const username = validateUsername(req.body.username);
      if (!username.ok) return res.status(400).json({ error: username.message });
      const existing = q.findUserByUsername.get(username.value);
      if (existing && existing.id !== req.user.id) return res.status(409).json({ error: 'Такое имя уже занято.' });
      q.updateUsername.run(username.value, req.user.id);
      updates.username = username.value;
    }

    if (req.body.display_name !== undefined) {
      const displayName = validateDisplayName(req.body.display_name);
      if (!displayName.ok) return res.status(400).json({ error: displayName.message });
      q.updateDisplayName.run(displayName.value, req.user.id);
      updates.display_name = displayName.value;
    }

    if (req.body.avatar_url !== undefined) {
      const avatar = String(req.body.avatar_url || '').trim();
      if (avatar && !/^\/uploads\/[a-zA-Z0-9.-]+$/.test(avatar)) {
        return res.status(400).json({ error: 'Некорректная ссылка на аватар.' });
      }
      q.updateAvatar.run(avatar || null, req.user.id);
      updates.avatar_url = avatar || null;
    }

    const user = q.findUserById.get(req.user.id);
    req.app.get('io')?.emit('user:updated', user);
    res.json({ user, updates });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/mute', (req, res) => {
  const userId = Number(req.params.id);
  if (userId === req.user.id || !q.findUserById.get(userId)) return res.status(404).json({ error: 'Пользователь не найден.' });
  q.muteChat.run(req.user.id, 'user', userId);
  res.json({ ok: true, muted: true });
});

router.delete('/:id/mute', (req, res) => {
  q.unmuteChat.run(req.user.id, 'user', Number(req.params.id));
  res.json({ ok: true, muted: false });
});

module.exports = router;
