const state = {
  me: null,
  socket: null,
  rooms: [],
  users: [],
  onlineIds: new Set(),
  unread: new Map(),
  chat: { type: 'room', id: 1, title: 'general' },
  replyTo: null,
  contextMessage: null,
  pendingDelete: null,
  typing: new Map(),
  recorder: null,
  chunks: [],
  longPressTimer: null
};

const el = {
  sidebar: document.querySelector('#sidebar'),
  rooms: document.querySelector('#roomsList'),
  users: document.querySelector('#usersList'),
  messages: document.querySelector('#messages'),
  title: document.querySelector('#chatTitle'),
  chatAvatar: document.querySelector('#chatAvatar'),
  chatHeaderButton: document.querySelector('#chatHeaderButton'),
  status: document.querySelector('#connectionStatus'),
  form: document.querySelector('#messageForm'),
  input: document.querySelector('#messageInput'),
  fileInput: document.querySelector('#fileInput'),
  attachButton: document.querySelector('#attachButton'),
  voiceButton: document.querySelector('#voiceButton'),
  videoButton: document.querySelector('#videoButton'),
  replyBar: document.querySelector('#replyBar'),
  contextMenu: document.querySelector('#contextMenu'),
  deleteModal: document.querySelector('#deleteModal'),
  deleteForm: document.querySelector('#deleteForm'),
  deleteForAll: document.querySelector('#deleteForAll'),
  settingsModal: document.querySelector('#settingsModal'),
  roomSettingsModal: document.querySelector('#roomSettingsModal'),
  roomSettingsForm: document.querySelector('#roomSettingsForm'),
  roomMembers: document.querySelector('#roomMembers'),
  roomAvatarPreview: document.querySelector('#roomAvatarPreview'),
  roomAvatarInput: document.querySelector('#roomAvatarInput'),
  typing: document.querySelector('#typing'),
  toast: document.querySelector('#toast'),
  toastText: document.querySelector('#toastText'),
  toastClose: document.querySelector('#toastClose')
};

const chatKey = (type, id) => `${type}:${id}`;
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const displayName = (user) => user?.display_name || user?.username || user?.name || '?';
let toastTimer = null;

async function api(path, options = {}) {
  const headers = options.body instanceof FormData ? options.headers || {} : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const response = await fetch(path, { headers, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Ошибка запроса.');
  return payload;
}

function toast(message) {
  clearTimeout(toastTimer);
  el.toastText.textContent = message;
  el.toast.classList.add('show');
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
}

el.toastClose.onclick = () => {
  clearTimeout(toastTimer);
  el.toast.classList.remove('show');
};

function avatar(entity, size = '') {
  const cls = `avatar ${size}`;
  if (entity?.avatar_url) return `<img class="${cls}" src="${escapeHtml(entity.avatar_url)}" alt="">`;
  const base = displayName(entity).slice(0, 2).toUpperCase();
  return `<span class="${cls}">${escapeHtml(base)}</span>`;
}

function formatTime(value) {
  return new Date(`${value}Z`).toLocaleString('ru-RU', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

function currentItem() {
  return state.chat.type === 'room'
    ? state.rooms.find((room) => room.id === state.chat.id)
    : state.users.find((user) => user.id === state.chat.id);
}

function currentChatMuted() {
  return Boolean(currentItem()?.muted);
}

function unreadBadge(type, id, muted) {
  const count = state.unread.get(chatKey(type, id)) || 0;
  if (!count) return '';
  return muted ? '<b class="unread-dot"></b>' : `<b class="unread-count">${count > 99 ? '99+' : count}</b>`;
}

function renderLists() {
  el.rooms.innerHTML = state.rooms.map((room) => `
    <button class="list-item ${state.chat.type === 'room' && state.chat.id === room.id ? 'active' : ''}" data-room="${room.id}">
      ${avatar(room, 'small')}
      <span># ${escapeHtml(room.name)}</span>
      ${unreadBadge('room', room.id, room.muted)}
    </button>
  `).join('');
  el.users.innerHTML = state.users.map((user) => `
    <button class="list-item ${state.chat.type === 'private' && state.chat.id === user.id ? 'active' : ''}" data-user="${user.id}">
      ${avatar(user, 'small')}
      <span>${escapeHtml(displayName(user))}</span>
      ${unreadBadge('private', user.id, user.muted)}
      <small><i class="dot ${state.onlineIds.has(user.id) ? 'online' : ''}"></i>${state.onlineIds.has(user.id) ? 'online' : 'offline'}</small>
    </button>
  `).join('');
}

function bodyHtml(body) {
  return escapeHtml(body).replace(/@([a-z0-9_]{3,32})/gi, '<mark>@$1</mark>');
}

function attachmentHtml(message) {
  if (!message.attachment_url) return '';
  const url = escapeHtml(message.attachment_url);
  const name = escapeHtml(message.attachment_name || 'media');
  if (message.attachment_type === 'image') return `<img class="media image-media" src="${url}" alt="${name}">`;
  if (message.attachment_type === 'video') return `<video class="media" src="${url}" controls playsinline></video>`;
  if (message.attachment_type === 'audio') return `<audio class="media audio-media" src="${url}" controls></audio>`;
  return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`;
}

function renderMessage(message, type = state.chat.type) {
  const mine = type === 'room' ? message.user_id === state.me.id : message.sender_id === state.me.id;
  const authorUser = type === 'room'
    ? { username: message.username, display_name: message.display_name, avatar_url: message.avatar_url }
    : { username: message.sender_username, display_name: message.sender_display_name, avatar_url: message.sender_avatar_url };
  const mentioned = message.body && message.body.toLowerCase().includes(`@${state.me.username}`);
  return `
    <article class="message ${mine ? 'mine' : ''} ${mentioned ? 'mentioned' : ''}" data-message-id="${message.id}" data-message-type="${type}">
      ${avatar(authorUser, 'small')}
      <div class="message-content">
        <div class="meta"><strong>${escapeHtml(displayName(authorUser))}</strong><time>${formatTime(message.created_at)}</time></div>
        ${message.reply_preview_author ? `<div class="reply-preview">${escapeHtml(message.reply_preview_author)}: ${escapeHtml(message.reply_preview_body)}</div>` : ''}
        ${message.forwarded_from_author ? `<div class="reply-preview">Переслано от ${escapeHtml(message.forwarded_from_author)}: ${escapeHtml(message.forwarded_from_body)}</div>` : ''}
        ${message.body ? `<p>${bodyHtml(message.body)}</p>` : ''}
        ${attachmentHtml(message)}
      </div>
    </article>
  `;
}

function addMessage(message, type) {
  el.messages.insertAdjacentHTML('beforeend', renderMessage(message, type));
  el.messages.scrollTop = el.messages.scrollHeight;
}

function removeMessage(messageId, type) {
  document.querySelector(`[data-message-type="${type}"][data-message-id="${messageId}"]`)?.remove();
}

function updateReplyBar() {
  if (!state.replyTo) {
    el.replyBar.hidden = true;
    el.replyBar.innerHTML = '';
    return;
  }
  el.replyBar.hidden = false;
  el.replyBar.innerHTML = `<span>Ответ ${escapeHtml(state.replyTo.author)}: ${escapeHtml(state.replyTo.body)}</span><button type="button" data-cancel-reply>×</button>`;
}

function setHeader() {
  const item = currentItem();
  el.title.textContent = state.chat.type === 'room' ? `# ${state.chat.title}` : displayName(item);
  el.chatAvatar.outerHTML = avatar(state.chat.type === 'room' ? item : item, 'small').replace('class="avatar small"', 'id="chatAvatar" class="avatar small"');
  el.chatAvatar = document.querySelector('#chatAvatar');
}

async function openRoom(room) {
  if (!room) return;
  if (state.chat.type === 'room' && state.socket) state.socket.emit('room:leave', { roomId: state.chat.id });
  state.chat = { type: 'room', id: room.id, title: room.name };
  state.replyTo = null;
  state.unread.delete(chatKey('room', room.id));
  updateReplyBar();
  setHeader();
  renderLists();
  const data = await api(`/api/rooms/${room.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'room')).join('');
  state.socket?.emit('room:join', { roomId: room.id }, (ack) => ack?.error && toast(ack.error));
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function openPrivate(user) {
  if (!user) return;
  state.chat = { type: 'private', id: user.id, title: user.username };
  state.replyTo = null;
  state.unread.delete(chatKey('private', user.id));
  updateReplyBar();
  setHeader();
  renderLists();
  const data = await api(`/api/private/${user.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'private')).join('');
  el.messages.scrollTop = el.messages.scrollHeight;
}

async function refreshData() {
  const [rooms, users] = await Promise.all([api('/api/rooms'), api('/api/users')]);
  state.rooms = rooms.rooms;
  state.users = users.users;
  renderLists();
}

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  return (await api('/api/uploads', { method: 'POST', body: form })).attachment;
}

function sendMessage(body, attachment = null) {
  const eventName = state.chat.type === 'room' ? 'message:send' : 'private:send';
  const payload = state.chat.type === 'room'
    ? { roomId: state.chat.id, body, attachment, replyTo: state.replyTo }
    : { receiverId: state.chat.id, body, attachment, replyTo: state.replyTo };
  state.socket.emit(eventName, payload, (ack) => {
    if (ack?.error) toast(ack.error);
    else {
      el.input.value = '';
      state.replyTo = null;
      updateReplyBar();
    }
  });
}

function bumpUnread(type, id, mentioned = false) {
  if (state.chat.type === type && state.chat.id === id && document.hasFocus()) return;
  const key = chatKey(type, id);
  state.unread.set(key, (state.unread.get(key) || 0) + 1);
  renderLists();
  if (mentioned) toast('Вас упомянули.');
}

function showDeviceNotification(title, body, muted = false) {
  if (muted || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  new Notification(title, { body });
}

function setupSocket() {
  state.socket = io({ path: '/socket.io' });
  state.socket.on('connect', () => {
    el.status.textContent = 'online';
    if (state.chat.type === 'room') state.socket.emit('room:join', { roomId: state.chat.id });
  });
  state.socket.on('disconnect', () => { el.status.textContent = 'offline'; });
  state.socket.on('connect_error', (error) => toast(error.message));
  state.socket.on('presence:update', (users) => {
    state.onlineIds = new Set(users.map((user) => user.id));
    renderLists();
  });
  state.socket.on('room:created', (room) => {
    if (!state.rooms.some((item) => item.id === room.id)) state.rooms.push(room);
    renderLists();
    toast(`Приглашение в комнату #${room.name}`);
  });
  state.socket.on('room:updated', (room) => {
    state.rooms = state.rooms.map((item) => item.id === room.id ? { ...item, ...room } : item);
    if (state.chat.type === 'room' && state.chat.id === room.id) setHeader();
    renderLists();
  });
  state.socket.on('room:deleted', (event) => {
    state.rooms = state.rooms.filter((room) => room.id !== event.roomId);
    renderLists();
    if (state.chat.type === 'room' && state.chat.id === event.roomId) openRoom(state.rooms[0]);
  });
  state.socket.on('user:updated', (user) => {
    if (state.me.id === user.id) state.me = user;
    state.users = state.users.map((item) => item.id === user.id ? { ...item, ...user } : item);
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>${escapeHtml(displayName(state.me))}</span>`;
    if (state.chat.type === 'private' && state.chat.id === user.id) setHeader();
    renderLists();
  });
  state.socket.on('user:created', (user) => {
    if (user.id !== state.me.id && !state.users.some((item) => item.id === user.id)) {
      state.users.push(user);
      renderLists();
    }
  });
  state.socket.on('message:new', (message) => {
    const mentioned = message.body?.toLowerCase().includes(`@${state.me.username}`);
    if (state.chat.type === 'room' && state.chat.id === message.room_id) addMessage(message, 'room');
    if (message.user_id !== state.me.id) {
      const room = state.rooms.find((item) => item.id === message.room_id);
      bumpUnread('room', message.room_id, mentioned);
      showDeviceNotification(`# ${room?.name || 'room'}`, `${message.display_name || message.username}: ${message.body || message.attachment_name || 'Медиа'}`, room?.muted);
    }
  });
  state.socket.on('private:new', (message) => {
    const otherId = message.sender_id === state.me.id ? message.receiver_id : message.sender_id;
    if (state.chat.type === 'private' && state.chat.id === otherId) addMessage(message, 'private');
    if (message.sender_id !== state.me.id) {
      const user = state.users.find((item) => item.id === otherId);
      bumpUnread('private', otherId, message.body?.toLowerCase().includes(`@${state.me.username}`));
      showDeviceNotification(`Сообщение от ${message.sender_display_name || message.sender_username}`, message.body || message.attachment_name || 'Медиа', user?.muted);
    }
  });
  state.socket.on('notification:new', (event) => {
    toast(event.title);
    showDeviceNotification(event.title, event.body);
  });
  state.socket.on('message:removed', (event) => removeMessage(event.messageId, event.chatType));
  state.socket.on('message:deleted', (event) => removeMessage(event.message?.id, event.chatType));
  state.socket.on('typing:update', (event) => {
    const key = `${event.chatType}:${event.chatId}:${event.user.id}`;
    if (event.typing) state.typing.set(key, displayName(event.user));
    else state.typing.delete(key);
    el.typing.textContent = Array.from(state.typing.values()).slice(0, 2).join(', ');
    if (el.typing.textContent) el.typing.textContent += ' печатает...';
  });
}

function openContextMenu(messageEl, x, y) {
  state.contextMessage = {
    id: Number(messageEl.dataset.messageId),
    type: messageEl.dataset.messageType,
    author: messageEl.querySelector('.meta strong')?.textContent || '',
    body: messageEl.querySelector('.message-content p')?.textContent || 'медиа'
  };
  el.contextMenu.style.left = `${Math.min(x, innerWidth - 170)}px`;
  el.contextMenu.style.top = `${Math.min(y, innerHeight - 140)}px`;
  el.contextMenu.hidden = false;
}

document.addEventListener('click', async (event) => {
  if (!event.target.closest('#contextMenu')) el.contextMenu.hidden = true;
  if (event.target.closest('[data-cancel-reply]')) {
    state.replyTo = null;
    updateReplyBar();
    return;
  }
  const menuAction = event.target.closest('[data-menu-action]')?.dataset.menuAction;
  if (menuAction && state.contextMessage) {
    const msg = state.contextMessage;
    if (menuAction === 'reply') {
      state.replyTo = { chatType: msg.type, messageId: msg.id, author: msg.author, body: msg.body.slice(0, 140) };
      updateReplyBar();
      el.input.focus();
    }
    if (menuAction === 'forward') {
      const target = prompt('Куда переслать? Например: @username или #room');
      const targets = (target || '').split(',').map((item) => item.trim()).map((item) => {
        if (item.startsWith('@')) return state.users.find((user) => user.username === item.slice(1).toLowerCase()) && { type: 'private', id: state.users.find((user) => user.username === item.slice(1).toLowerCase()).id };
        if (item.startsWith('#')) return state.rooms.find((room) => room.name.toLowerCase() === item.slice(1).toLowerCase()) && { type: 'room', id: state.rooms.find((room) => room.name.toLowerCase() === item.slice(1).toLowerCase()).id };
        return null;
      }).filter(Boolean);
      if (!targets.length) return toast('Получатель не найден.');
      state.socket.emit('message:forward', { chatType: msg.type, messageId: msg.id, targets }, (ack) => toast(ack?.error || 'Сообщение переслано.'));
    }
    if (menuAction === 'delete') {
      state.pendingDelete = msg;
      el.deleteForAll.checked = false;
      el.deleteModal.showModal();
    }
    return;
  }
  const roomButton = event.target.closest('[data-room]');
  const userButton = event.target.closest('[data-user]');
  if (roomButton) await openRoom(state.rooms.find((room) => room.id === Number(roomButton.dataset.room)));
  if (userButton) await openPrivate(state.users.find((user) => user.id === Number(userButton.dataset.user)));
  if (innerWidth < 760 && (roomButton || userButton)) el.sidebar.classList.remove('open');
});

el.messages.addEventListener('contextmenu', (event) => {
  const message = event.target.closest('[data-message-id]');
  if (!message) return;
  event.preventDefault();
  openContextMenu(message, event.clientX, event.clientY);
});
el.messages.addEventListener('touchstart', (event) => {
  const message = event.target.closest('[data-message-id]');
  if (!message) return;
  state.longPressTimer = setTimeout(() => openContextMenu(message, event.touches[0].clientX, event.touches[0].clientY), 520);
}, { passive: true });
['touchend', 'touchmove', 'touchcancel'].forEach((name) => el.messages.addEventListener(name, () => clearTimeout(state.longPressTimer), { passive: true }));

el.deleteForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const msg = state.pendingDelete;
  if (!msg) return;
  state.socket.emit('message:delete', { chatType: msg.type, messageId: msg.id, mode: el.deleteForAll.checked ? 'all' : 'self' }, (ack) => {
    if (ack?.error) toast(ack.error);
    else removeMessage(msg.id, msg.type);
  });
  el.deleteModal.close();
});
document.querySelector('#cancelDelete').onclick = () => el.deleteModal.close();

el.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    el.form.requestSubmit();
  }
});
el.form.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = el.input.value.trim();
  if (!body) return toast('Сообщение не может быть пустым.');
  if (body.length > 1000) return toast('Сообщение слишком длинное.');
  sendMessage(body);
});
el.attachButton.onclick = () => el.fileInput.click();
el.fileInput.addEventListener('change', async () => {
  const file = el.fileInput.files[0];
  if (!file) return;
  try {
    const attachment = await uploadFile(file);
    sendMessage(el.input.value.trim(), attachment);
  } catch (error) {
    toast(error.message);
  } finally {
    el.fileInput.value = '';
  }
});

async function toggleRecording(kind) {
  if (state.recorder?.state === 'recording') {
    state.recorder.stop();
    return;
  }
  try {
    toast(kind === 'video' ? 'Разрешите доступ к камере и микрофону.' : 'Разрешите доступ к микрофону.');
    const stream = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { audio: true, video: true } : { audio: true });
    state.chunks = [];
    state.recorder = new MediaRecorder(stream);
    state.recorder.ondataavailable = (event) => event.data.size && state.chunks.push(event.data);
    state.recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      const type = kind === 'video' ? 'video/webm' : 'audio/webm';
      const file = new File([new Blob(state.chunks, { type })], `${kind}-${Date.now()}.webm`, { type });
      sendMessage('', await uploadFile(file));
      el.voiceButton.classList.remove('recording');
      el.videoButton.classList.remove('recording');
    };
    state.recorder.start();
    (kind === 'video' ? el.videoButton : el.voiceButton).classList.add('recording');
    toast('Запись началась. Нажмите ещё раз для отправки.');
  } catch (_error) {
    toast('Браузер не дал доступ к микрофону или камере.');
  }
}
el.voiceButton.onclick = () => toggleRecording('audio');
el.videoButton.onclick = () => toggleRecording('video');

let typingSent = false;
let typingTimeout;
el.input.addEventListener('input', () => {
  if (!typingSent) {
    typingSent = true;
    state.socket.emit('typing:start', { chatType: state.chat.type, chatId: state.chat.id });
  }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    typingSent = false;
    state.socket.emit('typing:stop', { chatType: state.chat.type, chatId: state.chat.id });
  }, 900);
});

document.querySelector('#settingsButton').onclick = () => {
  document.querySelector('#settingsUsername').textContent = `Ваш username: @${state.me.username}`;
  el.settingsModal.showModal();
};
document.querySelector('#closeSettings').onclick = () => el.settingsModal.close();
document.querySelector('#themeButton').onclick = () => {
  document.body.classList.toggle('dark');
  localStorage.setItem('theme', document.body.classList.contains('dark') ? 'dark' : 'light');
};
document.querySelector('#notifyButton').onclick = async () => {
  if (!('Notification' in window)) return toast('Браузер не поддерживает уведомления.');
  const result = await Notification.requestPermission();
  toast(result === 'granted' ? 'Уведомления включены.' : 'Уведомления не разрешены.');
};
document.querySelector('#copyUsernameButton').onclick = async () => {
  await navigator.clipboard.writeText(`@${state.me.username}`);
  toast('Username скопирован.');
};

el.chatHeaderButton.onclick = async () => {
  const item = currentItem();
  if (!item) return;
  document.querySelector('#roomSettingsModal h2').textContent = state.chat.type === 'room' ? `# ${item.name}` : displayName(item);
  el.roomAvatarPreview.innerHTML = avatar(item, 'large');
  document.querySelector('#inviteButton').hidden = state.chat.type !== 'room' || state.chat.id === 1 || item.role !== 'admin';
  document.querySelector('#deleteRoomButton').hidden = state.chat.type !== 'room' || state.chat.id === 1 || item.role !== 'admin';
  el.roomAvatarInput.hidden = state.chat.type !== 'room' || item.role !== 'admin';
  const muted = currentChatMuted();
  document.querySelector('#muteButton').textContent = muted ? 'Снять мут' : 'Заглушить';
  if (state.chat.type === 'room') {
    const members = await api(`/api/rooms/${state.chat.id}/members`);
    el.roomMembers.innerHTML = members.members.map((user) => `<div class="member-row">${avatar(user, 'small')}<span>${escapeHtml(displayName(user))}</span><small>@${escapeHtml(user.username)}</small></div>`).join('');
  } else {
    el.roomMembers.innerHTML = `<div class="member-row">${avatar(item, 'small')}<span>${escapeHtml(displayName(item))}</span><small>@${escapeHtml(item.username)}</small></div>`;
  }
  el.roomSettingsModal.showModal();
};
document.querySelector('#closeRoomSettings').onclick = () => el.roomSettingsModal.close();
document.querySelector('#muteButton').onclick = async () => {
  const muted = currentChatMuted();
  const path = state.chat.type === 'room' ? `/api/rooms/${state.chat.id}/mute` : `/api/users/${state.chat.id}/mute`;
  await api(path, { method: muted ? 'DELETE' : 'POST' });
  currentItem().muted = muted ? 0 : 1;
  renderLists();
  toast(muted ? 'Мут снят.' : 'Чат заглушен.');
  el.roomSettingsModal.close();
};
document.querySelector('#inviteButton').onclick = async () => {
  const username = prompt('Кого пригласить? Введите username без @');
  if (!username) return;
  const user = state.users.find((candidate) => candidate.username === username.trim().toLowerCase());
  if (!user) return toast('Пользователь не найден.');
  await api(`/api/rooms/${state.chat.id}/invite`, { method: 'POST', body: JSON.stringify({ userId: user.id }) });
  toast('Пользователь приглашён.');
};
document.querySelector('#deleteRoomButton').onclick = async () => {
  if (!confirm('Удалить комнату для всех участников?')) return;
  await api(`/api/rooms/${state.chat.id}`, { method: 'DELETE' });
  el.roomSettingsModal.close();
};
el.roomSettingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (state.chat.type !== 'room' || !el.roomAvatarInput.files[0]) return el.roomSettingsModal.close();
  const uploaded = await uploadFile(el.roomAvatarInput.files[0]);
  const data = await api(`/api/rooms/${state.chat.id}`, { method: 'PATCH', body: JSON.stringify({ avatar_url: uploaded.url }) });
  state.rooms = state.rooms.map((room) => room.id === data.room.id ? { ...room, ...data.room } : room);
  setHeader();
  renderLists();
  el.roomSettingsModal.close();
});

document.querySelector('#openRoomModal').onclick = () => document.querySelector('#roomModal').showModal();
document.querySelector('#cancelRoom').onclick = () => document.querySelector('#roomModal').close();
document.querySelector('#roomForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const { room } = await api('/api/rooms', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(event.target).entries())) });
    document.querySelector('#roomModal').close();
    event.target.reset();
    await openRoom(room);
  } catch (error) { toast(error.message); }
});

document.querySelector('#logoutButton').onclick = async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/login.html';
};
document.querySelector('#profileButton').onclick = () => {
  document.querySelector('#profileForm').display_name.value = state.me.display_name || '';
  document.querySelector('#profileForm').username.value = state.me.username;
  document.querySelector('#profileAvatar').innerHTML = avatar(state.me, 'large');
  document.querySelector('#profileModal').showModal();
};
document.querySelector('#closeProfile').onclick = () => document.querySelector('#profileModal').close();
document.querySelector('#profileForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const form = event.target;
    let avatarUrl = state.me.avatar_url || null;
    if (document.querySelector('#avatarInput').files[0]) avatarUrl = (await uploadFile(document.querySelector('#avatarInput').files[0])).url;
    const data = await api('/api/users/me', {
      method: 'PATCH',
      body: JSON.stringify({ display_name: form.display_name.value, username: form.username.value, avatar_url: avatarUrl })
    });
    state.me = data.user;
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>${escapeHtml(displayName(state.me))}</span>`;
    document.querySelector('#profileModal').close();
    toast('Профиль обновлён.');
  } catch (error) { toast(error.message); }
});
document.querySelector('#openSidebar').onclick = () => el.sidebar.classList.add('open');
document.querySelector('#closeSidebar').onclick = () => el.sidebar.classList.remove('open');

(async function boot() {
  try {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    const me = await api('/api/auth/me');
    state.me = me.user;
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>${escapeHtml(displayName(state.me))}</span>`;
    await refreshData();
    setupSocket();
    await openRoom(state.rooms[0]);
    if (!state.me.display_name) document.querySelector('#profileButton').click();
  } catch (_error) {
    location.href = '/login.html';
  }
}());
