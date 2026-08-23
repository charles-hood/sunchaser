"use strict";
// Just enough TrueType parsing to measure text: unitsPerEm (head), glyph
// advances (hhea + hmtx) and the Unicode cmap (format 4 or 12). Used by the
// OG card to decide whether a city name fits before handing the SVG to
// rsvg-convert, which cannot report text widths back. Kerning is ignored,
// so measurements run a hair wide, which is the safe direction.

const fs = require("node:fs");

function parse(file) {
  const b = fs.readFileSync(file);
  const numTables = b.readUInt16BE(4);
  const tables = {};
  for (let i = 0; i < numTables; i++) {
    const o = 12 + i * 16;
    tables[b.toString("ascii", o, o + 4)] = { off: b.readUInt32BE(o + 8), len: b.readUInt32BE(o + 12) };
  }
  for (const t of ["head", "hhea", "hmtx", "cmap", "maxp"]) {
    if (!tables[t]) throw new Error(`ttf: ${file} has no ${t} table`);
  }
  const unitsPerEm = b.readUInt16BE(tables.head.off + 18);
  const numHMetrics = b.readUInt16BE(tables.hhea.off + 34);
  const numGlyphs = b.readUInt16BE(tables.maxp.off + 4);
  const adv = new Uint16Array(numGlyphs);
  for (let g = 0; g < numGlyphs; g++) {
    const i = Math.min(g, numHMetrics - 1);
    adv[g] = b.readUInt16BE(tables.hmtx.off + i * 4);
  }
  const cmap = readCmap(b, tables.cmap.off);
  return { unitsPerEm, adv, cmap, numGlyphs };
}

function readCmap(b, base) {
  const n = b.readUInt16BE(base + 2);
  let best = null;
  for (let i = 0; i < n; i++) {
    const o = base + 4 + i * 8;
    const platform = b.readUInt16BE(o), encoding = b.readUInt16BE(o + 2), off = b.readUInt32BE(o + 4);
    const format = b.readUInt16BE(base + off);
    // Prefer a full Unicode table (format 12), else BMP (format 4).
    if ((platform === 3 && (encoding === 10 || encoding === 1)) || platform === 0) {
      if (format === 12 && (!best || best.format !== 12)) best = { off: base + off, format };
      else if (format === 4 && !best) best = { off: base + off, format };
    }
  }
  if (!best) throw new Error("ttf: no usable Unicode cmap");
  const map = new Map();
  if (best.format === 4) {
    const o = best.off;
    const segX2 = b.readUInt16BE(o + 6), seg = segX2 / 2;
    const ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ranges = deltas + segX2;
    for (let s = 0; s < seg; s++) {
      const end = b.readUInt16BE(ends + s * 2), start = b.readUInt16BE(starts + s * 2);
      const delta = b.readInt16BE(deltas + s * 2), ro = b.readUInt16BE(ranges + s * 2);
      if (start === 0xffff) continue;
      for (let c = start; c <= end; c++) {
        let g;
        if (ro === 0) g = (c + delta) & 0xffff;
        else {
          const gi = ranges + s * 2 + ro + (c - start) * 2;
          if (gi + 1 >= b.length) continue;
          g = b.readUInt16BE(gi);
          if (g) g = (g + delta) & 0xffff;
        }
        if (g) map.set(c, g);
      }
    }
  } else {
    const o = best.off;
    const groups = b.readUInt32BE(o + 12);
    for (let i = 0; i < groups; i++) {
      const g = o + 16 + i * 12;
      const start = b.readUInt32BE(g), end = b.readUInt32BE(g + 4), gid = b.readUInt32BE(g + 8);
      for (let c = start; c <= end && c - start < 0x10000; c++) map.set(c, gid + (c - start));
    }
  }
  return map;
}

const cache = new Map();
function load(file) {
  if (!cache.has(file)) cache.set(file, parse(file));
  return cache.get(file);
}

// Width of `text` at `px` pixels in the font at `file`, in CSS px. Characters
// the font lacks count as an average glyph so the estimate never comes back
// too small.
function measure(file, text, px) {
  const f = load(file);
  const avg = f.adv.reduce((a, v) => a + v, 0) / f.adv.length;
  let units = 0;
  for (const ch of text) {
    const g = f.cmap.get(ch.codePointAt(0));
    units += g != null ? f.adv[g] : avg;
  }
  return (units / f.unitsPerEm) * px;
}

module.exports = { parse, load, measure };
