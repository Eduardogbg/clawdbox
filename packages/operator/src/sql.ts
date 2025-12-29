/**
 * SQL schema and queries for Operator Durable Object
 */

// Schema initialization
export const INIT_SCHEMA = `
-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  telegram_topic_id INTEGER,
  telegram_chat_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('pending', 'active', 'completed', 'failed')),
  prompt TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  container_id TEXT,
  claude_session_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('starting', 'running', 'paused', 'stopped')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Permissions table
CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  tool_input TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'denied', 'expired')),
  reason TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_sessions_task_id ON sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_permissions_session_id ON permissions(session_id);
CREATE INDEX IF NOT EXISTS idx_permissions_status ON permissions(status);
`;

// Task queries
export const INSERT_TASK = `
INSERT INTO tasks (id, telegram_topic_id, telegram_chat_id, status, prompt, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const UPDATE_TASK_STATUS = `
UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
`;

export const GET_TASK = `
SELECT id, telegram_topic_id, telegram_chat_id, status, prompt, created_at, updated_at
FROM tasks WHERE id = ?
`;

export const GET_TASKS_BY_STATUS = `
SELECT id, telegram_topic_id, telegram_chat_id, status, prompt, created_at, updated_at
FROM tasks WHERE status = ? ORDER BY created_at DESC
`;

export const GET_ALL_TASKS = `
SELECT id, telegram_topic_id, telegram_chat_id, status, prompt, created_at, updated_at
FROM tasks ORDER BY created_at DESC LIMIT ?
`;

// Session queries
export const INSERT_SESSION = `
INSERT INTO sessions (id, task_id, container_id, claude_session_id, status, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
`;

export const UPDATE_SESSION = `
UPDATE sessions SET container_id = ?, claude_session_id = ?, status = ?, updated_at = ?
WHERE id = ?
`;

export const UPDATE_SESSION_STATUS = `
UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?
`;

export const GET_SESSION = `
SELECT id, task_id, container_id, claude_session_id, status, created_at, updated_at
FROM sessions WHERE id = ?
`;

export const GET_SESSION_BY_TASK = `
SELECT id, task_id, container_id, claude_session_id, status, created_at, updated_at
FROM sessions WHERE task_id = ? ORDER BY created_at DESC LIMIT 1
`;

// Permission queries
export const INSERT_PERMISSION = `
INSERT INTO permissions (id, session_id, tool_name, tool_input, status, created_at)
VALUES (?, ?, ?, ?, ?, ?)
`;

export const UPDATE_PERMISSION = `
UPDATE permissions SET status = ?, reason = ?, resolved_at = ? WHERE id = ?
`;

export const GET_PERMISSION = `
SELECT id, session_id, tool_name, tool_input, status, reason, created_at, resolved_at
FROM permissions WHERE id = ?
`;

export const GET_PENDING_PERMISSIONS = `
SELECT id, session_id, tool_name, tool_input, status, reason, created_at, resolved_at
FROM permissions WHERE session_id = ? AND status = 'pending' ORDER BY created_at ASC
`;

export const EXPIRE_OLD_PERMISSIONS = `
UPDATE permissions SET status = 'expired', resolved_at = ?
WHERE status = 'pending' AND created_at < ?
`;
