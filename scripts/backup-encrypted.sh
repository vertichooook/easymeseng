#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
UPLOADS_DIR="${UPLOADS_DIR:-$ROOT_DIR/uploads}"
DB_PATH="${DB_PATH:-$DATA_DIR/messenger.sqlite}"
ITERATIONS="${BACKUP_PBKDF2_ITERATIONS:-200000}"

timestamp="$(date +%F-%H%M%S)"
tmp_dir="$(mktemp -d)"
output="$BACKUP_DIR/nexus-$timestamp.tar.gz.enc"

cleanup() {
  rm -rf "$tmp_dir"
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

password_args=()
if [[ -n "${BACKUP_PASSPHRASE_FILE:-}" ]]; then
  password_args=(-pass "file:$BACKUP_PASSPHRASE_FILE")
elif [[ -n "${BACKUP_PASSWORD:-}" ]]; then
  password_args=(-pass env:BACKUP_PASSWORD)
fi

require_command openssl
require_command tar
mkdir -p "$BACKUP_DIR" "$tmp_dir/data" "$tmp_dir/uploads"

if [[ -f "$DB_PATH" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    sqlite3 "$DB_PATH" ".backup '$tmp_dir/data/messenger.sqlite'"
  else
    echo "sqlite3 is not installed; copying SQLite files directly. Install sqlite3 for online-consistent backups." >&2
    cp "$DB_PATH" "$tmp_dir/data/messenger.sqlite"
    [[ -f "$DB_PATH-wal" ]] && cp "$DB_PATH-wal" "$tmp_dir/data/messenger.sqlite-wal"
    [[ -f "$DB_PATH-shm" ]] && cp "$DB_PATH-shm" "$tmp_dir/data/messenger.sqlite-shm"
  fi
else
  echo "Database not found at $DB_PATH" >&2
fi

if [[ -d "$UPLOADS_DIR" ]]; then
  tar -C "$UPLOADS_DIR" -cf "$tmp_dir/uploads.tar" .
else
  echo "Uploads directory not found at $UPLOADS_DIR" >&2
  tar -C "$tmp_dir/uploads" -cf "$tmp_dir/uploads.tar" .
fi

cat > "$tmp_dir/MANIFEST.txt" <<EOF
Nexus encrypted backup
created_at=$timestamp
database_path=$DB_PATH
uploads_path=$UPLOADS_DIR
cipher=aes-256-cbc
kdf=pbkdf2
pbkdf2_iterations=$ITERATIONS
EOF

tar -C "$tmp_dir" -czf - MANIFEST.txt data uploads.tar \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter "$ITERATIONS" -md sha256 "${password_args[@]}" -out "$output"

chmod 600 "$output"
echo "Encrypted backup created: $output"
