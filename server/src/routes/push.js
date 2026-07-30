const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const push = require('../utils/push');

const router = express.Router();

router.get('/public-key', (_req, res) => {
  res.json({ publicKey: push.publicKey(), enabled: push.isPushConfigured() });
});

router.use(requireAuth);

router.post('/subscribe', (req, res) => {
  if (!push.isPushConfigured()) {
    return res.status(503).json({ error: 'Push-уведомления не настроены на сервере.' });
  }

  const endpoint = String(req.body?.endpoint || '').trim();
  const p256dh = String(req.body?.keys?.p256dh || '').trim();
  const auth = String(req.body?.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !auth || !endpoint.startsWith('https://')) {
    return res.status(400).json({ error: 'Некорректная push-подписка.' });
  }

  q.upsertPushSubscription.run(endpoint, req.user.id, p256dh, auth, String(req.headers['user-agent'] || '').slice(0, 300));
  return res.json({ ok: true });
});

router.post('/unsubscribe', (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (endpoint) q.deletePushSubscription.run(endpoint, req.user.id);
  return res.json({ ok: true });
});

module.exports = router;
