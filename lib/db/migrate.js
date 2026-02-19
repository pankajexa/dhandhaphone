// Schema migration runner for DhandhaPhone DB
// Tracks applied versions in _migrations table

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema',
    up: (_db) => {
      // schema.sql handles version 1
    }
  },
  {
    version: 2,
    description: 'Add brain tables (entities, edges, observations)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS brain_entities (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          type            TEXT NOT NULL,
          name            TEXT NOT NULL,
          ref_id          INTEGER,
          ref_table       TEXT,
          properties      TEXT NOT NULL DEFAULT '{}',
          confidence      REAL DEFAULT 0.5,
          is_active       INTEGER DEFAULT 1,
          created_at      TEXT DEFAULT (datetime('now')),
          updated_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_brain_ent_type ON brain_entities(type);
        CREATE INDEX IF NOT EXISTS idx_brain_ent_ref ON brain_entities(ref_table, ref_id);
        CREATE INDEX IF NOT EXISTS idx_brain_ent_active ON brain_entities(is_active);
        CREATE INDEX IF NOT EXISTS idx_brain_ent_name ON brain_entities(name);

        CREATE TABLE IF NOT EXISTS brain_edges (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          from_entity_id  INTEGER NOT NULL REFERENCES brain_entities(id),
          to_entity_id    INTEGER REFERENCES brain_entities(id),
          type            TEXT NOT NULL,
          weight          REAL DEFAULT 0.5,
          properties      TEXT NOT NULL DEFAULT '{}',
          last_refreshed  TEXT DEFAULT (datetime('now')),
          created_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_brain_edge_from ON brain_edges(from_entity_id);
        CREATE INDEX IF NOT EXISTS idx_brain_edge_to ON brain_edges(to_entity_id);
        CREATE INDEX IF NOT EXISTS idx_brain_edge_type ON brain_edges(type);

        CREATE TABLE IF NOT EXISTS brain_observations (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          type            TEXT NOT NULL,
          entity_id       INTEGER REFERENCES brain_entities(id),
          content         TEXT NOT NULL,
          properties      TEXT NOT NULL DEFAULT '{}',
          confidence      REAL DEFAULT 0.5,
          source          TEXT,
          language        TEXT,
          is_resolved     INTEGER DEFAULT 0,
          expires_at      TEXT,
          created_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_brain_obs_type ON brain_observations(type);
        CREATE INDEX IF NOT EXISTS idx_brain_obs_entity ON brain_observations(entity_id);
        CREATE INDEX IF NOT EXISTS idx_brain_obs_active ON brain_observations(is_resolved, expires_at);
      `);
    }
  },
  {
    version: 3,
    description: 'Add notification_log and vpa_map tables for data ingestion',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS notification_log (
          hash            TEXT PRIMARY KEY,
          package_name    TEXT NOT NULL,
          status          TEXT NOT NULL,
          transaction_id  INTEGER REFERENCES transactions(id),
          created_at      TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_notif_log_pkg ON notification_log(package_name);
        CREATE INDEX IF NOT EXISTS idx_notif_log_status ON notification_log(status);

        CREATE TABLE IF NOT EXISTS vpa_map (
          vpa             TEXT PRIMARY KEY,
          contact_id      INTEGER REFERENCES contacts(id),
          contact_name    TEXT,
          created_at      TEXT DEFAULT (datetime('now'))
        );
      `);
    }
  },
];

function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      version     INTEGER PRIMARY KEY,
      description TEXT,
      applied_at  TEXT DEFAULT (datetime('now'))
    )
  `);

  const row = db.prepare('SELECT MAX(version) as v FROM _migrations').get();
  const currentVersion = (row && row.v) || 0;

  for (const migration of MIGRATIONS) {
    if (migration.version > currentVersion) {
      console.log(`[DB] Migration ${migration.version}: ${migration.description}`);
      migration.up(db);
      db.prepare(
        'INSERT INTO _migrations (version, description) VALUES (?, ?)'
      ).run(migration.version, migration.description);
    }
  }
}

module.exports = { runMigrations, MIGRATIONS };
