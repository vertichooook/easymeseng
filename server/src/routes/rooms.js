const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const { validateRoomName } = require('../utils/validators');

const router = express.Router();
router.use(requireAuth);

router.get('/', (_req, res) => {
  res.json({ rooms: q.listRooms.all() });
});

router.post('/', (req, res, next) => {
  try {
    const name = validateRoomName(req.body.name);
    if (!name.ok) return res.status(400).json({ error: name.message });
    if (q.findRoomByName.get(name.value)) return res.status(409).json({ error: 'Комната с таким названием уже есть.' });
    const result = q.createRoom.run(name.value, req.user.id);
    const room = q.findRoomById.get(result.lastInsertRowid);
    req.app.get('io')?.emit('room:created', room);
    res.status(201).json({ room });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/messages', (req, res) => {
  const roomId = Number(req.params.id);
  if (!q.findRoomById.get(roomId)) return res.status(404).json({ error: 'Комната не найдена.' });
  const rows = q.listRoomMessages.all(roomId, req.user.id, 100).reverse();
  res.json({ messages: rows });
});

module.exports = router;
