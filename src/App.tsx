import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Tornado,
  Wind,
  CloudLightning,
  CloudRain,
  Eye,
  Copy,
  RefreshCcw,
  MapPin,
  Clock,
  Compass,
  Map,
  MapPin as MapPinIcon,
} from "lucide-react";

/**
 * Instant Weather – Notification Generator
 * Polygon tools added:
 * - Paste polygon link → parse & show on Leaflet map
 * - "Fill towns from polygon" → auto-fills top 5 towns by population for the selected province
 * All existing UI/behavior preserved.
 */

type HazardKey = "funnel" | "rotation" | "tornado" | "hail" | "wind" | "flooding";
type Mode = "storm" | "regional";
type HazardStatus = "detected" | "reported";
type ProvinceCode =
  | "ON" | "QC" | "MB" | "SK" | "AB" | "BC" | "NB" | "NS" | "PE" | "NL" | "YT" | "NT" | "NU";

type LatLng = [number, number];

interface HazardOption {
  value: string;
  name: string;
  level: number;
  phrase: string;
}
interface HazardGroup { label: string; options: HazardOption[]; }
interface HailMaxOption { value: string; name: string; sized: string; }
interface Town { name: string; lat: number; lon: number; pop: number; prov: ProvinceCode; }

/* ---------- Provinces / timezones ---------- */
const PROVINCE_TZ: Record<ProvinceCode, string> = {
  ON: "America/Toronto",
  QC: "America/Toronto",
  MB: "America/Winnipeg",
  SK: "America/Regina",
  AB: "America/Edmonton",
  BC: "America/Vancouver",
  NB: "America/Halifax",
  NS: "America/Halifax",
  PE: "America/Halifax",
  NL: "America/St_Johns",
  YT: "America/Whitehorse",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
};

const PROVINCE_FULL: Record<ProvinceCode, string> = {
  ON: "Ontario",
  QC: "Quebec",
  MB: "Manitoba",
  SK: "Saskatchewan",
  AB: "Alberta",
  BC: "British Columbia",
  NB: "New Brunswick",
  NS: "Nova Scotia",
  PE: "Prince Edward Island",
  NL: "Newfoundland and Labrador",
  YT: "Yukon",
  NT: "Northwest Territories",
  NU: "Nunavut",
};

function getStormReportGroupInfo(code: ProvinceCode): { name: string; url: string | null } {
  const full = PROVINCE_FULL[code] || code;
  if (code === "ON") return { name: "Ontario Storm Reports", url: "https://www.facebook.com/groups/ontariostormreports" };
  if (code === "AB" || code === "SK" || code === "MB") {
    const slug = full.toLowerCase().replace(/\s+/g, "");
    return { name: `${full} Storm Reports`, url: `https://www.facebook.com/groups/${slug}storm` };
  }
  if (code === "NB" || code === "NS" || code === "PE") {
    return { name: "Atlantic Canada Storm Reports", url: "https://www.facebook.com/groups/atlanticstormreports" };
  }
  return { name: `${full} Storm Reports`, url: null };
}

/* ---------- Severity levels ---------- */
const LEVELS = [
  { id: 1, key: "prepare", label: "Prepare", color: "#1e88e5" },
  { id: 2, key: "act", label: "Act", color: "#fb8c00" },
  { id: 3, key: "critical", label: "Critical", color: "#e53935" },
  { id: 4, key: "emergency", label: "Emergency", color: "#d81b60" },
] as const;

/* ---------- Hail max options (objects only) ---------- */
const HAIL_MAX_OPTS: HailMaxOption[] = [
  { value: "", name: "No max hail size selected (optional)", sized: "" },
  { value: "0.5cm_pea", name: "Pea (~0.5 cm)", sized: "pea-sized (~0.5 cm)" },
  { value: "1.5cm_marble", name: "Marble (~1.5 cm)", sized: "marble-sized (~1.5 cm)" },
  { value: "1.8cm_dime", name: "Dime (~1.8 cm)", sized: "dime-sized (~1.8 cm)" },
  { value: "2.1cm_nickel", name: "Nickel (~2.1 cm)", sized: "nickel-sized (~2.1 cm)" },
  { value: "2.4cm_quarter", name: "Quarter (~2.4 cm)", sized: "quarter-sized (~2.4 cm)" },
  { value: "2.65cm_loonie", name: "Loonie (~2.65 cm)", sized: "loonie-sized (~2.65 cm)" },
  { value: "2.8cm_toonie", name: "Toonie (~2.8 cm)", sized: "toonie-sized (~2.8 cm)" },
  { value: "3.2cm_timbit", name: "Timbit (~3.2 cm)", sized: "Timbit-sized (~3.2 cm)" },
  { value: "4.0cm_pingpong", name: "Ping-pong ball (~4.0 cm)", sized: "ping-pong ball-sized (~4.0 cm)" },
  { value: "4.3cm_golfball", name: "Golf ball (~4.3 cm)", sized: "golf ball-sized (~4.3 cm)" },
  { value: "6.7cm_tennisball", name: "Tennis ball (~6.7 cm)", sized: "tennis ball-sized (~6.7 cm)" },
  { value: "7.4cm_baseball", name: "Baseball (~7.4 cm)", sized: "baseball-sized (~7.4 cm)" },
  { value: "9.7cm_softball", name: "Softball (~9.7 cm)", sized: "softball-sized (~9.7 cm)" },
];

/* ---------- Hazards ---------- */
const HAZARDS: Record<HazardKey, HazardGroup> = {
  funnel: {
    label: "Funnel cloud",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no funnel indication" },
      { value: "reported", name: "Funnel cloud reported", level: 1, phrase: "a funnel cloud has been reported" },
      { value: "landspout_reported", name: "Landspout reported", level: 2, phrase: "a landspout tornado has been reported" },
    ],
  },
  rotation: {
    label: "Rotation",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no organized rotation" },
      { value: "weak", name: "Broad/weak", level: 1, phrase: "weak rotation" },
      { value: "organized", name: "Organized", level: 2, phrase: "organized low-level rotation" },
      { value: "strong", name: "Strong", level: 2, phrase: "strong rotation with tornado potential" },
      { value: "intense", name: "Intense", level: 3, phrase: "intense low-level rotation" },
    ],
  },
  tornado: {
    label: "Tornado",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no tornado indicated" },
      { value: "reported", name: "Reported", level: 2, phrase: "a tornado has been reported" },
      { value: "damaging_reported", name: "Damaging tornado reported", level: 3, phrase: "a damaging tornado has been reported" },
    ],
  },
  hail: {
    label: "Hail size",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no hail" },
      { value: "subsevere", name: "Sub-Severe", level: 1, phrase: "sub-severe hail" },
      { value: "marginal", name: "Marginally Severe", level: 1, phrase: "marginally severe hail" },
      { value: "severe", name: "Severe", level: 2, phrase: "severe hail" },
      { value: "large", name: "Large", level: 2, phrase: "large hail" },
      { value: "very_large", name: "Very Large", level: 3, phrase: "very large hail" },
    ],
  },
  wind: {
    label: "Wind gust",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no severe wind" },
      { value: "sub_severe", name: "Sub-Severe (below 90 km/h)", level: 1, phrase: "sub-severe winds" },
      { value: "severe", name: "Severe (90–100 km/h)", level: 2, phrase: "severe winds" },
      { value: "damaging", name: "Damaging (100–120 km/h)", level: 3, phrase: "damaging winds" },
      { value: "destructive", name: "Destructive (120+ km/h)", level: 4, phrase: "destructive winds" },
    ],
  },
  flooding: {
    label: "Flooding",
    options: [
      { value: "none", name: "None", level: 0, phrase: "no flooding issues" },
      { value: "isolated", name: "Isolated Flooding", level: 1, phrase: "isolated flooding" },
      { value: "flooding", name: "Flooding", level: 2, phrase: "flooding in prone areas" },
      { value: "significant", name: "Significant Flooding", level: 3, phrase: "significant flooding" },
    ],
  },
};

const DIRECTIONS = ["north","northeast","east","southeast","south","southwest","west","northwest"] as const;
const HAZARD_PRIORITY: HazardKey[] = ["tornado", "rotation", "hail", "wind", "flooding", "funnel"];

/* ---------- Helper utils ---------- */
const capWord = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function toTitleCase(s: string) { return s.replace(/\b\w/g, (m) => m.toUpperCase()); }
function nytTitleCase(str: string) {
  const small = new Set(["a","an","the","and","but","or","nor","for","so","yet","as","at","by","in","of","on","per","to","via","vs","vs.","with","over","into","onto","from","off","up","down","out","about","near"]);
  return (str || "").split(/\s+/).map((w,i,arr)=>{
    const isFirst = i===0, isLast = i===arr.length-1;
    const hasLetters = /[A-Za-z]/.test(w);
    if (hasLetters && w === w.toUpperCase() && w.length>1) return w;
    const lower = w.toLowerCase();
    if (!isFirst && !isLast && small.has(lower)) return lower;
    return lower.split("-").map((part,j,parts)=>{
      const firstLast = (isFirst && j===0) || (isLast && j===parts.length-1);
      return (small.has(part) && !firstLast) ? part : capWord(part);
    }).join("-");
  }).join(" ");
}
function formatTimestamp(d = new Date(), tz = "America/Toronto") {
  const date = d.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: tz, hour12: true });
  const tzLabel = new Intl.DateTimeFormat("en-CA", { timeZoneName: "short", timeZone: tz })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "ET";
  return `${date} at ${time} ${tzLabel}`;
}
function levelFromSelection(opt?: HazardOption) { return opt?.level ?? 0; }
function resolveOverallLevel(values: Record<HazardKey, HazardOption>) {
  let max = 0;
  (Object.values(values) as HazardOption[]).forEach((opt) => { max = Math.max(max, levelFromSelection(opt)); });
  const id = Math.min(Math.max(max, 1), 4);
  const meta = LEVELS.find((l) => l.id === id) ?? LEVELS[0];
  return { id, meta };
}
function orderedHazards(selection: Record<HazardKey, HazardOption>) {
  return HAZARD_PRIORITY
    .map((key) => ({ key, opt: selection[key] }))
    .filter((e) => e.opt && e.opt.level > 0)
    .sort((a, b) => b.opt.level - a.opt.level || HAZARD_PRIORITY.indexOf(a.key) - HAZARD_PRIORITY.indexOf(b.key));
}
function joinForHeadline(items: string[]) {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} & ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  const tail = items[items.length - 1];
  return `${head} & ${tail}`;
}

/* ---------- Policy override (storm mode) ---------- */
function computeFinalLevel(
  baseId: number,
  selection: Record<HazardKey, HazardOption>,
  majorPopPath: boolean,
  hailMajorPop: boolean,
  mode: Mode
) {
  if (mode === "regional") return 1;
  if (selection.wind?.value === "destructive") return 4;

  let finalId = baseId;

  if (selection.rotation?.value === "strong" && majorPopPath) finalId = Math.max(finalId, 3);
  if (selection.rotation?.value === "intense" && majorPopPath) finalId = Math.max(finalId, 4);

  if (selection.tornado?.value === "reported" && majorPopPath) finalId = Math.max(finalId, 3);
  if (selection.tornado?.value === "damaging_reported" && majorPopPath) finalId = Math.max(finalId, 4);

  if (hailMajorPop && selection.hail?.value === "large") finalId = Math.max(finalId, 3);
  if (hailMajorPop && selection.hail?.value === "very_large") finalId = Math.max(finalId, 4);

  return finalId;
}

/* ---------- Headline helpers ---------- */
function headlinePhrase(key: HazardKey, value: string, status: HazardStatus) {
  const tag = status === "reported" ? "Reported" : "Detected";
  switch (key) {
    case "tornado":
      if (value === "reported") return "Tornado Reported";
      if (value === "damaging_reported") return "Damaging Tornado Reported";
      return null;
    case "rotation":
      if (value === "weak") return "Weak Rotation Detected";
      if (value === "organized") return "Organized Rotation Detected";
      if (value === "strong") return "Strong Rotation Detected";
      if (value === "intense") return "Intense Rotation Detected";
      return null;
    case "funnel":
      if (value === "reported") return "Funnel Cloud Reported";
      if (value === "landspout_reported") return "Landspout Reported";
      return null;
    case "hail":
      if (value === "subsevere") return `Sub-Severe Hail ${tag}`;
      if (value === "marginal") return `Marginally Severe Hail ${tag}`;
      if (value === "severe") return `Severe Hail ${tag}`;
      if (value === "large") return `Large Hail ${tag}`;
      if (value === "very_large") return `Very Large Hail ${tag}`;
      return null;
    case "wind":
      if (value === "sub_severe") return `Sub-Severe Winds ${tag}`;
      if (value === "severe") return `Severe Winds ${tag}`;
      if (value === "damaging") return `Damaging Winds ${tag}`;
      if (value === "destructive") return `Destructive Winds ${tag}`;
      return null;
    case "flooding":
      if (value === "isolated") return `Isolated Flooding ${tag}`;
      if (value === "flooding") return `Flooding ${tag}`;
      if (value === "significant") return `Significant Flooding ${tag}`;
      return null;
    default:
      return null;
  }
}
function buildHeadlineStorm(
  selection: Record<HazardKey, HazardOption>,
  status: Record<HazardKey, HazardStatus>,
  overallId: number,
  overallLabel: string
) {
  const items = HAZARD_PRIORITY
    .map((key) => {
      const opt = selection[key];
      return !opt || opt.level === 0 ? null : { key, level: opt.level, value: opt.value };
    })
    .filter((x): x is { key: HazardKey; level: number; value: string } => x !== null)
    .sort((a, b) => b.level - a.level || HAZARD_PRIORITY.indexOf(a.key) - HAZARD_PRIORITY.indexOf(b.key));

  const phrases = items
    .map(({ key, value }) => {
      const stat: HazardStatus =
        key === "rotation" || key === "funnel" ? "detected" :
        key === "tornado" ? "reported" : status[key];
      return headlinePhrase(key, value, stat);
    })
    .filter((p): p is string => Boolean(p));

  const hazardTextRaw = phrases.length ? joinForHeadline(phrases) : "Hazardous Weather Detected";
  const category = overallLabel.toUpperCase();
  const needsAllCaps = overallId >= 3;
  const hazardText = needsAllCaps ? hazardTextRaw.toUpperCase() : nytTitleCase(hazardTextRaw);
  return `${category}: ${hazardText}`;
}
function buildHeadlineRegional(
  opts: { choice: "funnel" | "severe" | null; tornadoRisk: boolean },
  overallId: number,
  overallLabel: string
) {
  const parts: string[] = [];
  if (opts.choice === "funnel") parts.push("Funnel Cloud Potential");
  if (opts.choice === "severe") parts.push("Severe Thunderstorm Potential");
  if (opts.choice === "severe" && opts.tornadoRisk) parts.push("Tornado Risk");
  const textRaw = parts.length ? joinForHeadline(parts) : "Weather Potential";
  const category = overallLabel.toUpperCase();
  const needsAllCaps = overallId >= 3;
  const text = needsAllCaps ? textRaw.toUpperCase() : nytTitleCase(textRaw);
  return `${category}: ${text}`;
}

/* ---------- Towns (starter lists per province; can expand later) ---------- */
const TOWNS: Town[] = [
  // ON (good coverage)
  { name: "Toronto", lat: 43.65107, lon: -79.347015, pop: 2731571, prov: "ON" },
  { name: "Ottawa", lat: 45.42153, lon: -75.697193, pop: 934243, prov: "ON" },
  { name: "Mississauga", lat: 43.589, lon: -79.644, pop: 721599, prov: "ON" },
  { name: "Brampton", lat: 43.684, lon: -79.759, pop: 593638, prov: "ON" },
  { name: "Hamilton", lat: 43.2557, lon: -79.8711, pop: 536917, prov: "ON" },
  { name: "London", lat: 42.9834, lon: -81.233, pop: 383822, prov: "ON" },
  { name: "Markham", lat: 43.8561, lon: -79.337, pop: 328966, prov: "ON" },
  { name: "Vaughan", lat: 43.8372, lon: -79.5083, pop: 323282, prov: "ON" },
  { name: "Kitchener", lat: 43.4516, lon: -80.4925, pop: 256885, prov: "ON" },
  { name: "Windsor", lat: 42.3149, lon: -83.0364, pop: 217188, prov: "ON" },
  { name: "Oshawa", lat: 43.8971, lon: -78.8658, pop: 168000, prov: "ON" },
  { name: "St. Catharines", lat: 43.1594, lon: -79.2469, pop: 133113, prov: "ON" },
  { name: "Barrie", lat: 44.3894, lon: -79.6903, pop: 153356, prov: "ON" },
  { name: "Guelph", lat: 43.5448, lon: -80.2482, pop: 131794, prov: "ON" },
  { name: "Cambridge", lat: 43.3616, lon: -80.3144, pop: 129920, prov: "ON" },
  { name: "Whitby", lat: 43.8976, lon: -78.9429, pop: 138501, prov: "ON" },
  { name: "Kingston", lat: 44.2312, lon: -76.486, pop: 136685, prov: "ON" },
  { name: "Thunder Bay", lat: 48.3809, lon: -89.2477, pop: 110172, prov: "ON" },
  { name: "Waterloo", lat: 43.4643, lon: -80.5204, pop: 121436, prov: "ON" },
  { name: "Brantford", lat: 43.1394, lon: -80.2644, pop: 104688, prov: "ON" },
  { name: "Pickering", lat: 43.8384, lon: -79.0868, pop: 99484, prov: "ON" },
  { name: "Niagara Falls", lat: 43.0896, lon: -79.0849, pop: 94415, prov: "ON" },
  { name: "Peterborough", lat: 44.3091, lon: -78.3197, pop: 83500, prov: "ON" },
  { name: "Sarnia", lat: 42.9745, lon: -82.4066, pop: 71594, prov: "ON" },
  { name: "Newmarket", lat: 44.0592, lon: -79.4613, pop: 84224, prov: "ON" },
  { name: "North Bay", lat: 46.3091, lon: -79.4608, pop: 51553, prov: "ON" },
  { name: "Belleville", lat: 44.1628, lon: -77.3832, pop: 55671, prov: "ON" },
  { name: "Milton", lat: 43.5183, lon: -79.8774, pop: 132979, prov: "ON" },
  { name: "Woodstock", lat: 43.1306, lon: -80.7467, pop: 46505, prov: "ON" },
  { name: "Orillia", lat: 44.6087, lon: -79.419, pop: 33811, prov: "ON" },
  { name: "Owen Sound", lat: 44.5672, lon: -80.943, pop: 21941, prov: "ON" },
  { name: "Collingwood", lat: 44.5001, lon: -80.216, pop: 24911, prov: "ON" },
  { name: "Stratford", lat: 43.370, lon: -80.981, pop: 33500, prov: "ON" },
  { name: "Listowel", lat: 43.734, lon: -80.953, pop: 9000, prov: "ON" },
  { name: "Hanover", lat: 44.151, lon: -81.033, pop: 8200, prov: "ON" },
  { name: "Walkerton", lat: 44.132, lon: -81.148, pop: 5000, prov: "ON" },
  { name: "Goderich", lat: 43.740, lon: -81.713, pop: 7500, prov: "ON" },
  { name: "Kincardine", lat: 44.180, lon: -81.637, pop: 13000, prov: "ON" },
  { name: "Port Elgin", lat: 44.436, lon: -81.389, pop: 8500, prov: "ON" },

  // AB (starter)
  { name: "Calgary", lat: 51.0447, lon: -114.0719, pop: 1239000, prov: "AB" },
  { name: "Edmonton", lat: 53.5461, lon: -113.4938, pop: 981280, prov: "AB" },
  { name: "Red Deer", lat: 52.2681, lon: -113.8112, pop: 100844, prov: "AB" },
  { name: "Lethbridge", lat: 49.6956, lon: -112.8451, pop: 92563, prov: "AB" },

  // SK
  { name: "Saskatoon", lat: 52.1332, lon: -106.6700, pop: 273010, prov: "SK" },
  { name: "Regina", lat: 50.4452, lon: -104.6189, pop: 226404, prov: "SK" },

  // MB
  { name: "Winnipeg", lat: 49.8951, lon: -97.1384, pop: 749607, prov: "MB" },
  { name: "Brandon", lat: 49.8485, lon: -99.9501, pop: 48859, prov: "MB" },

  // QC
  { name: "Montréal", lat: 45.5019, lon: -73.5674, pop: 1760000, prov: "QC" },
  { name: "Québec City", lat: 46.8139, lon: -71.2080, pop: 542298, prov: "QC" },

  // BC
  { name: "Vancouver", lat: 49.2827, lon: -123.1207, pop: 675218, prov: "BC" },
  { name: "Victoria", lat: 48.4284, lon: -123.3656, pop: 91867, prov: "BC" },
  { name: "Kelowna", lat: 49.8879, lon: -119.4960, pop: 144576, prov: "BC" },

  // Atlantic
  { name: "Halifax", lat: 44.6488, lon: -63.5752, pop: 439819, prov: "NS" },
  { name: "Moncton", lat: 46.0878, lon: -64.7782, pop: 79470, prov: "NB" },
  { name: "Saint John", lat: 45.2733, lon: -66.0633, pop: 67575, prov: "NB" },
  { name: "Charlottetown", lat: 46.2382, lon: -63.1311, pop: 36094, prov: "PE" },
  { name: "St. John’s", lat: 47.5615, lon: -52.7126, pop: 110525, prov: "NL" },

  // North (starters)
  { name: "Whitehorse", lat: 60.7212, lon: -135.0568, pop: 28600, prov: "YT" },
  { name: "Yellowknife", lat: 62.4540, lon: -114.3718, pop: 20500, prov: "NT" },
  { name: "Iqaluit", lat: 63.7467, lon: -68.5170, pop: 7740, prov: "NU" },
];

/* ---------- Geometry helpers ---------- */
function parsePolygonFromUrl(url: string): LatLng[] | null {
  try {
    const decoded = decodeURIComponent(url.trim());
    const tail = decoded.split("/").pop() || decoded;
    const pairs = tail.split(",").map(s => s.trim()).filter(Boolean);
    const coords: LatLng[] = [];
    for (const pair of pairs) {
      const parts = pair.split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
      if (parts.length < 2) continue;
      let lat = parts[0], lon = parts[1];
      if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat];
      coords.push([lat, lon]);
    }
    if (coords.length < 3) return null;
    const first = coords[0], last = coords[coords.length - 1];
    if (!(Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9)) {
      coords.push([first[0], first[1]]);
    }
    return coords;
  } catch {
    return null;
  }
}

// --- Robust parser for IW /custom/... polygon links ---
// Accepts encoded or plain URLs like:
// https://instantweather.ca/login/admin/custom/45.084%20-78.098%2C45.326%20-77.386%2C44.898%20-76.877%2C44.769%20-77.962%2C45.084%20-78.098
// Returns Leaflet-ready [lat, lng][]; trims duplicate closing point.
function parseCoordsFromUrl(raw: string): [number, number][] {
  if (!raw) return [];
  let s = raw.trim();

  // decode 1–2 times in case it’s double-encoded
  try { s = decodeURIComponent(s); } catch {}
  try { s = decodeURIComponent(s); } catch {}

  // Prefer the substring after "/custom/", otherwise use whole string
  const after = s.split('/custom/').pop() || s;

  // after should look like: "45.084 -78.098,45.326 -77.386,..."
  const tokens = after.split(',').map(t => t.trim()).filter(Boolean);

  const out: [number, number][] = [];
  for (const tok of tokens) {
    // grab the first "number number" pair
    const m = tok.match(/-?\d+(?:\.\d+)?\s+-?\d+(?:\.\d+)?/);
    const pair = (m ? m[0] : tok).trim().split(/\s+/);
    if (pair.length !== 2) continue;
    const lat = parseFloat(pair[0]);
    const lon = parseFloat(pair[1]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.push([lat, lon]);
  }

  // remove trailing duplicate of the first vertex
  if (out.length >= 2) {
    const [aLat, aLon] = out[0];
    const [bLat, bLon] = out[out.length - 1];
    if (Math.abs(aLat - bLat) < 1e-6 && Math.abs(aLon - bLon) < 1e-6) {
      out.pop();
    }
  }
  return out;
}


// Ray-casting point-in-polygon (x=lon, y=lat)
function pointInPolygon(pt: LatLng, poly: LatLng[]) {
  const x = pt[1], y = pt[0];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][1], yi = poly[i][0];
    const xj = poly[j][1], yj = poly[j][0];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi + 0.0) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ---------- Component ---------- */
export default function NotificationGenerator() {
  // Prevent indexing + consistent light UI
  useEffect(() => {
    const ensureMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) { el = document.createElement("meta"); el.setAttribute("name", name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };
    ensureMeta("robots", "noindex, nofollow, noarchive");
    ensureMeta("googlebot", "noindex, nofollow");

    const STYLE_ID = "__iw_light_ui__";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.innerHTML = `
        :root { color-scheme: light; }
        html, body, #root { min-height: 100%; background: #f6f7f9; }
        body { margin: 0; }
        .leaflet-container { border-radius: 12px; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const [mode, setMode] = useState<Mode>("storm");
  const [province, setProvince] = useState<ProvinceCode>("ON");
  const tz = PROVINCE_TZ[province] || "America/Toronto";
  const [addHashtags, setAddHashtags] = useState(false);

  // Storm details
  const [location, setLocation] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("east");
  const [speed, setSpeed] = useState("");
  const [towns, setTowns] = useState("");
  const [timeWindow, setTimeWindow] = useState("the next 30 to 60 minutes");
  const [now, setNow] = useState(new Date());

  // Regional
  const [regions, setRegions] = useState("");
  const [regionalChoice, setRegionalChoice] = useState<"funnel" | "severe" | null>(null);
  const [regionalSevere, setRegionalSevere] = useState({ hail: true, wind: true, heavyRain: true, lightning: true });
  const [regionalTornadoRisk, setRegionalTornadoRisk] = useState(false);
  const [regionalTornadoRiskLevel, setRegionalTornadoRiskLevel] = useState<"low"|"moderate"|"high">("low");

  // Funnel subtype & reporter (storm mode)
  const [funnelSubtype, setFunnelSubtype] = useState<"supercell" | "non">("non");
  const [funnelReporter, setFunnelReporter] = useState("");

  // Hazards (storm mode)
  const [selection, setSelection] = useState<Record<HazardKey, HazardOption>>({
    funnel: HAZARDS.funnel.options[0],
    rotation: HAZARDS.rotation.options[0],
    tornado: HAZARDS.tornado.options[0],
    hail: HAZARDS.hail.options[0],
    wind: HAZARDS.wind.options[0],
    flooding: HAZARDS.flooding.options[0],
  });

  // Optional detail fields
  const [hailMax, setHailMax] = useState<string>("");
  const [hailMajorPop, setHailMajorPop] = useState(false);
  const [windMax, setWindMax] = useState<string>("");
  const [rainMax, setRainMax] = useState<string>("");

  // Status sliders
  const [status, setStatus] = useState<Record<HazardKey, HazardStatus>>({
    funnel: "detected", rotation: "detected", tornado: "detected", hail: "detected", wind: "detected", flooding: "detected",
  });
  const [reportNotes, setReportNotes] = useState<Record<HazardKey, string>>({
    funnel: "", rotation: "", tornado: "", hail: "", wind: "", flooding: "",
  });

  // Major population in path
  const [majorPopPath, setMajorPopPath] = useState(false);

  // Overall level
  const baseOverall = useMemo(
    () => (mode === "storm" ? resolveOverallLevel(selection) : { id: 1, meta: LEVELS[0] }),
    [mode, selection]
  );
  const finalLevelId = useMemo(
    () => computeFinalLevel(baseOverall.id, selection, majorPopPath, hailMajorPop, mode),
    [baseOverall.id, selection, majorPopPath, hailMajorPop, mode]
  );
  const finalLevelMeta = LEVELS.find((l) => l.id === finalLevelId)!;

  const headlineBase = useMemo(() =>
    mode === "storm"
      ? buildHeadlineStorm(selection, status, finalLevelId, finalLevelMeta.label)
      : buildHeadlineRegional({ choice: regionalChoice, tornadoRisk: regionalTornadoRisk }, finalLevelId, finalLevelMeta.label),
    [mode, selection, status, finalLevelId, finalLevelMeta.label, regionalChoice, regionalTornadoRisk]
  );

  const headline = useMemo(() => {
    if (!addHashtags) return headlineBase;
    const code = String(province).toUpperCase();
    return `#${code}Storm #${code}wx ${headlineBase}`;
  }, [addHashtags, headlineBase, province]);

  const timestamp = useMemo(() => formatTimestamp(now, tz), [now, tz]);

  /* ---------- Description (fixed: no duplicate consts) ---------- */
  const description = useMemo(() => {
    const groupInfo = getStormReportGroupInfo(province);
    const reportLine =
      `Have a report? If it is safe, please post to ${groupInfo.name}` +
      `${groupInfo.url ? ` (${groupInfo.url})` : ""}. Include your exact location and the local date/time of your report.`;

    if (mode === "regional") {
      const areaText = regions ? `Regions impacted: ${regions}.` : "Regions impacted: multiple communities within the area.";
      const tf = timeWindow ? ` Timeframe: ${timeWindow}.` : "";

      if (regionalChoice === "funnel") {
        const p1 = `This is a regional notification categorized as ${finalLevelMeta.label}: conditions are favourable for funnel clouds to develop in parts of the area. ${areaText}${tf}`;
        const p2 = `What it means: Funnel clouds are narrow, rotating columns that extend from the base of towering cumulus or developing thunderstorms. They rarely pose a significant threat, but they can briefly touch down and become a weak landspout tornado, which is a narrow, ground-based spin-up not connected to a rotating supercell.`;
        const p3 = `If you see a funnel cloud: Move indoors and away from windows, note the time and location, and be ready to shelter quickly if it approaches. Consider reporting it if safe to do so.`;
        const p4 = `Stay aware: Keep an eye on the sky and stay tuned for future Instant Weather custom notifications and alerts from Environment Canada. Be prepared to act quickly if storms intensify.`;
        const p5 = `Reports: ${reportLine}`;
        return [p1, p2, p3, p4, p5].join("\n\n");
      }

      if (regionalChoice === "severe") {
        const risks: string[] = [];
        if (regionalSevere.wind) risks.push("damaging wind gusts");
        if (regionalSevere.hail) risks.push("large hail");
        if (regionalSevere.heavyRain) risks.push("torrential rain and localized flooding");
        if (regionalSevere.lightning) risks.push("frequent lightning");
        const riskLine = risks.length
          ? `Possible hazards: ${risks.length === 1 ? risks[0] : risks.slice(0,-1).join(", ") + " & " + risks[risks.length-1]}.`
          : "";
        const torLine = regionalTornadoRisk ? `Tornado risk: ${toTitleCase(regionalTornadoRiskLevel)}.` : "";
        const p1 = `This is a regional notification categorized as ${finalLevelMeta.label}: conditions may develop to produce severe thunderstorms in parts of the area. ${areaText}${tf}`;
        const p2 = [riskLine, torLine].filter(Boolean).join(" ");
        const p3 = `What you should do: Have a way to receive notifications and stay tuned for future Instant Weather custom notifications and alerts from Environment Canada. Be ready to move indoors quickly if skies darken or thunder is heard.`;
        const p4 = `Reports: ${reportLine}`;
        return [p1, p2, p3, p4].filter(Boolean).join("\n\n");
      }

      const pFallback = `This is a regional notification categorized as ${finalLevelMeta.label}. ${areaText}${tf}`;
      const pR = `Reports: ${reportLine}`;
      return [pFallback, pR].join("\n\n");
    }

    // Storm-based
    const townsText = towns.split(/\n|,/).map((t) => t.trim()).filter(Boolean).join(", ");
    const spd = speed ? ` at about ${speed} km/h` : "";
    const timeText = timeWindow ? ` Expected impacts over ${timeWindow}.` : "";

    const ordered = orderedHazards(selection);
    const primary = ordered[0];
    const extras = ordered.slice(1);

    const levelMeaning = {
      1: "Low immediate risk. Conditions could strengthen.",
      2: "Action is advised soon. A severe storm is occurring or likely.",
      3: "High impact threat. Shelter now.",
      4: "Life-threatening situation. Take immediate shelter.",
    }[finalLevelId];

    const hailMaxEntry = HAIL_MAX_OPTS.find((o) => o.value === hailMax);
    const hailMaxSized = hailMaxEntry?.sized || "";

    const descFor = (key: HazardKey, value: string): string | null => {
      switch (key) {
        case "tornado":
          if (value === "reported") return `a tornado, reported${reportNotes.tornado ? ` (${reportNotes.tornado})` : ""}`;
          if (value === "damaging_reported") return `a damaging tornado, reported${reportNotes.tornado ? ` (${reportNotes.tornado})` : ""}`;
          return null;
        case "rotation":
          if (value === "weak") return "weak rotation detected, an indicator that the storm may strengthen and could eventually produce a tornado";
          if (value === "organized") return "organized low-level rotation detected, the storm has increased potential to produce a tornado";
          if (value === "strong") return "strong, tightening rotation detected with potential for a tornado to develop at short notice";
          if (value === "intense") return "intense low-level rotation detected, a tornado could develop or be ongoing very near the circulation";
          return null;
        case "hail": {
          const classLabel =
            value === "subsevere" ? "sub-severe hail" :
            value === "marginal" ? "marginally severe hail" :
            value === "severe" ? "severe hail" :
            value === "large" ? "large hail" :
            value === "very_large" ? "very large hail" : null;
          if (!classLabel) return null;
          const sizePart = hailMaxSized ? `, up to ${hailMaxSized} hail` : "";
          const rep = status.hail === "reported" ? " reported" : " detected";
          const noteH = status.hail === "reported" && reportNotes.hail ? ` (${reportNotes.hail})` : "";
          return `${classLabel}${sizePart}${rep}${noteH}`;
        }
        case "wind": {
          const classText =
            value === "sub_severe" ? "sub-severe winds" :
            value === "severe" ? "severe winds" :
            value === "damaging" ? "damaging winds" :
            value === "destructive" ? "destructive winds" : null;
          if (!classText) return null;
          const maxPart = windMax ? `, up to ${windMax} km/h` : "";
          const rep = status.wind === "reported" ? " reported" : " detected";
          const noteW = status.wind === "reported" && reportNotes.wind ? ` (${reportNotes.wind})` : "";
          return `${classText}${maxPart}${rep}${noteW}`;
        }
        case "flooding": {
          const classText =
            value === "isolated" ? "isolated flooding" :
            value === "flooding" ? "flooding in prone areas" :
            value === "significant" ? "significant flooding" : null;
          if (!classText) return null;
          const maxRain = rainMax ? `, with rainfall totals up to ${rainMax} mm possible` : "";
          const rep = status.flooding === "reported" ? " reported" : " detected";
          const noteF = status.flooding === "reported" && reportNotes.flooding ? ` (${reportNotes.flooding})` : "";
          return `${classText}${maxRain}${rep}${noteF}`;
        }
        case "funnel":
          if (value === "reported") {
            const subtypeText = funnelSubtype === "supercell"
              ? "typically associated with supercell thunderstorms and can touch down to become a tornado"
              : "often associated with non-supercell convection; they rarely pose a significant threat but can briefly touch down as a weak landspout tornado";
            const by = funnelReporter ? ` (reported by ${funnelReporter})` : "";
            return `a funnel cloud has been reported${by}; ${subtypeText}`;
          }
          if (value === "landspout_reported") {
            const by = funnelReporter ? ` (reported by ${funnelReporter})` : "";
            return `a landspout tornado has been reported${by} (a generally weaker, narrow tornado not tied to a rotating supercell)`;
          }
          return null;
        default:
          return null;
      }
    };

    const p1 =
      `This notification is categorized as ${finalLevelMeta.label}: ${levelMeaning}` +
      (location ? ` A storm is near ${location}, moving ${direction}${spd}.` : ` A storm is in your area, moving ${direction}${spd}.`) +
      (townsText ? ` Areas in the path include ${townsText}.` : "") +
      timeText;

    const primaryPhrase = primary ? descFor(primary.key as HazardKey, primary.opt.value) : null;
    const p2 = primaryPhrase ? `Primary threat: ${primaryPhrase}.` : "";

    const extrasPhrases = extras.map((e) => descFor(e.key as HazardKey, e.opt.value)).filter((s): s is string => Boolean(s));
    let p3 = "";
    if (extrasPhrases.length === 1) p3 = `Additional threat: ${extrasPhrases[0]}.`;
    else if (extrasPhrases.length > 1) p3 = `Additional threats: ${extrasPhrases.slice(0,-1).join(", ")} & ${extrasPhrases[extrasPhrases.length-1]}.`;

    const safetyLines: string[] = [];
    const rotationVal = selection.rotation?.value;
    const primaryKey = primary?.key as HazardKey | undefined;
    if (primaryKey === "rotation") {
      if (rotationVal === "weak") {
        safetyLines.push("Stay close to sturdy shelter and be ready to move indoors quickly if the storm approaches.", "Have a plan to reach an interior room away from windows on short notice.");
      } else if (rotationVal === "organized") {
        safetyLines.push("Be prepared to take shelter quickly in an interior room away from windows.", "Delay or reroute travel near the storm until it passes.");
      } else if (rotationVal === "strong") {
        safetyLines.push(
          ...(majorPopPath
            ? ["Take shelter now on the lowest level or an interior room away from windows.", "Protect your head and neck; avoid large open rooms."]
            : ["Act now: move to an interior room away from windows.", "Avoid windows and large open rooms, and be ready to move to the lowest level if the storm intensifies."]
          )
        );
      } else if (rotationVal === "intense") {
        safetyLines.push("Take shelter now on the lowest level in a sturdy building.", "Put as many walls between you and the outside as possible; protect your head and neck.");
      }
    } else if (primaryKey === "tornado") {
      safetyLines.push("Go to the lowest level or an interior room away from windows.", "Protect your head and neck; a helmet or cushions can help.", "If outdoors or in a vehicle, seek a sturdy building immediately.");
    } else if (primaryKey === "funnel" && (selection.funnel.value === "reported" || selection.funnel.value === "landspout_reported")) {
      safetyLines.push("Be ready to shelter quickly if the funnel approaches.", "Move indoors and avoid windows until it dissipates or passes.");
    } else if (primaryKey === "hail") {
      safetyLines.push("Move indoors and stay away from windows and skylights.", "If driving, safely pull over under a sturdy structure if possible.", "Protect vehicles where you can; avoid parking under trees.");
    } else if (primaryKey === "wind") {
      safetyLines.push("Move to an interior room away from windows.", "Secure or bring inside loose outdoor items.", "Avoid travel during the peak of the storm if possible.");
    } else if (primaryKey === "flooding") {
      safetyLines.push("Never drive through flooded roads; turn around instead.", "Avoid low-lying areas, underpasses and fast-moving water.", "Move valuables off the floor in basements if safe to do so.");
    } else {
      safetyLines.push("Stay aware and be ready to act quickly if conditions worsen.");
    }
    safetyLines.push("Stay tuned for future Instant Weather custom notifications and alerts from Environment Canada.");

    const p4 = `What you should do: ${safetyLines.join(" ")}`;
    const p5 = `Reports: ${reportLine}`;

    return [p1, p2, p3, p4, p5].filter(Boolean).join("\n\n");
  }, [
    mode, regions, regionalChoice, regionalSevere, regionalTornadoRisk, regionalTornadoRiskLevel, timeWindow,
    selection, status, reportNotes, hailMax, hailMajorPop, majorPopPath, funnelSubtype, funnelReporter,
    location, towns, direction, speed, finalLevelId, finalLevelMeta.label, province
  ]);

  /* ---------- Polygon tools state ---------- */
  const [polyUrl, setPolyUrl] = useState("");
  const [polyCoords, setPolyCoords] = useState<LatLng[] | null>(null);
  const mapRef = useRef<any>(null);
  const layerRef = useRef<any>(null);

  // Initialize/Update Leaflet map when polygon changes
  useEffect(() => {
    const L = (window as any).L;
    const mapEl = document.getElementById("iw-poly-map");
    if (!L || !mapEl) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapEl).setView([45, -79], 5);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors",
        maxZoom: 18,
      }).addTo(mapRef.current);
    }
    const map = mapRef.current;

    if (layerRef.current) {
      layerRef.current.remove();
      layerRef.current = null;
    }

    if (polyCoords && polyCoords.length >= 3) {
      layerRef.current = L.polygon(polyCoords, { color: "#2563eb", weight: 3, fillOpacity: 0.15 }).addTo(map);
      const bounds = L.latLngBounds(polyCoords as any);
      map.fitBounds(bounds, { padding: [20, 20] });
    }
  }, [polyCoords]);

  function handleParsePolygon() {
    const coords = parsePolygonFromUrl(polyUrl);
    if (!coords) {
      alert("Could not parse coordinates from the link. Please check the format.");
      setPolyCoords(null);
      return;
    }
    setPolyCoords(coords);
  }

  function handleFillTownsFromPolygon() {
    if (!polyCoords || polyCoords.length < 3) {
      alert("Parse a polygon first.");
      return;
    }
    const candidates = TOWNS.filter((t) => t.prov === province && pointInPolygon([t.lat, t.lon], polyCoords));
    if (candidates.length === 0) {
      alert("No towns from the built-in list are inside this polygon. We can add more towns for this province if you like.");
      return;
    }
    const top5 = candidates.sort((a, b) => b.pop - a.pop).slice(0, 5);
    setTowns(top5.map((t) => t.name).join(", "));
  }

  /* ---------- Handlers ---------- */
  function updateSelect(groupKey: HazardKey, value: string) {
    const group = HAZARDS[groupKey];
    const opt = group.options.find((o) => o.value === value) ?? group.options[0];
    setSelection((prev) => ({ ...prev, [groupKey]: opt }));
  }
  const updateStatus = (key: HazardKey, val: HazardStatus) => setStatus((s) => ({ ...s, [key]: val }));
  const updateReportNote = (key: HazardKey, val: string) => setReportNotes((r) => ({ ...r, [key]: val }));
  function copyToClipboard(text: string) { if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(()=>{}); }
  const levelColorStyle = { background: finalLevelMeta.color, color: "#fff" } as React.CSSProperties;

  /* ---------- UI ---------- */
  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      <div className="max-w-screen-2xl mx-auto p-4 sm:p-6 lg:p-8">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-3">
            <Eye className="w-7 h-7" />
            Instant Weather Notification Generator
          </h1>
        </header>

        {/* Mode toggle */}
        <div className="mb-4">
          <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden">
            <button type="button" onClick={() => setMode("storm")} className={`px-3 py-1.5 text-sm ${mode==="storm" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>
              Storm-based
            </button>
            <button type="button" onClick={() => setMode("regional")} className={`px-3 py-1.5 text-sm border-l border-neutral-300 ${mode==="regional" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>
              Regional
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left column: Inputs */}
          <section className="bg-white rounded-2xl shadow-sm border border-neutral-200">
            <div className="p-5 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="w-5 h-5" />
                <h2 className="font-semibold">{mode === "storm" ? "Storm details" : "Regional details"}</h2>
              </div>
              <span className="text-xs font-medium px-2.5 py-1 rounded-full" style={levelColorStyle}>
                Level {finalLevelId} · {finalLevelMeta.label}
              </span>
            </div>

            {/* Details */}
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-1">
                  <label className="block text-sm font-medium mb-1">Province / time zone</label>
                  <select
                    value={province}
                    onChange={(e) => setProvince(e.target.value as ProvinceCode)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {(Object.keys(PROVINCE_TZ) as ProvinceCode[]).map((p) => (<option key={p} value={p}>{p}</option>))}
                  </select>
                </div>

                {mode === "storm" ? (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1">Current location</label>
                    <input
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="e.g., Listowel"
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                ) : (
                  <div className="sm:col-span-2">
                    <label className="block text-sm font-medium mb-1">Regions impacted</label>
                    <input
                      value={regions}
                      onChange={(e) => setRegions(e.target.value)}
                      placeholder="e.g., Grey-Bruce, Huron-Perth, Waterloo Region"
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                )}
              </div>

              {mode === "storm" ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium mb-1 flex items-center gap-1"><Compass className="w-4 h-4"/>Direction of motion</label>
                    <select
                      value={direction}
                      onChange={(e) => setDirection(e.target.value as any)}
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {DIRECTIONS.map((d) => (<option key={d} value={d}>{toTitleCase(d)}</option>))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Speed (km/h, optional)</label>
                    <input
                      type="number" inputMode="numeric" min={0} value={speed}
                      onChange={(e) => setSpeed(e.target.value)}
                      placeholder="e.g., 60"
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Time window</label>
                    <input
                      value={timeWindow}
                      onChange={(e) => setTimeWindow(e.target.value)}
                      placeholder="e.g., the next 30 to 60 minutes"
                      className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium mb-1">Timeframe</label>
                  <input
                    value={timeWindow}
                    onChange={(e) => setTimeWindow(e.target.value)}
                    placeholder="e.g., this afternoon and evening"
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              )}

              {mode === "storm" ? (
                <div>
                  <label className="block text-sm font-medium mb-1">Towns in the path</label>
                  <textarea
                    value={towns}
                    onChange={(e) => setTowns(e.target.value)}
                    rows={3}
                    placeholder="Enter towns or landmarks, separated by commas or new lines"
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ) : null}

              {/* Polygon tools (optional) */}
              {mode === "storm" && (
                <div className="rounded-xl border border-neutral-200 p-3 bg-neutral-50">
                  <div className="flex items-center gap-2 mb-2">
                    <Map className="w-4 h-4" />
                    <span className="font-semibold text-sm">Polygon tools</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      value={polyUrl}
                      onChange={(e) => setPolyUrl(e.target.value)}
                      placeholder="Paste polygon link (e.g., https://instantweather.ca/login/admin/custom/45.084 -78.098,...)"
                      className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                            const pts = parseCoordsFromUrl(polygonUrl); // polygonUrl = your textbox state
                            if (!pts.length) {
                              alert("Could not find coordinates in that link.");
                              return;
                            }
                            if (!mapRef.current) return;
                          
                            // remove existing polygon if present
                            if (polygonLayerRef.current) {
                              polygonLayerRef.current.remove();
                              polygonLayerRef.current = null;
                            }
                          
                            // draw new polygon
                            polygonLayerRef.current = L.polygon(pts, {
                              color: '#0ea5e9',
                              weight: 3,
                              fillOpacity: 0.2,
                            }).addTo(mapRef.current);
                          
                            // fit bounds
                            const bounds = polygonLayerRef.current.getBounds();
                            mapRef.current.fitBounds(bounds, { padding: [24, 24] });
                          }}

                        className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50"
                      >
                        <MapPinIcon className="w-4 h-4" />
                        Parse & show
                      </button>
                      <button
                        type="button"
                        onClick={handleFillTownsFromPolygon}
                        disabled={!polyCoords}
                        className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ${
                          polyCoords ? "border-neutral-300 bg-white hover:bg-neutral-50" : "border-neutral-200 bg-neutral-100 text-neutral-400 cursor-not-allowed"
                        }`}
                        title={polyCoords ? "Find top 5 towns in polygon" : "Parse a polygon first"}
                      >
                        <MapPinIcon className="w-4 h-4" />
                        Fill towns from polygon (top 5)
                      </button>
                    </div>
                    <div id="iw-poly-map" className="w-full" style={{ height: 260, background: "#eaeef3" }} />
                  </div>
                </div>
              )}
            </div>

            {/* Hazards */}
            <div className="px-5 pb-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2"><AlertTriangle className="w-5 h-5"/>Hazards</h3>

              {mode === "storm" ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(HAZARDS).map(([key, group]) => (
                    <div key={key} className="rounded-xl border border-neutral-200 p-3 bg-neutral-50">
                      <label className="block text-xs uppercase tracking-wide text-neutral-600 mb-1">{group.label}</label>
                      <select
                        value={selection[key as HazardKey].value}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateSelect(key as HazardKey, val);
                          if (key === "hail" && val === "none") { setHailMax(""); setHailMajorPop(false); }
                          if (key === "tornado" && val === "none") setMajorPopPath(false);
                          if (key === "rotation" && !["strong","intense"].includes(val)) setMajorPopPath(false);
                          if (key === "funnel" && val !== "reported") setFunnelSubtype("non");
                          if (key === "wind" && (val === "sub_severe" || val === "none")) setWindMax("");
                          if (key === "flooding" && val === "none") setRainMax("");
                        }}
                        className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {group.options.map((opt) => (<option key={opt.value} value={opt.value}>{opt.name}</option>))}
                      </select>

                      {/* HAIL: optional max size + major population for Large/Very Large */}
                      {key === "hail" && selection.hail.value !== "none" && (
                        <div className="mt-2 space-y-2">
                          <div>
                            <label className="block text-xs uppercase tracking-wide text-neutral-600 mb-1">Max hail size (optional)</label>
                            <select
                              value={hailMax}
                              onChange={(e) => setHailMax(e.target.value)}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              {HAIL_MAX_OPTS.map((o) => (<option key={o.value} value={o.value}>{o.name}</option>))}
                            </select>
                          </div>
                          {(selection.hail.value === "large" || selection.hail.value === "very_large") && (
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={hailMajorPop} onChange={(e) => setHailMajorPop(e.target.checked)} className="rounded border-neutral-300" />
                              <span>Major population in path</span>
                            </label>
                          )}
                        </div>
                      )}

                      {/* Funnel subtype + reporter */}
                      {key === "funnel" && (selection.funnel.value === "reported" || selection.funnel.value === "landspout_reported") && (
                        <div className="mt-2 space-y-2">
                          {selection.funnel.value === "reported" && (
                            <>
                              <span className="block text-[11px] uppercase tracking-wide text-neutral-600">Funnel type</span>
                              <div className="inline-flex rounded-md border border-neutral-300 overflow-hidden">
                                <button type="button" onClick={() => setFunnelSubtype("supercell")} className={`px-2.5 py-1 text-xs ${funnelSubtype==="supercell" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>Supercell</button>
                                <button type="button" onClick={() => setFunnelSubtype("non")} className={`px-2.5 py-1 text-xs border-l border-neutral-300 ${funnelSubtype==="non" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>Non-supercell</button>
                              </div>
                            </>
                          )}
                          <input
                            value={funnelReporter}
                            onChange={(e) => setFunnelReporter(e.target.value)}
                            placeholder="Reported by (e.g., trained spotter, OPP, photo/video)"
                            className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}

                      {/* Rotation: major population checkbox */}
                      {key === "rotation" && ["strong","intense"].includes(selection.rotation.value) && (
                        <div className="mt-2">
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={majorPopPath} onChange={(e) => setMajorPopPath(e.target.checked)} className="rounded border-neutral-300" />
                            <span>Major population in path</span>
                          </label>
                        </div>
                      )}

                      {/* Tornado: major population checkbox + reporter note */}
                      {key === "tornado" && (selection.tornado.value === "reported" || selection.tornado.value === "damaging_reported") && (
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <input
                            value={reportNotes.tornado || ""}
                            onChange={(e) => updateReportNote("tornado", e.target.value)}
                            placeholder="Reported by (e.g., trained spotter, OPP, photo/video)"
                            className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input type="checkbox" checked={majorPopPath} onChange={(e) => setMajorPopPath(e.target.checked)} className="rounded border-neutral-300" />
                            <span>Major population in path</span>
                          </label>
                        </div>
                      )}

                      {/* Status slider + notes (hide for rotation, funnel, tornado) */}
                      {key !== "rotation" && key !== "funnel" && key !== "tornado" && (
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wide text-neutral-600">Status</span>
                            <div className="inline-flex rounded-md border border-neutral-300 overflow-hidden">
                              <button type="button" onClick={() => updateStatus(key as HazardKey, "detected")} className={`px-2.5 py-1 text-xs ${status[key as HazardKey]==="detected" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>Detected</button>
                              <button type="button" onClick={() => updateStatus(key as HazardKey, "reported")} className={`px-2.5 py-1 text-xs ${status[key as HazardKey]==="reported" ? "bg-white" : "bg-neutral-100"} hover:bg-white border-l border-neutral-300`}>Reported</button>
                            </div>
                          </div>

                          {status[key as HazardKey] === "reported" && (
                            <input
                              value={reportNotes[key as HazardKey] || ""}
                              onChange={(e) => updateReportNote(key as HazardKey, e.target.value)}
                              placeholder="How was it reported? (e.g., photo/video, spotter)"
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}

                          {key === "wind" && selection.wind.value !== "none" && (
                            <input
                              type="number" inputMode="numeric" min={0} value={windMax}
                              onChange={(e) => setWindMax(e.target.value)}
                              placeholder="Max wind (km/h, optional)"
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}

                          {key === "flooding" && selection.flooding.value !== "none" && (
                            <input
                              type="number" inputMode="numeric" min={0} value={rainMax}
                              onChange={(e) => setRainMax(e.target.value)}
                              placeholder="Max rainfall (mm, optional)"
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                // Regional hazards (exclusive choice)
                <div className="space-y-3">
                  <div className="rounded-xl border border-neutral-200 p-3 bg-neutral-50">
                    <span className="block text-xs uppercase tracking-wide text-neutral-600 mb-2">Notification focus</span>
                    <label className="inline-flex items-center gap-2 mr-6 text-sm">
                      <input type="radio" name="regionalChoice" className="rounded border-neutral-300" checked={regionalChoice === "funnel"} onChange={() => setRegionalChoice("funnel")} />
                      <span>Funnel cloud potential</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="radio" name="regionalChoice" className="rounded border-neutral-300" checked={regionalChoice === "severe"} onChange={() => setRegionalChoice("severe")} />
                      <span>Severe thunderstorm potential</span>
                    </label>
                  </div>

                  {regionalChoice === "severe" && (
                    <div className="rounded-xl border border-neutral-200 p-3 bg-neutral-50">
                      <span className="block text-xs uppercase tracking-wide text-neutral-600 mb-2">Possible hazards (broad)</span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-neutral-300" checked={regionalSevere.wind} onChange={(e)=>setRegionalSevere(s=>({...s,wind:e.target.checked}))}/>
                          <span>Damaging wind gusts</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-neutral-300" checked={regionalSevere.hail} onChange={(e)=>setRegionalSevere(s=>({...s,hail:e.target.checked}))}/>
                          <span>Large hail</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-neutral-300" checked={regionalSevere.heavyRain} onChange={(e)=>setRegionalSevere(s=>({...s,heavyRain:e.target.checked}))}/>
                          <span>Torrential rain / flooding</span>
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-neutral-300" checked={regionalSevere.lightning} onChange={(e)=>setRegionalSevere(s=>({...s,lightning:e.target.checked}))}/>
                          <span>Frequent lightning</span>
                        </label>
                      </div>
                      <div className="mt-2 space-y-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input type="checkbox" className="rounded border-neutral-300" checked={regionalTornadoRisk} onChange={(e)=>setRegionalTornadoRisk(e.target.checked)} />
                          <span>Mention tornado risk</span>
                        </label>
                        {regionalTornadoRisk && (
                          <div>
                            <label className="block text-xs uppercase tracking-wide text-neutral-600 mb-1">Tornado risk level</label>
                            <select
                              value={regionalTornadoRiskLevel}
                              onChange={(e)=>setRegionalTornadoRiskLevel(e.target.value as "low"|"moderate"|"high")}
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                              <option value="low">Low</option>
                              <option value="moderate">Moderate</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Right column: Preview */}
          <section className="bg-white rounded-2xl shadow-sm border border-neutral-200 overflow-hidden">
            <div className="p-5 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="w-5 h-5" />
                <h2 className="font-semibold">Preview</h2>
              </div>
              <div className="flex items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm mr-2">
                  <input type="checkbox" checked={addHashtags} onChange={(e) => setAddHashtags(e.target.checked)} className="rounded border-neutral-300" />
                  <span>Add province hashtags to headline</span>
                </label>

                <button onClick={() => setNow(new Date())} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50" title="Refresh timestamp">
                  <RefreshCcw className="w-4 h-4" /> Update time
                </button>
                <button onClick={() => copyToClipboard(headline)} className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50" title="Copy headline">
                  <Copy className="w-4 h-4" /> Copy headline
                </button>
              </div>
            </div>

            {/* Live card */}
            <div className="p-5">
              <div className="rounded-2xl border border-neutral-200 overflow-hidden">
                <div className="px-5 py-3" style={{ background: finalLevelMeta.color }}>
                  <div className="flex items-center gap-2 text-white">
                    {finalLevelId === 4 ? <Tornado className="w-5 h-5"/> : finalLevelId === 3 ? <AlertTriangle className="w-5 h-5"/> : finalLevelId === 2 ? <Wind className="w-5 h-5"/> : <Eye className="w-5 h-5"/>}
                    <span className="text-xs uppercase tracking-wider opacity-90">Level {finalLevelId}</span>
                    <span className="font-semibold">{finalLevelMeta.label}</span>
                  </div>
                </div>
                <div className="px-5 py-4 space-y-3 bg-white">
                  <h3 className="text-lg font-bold leading-snug">{headline}</h3>
                  <div className="text-xs text-neutral-600 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5"/>
                    <span>{timestamp}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{description}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => { const full = `${headline}\n\n${timestamp}\n\n${description}`; copyToClipboard(full); }}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50"
                >
                  <Copy className="w-4 h-4"/> Copy full message
                </button>
              </div>

              <div className="mt-5">
                <p className="text-xs text-neutral-600 mb-2">Selected hazards</p>
                <div className="flex flex-wrap gap-2">
                  {mode === "storm" ? (
                    Object.entries(selection).map(([key, opt]) => (
                      (opt as HazardOption).level > 0 ? (
                        <span key={key} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                          {key === "tornado" && <Tornado className="w-3.5 h-3.5"/>}
                          {key === "rotation" && <Tornado className="w-3.5 h-3.5"/>}
                          {key === "hail" && <AlertTriangle className="w-3.5 h-3.5"/>}
                          {key === "wind" && <Wind className="w-3.5 h-3.5"/>}
                          {key === "flooding" && <CloudRain className="w-3.5 h-3.5"/>}
                          {key === "funnel" && <CloudLightning className="w-3.5 h-3.5"/>}
                          <span className="capitalize">{key}</span>
                          <span className="text-neutral-500">{(opt as HazardOption).name}</span>
                          {key === "hail" && hailMax && <span className="text-neutral-500">· max {HAIL_MAX_OPTS.find(h=>h.value===hailMax)?.name.toLowerCase()}</span>}
                          {key === "hail" && (selection.hail.value === "large" || selection.hail.value === "very_large") && hailMajorPop && <span className="text-neutral-500">· major population</span>}
                          {key === "wind" && windMax && <span className="text-neutral-500">· max {windMax} km/h</span>}
                          {key === "flooding" && rainMax && <span className="text-neutral-500">· max {rainMax} mm</span>}
                          {key === "tornado" && (selection.tornado.value === "reported" || selection.tornado.value === "damaging_reported") && <span className="text-neutral-500">· reported</span>}
                          {key === "tornado" && (selection.tornado.value === "reported" || selection.tornado.value === "damaging_reported") && majorPopPath && <span className="text-neutral-500">· major population</span>}
                          {key === "rotation" && ["strong","intense"].includes(selection.rotation.value) && majorPopPath && <span className="text-neutral-500">· major population</span>}
                          {key === "funnel" && (selection.funnel.value === "reported" || selection.funnel.value === "landspout_reported") && (
                            <>
                              {selection.funnel.value === "reported" && <span className="text-neutral-500">· {funnelSubtype === "supercell" ? "supercell" : "non-supercell"}</span>}
                              {funnelReporter && <span className="text-neutral-500">· {funnelReporter}</span>}
                            </>
                          )}
                        </span>
                      ) : null
                    ))
                  ) : (
                    <>
                      {regionalChoice === "funnel" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                          <CloudLightning className="w-3.5 h-3.5"/>
                          <span>Funnel cloud potential</span>
                        </span>
                      )}
                      {regionalChoice === "severe" && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                          <AlertTriangle className="w-3.5 h-3.5"/>
                          <span>Severe t-storm potential</span>
                          {regionalTornadoRisk && <span className="text-neutral-500">· tornado risk ({regionalTornadoRiskLevel})</span>}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Footer intentionally removed */}
      </div>
    </div>
  );
}
