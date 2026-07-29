const cookie = require('cookie');
const signature = require('cookie-signature');
const config = require('../config');
const q = require('../database/queries');
const { COOKIE_NAME } = require('../middleware/auth');

const online = new Map();
const typingTimers = new Map();

function publicUser(user) {
  return { id: user.id, username: user.username, avatar_url: user.avatar_url || null };
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

function normalizeAttachment(attachment) {
  if (!attachment) return { ok: true, value: { url: null, type: null, name: null } };
  const url = String(attachment.url || '').trim();
  const type = String(attachment.type || '').trim();
  const name = String(attachment.name || '').trim().slice(0, 120);
  if (!/^\/uploads\/[a-zA-Z0-9.-]+$/.test(url)) return { ok: false, message: 'Некорректное вложение.' };
  if (!['image', 'video', 'audio'].includes(type)) return { ok: false, message: 'Неподдерживаемый тип вложения.' };
  return { ok: true, value: { url, type, name } };
}

function normalizeBody(body, attachment) {
  const value = String(body || '').trim();
  if (!value && !attachment?.url) return { ok: false, message: 'Сообщение не может быть пустым.' };
  if (value.length > config.maxMessageLength) return { ok: false, message: `Сообщение не длиннее ${config.maxMessageLength} символов.` };
  return { ok: true, value };
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

    socket.on('message:send', ({ roomId, body, attachment }, ack) => {
      const id = Number(roomId);
      if (!q.findRoomById.get(id)) return ack?.({ error: 'Комната не найдена.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const result = q.insertMessage.run(id, userId, message.value, file.value.url, file.value.type, file.value.name);
      const saved = q.findMessageById.get(result.lastInsertRowid);
      io.to(`room:${id}`).emit('message:new', saved);
      return ack?.({ ok: true, message: saved });
    });

    socket.on('private:send', ({ receiverId, body, attachment }, ack) => {
      const targetId = Number(receiverId);
      if (targetId === userId || !q.findUserById.get(targetId)) return ack?.({ error: 'Пользователь не найден.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const result = q.insertPrivateMessage.run(userId, targetId, message.value, file.value.url, file.value.type, file.value.name);
      const saved = q.findPrivateMessageById.get(result.lastInsertRowid);
      io.to(`user:${userId}`).to(`user:${targetId}`).emit('private:new', saved);
      return ack?.({ ok: true, message: saved });
    });

    socket.on('message:delete', ({ chatType, messageId, mode }, ack) => {
      const id = Number(messageId);
      const deleteForAll = mode === 'all';

      if (chatType === 'room') {
        const message = q.findMessageById.get(id);
        if (!message) return ack?.({ error: 'Сообщение не найдено.' });
        if (deleteForAll) {
          if (message.user_id !== userId) return ack?.({ error: 'Можно удалить у всех только своё сообщение.' });
          q.deleteRoomMessageForAll.run(userId, id);
          const deleted = q.findMessageById.get(id);
          io.to(`room:${message.room_id}`).emit('message:deleted', { chatType: 'room', message: deleted });
          return ack?.({ ok: true });
        }
        q.hideMessageForUser.run(userId, 'room', id);
        return ack?.({ ok: true, hidden: true, chatType: 'room', messageId: id });
      }

      if (chatType === 'private') {
        const message = q.findPrivateMessageById.get(id);
        if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) {
          return ack?.({ error: 'Сообщение не найдено.' });
        }
        if (deleteForAll) {
          if (message.sender_id !== userId) return ack?.({ error: 'Можно удалить у всех только своё сообщение.' });
          q.deletePrivateMessageForAll.run(userId, id);
          const deleted = q.findPrivateMessageById.get(id);
          io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:deleted', { chatType: 'private', message: deleted });
          return ack?.({ ok: true });
        }
        q.hideMessageForUser.run(userId, 'private', id);
        return ack?.({ ok: true, hidden: true, chatType: 'private', messageId: id });
      }

      return ack?.({ error: 'Неизвестный тип чата.' });
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
