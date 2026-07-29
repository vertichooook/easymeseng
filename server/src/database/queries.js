const { db } = require('./db');

const userPublic = 'id, username, created_at';

module.exports = {
  createUser: db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)'),
  findUserByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findUserById: db.prepare(`SELECT ${userPublic} FROM users WHERE id = ?`),
  listUsers: db.prepare(`SELECT ${userPublic} FROM users ORDER BY username ASC`),

  createSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
  findSession: db.prepare('SELECT sessions.id AS session_id, sessions.expires_at, users.id, users.username, users.created_at FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ?'),
  deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
  deleteExpiredSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),

  listRooms: db.prepare('SELECT id, name, created_by, created_at FROM rooms ORDER BY id ASC'),
  createRoom: db.prepare('INSERT INTO rooms (name, created_by) VALUES (?, ?)'),
  findRoomById: db.prepare('SELECT id, name, created_by, created_at FROM rooms WHERE id = ?'),
  findRoomByName: db.prepare('SELECT id FROM rooms WHERE name = ?'),

  addRoomMember: db.prepare('INSERT OR IGNORE INTO room_members (room_id, user_id) VALUES (?, ?)'),
  insertMessage: db.prepare('INSERT INTO messages (room_id, user_id, body) VALUES (?, ?, ?)'),
  listRoomMessages: db.prepare(`
    SELECT messages.id, messages.room_id, messages.body, messages.created_at, users.id AS user_id, users.username
    FROM messages JOIN users ON users.id = messages.user_id
    WHERE messages.room_id = ?
    ORDER BY messages.id DESC
    LIMIT ?
  `),
  findMessageById: db.prepare(`
    SELECT messages.id, messages.room_id, messages.body, messages.created_at, users.id AS user_id, users.username
    FROM messages JOIN users ON users.id = messages.user_id
    WHERE messages.id = ?
  `),

  insertPrivateMessage: db.prepare('INSERT INTO private_messages (sender_id, receiver_id, body) VALUES (?, ?, ?)'),
  listPrivateMessages: db.prepare(`
    SELECT pm.id, pm.sender_id, sender.username AS sender_username, pm.receiver_id,
           receiver.username AS receiver_username, pm.body, pm.created_at
    FROM private_messages pm
    JOIN users sender ON sender.id = pm.sender_id
    JOIN users receiver ON receiver.id = pm.receiver_id
    WHERE (pm.sender_id = ? AND pm.receiver_id = ?) OR (pm.sender_id = ? AND pm.receiver_id = ?)
    ORDER BY pm.id DESC
    LIMIT ?
  `),
  findPrivateMessageById: db.prepare(`
    SELECT pm.id, pm.sender_id, sender.username AS sender_username, pm.receiver_id,
           receiver.username AS receiver_username, pm.body, pm.created_at
    FROM private_messages pm
    JOIN users sender ON sender.id = pm.sender_id
    JOIN users receiver ON receiver.id = pm.receiver_id
    WHERE pm.id = ?
  `)
};
