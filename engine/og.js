"use strict";
// Daily OG card: the social-share image, rebuilt from the live snapshot so a
// shared link shows this week's leaders instead of a screenshot from launch
// day. Node writes an SVG in the site's design language; rsvg-convert (the
// one system package this app leans on, librsvg2-bin) rasterizes it to
// var/og.png. Fonts ship in tools/og/fonts and reach rsvg through a private
// fontconfig file, so nothing is installed system-wide. If rsvg-convert is
// missing or fails, the caller logs and the server keeps serving the static
// public/og.png.

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const cfg = require("./config");
const ttf = require("./ttf");

const W = 1200, H = 630;
const PAD_X = 72;
const FONT = "Bricolage Grotesque";
const MONO = "IBM Plex Mono";
const INK = "#e8e6e1", MUTED = "#9aa0a6", ACCENT = "#f0a040", GOOD = "#4fba63";
const CARD_BG = "#1d2026", CARD_LINE = "#2c3038";
const RAIN = "#3b82c4";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sky glyphs drawn as vector shapes (no emoji: the droplet's librsvg predates
// color-font support, and shapes are deterministic everywhere). Each renders
// inside a 44x44 box whose top-left is the <g> origin.
// Filled disc with eight rays (Charles, 2026-08-23: filled over outline).
function sun(cx, cy, r, color, sw = 3) {
  const rays = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 4), y1 = cy + Math.sin(a) * (r + 4);
    const x2 = cx + Math.cos(a) * (r + 9), y2 = cy + Math.sin(a) * (r + 9);
    rays.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`);
  }
  return `<g stroke="${color}" stroke-width="${sw}" stroke-linecap="round">` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}" stroke="none"/>${rays.join("")}</g>`;
}
const CLOUD = "M12 34 h20 a8 8 0 0 0 0.5 -16 a11 11 0 0 0 -21 -2 a9 9 0 0 0 0.5 18 z";
function cloud(fill, stroke) {
  return `<path d="${CLOUD}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round"/>`;
}
function skyGlyph(label) {
  const drops = (color) => `<g stroke="${color}" stroke-width="3" stroke-linecap="round">` +
    `<line x1="16" y1="38" x2="14" y2="44"/><line x1="24" y1="38" x2="22" y2="44"/><line x1="32" y1="38" x2="30" y2="44"/></g>`;
  switch (label) {
    case "sunny": return sun(22, 22, 9, ACCENT);
    case "mostly-sunny":
    case "partly-sunny": return sun(14, 14, 7, ACCENT) + cloud("#2a2e36", MUTED);
    case "mostly-cloudy":
    case "cloudy": return cloud("#2a2e36", MUTED);
    case "showers":
    case "rain":
    case "freezing": return cloud("#2a2e36", MUTED) + drops(RAIN);
    case "snow": return cloud("#2a2e36", MUTED) +
      `<g fill="${INK}"><circle cx="15" cy="41" r="2"/><circle cx="23" cy="41" r="2"/><circle cx="31" cy="41" r="2"/></g>`;
    case "thunder": return cloud("#2a2e36", MUTED) +
      `<path d="M25 30 l-6 9 h5 l-2 7 l7 -10 h-5 l2 -6 z" fill="#f5c542"/>`;
    default: return sun(22, 22, 9, ACCENT);
  }
}

// Card text geometry. rsvg cannot report text widths, so they are measured
// from the vendored TTFs (engine/ttf.js). Bricolage is a variable font whose
// hmtx holds the Regular instance; heavier weights render wider by the
// factors below (calibrated against rsvg output on 2026-08-23).
const FONT_DIR = path.join(cfg.ROOT, "tools", "og", "fonts");
const BRICOLAGE = path.join(FONT_DIR, "BricolageGrotesque.ttf");
const PLEX = path.join(FONT_DIR, "IBMPlexMono-Regular.ttf");
const PLEX_SEMI = path.join(FONT_DIR, "IBMPlexMono-SemiBold.ttf");
const WEIGHT_FACTOR = { 400: 1.0, 600: 1.04, 700: 1.07, 800: 1.08 };
const textWidth = (file, text, px, weight = 400) => ttf.measure(file, text, px) * (WEIGHT_FACTOR[weight] || 1.08);

const CARD_W = (W - 2 * PAD_X - 40) / 3, CARD_H = 184, CARD_TOP = 372;
const CONTENT_INSET = 27; // 1px border + 26px padding
const chipWidth = (tier) => textWidth(PLEX, "$".repeat(tier), 17) + 22; // 10px padding + 1px border each side

// A name that will not fit beside its chip first loses the state suffix,
// then, if still too wide, is squeezed with textLength as a last resort.
function nameLayout(name, tier) {
  const avail = CARD_W - 2 * CONTENT_INSET - (tier ? chipWidth(tier) + 10 : 0);
  const fits = (t) => textWidth(BRICOLAGE, t, 26, 700) * 1.02 <= avail;
  let text = name;
  if (!fits(text)) text = name.replace(/,\s*[A-Z]{2}$/, "");
  const squeeze = fits(text) ? null : avail;
  return { text, squeeze };
}

function card(i, c, rents) {
  const x = PAD_X + i * (CARD_W + 20), y = CARD_TOP;
  const cx = x + CONTENT_INSET, right = x + CARD_W - CONTENT_INSET;
  const d0 = c.days[0];
  const r = rents?.[c.name];
  const tier = r && r.tier >= 1 && r.tier <= 3 ? r.tier : 0;
  const { text, squeeze } = nameLayout(c.name, tier);
  const hi = Number.isFinite(d0?.hi) ? `${Math.round(d0.hi)}°` : "–";
  const week = Number.isFinite(c.scores?.week) ? String(Math.round(c.scores.week)) : "–";
  const weekW = textWidth(PLEX_SEMI, week, 22);
  let s = `<rect x="${x}" y="${y}" width="${CARD_W.toFixed(2)}" height="${CARD_H}" rx="16" fill="${CARD_BG}" stroke="${CARD_LINE}"/>`;
  s += `<text x="${cx}" y="${y + 50}" font-family="${FONT}" font-weight="700" font-size="26" fill="${INK}"` +
    (squeeze ? ` textLength="${squeeze.toFixed(0)}" lengthAdjust="spacingAndGlyphs"` : "") + `>${esc(text)}</text>`;
  if (tier) {
    const w = Math.round(chipWidth(tier));
    s += `<rect x="${right - w}" y="${y + 29}" width="${w}" height="27" rx="9" fill="none" stroke="${CARD_LINE}"/>` +
      `<text x="${right - w / 2}" y="${y + 48}" text-anchor="middle" font-family="${MONO}" font-size="17" fill="${MUTED}">${"$".repeat(tier)}</text>`;
  }
  s += `<g transform="translate(${cx} ${y + 72})">${skyGlyph(d0?.sky)}</g>`;
  s += `<text x="${cx + 56}" y="${y + 111}" font-family="${FONT}" font-weight="800" font-size="44" fill="${INK}">${esc(hi)}</text>`;
  s += `<text x="${cx}" y="${y + 155}" font-family="${MONO}" font-weight="600" font-size="22" fill="${GOOD}">${week}</text>`;
  s += `<text x="${(cx + weekW + 8).toFixed(1)}" y="${y + 155}" font-family="${FONT}" font-size="18" fill="${MUTED}">this week</text>`;
  return s;
}

function fmtDay(iso) {
  const d = new Date(iso + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd}, ${mo} ${d.getUTCDate()}`;
}

// The forecast day the card describes: the leader's first forecast day, in
// the leader's own timezone. This is the "once per day" key, not the clock.
const cardDate = (snapshot) => snapshot?.cities?.[0]?.days?.[0]?.date || null;

function buildSvg(snapshot, rents) {
  const top = (snapshot.cities || []).slice(0, 3);
  if (top.length < 3) throw new Error("og: need at least 3 ranked cities");
  const n = snapshot.cities.length;
  const day = fmtDay(cardDate(snapshot));
  const footLeft = day ? `Leaders for ${day} · AI explains, never picks` : "Deterministic weather scores · AI explains, never picks";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <radialGradient id="glow" gradientUnits="userSpaceOnUse" cx="984" cy="113" r="511">
    <stop offset="0" stop-color="${ACCENT}" stop-opacity="0.16"/>
    <stop offset="1" stop-color="${ACCENT}" stop-opacity="0"/>
  </radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="#14161a"/>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<g transform="translate(${PAD_X} 86)">${sun(36, 44, 18, ACCENT, 5)}</g>
<text x="${PAD_X + 108}" y="160" font-family="${FONT}" font-weight="800" font-size="110" letter-spacing="-2" fill="${INK}">Sunchaser</text>
<text x="${PAD_X}" y="252" font-family="${FONT}" font-size="40" fill="${MUTED}">Where the good weather is right now, across</text>
<text x="${PAD_X}" y="304" font-family="${FONT}" font-size="40" fill="${MUTED}"><tspan font-weight="600" fill="${INK}">${n} vetted nomad cities</tspan>. Scored hourly. Ties</text>
<text x="${PAD_X}" y="356" font-family="${FONT}" font-size="40" fill="${MUTED}">are honest ties.</text>
${top.map((c, i) => card(i, c, rents)).join("\n")}
<text x="${PAD_X}" y="583" font-family="${FONT}" font-size="24" fill="${MUTED}">${esc(footLeft)}</text>
<text x="${W - PAD_X}" y="583" text-anchor="end" font-family="${MONO}" font-size="26" fill="${ACCENT}">sunchaser.rockofpages.com</text>
</svg>
`;
}

// Private fontconfig so rsvg sees the vendored TTFs without a system install.
// Written into var/ because the service's only writable path is var/.
function fontsConf(varDir) {
  const cache = path.join(varDir, "fontconfig-cache");
  const file = path.join(varDir, "fonts.conf");
  const xml = `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${esc(FONT_DIR)}</dir>
  <cachedir>${esc(cache)}</cachedir>
</fontconfig>
`;
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(file, xml);
  return file;
}

function loadRents() {
  try { return JSON.parse(fs.readFileSync(path.join(cfg.ROOT, "data", "rents.json"), "utf8")).rents || null; }
  catch { return null; }
}

// SVG -> PNG bytes via rsvg-convert. Throws with a clear message when the
// binary is absent so the caller can fall back to the static card.
function rasterize(svg, varDir) {
  const bin = process.env.RSVG_CONVERT || "rsvg-convert";
  try {
    return execFileSync(bin, ["--format", "png", "--width", String(W), "--height", String(H)], {
      // PANGOCAIRO_BACKEND matters only on macOS (Homebrew pango defaults to
      // CoreText there and would ignore the fontconfig file); Linux ignores it.
      input: svg, env: { ...process.env, FONTCONFIG_FILE: fontsConf(varDir), PANGOCAIRO_BACKEND: "fontconfig" },
      maxBuffer: 16 << 20,
      timeout: 30000,
    });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("og: rsvg-convert not installed (apt install librsvg2-bin)");
    throw new Error(`og: rsvg-convert failed: ${e.stderr?.toString().trim() || e.message}`);
  }
}

const ogPaths = (varDir = cfg.VAR_DIR) => ({
  png: path.join(varDir, "og.png"), meta: path.join(varDir, "og.json"),
});

function readMeta(varDir) {
  try { return JSON.parse(fs.readFileSync(ogPaths(varDir).meta, "utf8")); } catch { return null; }
}

// Rebuild var/og.png from the snapshot. With {ifStale: true} it is a no-op
// when the existing card already describes the same forecast day.
function renderOg(snapshot, { ifStale = false, varDir = cfg.VAR_DIR, rents = loadRents() } = {}) {
  const { png: pngFile, meta } = ogPaths(varDir);
  const date = cardDate(snapshot);
  if (ifStale && readMeta(varDir)?.date === date && fs.existsSync(pngFile)) return { skipped: true, date };
  fs.mkdirSync(varDir, { recursive: true });
  const png = rasterize(buildSvg(snapshot, rents), varDir);
  if (png.length < 1000 || png[0] !== 0x89 || png.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("og: rsvg-convert produced no PNG");
  }
  const tmp = pngFile + ".tmp";
  fs.writeFileSync(tmp, png);
  fs.renameSync(tmp, pngFile);
  fs.writeFileSync(meta, JSON.stringify({
    date, generated_at: new Date().toISOString(),
    cities: snapshot.cities.slice(0, 3).map((c) => c.name), bytes: png.length,
  }));
  return { skipped: false, date, bytes: png.length };
}

// index.html's og:image URL with the card's date appended, so share
// scrapers (which cache by URL) see each day's card as a new object.
function stampOgImage(html, date) {
  if (!date) return html;
  return html.replace(/(property="og:image" content="[^"?]+)/, `$1?d=${date}`);
}

module.exports = { buildSvg, renderOg, readMeta, cardDate, nameLayout, ogPaths, stampOgImage };
