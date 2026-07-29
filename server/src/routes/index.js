const express = require('express');
const auth = require('./auth');
const rooms = require('./rooms');
const users = require('./users');
const privateRoutes = require('./private');

const router = express.Router();

router.get('/health', (_req, res) => res.json({ ok: true }));
router.use('/auth', auth);
router.use('/rooms', rooms);
router.use('/users', users);
router.use('/private', privateRoutes);

module.exports = router;
