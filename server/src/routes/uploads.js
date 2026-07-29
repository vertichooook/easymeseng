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
  ['video/quicktime', 'mov'],
  ['video/3gpp', '3gp'],
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/aac', 'aac'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav']
]);

const extToMime = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['mp4', 'video/mp4'],
  ['webm', 'video/webm'],
  ['mov', 'video/quicktime'],
  ['3gp', 'video/3gpp'],
  ['m4a', 'audio/mp4'],
  ['aac', 'audio/aac'],
  ['mp3', 'audio/mpeg'],
  ['wav', 'audio/wav']
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}.${extensionForFile(file)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if ((!baseMime(file.mimetype) || baseMime(file.mimetype) === 'application/octet-stream') && extToMime.has(extensionFromName(file.originalname))) return cb(null, true);
    if (!allowed.has(baseMime(file.mimetype))) return cb(new Error('Можно загружать только изображения, видео и аудио.'));
    return cb(null, true);
  }
});

function baseMime(mimetype) {
  return String(mimetype || '').split(';')[0].trim().toLowerCase();
}

function extensionFromName(filename) {
  return path.extname(String(filename || '')).slice(1).toLowerCase();
}

function mimeForFile(file) {
  const mimetype = baseMime(file?.mimetype);
  const ext = extensionFromName(file?.originalname || file?.filename);
  if (mimetype === 'application/octet-stream' && extToMime.has(ext)) return extToMime.get(ext);
  if (allowed.has(mimetype)) return mimetype;
  return extToMime.get(ext) || '';
}

function extensionForFile(file) {
  const fromMime = allowed.get(mimeForFile(file)) || allowed.get(baseMime(file?.mimetype));
  if (fromMime) return fromMime;
  const fromName = extensionFromName(file?.originalname);
  return extToMime.has(fromName) ? fromName : 'webm';
}

function mediaType(file) {
  const value = mimeForFile(file);
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
        type: mediaType(req.file),
        name: req.file.originalname.slice(0, 120)
      }
    });
  });
});

module.exports = router;
