// Unified SQLite driver abstraction
// Auto-detects node:sqlite (Node 22.5+) vs node-sqlite3-wasm fallback
// Normalizes API differences so db.js doesn't care which is active

const fs = require('fs');

let driverName = null;

function openDatabase(dbPath) {
  // Ensure parent directory exists
  const dir = require('path').dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // --- Try node:sqlite first (Node 22.5+) ---
  try {
    const { DatabaseSync } = require('node:sqlite');
    driverName = 'node:sqlite';
    const raw = new DatabaseSync(dbPath);

    return {
      name: 'node:sqlite',

      exec(sql) {
        raw.exec(sql);
      },

      prepare(sql) {
        const stmt = raw.prepare(sql);
        return {
          run(...params) {
            const result = stmt.run(...params);
            return {
              changes: Number(result.changes),
              lastInsertRowid: Number(result.lastInsertRowid),
            };
          },
          get(...params) {
            const row = stmt.get(...params);
            return row ? Object.assign({}, row) : undefined;
          },
          all(...params) {
            const rows = stmt.all(...params);
            return rows.map(r => Object.assign({}, r));
          },
        };
      },

      close() {
        raw.close();
      },
    };
  } catch (_e) {
    // node:sqlite not available
  }

  // --- Fallback: node-sqlite3-wasm ---
  try {
    const { Database } = require('node-sqlite3-wasm');
    driverName = 'node-sqlite3-wasm';
    const raw = new Database(dbPath);

    return {
      name: 'node-sqlite3-wasm',

      exec(sql) {
        raw.exec(sql);
      },

      prepare(sql) {
        const stmt = raw.prepare(sql);
        return {
          run(...params) {
            stmt.bind(params);
            stmt.step();
            stmt.reset();
            return {
              changes: raw.getRowsModified(),
              lastInsertRowid: Number(raw.exec('SELECT last_insert_rowid()')[0]?.values?.[0]?.[0] ?? 0),
            };
          },
          get(...params) {
            const rows = [];
            stmt.bind(params);
            while (stmt.step()) {
              const cols = stmt.getColumnNames();
              const vals = stmt.get({});
              const obj = {};
              cols.forEach((c, i) => { obj[c] = vals[c] !== undefined ? vals[c] : null; });
              rows.push(obj);
            }
            stmt.reset();
            return rows[0] || undefined;
          },
          all(...params) {
            const rows = [];
            stmt.bind(params);
            while (stmt.step()) {
              const row = stmt.get({});
              rows.push(Object.assign({}, row));
            }
            stmt.reset();
            return rows;
          },
        };
      },

      close() {
        raw.close();
      },
    };
  } catch (_e2) {
    // node-sqlite3-wasm not available either
  }

  throw new Error(
    'No SQLite driver found. Install Node.js 22.5+ (for node:sqlite) ' +
    'or run: npm install node-sqlite3-wasm'
  );
}

function getDriverName() {
  return driverName;
}

module.exports = { openDatabase, getDriverName };
