/**
 * StickIt server instance manager for the two-instance harness (Section 11).
 *
 * Spawns the REAL server (server/index.js) as a child process with a scratch
 * file database, on any port, in cloud or venue mode. Supports clean stop,
 * hard kill (crash tests), and restart against the same database.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.resolve(__dirname, '../..');
const SERVER_DIR = path.join(REPO_ROOT, 'server');

// Scratch area for databases + logs; wiped per run by the runner.
const SCRATCH_ROOT = path.join(REPO_ROOT, 'harness', '.scratch');

function scratchDir(name) {
  const dir = path.join(SCRATCH_ROOT, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

class Instance {
  /**
   * opts: {
   *   name    — label for logs / scratch dir
   *   port    — listen port
   *   dbPath  — sqlite file path (default: scratch/<name>/scoring.db)
   *   mode    — 'cloud' (default) | 'venue'
   *   env     — extra env vars
   *   serverDir — alternate server tree (rollback-gate: the v1.30.03 checkout)
   * }
   */
  constructor(opts) {
    this.name = opts.name;
    this.port = opts.port;
    this.dir = scratchDir(opts.name);
    this.dbPath = opts.dbPath || path.join(this.dir, 'scoring.db');
    this.mode = opts.mode || 'cloud';
    this.extraEnv = opts.env || {};
    this.serverDir = opts.serverDir || SERVER_DIR;
    this.proc = null;
    this.log = [];
    this.base = `http://127.0.0.1:${this.port}`;
  }

  async start() {
    if (this.proc) throw new Error(`${this.name}: already running`);
    const env = {
      ...process.env,
      PORT: String(this.port),
      LIBSQL_URL: `file:${this.dbPath}`,
      STICKIT_MODE: this.mode === 'venue' ? 'venue' : '',
      ...this.extraEnv,
    };
    if (this.mode !== 'venue') delete env.STICKIT_MODE;
    this.proc = spawn('node', ['index.js'], { cwd: this.serverDir, env });
    const tag = `[${this.name}]`;
    const onData = (buf) => {
      for (const line of buf.toString().split('\n')) {
        if (line.trim()) this.log.push(`${tag} ${line}`);
      }
    };
    this.proc.stdout.on('data', onData);
    this.proc.stderr.on('data', onData);
    this.exited = new Promise((resolve) => this.proc.on('exit', (code, sig) => {
      this.proc = null;
      resolve({ code, sig });
    }));
    await this.waitReady();
    return this;
  }

  async waitReady(timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${this.base}/api/health`);
        if (r.ok) return;
      } catch (_) { /* not up yet */ }
      if (!this.proc) throw new Error(`${this.name}: process exited before becoming ready\n${this.tailLog()}`);
      await new Promise(r => setTimeout(r, 150));
    }
    throw new Error(`${this.name}: not ready after ${timeoutMs}ms\n${this.tailLog()}`);
  }

  /** Graceful stop (SIGTERM, then SIGKILL after 5s). */
  async stop() {
    if (!this.proc) return;
    const p = this.proc;
    p.kill('SIGTERM');
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (_) {} }, 5000);
    await this.exited;
    clearTimeout(t);
  }

  /** Hard kill — crash tests (Section 11 item 9). */
  async kill() {
    if (!this.proc) return;
    this.proc.kill('SIGKILL');
    await this.exited;
  }

  tailLog(n = 25) {
    return this.log.slice(-n).join('\n');
  }
}

module.exports = { Instance, scratchDir, SCRATCH_ROOT, REPO_ROOT, SERVER_DIR };
