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
  longPressTimer: null,
  longPressTriggered: false,
  lastReactionTap: null
};

const el = {
  sidebar: document.querySelector('#sidebar'),
  rooms: document.querySelector('#roomsList'),
  users: document.querySelector('#usersList'),
  peopleSearchInput: document.querySelector('#peopleSearchInput'),
  peopleSearchButton: document.querySelector('#peopleSearchButton'),
  peopleContactsList: document.querySelector('#peopleContactsList'),
  peopleSearchResults: document.querySelector('#peopleSearchResults'),
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
  inspectorAvatar: document.querySelector('#inspectorAvatar'),
  inspectorTitle: document.querySelector('#inspectorTitle'),
  inspectorMeta: document.querySelector('#inspectorMeta'),
  inspectorMembersList: document.querySelector('#inspectorMembersList'),
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
  toastClose: document.querySelector('#toastClose'),
  adminModal: document.querySelector('#adminModal'),
  adminLoginForm: document.querySelector('#adminLoginForm'),
  adminWorkspace: document.querySelector('#adminWorkspace'),
  adminCodesList: document.querySelector('#adminCodesList'),
  registrationCodeModal: document.querySelector('#registrationCodeModal'),
  newRegistrationCode: document.querySelector('#newRegistrationCode')
};

const chatKey = (type, id) => `${type}:${id}`;
const escapeHtml = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
const displayName = (user) => user?.display_name || user?.username || user?.name || '?';
const mediaSrc = (url) => {
  const value = String(url || '');
  if (value.startsWith('/uploads/')) return `/api/uploads/file/${encodeURIComponent(value.split('/').pop())}`;
  return value;
};
let toastTimer = null;
let keyboardOpen = false;
let scrollLatestTimer = null;

function scrollToLatest(behavior = 'auto') {
  if (!el.messages) return;
  el.messages.scrollTo({ top: el.messages.scrollHeight, behavior });
}

function scheduleScrollToLatest() {
  clearTimeout(scrollLatestTimer);
  requestAnimationFrame(() => scrollToLatest());
  scrollLatestTimer = setTimeout(() => scrollToLatest(), 180);
}

function setAppHeight() {
  const height = window.visualViewport?.height || window.innerHeight;
  const nextKeyboardOpen = Boolean(window.visualViewport && window.visualViewport.height < window.innerHeight - 90);
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
  document.body.classList.toggle('keyboard-open', nextKeyboardOpen);
  if (nextKeyboardOpen && (!keyboardOpen || document.activeElement === el.input)) {
    window.scrollTo(0, 0);
    scheduleScrollToLatest();
  }
  keyboardOpen = nextKeyboardOpen;
}

setAppHeight();
window.addEventListener('resize', setAppHeight);
window.addEventListener('orientationchange', setAppHeight);
window.visualViewport?.addEventListener('resize', setAppHeight);
window.visualViewport?.addEventListener('scroll', setAppHeight);
el.input.addEventListener('focus', () => {
  document.body.classList.add('keyboard-open');
  keyboardOpen = true;
  scheduleScrollToLatest();
});

function markCurrentPrivateRead() {
  if (state.chat.type === 'private' && state.socket?.connected) {
    state.socket.emit('private:read', { userId: state.chat.id });
  }
}

function sendActiveState() {
  const active = !document.hidden;
  state.socket?.emit('app:active', { active });
}

function setConnectionStatus(status) {
  if (state.chat.type === 'private') updateHeaderStatus();
  else if (el.status) el.status.textContent = status;
  document.body.dataset.connection = status;
}

window.addEventListener('focus', () => {
  markCurrentPrivateRead();
  sendActiveState();
});
window.addEventListener('blur', sendActiveState);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) markCurrentPrivateRead();
  sendActiveState();
});

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || 12000);
  const headers = options.body instanceof FormData ? options.headers || {} : { 'Content-Type': 'application/json', ...(options.headers || {}) };
  try {
    const response = await fetch(path, { headers, ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || 'Ошибка запроса.');
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Сервер не ответил вовремя. Обновите страницу.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function showBootError(error) {
  if (!el.loadingScreen) return;
  el.loadingScreen.innerHTML = `
    <div class="loading-desktop boot-error">
      <span class="logo-mark large">N</span>
      <div>
        <strong>Nexus</strong>
        <p>${escapeHtml(error.message || 'Не удалось загрузить приложение.')}</p>
        <button type="button" id="reloadAppButton">Обновить</button>
      </div>
    </div>
  `;
  document.querySelector('#reloadAppButton')?.addEventListener('click', () => location.reload());
}

function toast(message) {
  clearTimeout(toastTimer);
  el.toastText.textContent = message;
  el.toast.classList.add('show');
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
}

function adminCodeOwner(row) {
  if (!row.user_id) return '<span class="muted-text">Свободный код</span>';
  const name = escapeHtml(row.display_name || row.username || 'Пользователь');
  return `<strong>${name}</strong><small>@${escapeHtml(row.username || '')}</small>`;
}

function renderAdminCodes(codes = []) {
  if (!el.adminCodesList) return;
  el.adminCodesList.innerHTML = codes.length
    ? codes.map((row) => `
      <div class="admin-code-row">
        <div>${adminCodeOwner(row)}</div>
        <button type="button" data-copy-code="${escapeHtml(row.code)}">${escapeHtml(row.code)}</button>
      </div>
    `).join('')
    : '<p class="muted-text">Кодов пока нет.</p>';
}

async function loadAdminCodes() {
  const data = await api('/api/admin/codes');
  renderAdminCodes(data.codes || []);
  el.adminLoginForm.hidden = true;
  el.adminWorkspace.hidden = false;
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

function setupPeoplePanel() {
  const peoplePanel = document.querySelector('[data-sidebar-panel="people"]');
  const searchLabel = document.querySelector('.people-search');
  if (!peoplePanel || !searchLabel || !el.peopleSearchResults || !el.peopleContactsList || peoplePanel.querySelector('.people-search-block')) return;

  const searchBlock = document.createElement('div');
  searchBlock.className = 'people-block people-search-block';
  searchLabel.before(searchBlock);
  searchBlock.append(searchLabel, el.peopleSearchResults);

  const savedBlock = document.createElement('div');
  savedBlock.className = 'people-block people-saved-block';
  savedBlock.innerHTML = '<div class="subsection-title">Сохраненные контакты</div>';
  savedBlock.append(el.peopleContactsList);
  peoplePanel.append(savedBlock);
}

function ensureChangelogModal() {
  let modal = document.querySelector('#changelogModal');
  if (modal) return modal;
  modal = document.createElement('dialog');
  modal.id = 'changelogModal';
  modal.innerHTML = `
    <div class="modal-form changelog-modal">
      <div class="changelog-head">
        <span class="logo-mark">N</span>
        <div>
          <h2>Что нового в Nexus</h2>
          <p id="changelogVersion" class="muted-text"></p>
        </div>
      </div>
      <div id="changelogItems" class="changelog-items"></div>
      <button id="closeChangelog" type="button">Понятно</button>
    </div>
  `;
  document.body.append(modal);
  return modal;
}

async function showChangelogIfNeeded() {
  const changelog = (await import(`/js/changelog.js?v=${Date.now()}`).catch(() => null))?.default;
  if (!changelog?.version) return;
  const key = 'nexus:lastSeenChangelogVersion';
  if (localStorage.getItem(key) === changelog.version) return;
  if (document.querySelector('dialog[open]:not(#changelogModal)')) {
    setTimeout(showChangelogIfNeeded, 600);
    return;
  }

  const modal = ensureChangelogModal();
  modal.querySelector('#changelogVersion').textContent = `Версия ${changelog.version}`;
  modal.querySelector('#changelogItems').innerHTML = (changelog.items || []).map((item) => `
    <div class="changelog-item">
      <span></span>
      <p>${escapeHtml(item)}</p>
    </div>
  `).join('');

  const close = () => {
    localStorage.setItem(key, changelog.version);
    modal.close();
  };
  modal.querySelector('#closeChangelog').onclick = close;
  modal.addEventListener('cancel', () => localStorage.setItem(key, changelog.version), { once: true });
  modal.showModal();
}

setupPeoplePanel();

function getDefaultReaction() {
  const value = localStorage.getItem('nexus:defaultReaction') || 'heart';
  return reactionIcons[value] ? value : 'heart';
}

function setupDefaultReactionSetting() {
  if (!el.settingsModal || document.querySelector('#defaultReactionSelect')) return;
  const label = document.createElement('label');
  label.className = 'settings-field';
  label.innerHTML = `
    <span>Реакция по двойному клику</span>
    <select id="defaultReactionSelect">
      ${Object.entries(reactionIcons).map(([key, icon]) => `<option value="${key}">${icon}</option>`).join('')}
    </select>
  `;
  const closeButton = document.querySelector('#closeSettings');
  closeButton?.before(label);
  const select = label.querySelector('select');
  select.value = getDefaultReaction();
  select.addEventListener('change', () => localStorage.setItem('nexus:defaultReaction', select.value));
}

function avatar(entity, size = '') {
  const cls = `avatar ${size}`;
  const base = displayName(entity).slice(0, 2).toUpperCase();
  if (entity?.avatar_url) {
    return `<span class="${cls}" data-fallback="${escapeHtml(base)}"><img src="${escapeHtml(mediaSrc(entity.avatar_url))}" alt=""></span>`;
  }
  return `<span class="${cls}">${escapeHtml(base)}</span>`;
}

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.closest('.avatar')) return;
  const holder = image.closest('.avatar');
  const fallback = holder.dataset.fallback || '??';
  image.remove();
  holder.textContent = fallback;
}, true);

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

function saveLastChat(type, id) {
  if (type && id) localStorage.setItem('nexus:lastChat', `${type}:${id}`);
}

function findLastChat() {
  const [type, rawId] = String(localStorage.getItem('nexus:lastChat') || '').split(':');
  const id = Number(rawId);
  if (type === 'room') return { type, item: state.rooms.find((room) => room.id === id) };
  if (type === 'private') return { type, item: state.users.find((user) => user.id === id) };
  return null;
}

function renderInspectorMembers(users = []) {
  if (!el.inspectorMembersList) return;
  el.inspectorMembersList.innerHTML = users.length
    ? users.map((user) => `
      <div class="inspector-member">
        ${avatar(user, 'small')}
        <span>${escapeHtml(displayName(user))}</span>
        <small>@${escapeHtml(user.username)}</small>
      </div>
    `).join('')
    : '<p class="muted-text">No participants yet.</p>';
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
  if (el.peopleContactsList) {
    el.peopleContactsList.innerHTML = state.users.length
      ? state.users.map((user) => `
        <button class="list-item ${state.chat.type === 'private' && state.chat.id === user.id ? 'active' : ''}" data-user="${user.id}">
          ${avatar(user, 'small')}
          <span>${escapeHtml(displayName(user))}</span>
          <small>@${escapeHtml(user.username)}</small>
        </button>
      `).join('')
      : '<p class="muted-text">Контактов пока нет.</p>';
  }
}

function setSidebarMode(mode) {
  document.querySelectorAll('[data-sidebar-panel]').forEach((panel) => {
    panel.hidden = panel.dataset.sidebarPanel !== mode;
  });
  document.querySelectorAll('[data-rail-action]').forEach((item) => {
    item.classList.toggle('active', item.dataset.railAction === mode);
  });
  setSidebarOpen(innerWidth < 760);
}

function setSidebarOpen(open) {
  el.sidebar.classList.toggle('open', open);
  document.body.classList.toggle('sidebar-open', open);
}

function renderPeopleSearchResults(users) {
  if (!el.peopleSearchResults) return;
  if (!String(el.peopleSearchInput?.value || '').trim()) {
    el.peopleSearchResults.innerHTML = '<p class="muted-text">Введите username, чтобы найти пользователя.</p>';
    return;
  }
  el.peopleSearchResults.innerHTML = users.length
    ? users.map((user) => `
      <button class="list-item" type="button" data-people-user="${user.id}">
        ${avatar(user, 'small')}
        <span>${escapeHtml(displayName(user))}</span>
        <small>@${escapeHtml(user.username)}</small>
      </button>
    `).join('')
    : '<p class="muted-text">Ничего не найдено.</p>';
}

function bodyHtml(body) {
  return escapeHtml(body).replace(/@([a-z0-9_]{3,32})/gi, '<mark>@$1</mark>');
}

const reactionIcons = { heart: '❤️', like: '👍', fire: '🔥', cry: '😢', angry: '😡', dislike: '👎' };

setupDefaultReactionSetting();

function attachmentKind(message) {
  const declared = String(message.attachment_type || '').toLowerCase();
  if (['image', 'video', 'audio'].includes(declared)) return declared;
  if (declared.startsWith('image/')) return 'image';
  if (declared.startsWith('video/')) return 'video';
  if (declared.startsWith('audio/')) return 'audio';
  const source = `${message.attachment_name || ''} ${message.attachment_url || ''}`.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)(\?|#|$|\s)/.test(source)) return 'image';
  if (/\.(webm|mp4|mov|m4v|3gp|ogv)(\?|#|$|\s)/.test(source)) return 'video';
  if (/\.(webm|mp3|m4a|aac|wav|ogg|oga)(\?|#|$|\s)/.test(source)) return 'audio';
  return 'file';
}

function reactionsHtml(message) {
  const counts = message.reactions || {};
  const entries = Object.entries(reactionIcons).filter(([key]) => counts[key] || message.my_reaction === key);
  return `
    <div class="reactions" data-reactions>
      ${entries.map(([key, icon]) => `
        <button class="reaction-chip ${message.my_reaction === key ? 'active' : ''}" type="button" data-react="${key}">
          <span>${icon}</span>
          <b>${counts[key] || 1}</b>
        </button>
      `).join('')}
    </div>
  `;
}

function attachmentHtml(message) {
  if (!message.attachment_url) return '';
  const url = escapeHtml(mediaSrc(message.attachment_url));
  const name = escapeHtml(message.attachment_name || 'media');
  const kind = attachmentKind(message);
  if (kind === 'image') return `<img class="media image-media" src="${url}" alt="${name}">`;
  if (kind === 'video') {
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
  if (kind === 'audio') {
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
        ${reactionsHtml(message)}
      </div>
    </article>
  `;
}

function addMessage(message, type) {
  el.messages.insertAdjacentHTML('beforeend', renderMessage(message, type));
  scrollToLatest('smooth');
}

function updateMessageReactions(event) {
  const message = document.querySelector(`[data-message-type="${event.chatType}"][data-message-id="${event.messageId}"]`);
  const holder = message?.querySelector('[data-reactions]');
  if (!holder) return;
  holder.innerHTML = Object.entries(reactionIcons)
    .filter(([key]) => event.reactions?.[key] || event.my_reaction === key)
    .map(([key, icon]) => `
      <button class="reaction-chip ${event.my_reaction === key ? 'active' : ''}" type="button" data-react="${key}">
        <span>${icon}</span>
        <b>${event.reactions?.[key] || 1}</b>
      </button>
    `).join('');
}

function reactToMessage(message, reaction = getDefaultReaction()) {
  if (!message || !state.socket?.connected) return;
  state.socket.emit('message:react', {
    chatType: message.dataset.messageType,
    messageId: Number(message.dataset.messageId),
    reaction
  }, (ack) => {
    if (ack?.error) toast(ack.error);
    else if (ack?.ok) updateMessageReactions(ack);
  });
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
  if (el.inspectorAvatar) el.inspectorAvatar.innerHTML = avatar(item, 'large');
  if (el.inspectorTitle) el.inspectorTitle.textContent = state.chat.type === 'room' ? `# ${state.chat.title}` : displayName(item);
  if (el.inspectorMeta) {
    const type = state.chat.type === 'room' ? 'Room workspace' : `@${item?.username || 'user'}`;
    const muted = currentChatMuted() ? ' · muted' : '';
    el.inspectorMeta.textContent = `${type}${muted}`;
  }
}

function updateHeaderStatus() {
  if (!el.status) return;
  if (!state.socket?.connected) {
    el.status.textContent = 'offline';
    return;
  }
  if (state.chat.type === 'private') {
    el.status.textContent = state.onlineIds.has(state.chat.id) ? 'online' : 'offline';
    return;
  }
  el.status.textContent = state.socket?.connected ? 'online' : 'offline';
}

function showEmptyChat() {
  state.chat = { type: 'empty', id: null, title: '' };
  state.replyTo = null;
  updateReplyBar();
  renderTyping();
  el.title.textContent = 'Чатов пока нет';
  el.chatAvatar.outerHTML = '<span id="chatAvatar" class="avatar small">N</span>';
  el.chatAvatar = document.querySelector('#chatAvatar');
  if (el.inspectorAvatar) el.inspectorAvatar.innerHTML = '<span class="avatar large">N</span>';
  if (el.inspectorTitle) el.inspectorTitle.textContent = 'Nexus';
  if (el.inspectorMeta) el.inspectorMeta.textContent = 'No active chat';
  renderInspectorMembers([]);
  el.messages.innerHTML = '<div class="empty-chat"><strong>Здесь пока пусто</strong><span>Создайте комнату или дождитесь приглашения.</span></div>';
  renderLists();
}

async function openRoom(room) {
  if (!room) return showEmptyChat();
  saveLastChat('room', room.id);
  if (state.chat.type === 'room' && state.socket) state.socket.emit('room:leave', { roomId: state.chat.id });
  state.chat = { type: 'room', id: room.id, title: room.name };
  renderTyping();
  state.replyTo = null;
  state.unread.delete(chatKey('room', room.id));
  updateReplyBar();
  setHeader();
  updateHeaderStatus();
  renderLists();
  const data = await api(`/api/rooms/${room.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'room')).join('');
  try {
    const members = await api(`/api/rooms/${room.id}/members`);
    renderInspectorMembers(members.members);
  } catch (_error) {
    renderInspectorMembers([]);
  }
  state.socket?.emit('room:join', { roomId: room.id }, (ack) => ack?.error && toast(ack.error));
  scheduleScrollToLatest();
}

async function openPrivate(user) {
  if (!user) return;
  saveLastChat('private', user.id);
  state.chat = { type: 'private', id: user.id, title: user.username };
  renderTyping();
  state.replyTo = null;
  state.unread.delete(chatKey('private', user.id));
  updateReplyBar();
  setHeader();
  updateHeaderStatus();
  renderLists();
  state.socket?.emit('private:read', { userId: user.id });
  const data = await api(`/api/private/${user.id}/messages`);
  el.messages.innerHTML = data.messages.map((msg) => renderMessage(msg, 'private')).join('');
  renderInspectorMembers([user, state.me].filter(Boolean));
  scheduleScrollToLatest();
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

async function showDeviceNotification(title, body, muted = false) {
  if (muted || !('Notification' in window) || Notification.permission !== 'granted' || document.hasFocus()) return;
  if (await window.nexusPwa?.hasPushSubscription?.().catch(() => false)) return;
  const shown = await window.nexusPwa?.showNotification(title, { body, data: { url: '/' } }).catch(() => false);
  if (!shown) new Notification(title, { body });
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
    setConnectionStatus('online');
    sendActiveState();
    if (state.chat.type === 'room') state.socket.emit('room:join', { roomId: state.chat.id });
    if (state.chat.type === 'private') markCurrentPrivateRead();
  });
  state.socket.on('disconnect', () => { setConnectionStatus('offline'); });
  state.socket.on('connect_error', (error) => toast(error.message));
  state.socket.on('presence:update', (users) => {
    state.onlineIds = new Set(users.map((user) => user.id));
    updateHeaderStatus();
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
  state.socket.on('message:reaction', updateMessageReactions);
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
  if (!el.contextMenu.querySelector('[data-reaction-picker]')) {
    el.contextMenu.insertAdjacentHTML('afterbegin', `
      <div class="reaction-picker" data-reaction-picker>
        ${Object.entries(reactionIcons).map(([key, icon]) => `
          <button class="reaction-pick" type="button" data-reaction-pick="${key}" aria-label="${key}">${icon}</button>
        `).join('')}
      </div>
    `);
  }
  el.contextMenu.style.left = `${Math.min(x, innerWidth - 244)}px`;
  el.contextMenu.style.top = `${Math.min(y, innerHeight - 210)}px`;
  el.contextMenu.hidden = false;
}

document.addEventListener('click', async (event) => {
  if (!event.target.closest('#contextMenu')) el.contextMenu.hidden = true;
  if (event.target.closest('[data-cancel-reply]')) {
    state.replyTo = null;
    updateReplyBar();
    return;
  }
  const pickedReaction = event.target.closest('[data-reaction-pick]')?.dataset.reactionPick;
  if (pickedReaction && state.contextMessage) {
    const message = document.querySelector(`[data-message-type="${state.contextMessage.type}"][data-message-id="${state.contextMessage.id}"]`);
    reactToMessage(message, pickedReaction);
    el.contextMenu.hidden = true;
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
  if (innerWidth < 760 && (roomButton || userButton)) setSidebarOpen(false);
});

el.messages.addEventListener('contextmenu', (event) => {
  const message = event.target.closest('[data-message-id]');
  if (!message) return;
  event.preventDefault();
  openContextMenu(message, event.clientX, event.clientY);
});
el.messages.addEventListener('dblclick', (event) => {
  if (event.target.closest('[data-react], .media-player, .message-action, [data-player-progress]')) return;
  const message = event.target.closest('[data-message-id]');
  if (!message) return;
  event.preventDefault();
  reactToMessage(message, getDefaultReaction());
});
el.messages.addEventListener('touchstart', (event) => {
  const message = event.target.closest('[data-message-id]');
  if (!message) return;
  state.longPressTriggered = false;
  state.longPressTimer = setTimeout(() => {
    state.longPressTriggered = true;
    openContextMenu(message, event.touches[0].clientX, event.touches[0].clientY);
  }, 520);
}, { passive: true });
el.messages.addEventListener('touchend', (event) => {
  clearTimeout(state.longPressTimer);
  if (state.longPressTriggered) return;
  if (event.target.closest('[data-react], .media-player, .message-action, [data-player-progress]')) return;
  const message = event.target.closest('[data-message-id]');
  const touch = event.changedTouches[0];
  if (!message || !touch) return;
  const now = Date.now();
  const current = { id: message.dataset.messageId, type: message.dataset.messageType, x: touch.clientX, y: touch.clientY, time: now };
  const previous = state.lastReactionTap;
  const sameMessage = previous && previous.id === current.id && previous.type === current.type;
  const closeEnough = previous && Math.abs(previous.x - current.x) < 30 && Math.abs(previous.y - current.y) < 30;
  if (sameMessage && closeEnough && now - previous.time < 330) {
    event.preventDefault();
    state.lastReactionTap = null;
    reactToMessage(message, getDefaultReaction());
    return;
  }
  state.lastReactionTap = current;
}, { passive: false });
['touchmove', 'touchcancel'].forEach((name) => el.messages.addEventListener(name, () => {
  clearTimeout(state.longPressTimer);
  state.longPressTriggered = false;
}, { passive: true }));

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
  const reactionButton = event.target.closest('[data-react]');
  if (reactionButton) {
    const message = reactionButton.closest('[data-message-id]');
    event.preventDefault();
    reactToMessage(message, reactionButton.dataset.react);
    return;
  }
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
  try {
    if (!window.nexusPwa?.isPushSupported?.()) return toast('Браузер не поддерживает push-уведомления.');
    await window.nexusPwa.subscribePush();
    toast('Push-уведомления включены.');
  } catch (error) {
    toast(error.message || 'Не удалось включить уведомления.');
  }
};
document.querySelector('#copyUsernameButton').onclick = async () => {
  await navigator.clipboard.writeText(`@${state.me.username}`);
  toast('Username скопирован.');
};

document.querySelector('#adminOpenButton').onclick = async () => {
  el.adminModal.showModal();
  try {
    await loadAdminCodes();
  } catch (_error) {
    el.adminLoginForm.hidden = false;
    el.adminWorkspace.hidden = true;
  }
};
document.querySelector('#adminCloseButton').onclick = () => el.adminModal.close();
el.adminLoginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = new FormData(el.adminLoginForm).get('password');
  try {
    await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    el.adminLoginForm.reset();
    await loadAdminCodes();
    toast('Вход администратора выполнен.');
  } catch (error) {
    toast(error.message);
  }
});
document.querySelector('#adminRefreshButton').onclick = () => loadAdminCodes().catch((error) => toast(error.message));
document.querySelector('#adminAddCodeButton').onclick = async () => {
  try {
    const data = await api('/api/admin/codes', { method: 'POST', body: JSON.stringify({}) });
    el.newRegistrationCode.value = data.code;
    el.registrationCodeModal.showModal();
  } catch (error) {
    toast(error.message);
  }
};
document.querySelector('#copyRegistrationCodeButton').onclick = async () => {
  await navigator.clipboard.writeText(el.newRegistrationCode.value);
  toast('Код скопирован.');
};
document.querySelector('#closeRegistrationCodeButton').onclick = async () => {
  el.registrationCodeModal.close();
  await loadAdminCodes().catch((error) => toast(error.message));
};
el.adminCodesList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-copy-code]');
  if (!button) return;
  await navigator.clipboard.writeText(button.dataset.copyCode);
  toast('Код скопирован.');
});

document.querySelectorAll('[data-rail-action]').forEach((button) => {
  button.addEventListener('click', () => {
    const action = button.dataset.railAction;
    if (action === 'chats') {
      setSidebarMode('chats');
    }
    if (action === 'rooms') {
      setSidebarMode('rooms');
    }
    if (action === 'people') {
      setSidebarMode('people');
    }
  });
});

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
  if (state.chat.type === 'room') {
    const members = await api(`/api/rooms/${state.chat.id}/members`);
    renderInspectorMembers(members.members);
  }
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

let peopleSearchTimer = null;
async function runPeopleSearch() {
  if (!String(el.peopleSearchInput.value || '').trim()) {
    renderPeopleSearchResults([]);
    return;
  }
  renderPeopleSearchResults(await searchUsers(el.peopleSearchInput.value));
}

if (el.peopleSearchInput) {
  el.peopleSearchInput.addEventListener('input', () => {
    clearTimeout(peopleSearchTimer);
    peopleSearchTimer = setTimeout(async () => {
      try {
        await runPeopleSearch();
      } catch (error) {
        toast(error.message);
      }
    }, 250);
  });
}

if (el.peopleSearchButton) {
  el.peopleSearchButton.addEventListener('click', async () => {
    try {
      await runPeopleSearch();
    } catch (error) {
      toast(error.message);
    }
  });
}

if (el.peopleSearchResults) {
  el.peopleSearchResults.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-people-user]');
    if (!button) return;
    const userId = Number(button.dataset.peopleUser);
    let user = state.users.find((item) => item.id === userId);
    if (!user) {
      user = (await searchUsers(button.querySelector('small')?.textContent || '')).find((item) => item.id === userId);
      if (user && !state.users.some((item) => item.id === user.id)) {
        state.users.push(user);
        state.users.sort((a, b) => a.username.localeCompare(b.username));
        renderLists();
      }
    }
    if (user) openPrivate(user);
  });
}

el.chatHeaderButton.onclick = async () => {
  const item = currentItem();
  if (!item) return;
  document.querySelector('#roomSettingsModal h2').textContent = state.chat.type === 'room' ? `# ${item.name}` : displayName(item);
  el.roomAvatarPreview.innerHTML = avatar(item, 'large');
  el.roomAvatarInput.value = '';
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
el.roomAvatarInput.addEventListener('change', () => {
  const file = el.roomAvatarInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
    el.roomAvatarInput.value = '';
    toast('Для аватарки комнаты выберите изображение.');
    return;
  }
  const url = URL.createObjectURL(file);
  el.roomAvatarPreview.innerHTML = `<span class="avatar large"><img src="${url}" alt=""></span>`;
});
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
  document.querySelector('#avatarInput').value = '';
  document.querySelector('#profileAvatar').innerHTML = avatar(state.me, 'large');
  document.querySelector('#profileModal').showModal();
};
document.querySelector('#closeProfile').onclick = () => document.querySelector('#profileModal').close();
document.querySelector('#avatarInput').addEventListener('change', () => {
  const file = document.querySelector('#avatarInput').files[0];
  if (!file) return;
  if (!file.type.startsWith('image/') && !/\.(jpe?g|png|webp|gif)$/i.test(file.name)) {
    document.querySelector('#avatarInput').value = '';
    toast('Для аватарки выберите изображение.');
    return;
  }
  const url = URL.createObjectURL(file);
  document.querySelector('#profileAvatar').innerHTML = `<span class="avatar large"><img src="${url}" alt=""></span>`;
});
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
    if (avatarUrl) state.me.avatar_url = avatarUrl;
    state.users = state.users.map((user) => user.id === state.me.id ? { ...user, ...state.me } : user);
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>${escapeHtml(displayName(state.me))}</span>`;
    renderLists();
    document.querySelector('#profileModal').close();
    toast('Профиль обновлён.');
  } catch (error) { toast(error.message); }
});
document.querySelector('#openSidebar').onclick = () => setSidebarOpen(true);
document.querySelector('#closeSidebar').onclick = () => setSidebarOpen(false);

(async function boot() {
  try {
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark');
    const me = await api('/api/auth/me');
    state.me = me.user;
    document.querySelector('#profileButton').innerHTML = `${avatar(state.me, 'small')}<span>${escapeHtml(displayName(state.me))}</span>`;
    await refreshData();
    setupSocket();
    const lastChat = findLastChat();
    if (lastChat?.type === 'private' && lastChat.item) {
      await openPrivate(lastChat.item);
      setSidebarMode('chats');
    } else {
      await openRoom(lastChat?.item || state.rooms[0]);
      setSidebarMode('rooms');
    }
    if (!state.me.display_name) document.querySelector('#profileButton').click();
    el.loadingScreen.classList.add('done');
    showChangelogIfNeeded();
  } catch (_error) {
    if (_error.status === 401) {
      location.href = '/login.html';
      return;
    }
    showBootError(_error);
  }
}());
