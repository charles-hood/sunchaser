"use strict";
// Deterministic route planner: OSRM geometry, day legs, overnight stopovers
// preferring vetted cities, supercharger validation, stopover weather.
// Charging fine-print is the car's job; this plans days, towns, and weather.

const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");
const { loadCities } = require("./fetch");

const R_EARTH_MI = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_MI * Math.asin(Math.sqrt(a));
}

function loadSuperchargers() {
  return JSON.parse(fs.readFileSync(cfg.SUPERCHARGERS_FILE, "utf8")).sites;
}

// Resolve "City, ST" (vetted list first), "lat,lon", or a free-form place name.
async function geocode(input) {
  const vetted = loadCities().find((c) => c.name.toLowerCase() === input.toLowerCase());
  if (vetted) return { name: vetted.name, lat: vetted.lat, lon: vetted.lon, vetted: true };

  const m = input.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (m) return { name: input, lat: +m[1], lon: +m[2], vetted: false };

  const cityPart = input.split(",")[0].trim();
  const statePart = (input.split(",")[1] || "").trim().toUpperCase();
  const url = `${cfg.GEOCODE_URL}?name=${encodeURIComponent(cityPart)}&count=10&language=en&format=json`;
  const res = await fetch(url, { headers: { "User-Agent": "sunchaser/0.1" } });
  if (!res.ok) throw new Error(`geocoder HTTP ${res.status}`);
  const body = await res.json();
  const hits = (body.results || []).filter((r) => r.country_code === "US");
  const hit = statePart
    ? hits.find((r) => r.admin1_code === statePart || r.admin1 === statePart) || hits[0]
    : hits[0];
  if (!hit) throw new Error(`could not geocode "${input}"`);
  return {
    name: `${hit.name}, ${hit.admin1_code || hit.admin1 || ""}`.replace(/, $/, ""),
    lat: hit.latitude, lon: hit.longitude, vetted: false,
  };
}

async function osrmRoute(from, to) {
  const url = `${cfg.OSRM_URL}/${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url, { headers: { "User-Agent": "sunchaser/0.1" } });
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`);
  const body = await res.json();
  if (body.code !== "Ok" || !body.routes?.length) throw new Error(`OSRM: ${body.code}`);
  const r = body.routes[0];
  return {
    miles: r.distance / 1609.344,
    hours: r.duration / 3600,
    coords: r.geometry.coordinates, // [lon, lat] pairs
  };
}

// Cumulative miles at each polyline vertex.
function cumulative(coords) {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] +
      haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return cum;
}

function pointAtMile(coords, cum, mile) {
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < mile) lo = mid + 1; else hi = mid;
  }
  const [lon, lat] = coords[lo];
  return { lat, lon };
}

// For a place, find its nearest route vertex: distance off-route and mile marker.
function projectOntoRoute(place, coords, cum, step = 5) {
  let best = { offMi: Infinity, mile: 0 };
  for (let i = 0; i < coords.length; i += step) {
    const d = haversine(place.lat, place.lon, coords[i][1], coords[i][0]);
    if (d < best.offMi) best = { offMi: d, mile: cum[i] };
  }
  return best;
}

function nearestSupercharger(place, superchargers) {
  let best = null, bestD = Infinity;
  for (const s of superchargers) {
    const d = haversine(place.lat, place.lon, s.lat, s.lon);
    if (d < bestD) { bestD = d; best = s; }
  }
  return { site: best, miles: bestD };
}

// Superchargers within `corridor` miles of the route, with their mile markers.
function chargersAlongRoute(coords, cum, superchargers, corridor = 5) {
  const bbox = {
    minLat: Math.min(...coords.map((c) => c[1])) - 0.5,
    maxLat: Math.max(...coords.map((c) => c[1])) + 0.5,
    minLon: Math.min(...coords.map((c) => c[0])) - 0.5,
    maxLon: Math.max(...coords.map((c) => c[0])) + 0.5,
  };
  const near = [];
  for (const s of superchargers) {
    if (s.lat < bbox.minLat || s.lat > bbox.maxLat || s.lon < bbox.minLon || s.lon > bbox.maxLon) continue;
    const p = projectOntoRoute(s, coords, cum, 10);
    if (p.offMi <= corridor) near.push({ ...s, mile: p.mile, offMi: p.offMi });
  }
  return near.sort((a, b) => a.mile - b.mile);
}

function pickStopover(targetMile, coords, cum, cities, superchargers, usedNames) {
  const candidates = [];
  for (const c of cities) {
    if (usedNames.has(c.name)) continue;
    const p = projectOntoRoute(c, coords, cum);
    if (p.offMi > cfg.CORRIDOR_MI) continue;
    if (Math.abs(p.mile - targetMile) > 90) continue;
    const sc = nearestSupercharger(c, superchargers);
    if (sc.miles > cfg.SC_NEAR_MI) continue;
    candidates.push({
      name: c.name, lat: c.lat, lon: c.lon, vetted: true, curated: !!c.curated,
      mile: p.mile, offRouteMi: p.offMi,
      supercharger: { name: sc.site.name, miles: sc.miles, stalls: sc.site.stalls, kw: sc.site.kw },
      // Score: stay near the target mile, stay near the route, prefer curated.
      _cost: Math.abs(p.mile - targetMile) + p.offMi * 2 - (c.curated ? 15 : 0),
    });
  }
  if (candidates.length) {
    return candidates.sort((a, b) => a._cost - b._cost)[0];
  }
  // Fallback: the supercharger town nearest the ideal overnight point.
  const ideal = pointAtMile(coords, cum, targetMile);
  const sc = nearestSupercharger(ideal, superchargers);
  const p = projectOntoRoute(sc.site, coords, cum);
  return {
    name: `${sc.site.city}, ${sc.site.state}`, lat: sc.site.lat, lon: sc.site.lon,
    vetted: false, curated: false, mile: p.mile, offRouteMi: p.offMi,
    supercharger: { name: sc.site.name, miles: 0, stalls: sc.site.stalls, kw: sc.site.kw },
  };
}

// Daily forecast for stopover points, one batched Open-Meteo call.
async function stopoverWeather(points) {
  if (!points.length) return [];
  const lat = points.map((p) => p.lat).join(",");
  const lon = points.map((p) => p.lon).join(",");
  const url = `${cfg.OPEN_METEO_URL}?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&temperature_unit=fahrenheit&timezone=auto&forecast_days=7`;
  const res = await fetch(url, { headers: { "User-Agent": "sunchaser/0.1" } });
  if (!res.ok) return points.map(() => null);
  const body = await res.json();
  return Array.isArray(body) ? body : [body];
}

async function planRoute(fromInput, toInput, { log = console.error } = {}) {
  const cacheFile = path.join(cfg.VAR_DIR, "route-cache.json");
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, "utf8")); } catch {}
  const cacheKey = `${fromInput}|${toInput}`.toLowerCase();
  const hit = cache[cacheKey];
  if (hit && Date.now() - Date.parse(hit.generated_at) < cfg.ROUTE_CACHE_TTL_MS) {
    log("route: cache hit");
    return hit;
  }

  const [from, to] = [await geocode(fromInput), await geocode(toInput)];
  log(`route: ${from.name} -> ${to.name}`);
  const route = await osrmRoute(from, to);
  const cum = cumulative(route.coords);
  const totalMiles = cum[cum.length - 1];
  const cities = loadCities();
  const superchargers = loadSuperchargers();

  // Feasibility: largest gap between consecutive on-route superchargers.
  const onRoute = chargersAlongRoute(route.coords, cum, superchargers);
  let maxGap = 0, gapAt = 0;
  const markers = [0, ...onRoute.map((s) => s.mile), totalMiles];
  for (let i = 1; i < markers.length; i++) {
    if (markers[i] - markers[i - 1] > maxGap) { maxGap = markers[i] - markers[i - 1]; gapAt = markers[i - 1]; }
  }

  const nDays = Math.max(1, Math.ceil(totalMiles / cfg.VEHICLE.max_day_mi));
  const usedNames = new Set([from.name, to.name]);
  const stopovers = [];
  for (let i = 1; i < nDays; i++) {
    const stop = pickStopover((totalMiles * i) / nDays, route.coords, cum, cities, superchargers, usedNames);
    usedNames.add(stop.name);
    stopovers.push(stop);
  }
  stopovers.sort((a, b) => a.mile - b.mile);

  const wx = await stopoverWeather(stopovers);
  const waypoints = [
    { name: from.name, lat: from.lat, lon: from.lon, mile: 0 },
    ...stopovers,
    { name: to.name, lat: to.lat, lon: to.lon, mile: totalMiles },
  ];
  const days = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const legMiles = b.mile - a.mile;
    const isLast = i === waypoints.length - 2;
    let night = null;
    if (!isLast) {
      const w = wx[i]; // forecast at stopover; arrival evening = forecast day i
      const di = Math.min(i, 6);
      if (w?.daily) {
        night = {
          date: w.daily.time[di],
          hi: Math.round(w.daily.temperature_2m_max[di]),
          lo: Math.round(w.daily.temperature_2m_min[di]),
          precipProb: w.daily.precipitation_probability_max?.[di] ?? null,
        };
      }
    }
    days.push({
      day: i + 1,
      from: a.name, to: b.name,
      miles: Math.round(legMiles),
      driveHours: Math.round((route.hours * legMiles) / totalMiles * 10) / 10,
      // Full overnight charge covers the first stretch; supercharger hops after.
      chargeStops: legMiles <= cfg.VEHICLE.first_leg_mi ? 0 :
        Math.ceil((legMiles - cfg.VEHICLE.first_leg_mi) / cfg.VEHICLE.leg_cap_mi),
      stopover: isLast ? null : {
        name: b.name, vetted: b.vetted, curated: b.curated,
        offRouteMi: Math.round(b.offRouteMi * 10) / 10,
        supercharger: b.supercharger,
        night,
      },
    });
  }

  const plan = {
    generated_at: new Date().toISOString(),
    from: from.name, to: to.name,
    vehicle: cfg.VEHICLE.name,
    totals: {
      miles: Math.round(totalMiles),
      driveHours: Math.round(route.hours * 10) / 10,
      days: nDays,
      chargeStopsEstimate: days.reduce((n, d) => n + d.chargeStops, 0),
    },
    feasibility: {
      onRouteSuperchargers: onRoute.length,
      maxGapMiles: Math.round(maxGap),
      gapWarning: maxGap > cfg.SC_GAP_WARN_MI
        ? `largest supercharger gap is ${Math.round(maxGap)} mi starting near mile ${Math.round(gapAt)}`
        : null,
    },
    days,
    // Downsampled geometry for the frontend map (every ~8th point).
    polyline: route.coords.filter((_, i) => i % 8 === 0 || i === route.coords.length - 1)
      .map(([lon, lat]) => [lat, lon]),
  };

  fs.mkdirSync(cfg.VAR_DIR, { recursive: true });
  cache[cacheKey] = plan;
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
  return plan;
}

module.exports = { planRoute, geocode, haversine };
