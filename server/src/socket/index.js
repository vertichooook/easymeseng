const cookie = require('cookie');
const signature = require('cookie-signature');
const config = require('../config');
const q = require('../database/queries');
const { COOKIE_NAME } = require('../middleware/auth');
const push = require('../utils/push');
const { allowedReactions, decorateMessage, reactionPayload } = require('../utils/reactions');
const { privateChatKey, pinnedPayload } = require('../utils/pins');

const online = new Map();
const typingTimers = new Map();
const callTimers = new Map();

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
    if (isUserActive(id)) continue;
    io.to(`user:${id}`).emit('notification:new', {
      title: `Вас упомянул ${sender.username}`,
      body: String(body || '').slice(0, 120),
      chat
    });
  }
}

function isUserActive(userId) {
  return Boolean(online.get(userId)?.active);
}

function queuePush(userId, payload) {
  if (isUserActive(userId)) return;
  push.sendPushToUser(userId, payload).catch((error) => {
    console.error('Web Push queue failed:', error.message);
  });
}

function notifyRoomPushes(sender, roomId, roomName, message) {
  for (const member of q.listRoomMembers.all(roomId)) {
    if (member.id === sender.id) continue;
    if (q.findMutedChat.get(member.id, 'room', roomId)) continue;
    queuePush(member.id, {
      title: `# ${roomName || 'room'}`,
      body: `${sender.display_name || sender.username}: ${push.compactBody(message)}`,
      url: `/?chat=room-${roomId}`,
      tag: `room-${roomId}`,
      chat: { type: 'room', id: roomId }
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

function callIdFor(a, b) {
  const left = Number(a);
  const right = Number(b);
  return `call:${Math.min(left, right)}:${Math.max(left, right)}:${Date.now().toString(36)}`;
}

function canSignalCall(fromUserId, toUserId) {
  const targetId = Number(toUserId);
  return targetId && targetId !== fromUserId && Boolean(q.findUserById.get(targetId));
}

function relayCall(io, socket, eventName, payload = {}, ack) {
  const targetId = Number(payload.to);
  if (!canSignalCall(socket.user.id, targetId)) return ack?.({ error: 'Пользователь не найден.' });
  io.to(`user:${targetId}`).emit(eventName, {
    ...payload,
    from: socket.user.id,
    user: publicUser(socket.user)
  });
  return ack?.({ ok: true });
}

function registerSocket(io) {
  io.use(socketAuth);

  io.on('connection', (socket) => {
    const userId = socket.user.id;
    const existing = online.get(userId) || { user: socket.user, sockets: new Set() };
    existing.user = socket.user;
    existing.sockets.add(socket.id);
    existing.activeSockets = existing.activeSockets || new Set();
    existing.activeSockets.add(socket.id);
    existing.active = true;
    online.set(userId, existing);
    socket.join(`user:${userId}`);
    io.emit('presence:update', onlinePayload());
    console.log(`Socket connected user=${socket.user.username}`);

    socket.on('room:join', ({ roomId }, ack) => {
      const id = Number(roomId);
      const room = q.findRoomById.get(id);
      if (!room) return ack?.({ error: 'Комната не найдена.' });
      if (!canAccessRoom(id, userId)) return ack?.({ error: 'Нет доступа к комнате.' });
      socket.join(`room:${id}`);
      return ack?.({ ok: true });
    });

    socket.on('room:leave', ({ roomId }) => socket.leave(`room:${Number(roomId)}`));

    socket.on('message:send', ({ roomId, body, attachment, replyTo }, ack) => {
      const id = Number(roomId);
      const room = q.findRoomById.get(id);
      if (!room) return ack?.({ error: 'Комната не найдена.' });
      if (!canAccessRoom(id, userId)) return ack?.({ error: 'Нет доступа к комнате.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const reply = replyPreview(replyTo, 'room', userId);
      const result = q.insertMessage.run(id, userId, message.value, file.value.url, file.value.type, file.value.name, reply.id, reply.author, reply.body, null, null);
      const saved = decorateMessage(q.findMessageById.get(result.lastInsertRowid), 'room', userId);
      io.to(`room:${id}`).emit('message:new', saved);
      notifyMentions(io, socket.user, message.value, { type: 'room', id });
      notifyRoomPushes(socket.user, id, room.name, saved);
      return ack?.({ ok: true, message: saved });
    });

    socket.on('private:send', ({ receiverId, body, attachment, replyTo }, ack) => {
      const targetId = Number(receiverId);
      const target = q.findUserById.get(targetId);
      if (targetId === userId || !target) return ack?.({ error: 'Пользователь не найден.' });
      const file = normalizeAttachment(attachment);
      if (!file.ok) return ack?.({ error: file.message });
      const message = normalizeBody(body, file.value);
      if (!message.ok) return ack?.({ error: message.message });
      const reply = replyPreview(replyTo, 'private', userId);
      const result = q.insertPrivateMessage.run(userId, targetId, message.value, file.value.url, file.value.type, file.value.name, reply.id, reply.author, reply.body, null, null);
      const saved = decorateMessage(q.findPrivateMessageById.get(result.lastInsertRowid), 'private', userId);
      emitPrivate(io, userId, targetId, saved);
      if (!q.findMutedChat.get(targetId, 'user', userId) && !isUserActive(targetId)) {
        io.to(`user:${targetId}`).emit('notification:new', { title: `Сообщение от ${socket.user.username}`, body: message.value.slice(0, 120), chat: { type: 'private', id: userId } });
      }
      if (!q.findMutedChat.get(targetId, 'user', userId)) {
        queuePush(targetId, {
          title: `Сообщение от ${socket.user.display_name || socket.user.username}`,
          body: push.compactBody(saved),
          url: `/?chat=private-${userId}`,
          tag: `private-${userId}`,
          chat: { type: 'private', id: userId }
        });
      }
      notifyMentions(io, socket.user, message.value, { type: 'private', id: userId });
      return ack?.({ ok: true, message: saved });
    });

    socket.on('app:active', ({ active } = {}) => {
      const entry = online.get(userId);
      if (!entry) return;
      entry.activeSockets = entry.activeSockets || new Set();
      if (active === false) entry.activeSockets.delete(socket.id);
      else entry.activeSockets.add(socket.id);
      entry.active = entry.activeSockets.size > 0;
    });

    socket.on('call:invite', ({ to, kind }, ack) => {
      const targetId = Number(to);
      if (!canSignalCall(userId, targetId)) return ack?.({ error: 'Пользователь не найден.' });
      const callId = callIdFor(userId, targetId);
      const callKind = kind === 'video' ? 'video' : 'audio';
      io.to(`user:${targetId}`).emit('call:incoming', {
        callId,
        from: userId,
        to: targetId,
        kind: callKind,
        user: publicUser(socket.user)
      });
      clearTimeout(callTimers.get(callId));
      callTimers.set(callId, setTimeout(() => {
        io.to(`user:${userId}`).to(`user:${targetId}`).emit('call:ended', { callId, reason: 'timeout', from: targetId });
        callTimers.delete(callId);
      }, 45000).unref());
      return ack?.({ ok: true, callId, kind: callKind });
    });

    socket.on('call:accept', (payload, ack) => {
      if (payload?.callId) clearTimeout(callTimers.get(payload.callId));
      if (payload?.callId) callTimers.delete(payload.callId);
      return relayCall(io, socket, 'call:accepted', payload, ack);
    });

    socket.on('call:reject', (payload, ack) => {
      if (payload?.callId) clearTimeout(callTimers.get(payload.callId));
      if (payload?.callId) callTimers.delete(payload.callId);
      return relayCall(io, socket, 'call:rejected', payload, ack);
    });

    socket.on('call:offer', (payload, ack) => relayCall(io, socket, 'call:offer', payload, ack));
    socket.on('call:answer', (payload, ack) => relayCall(io, socket, 'call:answer', payload, ack));
    socket.on('call:ice', (payload, ack) => relayCall(io, socket, 'call:ice', payload, ack));

    socket.on('call:end', (payload, ack) => {
      if (payload?.callId) clearTimeout(callTimers.get(payload.callId));
      if (payload?.callId) callTimers.delete(payload.callId);
      return relayCall(io, socket, 'call:ended', payload, ack);
    });

    socket.on('message:react', ({ chatType, messageId, reaction }, ack) => {
      const type = chatType === 'room' ? 'room' : chatType === 'private' ? 'private' : null;
      const id = Number(messageId);
      if (!type || !id || !allowedReactions.has(reaction)) return ack?.({ error: 'Некорректная реакция.' });

      if (type === 'room') {
        const message = q.findMessageById.get(id);
        if (!message || !canAccessRoom(message.room_id, userId)) return ack?.({ error: 'Сообщение не найдено.' });
        const current = q.findMessageReaction.get(userId, type, id)?.reaction;
        if (current === reaction) q.deleteMessageReaction.run(userId, type, id);
        else q.upsertMessageReaction.run(userId, type, id, reaction);
        const payload = { chatType: type, messageId: id, roomId: message.room_id, actorId: userId, ...reactionPayload(type, id) };
        io.to(`room:${message.room_id}`).emit('message:reaction', payload);
        return ack?.({ ok: true, chatType: type, messageId: id, ...reactionPayload(type, id, userId) });
      }

      const message = q.findPrivateMessageById.get(id);
      if (!message || (message.sender_id !== userId && message.receiver_id !== userId)) return ack?.({ error: 'Сообщение не найдено.' });
      const current = q.findMessageReaction.get(userId, type, id)?.reaction;
      if (current === reaction) q.deleteMessageReaction.run(userId, type, id);
      else q.upsertMessageReaction.run(userId, type, id, reaction);
      const payload = { chatType: type, messageId: id, actorId: userId, ...reactionPayload(type, id) };
      io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:reaction', payload);
      return ack?.({ ok: true, chatType: type, messageId: id, ...reactionPayload(type, id, userId) });
    });

    socket.on('message:pin', ({ chatType, messageId }, ack) => {
      const type = chatType === 'room' ? 'room' : chatType === 'private' ? 'private' : null;
      const id = Number(messageId);
      if (!type || !id) return ack?.({ error: 'Некорректное сообщение.' });

      if (type === 'room') {
        const message = q.findMessageById.get(id);
        if (!message || message.deleted_at || !canAccessRoom(message.room_id, userId)) return ack?.({ error: 'Сообщение не найдено.' });
        const key = String(message.room_id);
        const current = q.findPinnedMessage.get(type, key);
        if (current?.message_id === id) q.deletePinnedMessage.run(type, key);
        else q.upsertPinnedMessage.run(type, key, id, userId);
        const pinned = pinnedPayload(type, key, userId);
        io.to(`room:${message.room_id}`).emit('message:pinned', { chatType: type, roomId: message.room_id, pinned });
        return ack?.({ ok: true, chatType: type, roomId: message.room_id, pinned });
      }

      const message = q.findPrivateMessageById.get(id);
      if (!message || message.deleted_at || (message.sender_id !== userId && message.receiver_id !== userId)) return ack?.({ error: 'Сообщение не найдено.' });
      const key = privateChatKey(message.sender_id, message.receiver_id);
      const current = q.findPinnedMessage.get(type, key);
      if (current?.message_id === id) q.deletePinnedMessage.run(type, key);
      else q.upsertPinnedMessage.run(type, key, id, userId);
      const pinned = pinnedPayload(type, key, userId);
      const payload = { chatType: type, userIds: [message.sender_id, message.receiver_id], pinned };
      io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:pinned', payload);
      return ack?.({ ok: true, ...payload });
    });

    socket.on('private:read', ({ userId: otherUserId }, ack) => {
      const otherId = Number(otherUserId);
      if (otherId === userId || !q.findUserById.get(otherId)) return ack?.({ error: 'РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РЅРµ РЅР°Р№РґРµРЅ.' });
      const messageIds = q.listUnreadPrivateMessageIds.all(otherId, userId).map((row) => row.id);
      if (!messageIds.length) return ack?.({ ok: true, messageIds: [] });
      q.markPrivateMessagesRead.run(otherId, userId);
      io.to(`user:${otherId}`).emit('private:read', { readerId: userId, messageIds });
      io.to(`user:${userId}`).emit('private:read', { readerId: userId, messageIds });
      return ack?.({ ok: true, messageIds });
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
          const pinKey = String(message.room_id);
          const currentPin = q.findPinnedMessage.get('room', pinKey);
          q.deleteRoomMessageForAll.run(userId, id);
          io.to(`room:${message.room_id}`).emit('message:removed', { chatType: 'room', messageId: id, roomId: message.room_id });
          if (currentPin?.message_id === id) {
            q.deletePinnedMessage.run('room', pinKey);
            io.to(`room:${message.room_id}`).emit('message:pinned', { chatType: 'room', roomId: message.room_id, pinned: null });
          }
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
          const pinKey = privateChatKey(message.sender_id, message.receiver_id);
          const currentPin = q.findPinnedMessage.get('private', pinKey);
          q.deletePrivateMessageForAll.run(userId, id);
          io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:removed', { chatType: 'private', messageId: id });
          if (currentPin?.message_id === id) {
            q.deletePinnedMessage.run('private', pinKey);
            io.to(`user:${message.sender_id}`).to(`user:${message.receiver_id}`).emit('message:pinned', { chatType: 'private', userIds: [message.sender_id, message.receiver_id], pinned: null });
          }
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
        entry.activeSockets?.delete(socket.id);
        entry.active = Boolean(entry.activeSockets?.size);
        if (!entry.sockets.size) online.delete(userId);
      }
      io.emit('presence:update', onlinePayload());
      console.log(`Socket disconnected user=${socket.user.username}`);
    });
  });
}

module.exports = { registerSocket };
