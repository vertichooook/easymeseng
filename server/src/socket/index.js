const cookie = require('cookie');
const signature = require('cookie-signature');
const config = require('../config');
const q = require('../database/queries');
const { COOKIE_NAME } = require('../middleware/auth');
const { validateMessage } = require('../utils/validators');

const online = new Map();
const typingTimers = new Map();

function publicUser(user) {
  return { id: user.id, username: user.username };
}

function onlinePayload() {
  return Array.from(online.values()).map((entry) => publicUser(entry.user));
}

function parseSignedCookie(socket) {
  const header = socket.handshake.headers.cookie || '';
  const parsed = cookie.parse(header);
  const raw = parsed[COOKIE_NAME];
  if (!raw || !raw.startsWith('s:')) return null;
  const unsigned = signature.unsign(raw.slice(2), config.sessionSecret);
  return unsigned || null;
}

function socketAuth(socket, next) {
  try {
    const sessionId = parseSignedCookie(socket);
    if (!sessionId) return next(new Error('Требуется вход в аккаунт.'));
    const row = q.findSession.get(sessionId);
    if (!row || new Date(`${row.expires_at}Z`).getTime() <= Date.now()) return next(new Error('Сессия истекла.'));
    socket.user = { id: row.id, username: row.username };
    return next();
  } catch (error) {
    return next(error);
  }
}

function registerSocket(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const existing = online.get(userId) || { user: socket.user, sockets: new Set() };
    existing.sockets.add(socket.id);
    online.set(userId, existing);
    socket.join(`user:${userId}`);
    io.emit('presence:update', onlinePayload());
    console.log(`Socket connected user=${socket.user.username}`);

    socket.on('room:join', ({ roomId }, ack) => {
      const id = Number(roomId);
      const room = q.findRoomById.get(id);
      if (!room) return ack?.({ error: 'Комната не найдена.' });
      q.addRoomMember.run(id, userId);
      socket.join(`room:${id}`);
      return ack?.({ ok: true });
    });

    socket.on('room:leave', ({ roomId }) => {
      socket.leave(`room:${Number(roomId)}`);
    });

    socket.on('message:send', ({ roomId, body }, ack) => {
      const id = Number(roomId);
      if (!q.findRoomById.get(id)) return ack?.({ error: 'Комната не найдена.' });
      const message = validateMessage(body);
      if (!message.ok) return ack?.({ error: message.message });
      const result = q.insertMessage.run(id, userId, message.value);
      const saved = q.findMessageById.get(result.lastInsertRowid);
      io.to(`room:${id}`).emit('message:new', saved);
      return ack?.({ ok: true, message: saved });
    });

    socket.on('private:send', ({ receiverId, body }, ack) => {
      const targetId = Number(receiverId);
      if (targetId === userId || !q.findUserById.get(targetId)) return ack?.({ error: 'Пользователь не найден.' });
      const message = validateMessage(body);
      if (!message.ok) return ack?.({ error: message.message });
      const result = q.insertPrivateMessage.run(userId, targetId, message.value);
      const saved = q.findPrivateMessageById.get(result.lastInsertRowid);
      io.to(`user:${userId}`).to(`user:${targetId}`).emit('private:new', saved);
      return ack?.({ ok: true, message: saved });
    });

    socket.on('typing:start', ({ chatType, chatId }) => {
      const payload = { user: publicUser(socket.user), chatType, chatId: Number(chatId) };
      if (chatType === 'room') socket.to(`room:${Number(chatId)}`).emit('typing:update', { ...payload, typing: true });
      if (chatType === 'private') socket.to(`user:${Number(chatId)}`).emit('typing:update', { ...payload, typing: true });
      const key = `${socket.id}:${chatType}:${chatId}`;
      clearTimeout(typingTimers.get(key));
      typingTimers.set(key, setTimeout(() => {
        if (chatType === 'room') socket.to(`room:${Number(chatId)}`).emit('typing:update', { ...payload, typing: false });
        if (chatType === 'private') socket.to(`user:${Number(chatId)}`).emit('typing:update', { ...payload, typing: false });
        typingTimers.delete(key);
      }, 2500));
    });

    socket.on('typing:stop', ({ chatType, chatId }) => {
      const payload = { user: publicUser(socket.user), chatType, chatId: Number(chatId), typing: false };
      if (chatType === 'room') socket.to(`room:${Number(chatId)}`).emit('typing:update', payload);
      if (chatType === 'private') socket.to(`user:${Number(chatId)}`).emit('typing:update', payload);
    });

    socket.on('disconnect', () => {
      const entry = online.get(userId);
      if (entry) {
        entry.sockets.delete(socket.id);
        if (!entry.sockets.size) online.delete(userId);
      }
      io.emit('presence:update', onlinePayload());
      console.log(`Socket disconnected user=${socket.user.username}`);
    });
  });
}

module.exports = { registerSocket };
