const { db } = require('./db');

const userPublic = 'id, username, avatar_url, created_at';

module.exports = {
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare(`SELECT ${userPublic} FROM users WHERE id = ?`),
  listUsers: db.prepare(`SELECT ${userPublic} FROM users ORDER BY username ASC`),
  updateUsername: db.prepare('UPDATE users SET username = ? WHERE id = ?'),
  updateAvatar: db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?'),

  createSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
  findSession: db.prepare('SELECT sessions.id AS session_id, sessions.expires_at, users.id, users.username, users.avatar_url, users.created_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),

  listRoomsForUser: db.prepare(`
    SELECT rooms.id, rooms.name, rooms.created_by, rooms.created_at,
           COALESCE(room_members.role, CASE WHEN rooms.id = 1 THEN 'member' END) AS role,
           muted_chats.muted_at IS NOT NULL AS muted
    FROM rooms
    LEFT JOIN room_members ON room_members.room_id = rooms.id AND room_members.user_id = ?
    LEFT JOIN muted_chats ON muted_chats.user_id = ? AND muted_chats.target_type = 'room' AND muted_chats.target_id = rooms.id
    WHERE rooms.id = 1 OR room_members.user_id IS NOT NULL
    ORDER BY rooms.id ASC
  `),
  createRoom: db.prepare('INSERT INTO rooms (name, created_by) VALUES (?, ?)'),
  findRoomById: db.prepare('SELECT id, name, created_by, created_at FROM rooms WHERE id = ?'),
  findRoomByName: db.prepare('SELECT id FROM rooms WHERE name = ?'),
  deleteRoom: db.prepare('DELETE FROM rooms WHERE id = ?'),

  addRoomMember: db.prepare("INSERT OR IGNORE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'member')"),
  addRoomAdmin: db.prepare("INSERT OR REPLACE INTO room_members (room_id, user_id, role) VALUES (?, ?, 'admin')"),
  findRoomMember: db.prepare('SELECT room_id, user_id, role FROM room_members WHERE room_id = ? AND user_id = ?'),
  listRoomMembers: db.prepare('SELECT users.id, users.username, users.avatar_url FROM room_members JOIN users ON users.id = room_members.user_id WHERE room_members.room_id = ?'),
  insertMessage: db.prepare(`
    INSERT INTO messages (
      room_id, user_id, body, attachment_url, attachment_type, attachment_name,
      reply_to_message_id, reply_preview_author, reply_preview_body, forwarded_from_author, forwarded_from_body
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listRoomMessages: db.prepare(`
    SELECT messages.id, messages.room_id, messages.body, messages.attachment_url, messages.attachment_type,
           messages.attachment_name, messages.deleted_at, messages.deleted_by,
           messages.reply_to_message_id, messages.reply_preview_author, messages.reply_preview_body,
           messages.forwarded_from_author, messages.forwarded_from_body, messages.created_at,
           users.id AS user_id, users.username, users.avatar_url
    FROM messages JOIN users ON users.id = messages.user_id
    WHERE messages.room_id = ?
      AND NOT EXISTS (
        SELECT 1 FROM hidden_messages hm
        WHERE hm.user_id = ? AND hm.message_type = 'room' AND hm.message_id = messages.id
      )
    ORDER BY messages.id DESC
    LIMIT ?
  `),
  findMessageById: db.prepare(`
    SELECT messages.id, messages.room_id, messages.body, messages.attachment_url, messages.attachment_type,
           messages.attachment_name, messages.deleted_at, messages.deleted_by,
           messages.reply_to_message_id, messages.reply_preview_author, messages.reply_preview_body,
           messages.forwarded_from_author, messages.forwarded_from_body, messages.created_at,
           users.id AS user_id, users.username, users.avatar_url
    FROM messages JOIN users ON users.id = messages.user_id
    WHERE messages.id = ?
  `),
  deleteRoomMessageForAll: db.prepare("UPDATE messages SET deleted_at = datetime('now'), deleted_by = ?, body = '', attachment_url = NULL, attachment_type = NULL, attachment_name = NULL WHERE id = ?"),

  insertPrivateMessage: db.prepare(`
    INSERT INTO private_messages (
      sender_id, receiver_id, body, attachment_url, attachment_type, attachment_name,
      reply_to_message_id, reply_preview_author, reply_preview_body, forwarded_from_author, forwarded_from_body
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  listPrivateMessages: db.prepare(`
    SELECT pm.id, pm.sender_id, sender.username AS sender_username, pm.receiver_id,
           receiver.username AS receiver_username, sender.avatar_url AS sender_avatar_url,
           receiver.avatar_url AS receiver_avatar_url, pm.body, pm.attachment_url,
           pm.attachment_type, pm.attachment_name, pm.deleted_at, pm.deleted_by,
           pm.reply_to_message_id, pm.reply_preview_author, pm.reply_preview_body,
           pm.forwarded_from_author, pm.forwarded_from_body, pm.created_at
    FROM private_messages pm
    JOIN users sender ON sender.id = pm.sender_id
    JOIN users receiver ON receiver.id = pm.receiver_id
    WHERE ((pm.sender_id = ? AND pm.receiver_id = ?) OR (pm.sender_id = ? AND pm.receiver_id = ?))
      AND NOT EXISTS (
        SELECT 1 FROM hidden_messages hm
        WHERE hm.user_id = ? AND hm.message_type = 'private' AND hm.message_id = pm.id
      )
    ORDER BY pm.id DESC
    LIMIT ?
  `),
  findPrivateMessageById: db.prepare(`
    SELECT pm.id, pm.sender_id, sender.username AS sender_username, pm.receiver_id,
           receiver.username AS receiver_username, sender.avatar_url AS sender_avatar_url,
           receiver.avatar_url AS receiver_avatar_url, pm.body, pm.attachment_url,
           pm.attachment_type, pm.attachment_name, pm.deleted_at, pm.deleted_by,
           pm.reply_to_message_id, pm.reply_preview_author, pm.reply_preview_body,
           pm.forwarded_from_author, pm.forwarded_from_body, pm.created_at
    FROM private_messages pm
    JOIN users sender ON sender.id = pm.sender_id
    JOIN users receiver ON receiver.id = pm.receiver_id
    WHERE pm.id = ?
  `),
  deletePrivateMessageForAll: db.prepare("UPDATE private_messages SET deleted_at = datetime('now'), deleted_by = ?, body = '', attachment_url = NULL, attachment_type = NULL, attachment_name = NULL WHERE id = ?"),
  hideMessageForUser: db.prepare('INSERT OR IGNORE INTO hidden_messages (user_id, message_type, message_id) VALUES (?, ?, ?)'),
  muteChat: db.prepare('INSERT OR IGNORE INTO muted_chats (user_id, target_type, target_id) VALUES (?, ?, ?)'),
  unmuteChat: db.prepare('DELETE FROM muted_chats WHERE user_id = ? AND target_type = ? AND target_id = ?'),
  findMutedChat: db.prepare('SELECT 1 FROM muted_chats WHERE user_id = ? AND target_type = ? AND target_id = ?'),
  listMutedChats: db.prepare('SELECT target_type, target_id FROM muted_chats WHERE user_id = ?')
};
