const fs = require("fs");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const dataDir = path.join(process.cwd(), "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "farm.sqlite");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {

  db.run(`
    CREATE TABLE IF NOT EXISTS user_stats (
        user_id TEXT PRIMARY KEY,
        total_plantings INTEGER DEFAULT 0
    )
  `);

}); // 🔥 OVO TI JE FALILO

module.exports = db;
