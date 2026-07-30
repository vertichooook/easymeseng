const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const { validateRoomName } = require('../utils/validators');
const { decorateMessages } = require('../utils/reactions');

const router = express.Router();
router.use(requireAuth);

function canAccessRoom(roomId, userId) {
  return Boolean(q.findRoomMember.get(roomId, userId));
}

function isRoomAdmin(room, userId) {
  const member = q.findRoomMember.get(room.id, userId);
  return room.created_by === userId || member?.role === 'admin';
}

router.get('/', (req, res) => {
  res.json({ rooms: q.listRoomsForUser.all(req.user.id, req.user.id) });
});

router.post('/', (req, res, next) => {
  try {
    const name = validateRoomName(req.body.name);
    if (!name.ok) return res.status(400).json({ error: name.message });
    if (q.findRoomByName.get(name.value)) return res.status(409).json({ error: 'Комната с таким названием уже есть.' });
    const result = q.createRoom.run(name.value, req.user.id);
    const room = q.findRoomById.get(result.lastInsertRowid);
    q.addRoomAdmin.run(room.id, req.user.id);
    req.app.get('io')?.to(`user:${req.user.id}`).emit('room:created', { ...room, role: 'admin', muted: 0 });
    res.status(201).json({ room: { ...room, role: 'admin', muted: 0 } });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/messages', (req, res) => {
  const roomId = Number(req.params.id);
  if (!q.findRoomById.get(roomId)) return res.status(404).json({ error: 'Комната не найдена.' });
  if (!canAccessRoom(roomId, req.user.id)) return res.status(403).json({ error: 'Нет доступа к комнате.' });
  const rows = q.listRoomMessages.all(roomId, req.user.id, 100).reverse();
  res.json({ messages: decorateMessages(rows, 'room', req.user.id) });
});

router.get('/:id/members', (req, res) => {
  const roomId = Number(req.params.id);
  if (!canAccessRoom(roomId, req.user.id)) return res.status(403).json({ error: 'Нет доступа к комнате.' });
  res.json({ members: q.listRoomMembers.all(roomId) });
});

router.patch('/:id', (req, res) => {
  const roomId = Number(req.params.id);
  const room = q.findRoomById.get(roomId);
  if (!room) return res.status(404).json({ error: 'Комната не найдена.' });
  if (!isRoomAdmin(room, req.user.id)) return res.status(403).json({ error: 'Изменять комнату может только админ.' });
  if (req.body.avatar_url !== undefined) {
    const avatar = String(req.body.avatar_url || '').trim();
    if (avatar && !/^\/uploads\/[a-zA-Z0-9.-]+$/.test(avatar)) return res.status(400).json({ error: 'Некорректная ссылка на аватар.' });
    q.updateRoomAvatar.run(avatar || null, roomId);
  }
  const updated = q.findRoomById.get(roomId);
  req.app.get('io')?.to(`room:${roomId}`).emit('room:updated', updated);
  res.json({ room: updated });
});

router.post('/:id/invite', (req, res) => {
  const roomId = Number(req.params.id);
  const userId = Number(req.body.userId);
  const room = q.findRoomById.get(roomId);
  if (!room) return res.status(404).json({ error: 'Комната не найдена.' });
  if (!isRoomAdmin(room, req.user.id)) return res.status(403).json({ error: 'Приглашать может только админ комнаты.' });
  const user = q.findUserById.get(userId);
  if (!user) return res.status(404).json({ error: 'Пользователь не найден.' });
  q.addRoomMember.run(roomId, userId);
  const inviter = q.findUserById.get(req.user.id);
  const body = `${inviter.display_name || inviter.username} пригласил вас в комнату #${room.name}`;
  const result = q.insertPrivateMessage.run(req.user.id, userId, `[Система] ${body}`, null, null, null, null, null, null, null, null);
  const saved = q.findPrivateMessageById.get(result.lastInsertRowid);
  req.app.get('io')?.to(`user:${req.user.id}`).to(`user:${userId}`).emit('private:new', saved);
  req.app.get('io')?.to(`user:${userId}`).emit('room:created', { ...room, role: 'member', muted: 0 });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const roomId = Number(req.params.id);
  const room = q.findRoomById.get(roomId);
  if (!room || room.id === 1) return res.status(404).json({ error: 'Комнату нельзя удалить.' });
  if (!isRoomAdmin(room, req.user.id)) return res.status(403).json({ error: 'Удалить комнату может только админ.' });
  q.deleteRoom.run(roomId);
  req.app.get('io')?.emit('room:deleted', { roomId });
  res.json({ ok: true });
});

router.post('/:id/mute', (req, res) => {
  const roomId = Number(req.params.id);
  if (!canAccessRoom(roomId, req.user.id)) return res.status(403).json({ error: 'Нет доступа к комнате.' });
  q.muteChat.run(req.user.id, 'room', roomId);
  res.json({ ok: true, muted: true });
});

router.delete('/:id/mute', (req, res) => {
  q.unmuteChat.run(req.user.id, 'room', Number(req.params.id));
  res.json({ ok: true, muted: false });
});

module.exports = router;
