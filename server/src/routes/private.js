const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/:userId/messages', (req, res) => {
  const otherId = Number(req.params.userId);
  if (!q.findUserById.get(otherId)) return res.status(404).json({ error: 'Пользователь не найден.' });
  const rows = q.listPrivateMessages.all(req.user.id, otherId, otherId, req.user.id, req.user.id, 100).reverse();
  res.json({ messages: rows });
});

module.exports = router;
