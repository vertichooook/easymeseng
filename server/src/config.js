const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  sessionSecret: process.env.SESSION_SECRET || 'development_change_me',
  databasePath: process.env.DATABASE_PATH || path.resolve(__dirname, '../../data/messenger.sqlite'),
  uploadDir: process.env.UPLOAD_DIR || path.resolve(__dirname, '../../uploads'),
  cookieSecure: bool(process.env.COOKIE_SECURE, process.env.NODE_ENV === 'production'),
  trustProxy: Number(process.env.TRUST_PROXY || 0),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
  vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  maxMessageLength: 1000,
  maxUsernameLength: 32,
  maxRoomNameLength: 60
};
