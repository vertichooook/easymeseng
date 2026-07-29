# Messenger MVP

Простой веб-мессенджер для одной Linux VDS: статический frontend, Express API, Socket.IO, SQLite, Nginx и Docker Compose. Интерфейс работает без сборщика.

## Стек

- Node.js 20, Express, Socket.IO
- SQLite через `better-sqlite3`
- `bcryptjs`, HttpOnly signed-cookie sessions
- Helmet, rate limiting, параметризованные SQL-запросы
- HTML, CSS, JavaScript
- Nginx, Docker Compose, systemd
- Загрузка изображений, видео, голосовых и видеосообщений в `uploads/`
- Приватные комнаты по приглашениям, ответы, пересылка, упоминания, мут чатов и browser notifications

## Структура

```text
client/                 статический frontend
server/src/             backend API, socket, middleware, database
data/                   SQLite на VDS, не коммитится
nginx/messenger.conf    конфигурация Nginx
deploy/messenger.service systemd unit
Dockerfile
docker-compose.yml
.env.example
```

## Требования к VDS

Ubuntu 24.04 LTS, 1 CPU, 1 GB RAM, 10 GB disk, домен с A-записью на IP сервера. Открыты только 80/443 и SSH.

## Установка Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

## Настройка `.env`

```bash
cp .env.example .env
nano .env
openssl rand -hex 32
```

Вставьте результат в `SESSION_SECRET`. Для Docker оставьте `DATABASE_PATH=/app/data/messenger.sqlite`, `UPLOAD_DIR=/app/uploads`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`.

## Запуск через Docker Compose

```bash
git clone REPOSITORY_URL /var/www/messenger
cd /var/www/messenger
cp .env.example .env
nano .env
docker compose up -d --build
docker compose logs -f backend
```

Backend публикуется только на `127.0.0.1:3000`, поэтому снаружи он недоступен напрямую.

## Запуск без Docker через systemd

```bash
sudo useradd --system --home /var/www/messenger --shell /usr/sbin/nologin messenger
cd /var/www/messenger/server
npm install --omit=dev
cd /var/www/messenger
cp .env.example .env
nano .env
sudo chown -R messenger:messenger /var/www/messenger
sudo cp deploy/messenger.service /etc/systemd/system/messenger.service
sudo systemctl daemon-reload
sudo systemctl enable messenger
sudo systemctl start messenger
sudo systemctl status messenger
journalctl -u messenger -f
```

Для systemd задайте `DATABASE_PATH=/var/www/messenger/data/messenger.sqlite`, `HOST=127.0.0.1`.

## Nginx и домен

```bash
sudo apt install -y nginx
sudo cp nginx/messenger.conf /etc/nginx/sites-available/messenger.conf
sudo nano /etc/nginx/sites-available/messenger.conf
sudo ln -s /etc/nginx/sites-available/messenger.conf /etc/nginx/sites-enabled/messenger.conf
sudo nginx -t
sudo systemctl reload nginx
```

Замените `chat.example.com` на ваш домен и проверьте, что `root` указывает на `/var/www/messenger/client`.

## HTTPS через Certbot

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d chat.example.com
sudo certbot renew --dry-run
sudo systemctl reload nginx
```

Сертификаты Let's Encrypt не добавляются в репозиторий.

## Firewall UFW

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

## Логи

```bash
docker compose logs -f backend
journalctl -u messenger -f
sudo tail -f /var/log/nginx/access.log /var/log/nginx/error.log
```

## Обновление

```bash
cd /var/www/messenger
git pull
docker compose up -d --build
sudo systemctl reload nginx
```

Для systemd:

```bash
cd /var/www/messenger/server
npm install --omit=dev
sudo systemctl restart messenger
```

## Backup SQLite

```bash
mkdir -p backups
sqlite3 data/messenger.sqlite ".backup 'backups/messenger-$(date +%F-%H%M).sqlite'"
```

## Restore SQLite

```bash
docker compose stop backend
cp backups/messenger-YYYY-MM-DD-HHMM.sqlite data/messenger.sqlite
docker compose start backend
```

Для systemd используйте `sudo systemctl stop messenger` и `sudo systemctl start messenger`.

## Проверка WebSocket через Nginx

Откройте DevTools браузера, вкладка Network, фильтр WS. Должно появиться соединение `/socket.io/`. Также проверьте:

```bash
curl -i https://chat.example.com/api/health
```

## Частые проблемы

- 502 Bad Gateway: backend не запущен или Nginx проксирует не на `127.0.0.1:3000`.
- Cookie не сохраняется: в production нужен HTTPS при `COOKIE_SECURE=true`.
- WebSocket не подключается: проверьте блок `/socket.io/`, заголовки `Upgrade` и `Connection`.
- База пропала после перезапуска: проверьте volume `./data:/app/data` и `DATABASE_PATH`.
- Медиа не загружается: проверьте `client_max_body_size 30m`, папку `uploads/` и volume `./uploads:/app/uploads`.
- Голосовые или видеосообщения не записываются: браузеру нужен HTTPS или localhost для доступа к микрофону и камере.
- Уведомления не появляются: разрешите уведомления в браузере; для большинства браузеров нужен HTTPS.
- Пользователь не видит комнату: новые комнаты доступны только автору и приглашённым участникам.
- Ошибка native-модуля SQLite: пересоберите контейнер `docker compose build --no-cache`.
