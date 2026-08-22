/**
 * Minimal HTTP client for driving StickIt instances through their real APIs.
 */

class Api {
  constructor(base, opts = {}) {
    this.base = base;
    this.token = opts.token || null;
  }

  headers(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    return h;
  }

  async req(method, path, body, opts = {}) {
    const r = await fetch(this.base + path, {
      method,
      headers: this.headers(opts.headers),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data = null;
    const text = await r.text();
    try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
    return { status: r.status, ok: r.ok, data };
  }

  get(path, opts)        { return this.req('GET', path, undefined, opts); }
  post(path, body, opts) { return this.req('POST', path, body, opts); }
  put(path, body, opts)  { return this.req('PUT', path, body, opts); }
  del(path, body, opts)  { return this.req('DELETE', path, body, opts); }

  /** Like get/post but throws on non-2xx — for driver steps that must succeed. */
  async must(method, path, body, opts) {
    const r = await this.req(method, path, body, opts);
    if (!r.ok) {
      throw new Error(`${method} ${path} -> ${r.status}: ${JSON.stringify(r.data)}`);
    }
    return r.data;
  }
}

module.exports = { Api };
