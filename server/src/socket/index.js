const cookie = require('cookie');
const signature = require('cookie-signature');
const config = require('../config');
const q = require('../database/queries');
const { COOKIE_NAME } = require('../middleware/auth');

const online = new Map();
const typingTimers = new Map();

const publicUser = (user) => ({ id: user.id, username: user.username, display_name: user.display_name, avatar_url: user.avatar_url || null });
const onlinePayload = () => Array.from(online.values()).map((entry) => publicUser(entry.user));

function parseSignedCookie(socket) {
  const parsed = cookie.parse(socket.handshake.headers.cookie || '');
  const raw = parsed[COOKIE_NAME];
  if (!raw || !raw.startsWith('s:')) return null;
  return signature.unsign(raw.slice(2), config.sessionSecret) || null;
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

function canAccessRoom(roomId, userId) {
  return Boolean(q.findRoomMember.get(roomId, userId));
}

function replyPreview(replyTo, chatType, userId) {
  const id = Number(replyTo?.messageId);
  if (!id) return { id: null, author: null, body: null };
  if (chatType === 'room') {
    const message = q.findMessageById.get(id);
    if (!message || !canAccessRoom(message.room_id, userId)) return { id: null, author: null, body: null };
    return { id, author: message.username, body: (message.body || message.attachment_name || 'медиа').slice(0, 140) };
  }
  const message = q.findPrivateMessageById.get(id);
  if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) return { id: null, author: null, body: null };
  return { id, author: message.sender_username, body: (message.body || message.attachment_name || 'медиа').slice(0, 140) };
}

function mentionIds(body) {
  const names = [...new Set(String(body || '').match(/@[a-z0-9_]{3,32}/gi) || [])]
    .map((item) => item.slice(1).toLowerCase());
  return names.map((name) => q.findUserByUsername.get(name)?.id).filter(Boolean);
}

function notifyMentions(io, sender, body, chat) {
  for (const id of mentionIds(body)) {
    if (id === sender.id) continue;
    const muteType = chat.type === 'room' ? 'room' : 'user';
    const muteId = chat.type === 'room' ? chat.id : sender.id;
    if (q.findMutedChat.get(id, muteType, muteId)) continue;
    io.to(`user:${id}`).emit('notification:new', {
      title: `Вас упомянул ${sender.username}`,
      body: String(body || '').slice(0, 120),
      chat
    });
  }
}

function socketAuth(socket, next) {
  try {
    const sessionId = parseSignedCookie(socket);
    if (!sessionId) return next(new Error('Требуется вход в аккаунт.'));
    const row = q.findSession.get(sessionId);
    if (!row || new Date(`${row.expires_at}Z`).getTime() <= Date.now()) return next(new Error('Сессия истекла.'));
    socket.user = { id: row.id, username: row.username, display_name: row.display_name, avatar_url: row.avatar_url };
    return next();
  } catch (error) {
    return next(error);
  }
}

function emitPrivate(io, userId, targetId, message) {
  io.to(`user:${userId}`).to(`user:${targetId}`).emit('private:new', message);
}

function registerSocket(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const existing = online.get(userId) || { user: socket.user, sockets: new Set() };
    existing.user = socket.user;
    existing.sockets.add(socket.id);
    online.set(userId, existing);
    socket.join(`user:${userId}`);
    io.emit('presence:update', onlinePayload());
    console.log(`Socket connected user=${socket.user.username}`);

    socket.on('room:join', ({ roomId }, ack) => {
      const id = Number(roomId);
      if (!q.findRoomById.get(id)) return ack?.({ error: 'Комната не найдена.' });
      if (!canAccessRoom(id, userId)) return ack?.({ error: 'Нет доступа к комнате.' });
      socket.join(`room:${id}`);
      return ack?.({ ok: true });
    });

    socket.on('room:leave', ({ roomId }) => socket.leave(`room:${Number(roomId)}`));

    socket.on('message:send', ({ roomId, body, attachment, replyTo }, ack) => {
      const id = Number(roomId);
      if (!q.findRoomById.get(id)) return ack?.({ error: 'Комната не найдена.' });
      if (!canAccessRoom(id, userId)) return ack?.({ error: 'Нет доступа к комнате.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const reply = replyPreview(replyTo, 'room', userId);
      const result = q.insertMessage.run(id, userId, message.value, file.value.url, file.value.type, file.value.name, reply.id, reply.author, reply.body, null, null);
      const saved = q.findMessageById.get(result.lastInsertRowid);
      io.to(`room:${id}`).emit('message:new', saved);
      notifyMentions(io, socket.user, message.value, { type: 'room', id });
      return ack?.({ ok: true, message: saved });
    });

    socket.on('private:send', ({ receiverId, body, attachment, replyTo }, ack) => {
      const targetId = Number(receiverId);
      if (targetId === userId || !q.findUserById.get(targetId)) return ack?.({ error: 'Пользователь не найден.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const reply = replyPreview(replyTo, 'private', userId);
      const result = q.insertPrivateMessage.run(userId, targetId, message.value, file.value.url, file.value.type, file.value.name, reply.id, reply.author, reply.body, null, null);
      const saved = q.findPrivateMessageById.get(result.lastInsertRowid);
      emitPrivate(io, userId, targetId, saved);
      if (!q.findMutedChat.get(targetId, 'user', userId)) {
        io.to(`user:${targetId}`).emit('notification:new', { title: `Сообщение от ${socket.user.username}`, body: message.value.slice(0, 120), chat: { type: 'private', id: userId } });
      }
      notifyMentions(io, socket.user, message.value, { type: 'private', id: userId });
      return ack?.({ ok: true, message: saved });
    });

    socket.on('message:forward', ({ chatType, messageId, targets }, ack) => {
      const source = chatType === 'room' ? q.findMessageById.get(Number(messageId)) : q.findPrivateMessageById.get(Number(messageId));
      if (!source || source.deleted_at) return ack?.({ error: 'Сообщение не найдено.' });
      if (chatType === 'room' && !canAccessRoom(source.room_id, userId)) return ack?.({ error: 'Нет доступа к исходному сообщению.' });
      if (chatType === 'private' && source.sender_id !== userId && source.receiver_id !== userId) return ack?.({ error: 'Нет доступа к исходному сообщению.' });

      const author = chatType === 'room' ? source.username : source.sender_username;
      const preview = (source.body || source.attachment_name || 'медиа').slice(0, 140);
      for (const target of Array.isArray(targets) ? targets.slice(0, 10) : []) {
        if (target.type === 'room') {
          const roomId = Number(target.id);
          if (!canAccessRoom(roomId, userId)) continue;
          const result = q.insertMessage.run(roomId, userId, source.body || '', source.attachment_url, source.attachment_type, source.attachment_name, null, null, null, author, preview);
          io.to(`room:${roomId}`).emit('message:new', q.findMessageById.get(result.lastInsertRowid));
        }
        if (target.type === 'private') {
          const receiverId = Number(target.id);
          if (receiverId === userId || !q.findUserById.get(receiverId)) continue;
          const result = q.insertPrivateMessage.run(userId, receiverId, source.body || '', source.attachment_url, source.attachment_type, source.attachment_name, null, null, null, author, preview);
          emitPrivate(io, userId, receiverId, q.findPrivateMessageById.get(result.lastInsertRowid));
        }
      }
      return ack?.({ ok: true });
    });

    socket.on('message:delete', ({ chatType, messageId, mode }, ack) => {
      const id = Number(messageId);
      if (chatType === 'room') {
        const message = q.findMessageById.get(id);
        if (!message || !canAccessRoom(message.room_id, userId)) return ack?.({ error: 'Сообщение не найдено.' });
        if (mode === 'all') {
          if (message.user_id !== userId) return ack?.({ error: 'Можно удалить у всех только своё сообщение.' });
          q.deleteRoomMessageForAll.run(userId, id);
          io.to(`room:${message.room_id}`).emit('message:removed', { chatType: 'room', messageId: id, roomId: message.room_id });
          return ack?.({ ok: true });
        }
        q.hideMessageForUser.run(userId, 'room', id);
        return ack?.({ ok: true, hidden: true, chatType: 'room', messageId: id });
      }

      if (chatType === 'private') {
        const message = q.findPrivateMessageById.get(id);
        if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) return ack?.({ error: 'Сообщение не найдено.' });
        if (mode === 'all') {
          if (message.sender_id !== userId) return ack?.({ error: 'Можно удалить у всех только своё сообщение.' });
          q.deletePrivateMessageForAll.run(userId, id);
          io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:removed', { chatType: 'private', messageId: id });
          return ack?.({ ok: true });
        }
        q.hideMessageForUser.run(userId, 'private', id);
        return ack?.({ ok: true, hidden: true, chatType: 'private', messageId: id });
      }

      return ack?.({ error: 'Неизвестный тип чата.' });
    });

    socket.on('typing:start', ({ chatType, chatId }) => {
      const targetId = Number(chatId);
      const payload = { user: publicUser(socket.user), chatType, chatId: targetId, fromUserId: userId, toUserId: targetId };
      if (chatType === 'room' && canAccessRoom(chatId, userId)) socket.to(`room:${Number(chatId)}`).emit('typing:update', { ...payload, typing: true });
      if (chatType === 'private' && targetId !== userId && q.findUserById.get(targetId)) socket.to(`user:${targetId}`).emit('typing:update', { ...payload, typing: true });
      const key = `${socket.id}:${chatType}:${chatId}`;
      clearTimeout(typingTimers.get(key));
      typingTimers.set(key, setTimeout(() => {
        if (chatType === 'room') socket.to(`room:${targetId}`).emit('typing:update', { ...payload, typing: false });
        if (chatType === 'private') socket.to(`user:${targetId}`).emit('typing:update', { ...payload, typing: false });
        typingTimers.delete(key);
      }, 2500));
    });

    socket.on('typing:stop', ({ chatType, chatId }) => {
      const targetId = Number(chatId);
      const payload = { user: publicUser(socket.user), chatType, chatId: targetId, fromUserId: userId, toUserId: targetId, typing: false };
      if (chatType === 'room') socket.to(`room:${targetId}`).emit('typing:update', payload);
      if (chatType === 'private') socket.to(`user:${targetId}`).emit('typing:update', payload);
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
