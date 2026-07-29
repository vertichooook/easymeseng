const express = require('express');
const q = require('../database/queries');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  const users = q.listUsers.all().filter((user) => user.id !== req.user.id);
  res.json({ users });
});

module.exports = router;
