const express = require('express');
const config = require('../config');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const calls = require('../utils/calls');

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

router.get('/calls/pending', (req, res) => {
  const call = calls.getIncomingCall(req.user.id);
  if (!call) return res.json({ call: null });
  const user = q.findUserById.get(call.callerId);
  res.json({
    call: {
      callId: call.callId,
      from: call.callerId,
      to: call.receiverId,
      kind: call.kind,
      user
    }
  });
});

module.exports = router;
