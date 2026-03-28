db.run(`
CREATE TABLE IF NOT EXISTS plantings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  crop_key TEXT NOT NULL,
  amount INTEGER NOT NULL,
  planted_at INTEGER NOT NULL,
  harvest_at INTEGER NOT NULL,
  harvested INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  harvest_message_id TEXT,
  harvest_channel_id TEXT,
  harvested_by TEXT,
  harvested_at INTEGER
)
`);
