// scripts/build-towns-on.mjs
// Node 18+. No keys required.
// Builds public/towns-on.json with {name, lat, lon, pop, kind} for Ontario.

import fs from "node:fs/promises";

const OUT = new URL("../public/towns-on.json", import.meta.url);

// Conservative fallback populations when OSM doesn't provide one
const POP_FALLBACK = {
  city: 10000,
  town: 1000,
  village: 300,
  hamlet: 100,
  suburb: 500,     // suburban named areas vary a lot
  locality: 100    // catch-all; keep only if likely inhabited
};

// Convert weird population strings (e.g., "1,234", "1200; 2016 census") → int
function parsePop(raw) {
  if (!raw) return null;
  const m = String(raw).replace(/[^\d.]/g, "");
  if (!m) return null;
  const n = Math.round(Number(m));
  return Number.isFinite(n) ? n : null;
}

function normName(s) {
  return s?.trim().replace(/\s+/g, " ") ?? "";
}

function uniqueKey(it) {
  return `${normName(it.name)}|${it.lat.toFixed(5)}|${it.lon.toFixed(5)}`;
}

// One Overpass pull grabbing nodes/ways/relations in Ontario by ISO code.
async function fetchChunk(placeRegex) {
  const query = `
    [out:json][timeout:180];
    area["ISO3166-2"="CA-ON"]->.a;
    (
      node["place"~"${placeRegex}"](area.a);
      way["place"~"${placeRegex}"](area.a);
      relation["place"~"${placeRegex}"](area.a);
    );
    out tags center;
  `;

  const url = "https://overpass-api.de/api/interpreter";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: new URLSearchParams({ data: query })
  });
  if (!res.ok) throw new Error(`Overpass error: ${res.status} ${res.statusText}`);
  return res.json();
}

// Turn OSM element → {name, lat, lon, pop, kind}
function toTown(el) {
  const t = el.tags || {};
  const kind = t.place || "locality";
  const name = normName(t.name || t["name:en"]);
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const p = parsePop(t.population);
  const pop = p ?? POP_FALLBACK[kind] ?? 0;

  // Keep only plausible inhabited places over our floor
  if (pop < 100) return null;

  return { name, lat, lon, pop, kind };
}

async function main() {
  // Split by class to keep responses reasonable
  const chunks = [
    "^(city)$",
    "^(town)$",
    "^(village)$",
    "^(hamlet)$",
    "^(suburb|locality)$"
  ];

  const results = [];
  for (const r of chunks) {
    const data = await fetchChunk(r);
    results.push(...(data.elements || []));
  }

  // Map → normalize → dedupe
  const byKey = new Map();
  for (const el of results) {
    const town = toTown(el);
    if (!town) continue;
    byKey.set(uniqueKey(town), town);
  }

  // Sort by population desc (stable-ish)
  const list = Array.from(byKey.values()).sort((a, b) => b.pop - a.pop);

  await fs.mkdir(new URL("../public/", import.meta.url), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(list, null, 2), "utf8");

  console.log(`Wrote ${list.length} towns → ${OUT.pathname}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
