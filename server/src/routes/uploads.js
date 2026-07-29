const crypto = require('crypto');
const path = require('path');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const allowed = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav']
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}.${allowed.get(baseMime(file.mimetype))}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!allowed.has(baseMime(file.mimetype))) return cb(new Error('Можно загружать только изображения, видео и аудио.'));
    return cb(null, true);
  }
});

function baseMime(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

function mediaType(mimetype) {
  const value = baseMime(mimetype);
  if (value.startsWith('image/')) return 'image';
  if (value.startsWith('video/')) return 'video';
  if (value.startsWith('audio/')) return 'audio';
  return 'file';
}

router.post('/', requireAuth, (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) return res.status(400).json({ error: error.message });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен.' });
    return res.status(201).json({
      attachment: {
        url: `/uploads/${path.basename(req.file.filename)}`,
        type: mediaType(req.file.mimetype),
        name: req.file.originalname.slice(0, 120)
      }
    });
  });
});

module.exports = router;
