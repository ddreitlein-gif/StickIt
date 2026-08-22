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
  return {
    client,
    async queryAll(sql, args = []) {
      const r = await client.execute({ sql, args });
      return r.rows.map(rowToObj);
    },
    async queryOne(sql, args = []) {
      const rows = await this.queryAll(sql, args);
      return rows[0] || null;
    },
    async execute(sql, args = []) {
      return client.execute({ sql, args });
    },
    close() { client.close(); },
  };
}

module.exports = { openDb };
