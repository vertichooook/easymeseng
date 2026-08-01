const express = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/config', (_req, res) => {
  const iceServers = [];
  if (config.webrtcStunUrl) iceServers.push({ urls: config.webrtcStunUrl });
  if (config.webrtcTurnUrl && config.webrtcTurnUsername && config.webrtcTurnPassword) {
    iceServers.push({
      urls: config.webrtcTurnUrl,
      username: config.webrtcTurnUsername,
      credential: config.webrtcTurnPassword
    });
  }
  res.json({ iceServers });
});

module.exports = router;
