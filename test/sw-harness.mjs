// Runs pilot-sw.js outside a browser: the worker's own code in a vm, with a network, a cache store and an IndexedDB
// the test controls. Enough of each for what the worker uses; nothing else.
//   const sw = load({ fetch: async (req) => new Response(…), source?: '<path to another copy of the worker>' })
//   await sw.get('/path')  await sw.post('/api/…', body)  await sw.head('/path')  await sw.message({ type, … })
//   sw.kept('/path', response)   put a copy in the worker's cache        sw.net.down = true   every fetch fails
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ORIGIN = 'http://pilot.test';

/** An IndexedDB small enough to read: stores of rows by key, transactions that complete on the next tick. */
function fakeIndexedDB() {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  return {
    open(name) {
      const req = {};
      later(() => {
        let d = dbs.get(name);
        const fresh = !d;
        if (!d) { d = { stores: new Map() }; dbs.set(name, d); }
        const handle = {
          objectStoreNames: { contains: (n) => d.stores.has(n) },
          createObjectStore(n, o = {}) { d.stores.set(n, { keyPath: o.keyPath, auto: !!o.autoIncrement, rows: new Map(), seq: 0 }); },
          transaction(n) {
            const st = d.stores.get(n);
            const tx = {};
            const reqOf = (result) => ({ result });
            tx.objectStore = () => ({
              get: (k) => reqOf(st.rows.has(k) ? structuredClone(st.rows.get(k)) : undefined),
              getAll: () => reqOf([...st.rows.values()].map((r) => structuredClone(r))),
              put(row) { const r = structuredClone(row); if (st.auto && r[st.keyPath] == null) r[st.keyPath] = ++st.seq; st.rows.set(r[st.keyPath], r); return reqOf(r[st.keyPath]); },
              add(row) { const r = structuredClone(row); r[st.keyPath] = st.auto ? ++st.seq : r[st.keyPath]; st.rows.set(r[st.keyPath], r); return reqOf(r[st.keyPath]); },
              delete(k) { st.rows.delete(k); return reqOf(undefined); },
            });
            later(() => tx.oncomplete && tx.oncomplete());
            return tx;
          },
        };
        req.result = handle;
        if (fresh && req.onupgradeneeded) req.onupgradeneeded();
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
    _dbs: dbs,
  };
}

function fakeCaches() {
  const all = new Map();
  const keyOf = (k) => (typeof k === 'string' ? k : k.url);
  const noSearch = (u) => { const x = new URL(u); x.search = ''; return x.toString(); };
  const cache = () => {
    const m = new Map();
    return {
      async match(k, o = {}) {
        const key = keyOf(k);
        if (m.has(key)) return m.get(key).clone();
        if (o.ignoreSearch) for (const [u, r] of m) if (noSearch(u) === noSearch(key)) return r.clone();
        return undefined;
      },
      async put(k, res) { m.set(keyOf(k), res); },
      // (as a browser's: every entry, or with a request only the entries that answer it)
      async keys(k, o = {}) { const all = [...m.keys()]; const want = k === undefined ? all : all.filter((u) => u === keyOf(k) || (o.ignoreSearch && noSearch(u) === noSearch(keyOf(k)))); return want.map((u) => ({ url: u })); },
      async delete(k) { return m.delete(keyOf(k)); },
      _m: m,
    };
  };
  return {
    async open(n) { if (!all.has(n)) all.set(n, cache()); return all.get(n); },
    async match(k, o) { for (const c of all.values()) { const hit = await c.match(k, o); if (hit) return hit; } return undefined; },
    async keys() { return [...all.keys()]; },
    async delete(n) { return all.delete(n); },
    _all: all,
  };
}

export function load({ fetch: net, source = path.join(HERE, '..', 'pilot-sw.js'), timers = null } = {}) {
  const listeners = {};
  const state = { down: false, calls: [] };
  const caches = fakeCaches();
  const fetchImpl = async (input, init) => {
    const req = input instanceof Request ? input : new Request(typeof input === 'string' && input.startsWith('/') ? ORIGIN + input : input, init);
    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await req.clone().text();
    state.calls.push({ method: req.method, url: req.url.replace(ORIGIN, ''), body, headers: Object.fromEntries(req.headers) });
    if (state.down) throw new TypeError('Failed to fetch');
    return net ? net(req, body) : new Response('not found', { status: 404 });
  };
  // a worker's `self` IS its global: self.fetch is the fetch the worker's code calls (the worker swaps it for its self-test)
  const g = {
    location: new URL(ORIGIN + '/__cb/sw.js'),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    skipWaiting: () => Promise.resolve(), clients: { claim: () => Promise.resolve(), matchAll: () => Promise.resolve([]) },
    registration: { scope: ORIGIN + '/' },
    caches, fetch: fetchImpl, indexedDB: fakeIndexedDB(), Response, Request, Headers, URL, URLSearchParams, crypto: globalThis.crypto, atob, btoa, Blob,
    setTimeout: timers ? timers.set : setTimeout, clearTimeout: timers ? timers.clear : clearTimeout, setInterval, clearInterval, console, Promise, JSON, Date, Math, Object, Array, String, Number, Uint8Array, encodeURIComponent, decodeURIComponent, structuredClone, TextEncoder, TextDecoder,
  };
  g.self = g;
  const ctx = vm.createContext(g);
  vm.runInContext(fs.readFileSync(source, 'utf8'), ctx, { filename: 'pilot-sw.js' });

  const dispatch = (req) => {
    let answer = null;
    const waits = [];
    for (const fn of listeners.fetch || []) { fn({ request: req, respondWith(p) { if (!answer) answer = Promise.resolve(p); }, waitUntil(p) { waits.push(p); } }); if (answer) break; }
    return answer; // null = the worker left it to the network
  };
  const url = (p) => (p.startsWith('http') ? p : ORIGIN + p);
  return {
    net: state, caches,
    get: (p, init = {}) => dispatch(new Request(url(p), { method: 'GET', ...init })),
    // a page being opened (a tab or a frame going to this address): the one kind of request a script cannot make
    visit: (p) => {
      const real = new Request(url(p), { method: 'GET', headers: { Accept: 'text/html' } });
      return dispatch(new Proxy(real, { get(t, k) { if (k === 'mode') return 'navigate'; const v = t[k]; return typeof v === 'function' ? v.bind(t) : v; } }));
    },
    head: (p) => dispatch(new Request(url(p), { method: 'HEAD' })),
    put: (p, body, headers = {}) => dispatch(new Request(url(p), { method: 'PUT', headers, body })),
    post: (p, body, headers = {}) => dispatch(new Request(url(p), { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) })),
    message(data) {
      return new Promise((ok) => {
        const waits = [];
        const port = { postMessage: (m) => ok(JSON.parse(JSON.stringify(m))) }; // a real port hands over a copy
        for (const fn of listeners.message || []) fn({ data, ports: [port], waitUntil(p) { waits.push(p); } });
        Promise.all(waits).then(() => setTimeout(() => ok(undefined), 20));
      });
    },
    async kept(p, res) { const c = await caches.open('cb-pilot-v1'); await c.put(url(p), res); },
    async isKept(p) { const c = await caches.open('cb-pilot-v1'); return !!(await c.match(url(p))); },
    run: (code) => vm.runInContext(code, ctx),
  };
}

/** Timers the test fires by hand: fire(ms) runs every timer set for at most that long. */
export function handTimers() {
  let id = 0;
  const waiting = new Map();
  return {
    set(fn, ms) { waiting.set(++id, { fn, ms: ms || 0 }); return id; },
    clear(h) { waiting.delete(h); },
    fire(ms) { for (const [h, t] of [...waiting]) if (t.ms <= ms) { waiting.delete(h); t.fn(); } },
    count: () => waiting.size,
  };
}

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
export const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));
