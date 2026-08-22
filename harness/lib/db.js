/**
 * Direct scratch-database access for test assertions and seeding.
 * File databases only (the harness's stand-in for both cloud and venue).
 */

const { createClient } = require('@libsql/client');

function openDb(dbPath) {
  const client = createClient({ url: `file:${dbPath}` });
  function rowToObj(row) {
    const obj = {};
    for (const key of Object.keys(row)) {
      if (isNaN(parseInt(key))) obj[key] = row[key];
    }
    return obj;
  }
  // The harness reads scratch DBs while live server instances write them —
  // retry briefly on SQLITE_BUSY instead of failing a suite on a transient.
  async function withRetry(fn) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (attempt < 20 && /database is locked|SQLITE_BUSY/i.test(String(e && e.message))) {
          await new Promise(r => setTimeout(r, 50 + attempt * 25));
          continue;
        }
        throw e;
      }
    }
  }

  return {
    client,
    async queryAll(sql, args = []) {
      const r = await withRetry(() => client.execute({ sql, args }));
      return r.rows.map(rowToObj);
    },
    async queryOne(sql, args = []) {
      const rows = await this.queryAll(sql, args);
      return rows[0] || null;
    },
    async execute(sql, args = []) {
      return withRetry(() => client.execute({ sql, args }));
    },
    close() { client.close(); },
  };
}

module.exports = { openDb };
