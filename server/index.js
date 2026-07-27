"use strict";
// Sunchaser server: static frontend + JSON API. Zero-dep Node http, the
// site-report house pattern. Localhost only; Caddy fronts it in production.
//
//   GET /                     frontend
//   GET /api/snapshot         scored snapshot (lazy refresh honoring TTLs)
//   GET /api/verdict          cached AI verdict (never spends on a page view)
//   GET /api/route?from=&to=  deterministic route plan (throttled per IP)
//   GET /api/health           cache ages, counters

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("../engine/config");
const { refresh, loadCities, setPromotions, freshAge } = require("../engine/fetch");
const { buildSnapshot } = require("../engine/score");
const { planRoute } = require("../engine/route");

const PORT = Number(process.env.PORT || 3005);
const PUBLIC = path.join(cfg.ROOT, "public");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

// Per-IP throttle for the one endpoint that does live upstream work.
const routeHits = new Map();
function throttled(ip) {
  const now = Date.now();
  const hits = (routeHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (hits.length >= 6) return true;
  hits.push(now);
  routeHits.set(ip, hits);
  return false;
}

let refreshing = null;
async function getSnapshot() {
  try {
    const snap = JSON.parse(fs.readFileSync(cfg.SNAPSHOT_FILE, "utf8"));
    if (freshAge(snap._meta.generated_at, cfg.ACTIVE_TTL_MS)) return snap;
  } catch {}
  // Stale or missing: refresh, but never let concurrent requests stampede.
  refreshing = refreshing || (async () => {
    try {
      const raw = await refresh({});
      const snap = buildSnapshot(raw, loadCities());
      fs.mkdirSync(cfg.VAR_DIR, { recursive: true });
      fs.writeFileSync(cfg.SNAPSHOT_FILE, JSON.stringify(snap));
      // Promotions must persist regardless of which entry point built the
      // snapshot, or dormant near-leaders never get active-tier data.
      if (snap.promotions.length) setPromotions(snap.promotions);
      return snap;
    } finally { refreshing = null; }
  })();
  try {
    return await refreshing;
  } catch (e) {
    // Serve stale rather than fail (open-meteo outage, fetch lock, etc.).
    try { return JSON.parse(fs.readFileSync(cfg.SNAPSHOT_FILE, "utf8")); }
    catch { throw e; }
  }
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const ip = req.socket.remoteAddress || "?";
  try {
    if (url.pathname === "/api/snapshot") {
      return json(res, 200, await getSnapshot());
    }
    if (url.pathname === "/api/verdict") {
      try {
        return json(res, 200, JSON.parse(fs.readFileSync(cfg.VERDICT_FILE, "utf8")));
      } catch {
        return json(res, 404, { error: "no verdict generated yet; run: node cli.js verdict" });
      }
    }
    if (url.pathname === "/api/route") {
      const from = url.searchParams.get("from");
      let to = url.searchParams.get("to");
      if (!from) return json(res, 400, { error: "from is required" });
      if (from.length > 80 || (to && to.length > 80)) return json(res, 400, { error: "input too long" });
      if (throttled(ip)) return json(res, 429, { error: "slow down: 6 route plans/minute" });
      if (!to) to = (await getSnapshot()).cities[0].name;
      return json(res, 200, await planRoute(from, to));
    }
    if (url.pathname === "/api/health") {
      let snapAge = null, verdictAge = null;
      try { snapAge = Date.now() - Date.parse(JSON.parse(fs.readFileSync(cfg.SNAPSHOT_FILE, "utf8"))._meta.generated_at); } catch {}
      try { verdictAge = Date.now() - Date.parse(JSON.parse(fs.readFileSync(cfg.VERDICT_FILE, "utf8")).generated_at); } catch {}
      let counters = {};
      try { counters = JSON.parse(fs.readFileSync(cfg.COUNTERS_FILE, "utf8")); } catch {}
      return json(res, 200, {
        ok: true,
        snapshot_age_min: snapAge == null ? null : Math.round(snapAge / 60000),
        verdict_age_min: verdictAge == null ? null : Math.round(verdictAge / 60000),
        ai_calls_today: counters[new Date().toISOString().slice(0, 10)] || 0,
        ai_daily_cap: cfg.VERDICT_DAILY_CAP,
      });
    }

    // Static files. Resolve inside PUBLIC only; the boundary check must be
    // separator-aware so a sibling like "publicX/" can never match.
    let file = url.pathname === "/" ? "/index.html" : url.pathname;
    const full = path.join(PUBLIC, path.normalize(file));
    const rel = path.relative(PUBLIC, full);
    if (rel.startsWith("..") || path.isAbsolute(rel)) { res.writeHead(403); return res.end(); }
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": MIME[path.extname(full)] || "application/octet-stream" });
      res.end(data);
    });
  } catch (e) {
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} failed: ${e.message}`);
    json(res, 500, { error: e.message });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`sunchaser listening on http://127.0.0.1:${PORT}`);
});
