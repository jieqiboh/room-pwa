-- Which device a press was for. Presses from before room pages were the shutter.
ALTER TABLE presses ADD COLUMN device TEXT NOT NULL DEFAULT 'shutter';
CREATE INDEX IF NOT EXISTS idx_presses_device_sent_at ON presses (device, sent_at);

-- Each person's pages of devices, stored whole as one JSON document.
CREATE TABLE IF NOT EXISTS layouts (
  who        TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at INTEGER NOT NULL   -- ms since epoch
);
