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
  recordMode: 'audio',
  recordPressStarted: false,
  recordPointerId: null,
  recordHoldTimer: null,
  recordStarting: false,
  stopAfterStart: false,
  recordingKind: null,
  recordingStartedAt: 0,
  recordStopTimer: null,
  recordTimerInterval: null,
  recordStream: null,
  cameraFacing: 'user',
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
  recordButton: document.querySelector('#recordButton'),
  replyBar: document.querySelector('#replyBar'),
  contextMenu: document.querySelector('#contextMenu'),
  deleteModal: document.querySelector('#deleteModal'),
  deleteForm: document.querySelector('#deleteForm'),
  deleteForAll: document.querySelector('#deleteForAll'),
  videoPreviewModal: document.querySelector('#videoPreviewModal'),
  videoPreview: document.querySelector('#videoPreview'),
  cancelVideoPreview: document.querySelector('#cancelVideoPreview'),
  sendVideoPreview: document.querySelector('#sendVideoPreview'),
  recordPreviewOverlay: document.querySelector('#recordPreviewOverlay'),
  recordLivePreview: document.querySelector('#recordLivePreview'),
  recordTimer: document.querySelector('#recordTimer'),
  switchCameraButton: document.querySelector('#switchCameraButton'),
  cameraModeButton: null,
  loadingScreen: document.querySelector('#loadingScreen'),
  settingsModal: document.querySelector('#settingsModal'),
  roomSettingsModal: document.querySelector('#roomSettingsModal'),
  roomSettingsForm: document.querySelector('#roomSettingsForm'),
  roomMembers: document.querySelector('#roomMembers'),
  roomAvatarPreview: document.querySelector('#roomAvatarPreview'),
  roomAvatarInput: document.querySelector('#roomAvatarInput'),
  inviteSearch: document.querySelector('#inviteSearch'),
  userSearchInput: document.querySelector('#userSearchInput'),
  userSearchResults: document.querySelector('#userSearchResults'),
  typing: document.querySelector('#typing'),
  toast: document.querySelector('#toast'),
  toastText: document.querySelector('#toastText'),
  toastClose: document.querySelector('#toastClose')
};

const chatKey = (type, id) => `${type}:${id}`;
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const displayName = (user) => user?.display_name || user?.username || user?.name || '?';
let toastTimer = null;

function setAppHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);
window.visualViewport?.addEventListener('resize', setAppHeight);

function markCurrentPrivateRead() {
  if (state.chat.type === 'private' && state.socket?.connected) {
    state.socket.emit('private:read', { userId: state.chat.id });
  }
}

window.addEventListener('focus', markCurrentPrivateRead);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) markCurrentPrivateRead();
});

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

function setupCameraModeButton() {
  el.cameraModeButton = document.createElement('button');
  el.cameraModeButton.id = 'cameraModeButton';
  el.cameraModeButton.className = 'icon-button ghost camera-mode-button';
  el.cameraModeButton.type = 'button';
  el.cameraModeButton.title = 'Сменить камеру';
  el.cameraModeButton.setAttribute('aria-label', 'Сменить камеру');
  el.cameraModeButton.textContent = '↻';
  el.cameraModeButton.hidden = true;
  el.recordButton.before(el.cameraModeButton);
}

setupCameraModeButton();

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
  if (message.attachment_type === 'video') {
    const circle = /^video-\d+\.(webm|mp4|mov|3gp)$/i.test(message.attachment_name || '');
    return `
      <div class="media-player ${circle ? 'video-circle-player' : 'video-wide-player'}">
        <video class="media ${circle ? 'video-message-media' : 'video-file-media'}" src="${url}" playsinline preload="metadata"></video>
        <div class="player-controls">
          <button class="player-play" type="button" data-player-toggle aria-label="Воспроизвести"></button>
          <input class="player-progress" type="range" min="0" max="1000" value="0" data-player-progress aria-label="Прогресс">
          <time class="player-time">00:00</time>
        </div>
      </div>
    `;
  }
  if (message.attachment_type === 'audio') {
    return `
      <div class="media-player audio-player">
        <audio class="media audio-media" src="${url}" preload="metadata"></audio>
        <button class="player-play" type="button" data-player-toggle aria-label="Воспроизвести"></button>
        <input class="player-progress" type="range" min="0" max="1000" value="0" data-player-progress aria-label="Прогресс">
        <time class="player-time">00:00</time>
      </div>
    `;
  }
  return `<a href="${url}" target="_blank" rel="noopener">${name}</a>`;
}

function renderMessage(message, type = state.chat.type) {
  const mine = type === 'room' ? message.user_id === state.me.id : message.sender_id === state.me.id;
  const authorUser = type === 'room'
    ? { username: message.username, display_name: message.display_name, avatar_url: message.avatar_url }
    : { username: message.sender_username, display_name: message.sender_display_name, avatar_url: message.sender_avatar_url };
  const mentioned = message.body && message.body.toLowerCase().includes(`@${state.me.username}`);
  const statusHtml = type === 'private' && mine
    ? `<span class="message-status ${message.read_at ? 'read' : 'delivered'}" title="${message.read_at ? 'Прочитано' : 'Доставлено'}">${message.read_at ? '✓✓' : '✓'}</span>`
    : '';
  return `
    <article class="message ${mine ? 'mine' : ''} ${mentioned ? 'mentioned' : ''}" data-message-id="${message.id}" data-message-type="${type}">
      ${avatar(authorUser, 'small')}
      <div class="message-content">
        <div class="meta"><strong>${escapeHtml(displayName(authorUser))}</strong><time>${formatTime(message.created_at)}</time>${statusHtml}</div>
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

function ensurePrivateUser(message) {
  const other = message.sender_id === state.me.id
    ? {
      id: message.receiver_id,
      username: message.receiver_username,
      display_name: message.receiver_display_name,
      avatar_url: message.receiver_avatar_url,
      muted: 0
    }
    : {
      id: message.sender_id,
      username: message.sender_username,
      display_name: message.sender_display_name,
      avatar_url: message.sender_avatar_url,
      muted: 0
    };
  if (other.id && !state.users.some((user) => user.id === other.id)) {
    state.users.push(other);
    state.users.sort((a, b) => a.username.localeCompare(b.username));
    renderLists();
  }
  return other;
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

function activeTypingKey() {
  return chatKey(state.chat.type, state.chat.id);
}

function eventTypingKey(event) {
  if (event.chatType === 'room') return chatKey('room', event.chatId);
  return chatKey('private', event.fromUserId);
}

function renderTyping() {
  const activeKey = activeTypingKey();
  const names = Array.from(state.typing.values())
    .filter((item) => item.chatKey === activeKey)
    .map((item) => item.name)
    .slice(0, 2);
  el.typing.textContent = names.length ? `${names.join(', ')} печатает...` : '';
}

function setHeader() {
  const item = currentItem();
  el.title.textContent = state.chat.type === 'room' ? `# ${state.chat.title}` : displayName(item);
  el.chatAvatar.outerHTML = avatar(state.chat.type === 'room' ? item : item, 'small').replace('class="avatar small"', 'id="chatAvatar" class="avatar small"');
  el.chatAvatar = document.querySelector('#chatAvatar');
}

function showEmptyChat() {
  state.chat = { type: 'empty', id: null, title: '' };
  state.replyTo = null;
  updateReplyBar();
  renderTyping();
  el.title.textContent = 'Чатов пока нет';
  el.chatAvatar.outerHTML = '<span id="chatAvatar" class="avatar small">N</span>';
  el.chatAvatar = document.querySelector('#chatAvatar');
  el.messages.innerHTML = '<div class="empty-chat"><strong>Здесь пока пусто</strong><span>Создайте комнату или дождитесь приглашения.</span></div>';
  renderLists();
}

async function openRoom(room) {
  if (!room) return showEmptyChat();
  if (state.chat.type === 'room' && state.socket) state.socket.emit('room:leave', { roomId: state.chat.id });
  state.chat = { type: 'room', id: room.id, title: room.name };
  renderTyping();
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
  renderTyping();
  state.replyTo = null;
  state.unread.delete(chatKey('private', user.id));
  updateReplyBar();
  setHeader();
  renderLists();
  const data = await api(`/api/private/${user.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'private')).join('');
  state.socket?.emit('private:read', { userId: user.id });
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
  form.append('file', normalizeUploadFile(file));
  const attachment = (await api('/api/uploads', { method: 'POST', body: form })).attachment;
  return attachment;
}

function isVideoFile(file) {
  return file?.type?.startsWith('video/') || /\.(webm|mp4|mov|3gp)$/i.test(file?.name || '');
}

function mimeFromFilename(filename) {
  const ext = String(filename || '').split('.').pop().toLowerCase();
  return {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    '3gp': 'video/3gpp',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    mp3: 'audio/mpeg',
    wav: 'audio/wav'
  }[ext] || '';
}

function normalizeUploadFile(file) {
  if (file?.type) return file;
  const type = mimeFromFilename(file?.name);
  if (!type) return file;
  return new File([file], file.name, { type, lastModified: file.lastModified || Date.now() });
}

function previewVideo(file) {
  if (!isVideoFile(file)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      el.videoPreview.pause();
      el.videoPreview.removeAttribute('src');
      el.videoPreview.load();
      URL.revokeObjectURL(url);
      el.videoPreviewModal.close();
      resolve(result);
    };
    el.videoPreview.src = url;
    el.videoPreview.currentTime = 0;
    el.cancelVideoPreview.onclick = () => finish(false);
    el.sendVideoPreview.onclick = () => finish(true);
    el.videoPreviewModal.oncancel = (event) => {
      event.preventDefault();
      finish(false);
    };
    el.videoPreviewModal.showModal();
  });
}

function hasRenderedMessage(type, id) {
  return Boolean(document.querySelector(`[data-message-type="${type}"][data-message-id="${id}"]`));
}

function sendMessageAsync(body, attachment = null) {
  if (state.chat.type === 'empty') {
    toast('Сначала выберите или создайте чат.');
    return Promise.reject(new Error('Чат не выбран.'));
  }
  const eventName = state.chat.type === 'room' ? 'message:send' : 'private:send';
  const payload = state.chat.type === 'room'
    ? { roomId: state.chat.id, body, attachment, replyTo: state.replyTo }
    : { receiverId: state.chat.id, body, attachment, replyTo: state.replyTo };
  return new Promise((resolve, reject) => {
    if (!state.socket?.connected) {
      const error = new Error('Нет подключения к серверу.');
      toast(error.message);
      reject(error);
      return;
    }
    state.socket.timeout(8000).emit(eventName, payload, (error, ack) => {
      if (error) {
        const timeoutError = new Error('Сервер не подтвердил отправку. Проверьте подключение.');
        toast(timeoutError.message);
        reject(timeoutError);
        return;
      }
      if (ack?.error) {
        const ackError = new Error(ack.error);
        toast(ackError.message);
        reject(ackError);
        return;
      }
      if (ack?.message && !hasRenderedMessage(state.chat.type, ack.message.id)) addMessage(ack.message, state.chat.type);
      el.input.value = '';
      state.replyTo = null;
      updateReplyBar();
      resolve(ack?.message || null);
    });
  });
}

function sendMessage(body, attachment = null) {
  sendMessageAsync(body, attachment).catch(() => {});
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

async function resolveForwardTargets(input) {
  const targets = [];
  for (const raw of String(input || '').split(',').map((item) => item.trim()).filter(Boolean)) {
    if (raw.startsWith('@')) {
      const username = raw.slice(1).toLowerCase();
      let user = state.users.find((candidate) => candidate.username === username);
      if (!user) user = (await searchUsers(username)).find((candidate) => candidate.username === username);
      if (user) targets.push({ type: 'private', id: user.id });
    }
    if (raw.startsWith('#')) {
      const name = raw.slice(1).toLowerCase();
      const room = state.rooms.find((candidate) => candidate.name.toLowerCase() === name);
      if (room) targets.push({ type: 'room', id: room.id });
    }
  }
  return targets;
}

function setupSocket() {
  state.socket = io({ path: '/socket.io' });
  state.socket.on('connect', () => {
    el.status.textContent = 'online';
    if (state.chat.type === 'room') state.socket.emit('room:join', { roomId: state.chat.id });
    if (state.chat.type === 'private') markCurrentPrivateRead();
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
    const other = ensurePrivateUser(message);
    const otherId = message.sender_id === state.me.id ? message.receiver_id : message.sender_id;
    if (state.chat.type === 'private' && state.chat.id === otherId) addMessage(message, 'private');
    if (message.sender_id !== state.me.id) {
      if (state.chat.type === 'private' && state.chat.id === otherId && document.hasFocus()) state.socket.emit('private:read', { userId: otherId });
      bumpUnread('private', otherId, message.body?.toLowerCase().includes(`@${state.me.username}`));
      showDeviceNotification(`Сообщение от ${message.sender_display_name || message.sender_username}`, message.body || message.attachment_name || 'Медиа', other?.muted);
    }
  });
  state.socket.on('private:read', (event) => {
    for (const id of event.messageIds || []) {
      const status = document.querySelector(`[data-message-type="private"][data-message-id="${id}"] .message-status`);
      if (!status) continue;
      status.classList.remove('delivered');
      status.classList.add('read');
      status.textContent = '✓✓';
      status.title = 'Прочитано';
    }
  });
  state.socket.on('notification:new', (event) => {
    toast(event.title);
    showDeviceNotification(event.title, event.body);
  });
  state.socket.on('message:removed', (event) => removeMessage(event.messageId, event.chatType));
  state.socket.on('message:deleted', (event) => removeMessage(event.message?.id, event.chatType));
  state.socket.on('typing:update', (event) => {
    const scopedChatKey = eventTypingKey(event);
    const key = `${scopedChatKey}:${event.fromUserId || event.user.id}`;
    if (event.typing) state.typing.set(key, { chatKey: scopedChatKey, name: displayName(event.user) });
    else state.typing.delete(key);
    renderTyping();
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
      const targets = await resolveForwardTargets(target);
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

function formatMediaTime(value) {
  if (!Number.isFinite(value)) return '00:00';
  const total = Math.max(0, Math.floor(value));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function updateMediaPlayer(player) {
  const media = player.querySelector('audio, video');
  const progress = player.querySelector('[data-player-progress]');
  const time = player.querySelector('.player-time');
  const play = player.querySelector('[data-player-toggle]');
  if (!media || !progress || !time || !play) return;
  const duration = media.duration || 0;
  progress.value = duration ? Math.round((media.currentTime / duration) * 1000) : 0;
  player.style.setProperty('--player-progress', `${Number(progress.value) / 10}%`);
  time.textContent = formatMediaTime(media.currentTime || duration);
  play.classList.toggle('paused', !media.paused);
  player.classList.toggle('playing', !media.paused);
}

el.messages.addEventListener('click', async (event) => {
  const playButton = event.target.closest('[data-player-toggle]');
  const circlePlayer = event.target.closest('.video-circle-player');
  if (!playButton && !circlePlayer) return;
  if (event.target.closest('[data-player-progress]')) return;
  const player = playButton?.closest('.media-player') || circlePlayer;
  const media = player?.querySelector('audio, video');
  if (!media) return;
  event.preventDefault();
  document.querySelectorAll('.media-player audio, .media-player video').forEach((item) => {
    if (item !== media) item.pause();
  });
  try {
    if (media.paused) await media.play();
    else media.pause();
    updateMediaPlayer(player);
  } catch (_error) {
    toast('Не удалось воспроизвести медиа.');
  }
});

el.messages.addEventListener('input', (event) => {
  const progress = event.target.closest('[data-player-progress]');
  if (!progress) return;
  const player = progress.closest('.media-player');
  const media = player?.querySelector('audio, video');
  if (!media || !media.duration) return;
  media.currentTime = (Number(progress.value) / 1000) * media.duration;
  updateMediaPlayer(player);
});

el.messages.addEventListener('timeupdate', (event) => {
  const player = event.target.closest('.media-player');
  if (player) updateMediaPlayer(player);
}, true);

el.messages.addEventListener('loadedmetadata', (event) => {
  const player = event.target.closest('.media-player');
  if (player) updateMediaPlayer(player);
}, true);

el.messages.addEventListener('play', (event) => {
  const player = event.target.closest('.media-player');
  if (player) updateMediaPlayer(player);
}, true);

el.messages.addEventListener('pause', (event) => {
  const player = event.target.closest('.media-player');
  if (player) updateMediaPlayer(player);
}, true);

el.messages.addEventListener('ended', (event) => {
  const player = event.target.closest('.media-player');
  if (player) updateMediaPlayer(player);
}, true);

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
    if (!await previewVideo(file)) return;
    const attachment = await uploadFile(file);
    sendMessage(el.input.value.trim(), attachment);
  } catch (error) {
    toast(error.message);
  } finally {
    el.fileInput.value = '';
  }
});

function updateRecordButton() {
  if (state.recordStarting || state.recorder?.state === 'recording') return;
  if (!canRecordVideoMessage()) state.recordMode = 'audio';
  if (el.cameraModeButton) el.cameraModeButton.hidden = state.recordMode !== 'video' || !canRecordVideoMessage();
  el.recordButton.classList.toggle('mic-icon', state.recordMode === 'audio');
  el.recordButton.classList.toggle('video-icon', state.recordMode === 'video');
  el.recordButton.title = state.recordMode === 'audio'
    ? (canRecordVideoMessage() ? 'Голосовое. Тап: переключить на видео. Удерживайте для записи' : 'Голосовое. Удерживайте для записи')
    : 'Видеосообщение. Тап: переключить на голос. Удерживайте для записи';
}

function canRecordVideoMessage() {
  const mobileUa = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const touchDevice = navigator.maxTouchPoints > 0;
  return mobileUa || (touchDevice && window.matchMedia('(pointer: coarse)').matches) || window.innerWidth <= 760;
}

function mediaConstraints(kind, facing = state.cameraFacing) {
  return kind === 'video'
    ? { audio: true, video: { facingMode: { ideal: facing }, width: { ideal: 480 }, height: { ideal: 480 } } }
    : { audio: { echoCancellation: true, noiseSuppression: true } };
}

async function requestMediaStream(kind, preferredFacing = state.cameraFacing) {
  try {
    return await navigator.mediaDevices.getUserMedia(mediaConstraints(kind, preferredFacing));
  } catch (error) {
    if (kind !== 'video') throw error;
    const fallbackFacing = preferredFacing === 'user' ? 'environment' : 'user';
    try {
      return await navigator.mediaDevices.getUserMedia(mediaConstraints('video', fallbackFacing));
    } catch (_fallbackError) {
      return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    }
  }
}

async function primeMediaPermission(kind) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) return;
  try {
    const stream = await requestMediaStream(kind);
    stream.getTracks().forEach((track) => track.stop());
    toast(kind === 'video' ? 'Камера готова. Удерживайте кнопку для записи кружка.' : 'Микрофон готов.');
  } catch (error) {
    if (error.name === 'NotAllowedError') toast('Камера заблокирована. Проверьте HTTPS и Permissions-Policy в Nginx.');
    else toast('Не удалось получить доступ к камере или микрофону.');
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function updateRecordTimer() {
  el.recordTimer.textContent = formatDuration(Date.now() - state.recordingStartedAt);
}

async function showLiveRecordPreview(stream) {
  state.recordStream = stream;
  el.recordLivePreview.srcObject = stream;
  el.recordPreviewOverlay.hidden = false;
  el.recordTimer.textContent = '00:00';
  clearInterval(state.recordTimerInterval);
  state.recordTimerInterval = setInterval(updateRecordTimer, 250);
  try {
    await el.recordLivePreview.play();
    setTimeout(() => {
      if (!el.recordPreviewOverlay.hidden && (!el.recordLivePreview.videoWidth || !el.recordLivePreview.videoHeight)) {
        toast('Предпросмотр камеры пустой. Нажмите ↻ и попробуйте другую камеру.');
      }
    }, 1100);
  } catch (_error) {
    toast('Камера открыта, но браузер не показал предпросмотр. Попробуйте сменить камеру.');
  }
}

function hideLiveRecordPreview() {
  clearInterval(state.recordTimerInterval);
  state.recordTimerInterval = null;
  el.recordLivePreview.pause();
  el.recordLivePreview.srcObject = null;
  el.recordPreviewOverlay.hidden = true;
  state.recordStream = null;
}

function switchCameraPreference() {
  state.cameraFacing = state.cameraFacing === 'user' ? 'environment' : 'user';
  toast(state.cameraFacing === 'user' ? 'Камера: фронтальная.' : 'Камера: основная.');
}

async function startRecording(kind) {
  if (state.recordStarting || state.recorder?.state === 'recording') return;
  state.recordStarting = true;
  state.stopAfterStart = false;
  state.recordingKind = kind;
  try {
    if (!window.isSecureContext) {
      state.recordStarting = false;
      return toast('Для микрофона и камеры откройте сайт через HTTPS.');
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      state.recordStarting = false;
      return toast('Этот браузер не поддерживает запись аудио или видео.');
    }
    toast(kind === 'video' ? 'Разрешите доступ к камере и микрофону.' : 'Разрешите доступ к микрофону.');
    const stream = await requestMediaStream(kind);
    state.chunks = [];
    const audioTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'];
    const videoTypes = ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mimeType = (kind === 'video' ? videoTypes : audioTypes).find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const recorderOptions = {
      ...(mimeType ? { mimeType } : {}),
      ...(kind === 'video' ? { videoBitsPerSecond: 700000, audioBitsPerSecond: 64000 } : { audioBitsPerSecond: 64000 })
    };
    state.recorder = new MediaRecorder(stream, recorderOptions);
    state.recorder.ondataavailable = (event) => event.data.size && state.chunks.push(event.data);
    state.recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      try {
        const type = state.recorder.mimeType || (kind === 'video' ? 'video/webm' : 'audio/webm');
        const ext = type.includes('mp4') || type.includes('aac') ? 'mp4' : 'webm';
        if (!state.chunks.length) return toast('Запись получилась пустой. Попробуйте удерживать кнопку дольше.');
        const file = new File([new Blob(state.chunks, { type })], `${kind}-${Date.now()}.${ext}`, { type });
        if (!await previewVideo(file)) return;
        toast('Отправляю видеосообщение...');
        const attachment = await uploadFile(file);
        await sendMessageAsync('', attachment);
        toast('Видеосообщение отправлено.');
      } catch (error) {
        toast(error.message || 'Не удалось отправить запись.');
      } finally {
        el.recordButton.classList.remove('recording');
        state.recorder = null;
        state.recordStarting = false;
        state.stopAfterStart = false;
        state.recordingKind = null;
        state.recordingStartedAt = 0;
        clearTimeout(state.recordStopTimer);
        state.recordStopTimer = null;
        hideLiveRecordPreview();
        updateRecordButton();
      }
    };
    state.recorder.start(250);
    state.recordingStartedAt = Date.now();
    state.recordStarting = false;
    el.recordButton.classList.add('recording');
    if (kind === 'video') showLiveRecordPreview(stream);
    toast(kind === 'video' ? 'Идёт запись видео. Отпустите кнопку для отправки.' : 'Идёт запись голоса. Отпустите кнопку для отправки.');
    if (state.stopAfterStart) {
      setTimeout(stopRecording, 1000);
    }
  } catch (error) {
    state.recordStarting = false;
    state.stopAfterStart = false;
    state.recordingKind = null;
    state.recordingStartedAt = 0;
    el.recordButton.classList.remove('recording');
    hideLiveRecordPreview();
    if (error.name === 'NotAllowedError') return toast('Камера заблокирована. Проверьте HTTPS и Permissions-Policy в Nginx.');
    if (error.name === 'NotFoundError') return toast('Микрофон или камера не найдены.');
    if (error.name === 'NotReadableError') return toast('Устройство уже используется другим приложением.');
    toast('Браузер не дал доступ к микрофону или камере.');
  }
}

function stopRecording() {
  if (state.recordStarting) {
    state.stopAfterStart = true;
    return;
  }
  if (state.recorder?.state !== 'recording') return;
  const elapsed = Date.now() - state.recordingStartedAt;
  const finish = () => {
    try {
      state.recorder?.requestData?.();
    } catch (_error) {
      // Some mobile browsers throw if data is already being flushed.
    }
    setTimeout(() => {
      if (state.recorder?.state === 'recording') state.recorder.stop();
    }, 80);
  };
  clearTimeout(state.recordStopTimer);
  if (elapsed < 1000) state.recordStopTimer = setTimeout(finish, 1000 - elapsed);
  else finish();
}

function resetRecordPress() {
  state.recordPressStarted = false;
  state.recordPointerId = null;
}

el.recordButton.addEventListener('pointerdown', (event) => {
  if (event.button !== undefined && event.button !== 0) return;
  if (state.recordStarting || state.recorder?.state === 'recording') return;
  event.preventDefault();
  state.recordPressStarted = false;
  state.recordPointerId = event.pointerId;
  el.recordButton.setPointerCapture?.(event.pointerId);
  state.recordHoldTimer = setTimeout(async () => {
    state.recordPressStarted = true;
    await startRecording(state.recordMode);
  }, 260);
});

el.recordButton.addEventListener('pointerup', (event) => {
  event.preventDefault();
  clearTimeout(state.recordHoldTimer);
  if (state.recordPressStarted) {
    stopRecording();
  } else {
    if (state.recordStarting || state.recorder?.state === 'recording') {
      resetRecordPress();
      return;
    }
    if (!canRecordVideoMessage()) {
      toast('На ПК доступна запись голоса. Удерживайте кнопку для записи.');
      updateRecordButton();
      resetRecordPress();
      return;
    }
    state.recordMode = state.recordMode === 'audio' ? 'video' : 'audio';
    updateRecordButton();
    toast(state.recordMode === 'audio' ? 'Режим: голосовое сообщение.' : 'Режим: видеосообщение.');
    if (state.recordMode === 'video') {
      toast('Режим: видеосообщение. Удерживайте для записи, ↻ сменит камеру в окне записи.');
      void primeMediaPermission('video');
    }
  }
  resetRecordPress();
});

el.recordButton.addEventListener('pointercancel', () => {
  clearTimeout(state.recordHoldTimer);
  stopRecording();
  resetRecordPress();
});
el.recordButton.addEventListener('contextmenu', (event) => event.preventDefault());
el.cameraModeButton.addEventListener('click', (event) => {
  event.preventDefault();
  switchCameraPreference();
  void primeMediaPermission('video');
});
el.switchCameraButton.addEventListener('click', (event) => {
  event.preventDefault();
  if (state.recorder?.state === 'recording' || state.recordStarting) {
    toast('Сменить камеру можно перед новой записью.');
    return;
  }
  switchCameraPreference();
});
updateRecordButton();
window.addEventListener('resize', updateRecordButton);

let typingSent = false;
let typingTimeout;
el.input.addEventListener('input', () => {
  if (!state.socket || state.chat.type === 'empty') return;
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

async function searchUsers(query) {
  const value = String(query || '').trim().replace(/^@/, '');
  if (value.length < 2) return [];
  return (await api(`/api/users/search?q=${encodeURIComponent(value)}`)).users;
}

async function inviteUserToCurrentRoom(userId) {
  await api(`/api/rooms/${state.chat.id}/invite`, { method: 'POST', body: JSON.stringify({ userId }) });
  toast('Пользователь приглашён.');
  el.userSearchInput.value = '';
  el.userSearchResults.innerHTML = '';
}

function renderUserSearchResults(users) {
  el.userSearchResults.innerHTML = users.length
    ? users.map((user) => `
      <button class="search-result" type="button" data-invite-user="${user.id}">
        ${avatar(user, 'small')}
        <span>${escapeHtml(displayName(user))}</span>
        <small>@${escapeHtml(user.username)}</small>
      </button>
    `).join('')
    : '<p class="muted-text">Ничего не найдено.</p>';
}

el.chatHeaderButton.onclick = async () => {
  const item = currentItem();
  if (!item) return;
  document.querySelector('#roomSettingsModal h2').textContent = state.chat.type === 'room' ? `# ${item.name}` : displayName(item);
  el.roomAvatarPreview.innerHTML = avatar(item, 'large');
  const canInvite = state.chat.type === 'room' && item.role === 'admin';
  document.querySelector('#inviteButton').hidden = !canInvite;
  el.inviteSearch.hidden = !canInvite;
  el.userSearchInput.value = '';
  el.userSearchResults.innerHTML = '';
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
  const found = await searchUsers(username);
  const clean = username.trim().replace(/^@/, '').toLowerCase();
  const user = found.find((candidate) => candidate.username === clean) || found[0];
  if (!user) return toast('Пользователь не найден.');
  await inviteUserToCurrentRoom(user.id);
};
let userSearchTimer = null;
el.userSearchInput.addEventListener('input', () => {
  clearTimeout(userSearchTimer);
  userSearchTimer = setTimeout(async () => {
    try {
      renderUserSearchResults(await searchUsers(el.userSearchInput.value));
    } catch (error) {
      toast(error.message);
    }
  }, 250);
});

el.userSearchResults.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-invite-user]');
  if (!button) return;
  try {
    await inviteUserToCurrentRoom(Number(button.dataset.inviteUser));
  } catch (error) {
    toast(error.message);
  }
});

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
    el.loadingScreen.classList.add('done');
  } catch (_error) {
    location.href = '/login.html';
  }
}());
