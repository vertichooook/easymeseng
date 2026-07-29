const http = require('http');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { Server } = require('socket.io');
const config = require('./config');
const q = require('./database/queries');
const routes = require('./routes');
const { attachUser } = require('./middleware/auth');
const { apiLimiter } = require('./middleware/rateLimits');
const { registerSocket } = require('./socket');

if (config.isProduction && config.sessionSecret === 'development_change_me') {
  throw new Error('Set SESSION_SECRET before running in production.');
}

setInterval(() => q.deleteExpiredSessions.run(), 60 * 60 * 1000).unref();

const app = express();
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://cdn.socket.io'],
      'connect-src': ["'self'", 'ws:', 'wss:']
    }
  },
  permissionsPolicy: {
    features: {
      camera: ['self'],
      microphone: ['self'],
      geolocation: []
    }
  }
}));
app.use(morgan(config.isProduction ? 'combined' : 'dev'));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser(config.sessionSecret));
app.use(attachUser);
app.use('/api', apiLimiter, routes);
app.use('/uploads', express.static(config.uploadDir, {
  fallthrough: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

if (!config.isProduction) {
  app.use(express.static(path.resolve(__dirname, '../../client')));
}

app.use((req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Маршрут не найден.' });
  return res.status(404).send('Not found');
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(error.status || 500).json({
    error: config.isProduction ? 'Внутренняя ошибка сервера.' : error.message
  });
});

const server = http.createServer(app);
const io = new Server(server, {
  path: '/socket.io',
  cors: false,
  maxHttpBufferSize: 4096
});
app.set('io', io);
registerSocket(io);

server.listen(config.port, config.host, () => {
  console.log(`Nexus server listening on http://${config.host}:${config.port}`);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection', error);
});
