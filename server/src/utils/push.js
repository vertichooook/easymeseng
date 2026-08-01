const webPush = require('web-push');
const config = require('../config');
const q = require('../database/queries');

const pushReady = Boolean(config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject);
const CALL_MESSAGE_PREFIX = '__nexus_call__';

if (pushReady) {
  webPush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
} else {
  console.warn('Web Push is disabled: set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.');
}

function isPushConfigured() {
  return pushReady;
}

function publicKey() {
  return config.vapidPublicKey;
}

function mediaLabel(attachmentType) {
  if (attachmentType === 'image') return 'Фото';
  if (attachmentType === 'video') return 'Видео';
  if (attachmentType === 'audio') return 'Голосовое сообщение';
  return 'Сообщение';
}

function compactBody(message) {
  const text = String(message?.body || '').trim();
  if (text.startsWith(CALL_MESSAGE_PREFIX)) return 'Звонок';
  if (text) return text.slice(0, 140);
  if (message?.attachment_name) return String(message.attachment_name).slice(0, 140);
  return mediaLabel(message?.attachment_type);
}

async function sendPushToUser(userId, payload) {
  if (!pushReady || !userId) return;
  const subscriptions = q.listPushSubscriptionsForUser.all(userId);
  await Promise.all(subscriptions.map(async (row) => {
    try {
      await webPush.sendNotification({
        endpoint: row.endpoint,
        keys: {
          p256dh: row.p256dh,
          auth: row.auth
        }
      }, JSON.stringify({
        title: payload.title || 'Nexus',
        body: payload.body || '',
        url: payload.url || '/',
        tag: payload.tag || 'nexus-message',
        chat: payload.chat || null,
        type: payload.type || 'message',
        call: payload.call || null,
        actions: payload.actions || null
      }));
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        q.deletePushSubscriptionByEndpoint.run(row.endpoint);
        return;
      }
      console.error('Web Push delivery failed:', error.statusCode || error.message);
    }
  }));
}

module.exports = { compactBody, isPushConfigured, publicKey, sendPushToUser };
