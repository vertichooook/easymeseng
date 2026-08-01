const express = require('express');
const config = require('../config');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');
const calls = require('../utils/calls');
const { finishCall } = require('../utils/callRecords');

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

router.post('/calls/:callId/reject', (req, res) => {
  const call = calls.getCall(req.params.callId);
  if (!call || call.receiverId !== req.user.id || call.status !== 'ringing') {
    return res.status(404).json({ error: 'Звонок не найден.' });
  }
  const io = req.app.get('io');
  finishCall(io, call.callId, 'missed');
  io?.to(`user:${call.callerId}`).emit('call:rejected', {
    callId: call.callId,
    from: req.user.id,
    to: call.callerId,
    reason: 'rejected',
    user: q.findUserById.get(req.user.id)
  });
  res.json({ ok: true });
});

module.exports = router;
