# Nexus MVP

Nexus — простой веб-мессенджер для одной Linux VDS: статический frontend, Express API, Socket.IO, SQLite, Nginx и Docker Compose. Интерфейс работает без сборщика.

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

Вставьте результат в `SESSION_SECRET`. Для админ-раздела в настройках приложения задайте `ADMIN_PASSWORD`. Для Docker оставьте `DATABASE_PATH=/app/data/messenger.sqlite`, `UPLOAD_DIR=/app/uploads`, `COOKIE_SECURE=true`, `TRUST_PROXY=1`.

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

## PWA-приложение

Nexus можно установить как приложение-сайт: оно открывается в standalone-режиме без адресной строки и использует системные уведомления, когда сайт/PWA открыт или работает в фоне браузера.

Что добавлено:

- `client/manifest.webmanifest`;
- `client/sw.js`;
- иконки в `client/icons/`;
- регистрация service worker через `client/js/pwa.js`;
- meta-теги для Android/iOS standalone-режима.

Условия:

- обязательно открывать через HTTPS;
- в браузере нажать `Добавить на главный экран` / `Install app`;
- в настройках Nexus нажать `Разрешить уведомления`.

Важно: для push-уведомлений нужен HTTPS, VAPID-ключи в `.env` и разрешение уведомлений в браузере.

## Web Push уведомления

Теперь Nexus поддерживает настоящие Web Push уведомления через VAPID. Они работают через HTTPS и service worker, поэтому устройство может получать уведомления даже когда сайт установлен как PWA или открыт в фоне.

Сгенерируйте ключи на сервере:

```bash
cd /var/www/messenger
docker compose run --rm backend npx web-push generate-vapid-keys
```

Если запускаете backend без Docker:

```bash
cd /var/www/messenger/server
npx web-push generate-vapid-keys
```

Добавьте значения в `.env`:

```env
VAPID_PUBLIC_KEY=ваш_public_key
VAPID_PRIVATE_KEY=ваш_private_key
VAPID_SUBJECT=mailto:vertichoklive@gmail.com
```

После изменения `.env` перезапустите backend:

```bash
docker compose up -d --build
```

Проверка:

```bash
curl -s https://chat-nexus.duckdns.org/api/push/public-key
```

В ответе должно быть `"enabled":true`. После этого зайдите в Nexus, откройте настройки сайта и нажмите кнопку уведомлений. Браузер сохранит push-подписку в SQLite.

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

## Encrypted backup SQLite + uploads

Рекомендуемый вариант для VDS: хранить резервные копии SQLite и `uploads/` только в зашифрованном виде. Пароль/ключ не коммитьте в Git и не кладите рядом с backup-архивом.

Один раз создайте файл с длинным паролем на сервере:

```bash
sudo install -m 700 -d /etc/nexus
openssl rand -base64 48 | sudo tee /etc/nexus/backup.pass >/dev/null
sudo chmod 600 /etc/nexus/backup.pass
```

Создать зашифрованный backup:

```bash
cd /var/www/messenger
BACKUP_PASSPHRASE_FILE=/etc/nexus/backup.pass ./scripts/backup-encrypted.sh
```

Результат появится в `backups/nexus-YYYY-MM-DD-HHMMSS.tar.gz.enc`. Внутри backup лежат:

- SQLite база `data/messenger.sqlite`;
- все файлы из `uploads/`;
- manifest с технической информацией.

Можно задать пути явно:

```bash
BACKUP_PASSPHRASE_FILE=/etc/nexus/backup.pass \
DATA_DIR=/var/www/messenger/data \
UPLOADS_DIR=/var/www/messenger/uploads \
BACKUP_DIR=/var/backups/nexus \
./scripts/backup-encrypted.sh
```

Для автоматического ежедневного backup через cron:

```bash
sudo crontab -e
```

```cron
15 3 * * * cd /var/www/messenger && BACKUP_PASSPHRASE_FILE=/etc/nexus/backup.pass ./scripts/backup-encrypted.sh >/var/log/nexus-backup.log 2>&1
```

Проверить расшифровку без восстановления:

```bash
BACKUP_PASSPHRASE_FILE=/etc/nexus/backup.pass \
openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter 200000 -md sha256 \
  -in backups/nexus-YYYY-MM-DD-HHMMSS.tar.gz.enc | tar -tzf - | head
```

## Restore encrypted backup

Перед восстановлением остановите приложение:

```bash
cd /var/www/messenger
docker compose stop backend
CONFIRM_RESTORE=1 BACKUP_PASSPHRASE_FILE=/etc/nexus/backup.pass \
  ./scripts/restore-encrypted.sh backups/nexus-YYYY-MM-DD-HHMMSS.tar.gz.enc
docker compose start backend
```

Скрипт перед заменой создаёт локальную копию текущих `data/` и `uploads/` в `backups/pre-restore-*`.

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

## WebRTC звонки

Nexus поддерживает аудио- и видеозвонки 1-на-1 через WebRTC. Socket.IO используется только для сигналинга: `call:invite`, `call:accept`, `call:offer`, `call:answer`, `call:ice`, `call:end`. Сам аудио/видео поток шифруется браузером через DTLS-SRTP.

На компьютере входящий звонок проигрывает локальный рингтон в браузере. На телефонах используется обычный звук push-уведомлений, выбранный в настройках системы или браузера. На ответ даётся 30 секунд; после завершения, отклонения или таймаута в личном чате появляется системная запись о звонке.

В push-уведомлении звонка кнопка "Сбросить" отклоняет звонок сразу через backend. Кнопка "Ответить" открывает приложение в нужном чате, потому что браузеру нужна открытая страница для доступа к микрофону и камере.

Минимально достаточно HTTPS и STUN:

```env
WEBRTC_STUN_URL=stun:stun.l.google.com:19302
```

Для стабильной работы на мобильном интернете и за NAT лучше поднять TURN через coturn и добавить:

```env
WEBRTC_TURN_URL=turn:chat-nexus.duckdns.org:3478
WEBRTC_TURN_USERNAME=nexus
WEBRTC_TURN_PASSWORD=long_random_password
```

После изменения `.env` перезапустите backend:

```bash
docker compose up -d --build backend
```

Для coturn на Ubuntu:

```bash
sudo apt update
sudo apt install coturn
sudo nano /etc/turnserver.conf
```

Минимальный пример `/etc/turnserver.conf`:

```conf
listening-port=3478
fingerprint
lt-cred-mech
realm=chat-nexus.duckdns.org
user=nexus:long_random_password
min-port=49160
max-port=49200
no-multicast-peers
no-cli
```

Включение сервиса:

```bash
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
sudo systemctl enable coturn
sudo systemctl restart coturn
sudo systemctl status coturn
```

Firewall:

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 49160:49200/udp
```
