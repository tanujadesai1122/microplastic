const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(
    path.join(__dirname, "microplastic_history.db")
);

db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        analyzed_at TEXT NOT NULL,
        total_images INTEGER NOT NULL DEFAULT 0,
        total_particles INTEGER NOT NULL DEFAULT 0,
        counts_json TEXT NOT NULL,
        results_json TEXT NOT NULL
    )
`);

const saveAnalysis = db.prepare(`
    INSERT INTO analysis_history (
        analyzed_at,
        total_images,
        total_particles,
        counts_json,
        results_json
    )
    VALUES (?, ?, ?, ?, ?)
`);

const getHistory = db.prepare(`
    SELECT
        id,
        analyzed_at,
        total_images,
        total_particles,
        counts_json,
        results_json
    FROM analysis_history
    ORDER BY id DESC
`);

module.exports = {
    db,
    saveAnalysis,
    getHistory
};