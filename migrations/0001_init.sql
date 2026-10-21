-- Every press from the app, sent or not. `sent_at` is the room server's timestamp
-- for a successful send, which is how the last-sent line is matched to a person.
CREATE TABLE IF NOT EXISTS presses (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  who     TEXT NOT NULL,         -- the name given at sign-in
  action  TEXT NOT NULL,
  at      INTEGER NOT NULL,      -- ms since epoch, when the Worker got the press
  sent_at TEXT,                  -- room server's timestamp; NULL if not sent
  error   TEXT                   -- why it was not sent; NULL if sent
);
CREATE INDEX IF NOT EXISTS idx_presses_who_at ON presses (who, at);
CREATE INDEX IF NOT EXISTS idx_presses_sent_at ON presses (sent_at);

-- Wrong passwords, per IP, to slow down guessing.
CREATE TABLE IF NOT EXISTS login_failures (
  ip TEXT NOT NULL,
  at INTEGER NOT NULL            -- ms since epoch
);
CREATE INDEX IF NOT EXISTS idx_login_failures_ip_at ON login_failures (ip, at);
