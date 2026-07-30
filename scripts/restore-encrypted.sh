#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/nexus-YYYY-MM-DD-HHMMSS.tar.gz.enc" >&2
  exit 1
fi

if [[ "${CONFIRM_RESTORE:-}" != "1" ]]; then
  echo "Refusing to restore without CONFIRM_RESTORE=1." >&2
  echo "Stop the app first, then run: CONFIRM_RESTORE=1 $0 $1" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
DATA_DIR="${DATA_DIR:-$ROOT_DIR/data}"
UPLOADS_DIR="${UPLOADS_DIR:-$ROOT_DIR/uploads}"
ITERATIONS="${BACKUP_PBKDF2_ITERATIONS:-200000}"
ARCHIVE="$1"
timestamp="$(date +%F-%H%M%S)"
tmp_dir="$(mktemp -d)"
pre_restore="$BACKUP_DIR/pre-restore-$timestamp"

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

mkdir -p "$BACKUP_DIR" "$tmp_dir" "$pre_restore"

openssl enc -d -aes-256-cbc -salt -pbkdf2 -iter "$ITERATIONS" -md sha256 "${password_args[@]}" -in "$ARCHIVE" \
  | tar -xzf - -C "$tmp_dir"

if [[ -d "$DATA_DIR" ]]; then
  cp -a "$DATA_DIR" "$pre_restore/data"
fi
if [[ -d "$UPLOADS_DIR" ]]; then
  cp -a "$UPLOADS_DIR" "$pre_restore/uploads"
fi

mkdir -p "$DATA_DIR" "$UPLOADS_DIR"

if [[ -f "$tmp_dir/data/messenger.sqlite" ]]; then
  cp "$tmp_dir/data/messenger.sqlite" "$DATA_DIR/messenger.sqlite"
  rm -f "$DATA_DIR/messenger.sqlite-wal" "$DATA_DIR/messenger.sqlite-shm"
else
  echo "Backup does not contain data/messenger.sqlite" >&2
  exit 1
fi

mkdir -p "$tmp_dir/restored_uploads"
tar -C "$tmp_dir/restored_uploads" -xf "$tmp_dir/uploads.tar"
if command -v rsync >/dev/null 2>&1; then
  rsync -a --delete "$tmp_dir/restored_uploads/" "$UPLOADS_DIR/"
else
  find "$UPLOADS_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  cp -a "$tmp_dir/restored_uploads/." "$UPLOADS_DIR/"
fi

echo "Restore complete."
echo "Previous data snapshot: $pre_restore"
