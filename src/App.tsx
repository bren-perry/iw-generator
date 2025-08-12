import React, { useMemo, useState, useEffect } from "react";
import { AlertTriangle, Tornado, Wind, CloudLightning, CloudRain, Eye, Copy, RefreshCcw, MapPin, Clock, Compass } from "lucide-react";

/**
 * Instant Weather – Notification Generator
 * - Mode toggle: Storm-based (default) or Regional
 * - Action-first scale: Prepare (1), Act (2), Critical (3), Emergency (4)
 * - Overall level = most severe selected hazard, with policy overrides (see computeFinalLevel)
 * - Headline: CATEGORY: hazards...; uses '&' (no comma before it), commas only when 3+ items
 * - NYT-style capitalization for L1/L2; ALL CAPS for L3/L4
 * - Province selector sets timestamp timezone (defaults to Ontario/ET)
 * - Per-hazard status slider (Detected/Reported) + report note box
 * - Storm-based updates (rotation wording, population bumps, hail/wind/flooding options)
 * - Noindex meta added to keep the page out of search
 */

type HazardKey = "funnel" | "rotation" | "tornado" | "hail" | "wind" | "flooding";
type Mode = "storm" | "regional";

const PROVINCE_TZ: Record<string, string> = {
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

const PROVINCE_FULL: Record<string, string> = {
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

function getStormReportGroupInfo(code: keyof typeof PROVINCE_TZ): { name: string; url: string | null } {
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

const LEVELS = [
  { id: 1, key: "prepare", label: "Prepare", color: "#1e88e5", tint: "bg-blue-50", chip: "bg-blue-600", text: "text-blue-700" },
  { id: 2, key: "act", label: "Act", color: "#fb8c00", tint: "bg-orange-50", chip: "bg-orange-600", text: "text-orange-700" },
  { id: 3, key: "critical", label: "Critical", color: "#e53935", tint: "bg-red-50", chip: "bg-red-600", text: "text-red-700" },
  { id: 4, key: "emergency", label: "Emergency", color: "#d81b60", tint: "bg-pink-50", chip: "bg-pink-600", text: "text-pink-700" },
];

/** Max hail size options (object-based only, with Canadian objects where possible) */
const HAIL_MAX_OPTS: { value: string; name: string; sized: string }[] = [
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

// Hazards (storm mode)
const HAZARDS = {
  funnel: {
    label: "Funnel cloud",
    icon: CloudLightning,
    options: [
      { value: "none", name: "None", level: 0, phrase: "no funnel indication" },
      { value: "reported", name: "Funnel cloud reported", level: 1, phrase: "a funnel cloud has been reported" },
      { value: "landspout_reported", name: "Landspout reported", level: 2, phrase: "a landspout tornado has been reported" },
    ],
  },
  rotation: {
    label: "Rotation",
    icon: Tornado,
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
    icon: Tornado,
    options: [
      { value: "none", name: "None", level: 0, phrase: "no tornado indicated" },
      { value: "reported", name: "Reported", level: 2, phrase: "a tornado has been reported" },
      { value: "damaging_reported", name: "Damaging tornado reported", level: 3, phrase: "a damaging tornado has been reported" },
    ],
  },
  hail: {
    label: "Hail size",
    icon: AlertTriangle,
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
    icon: Wind,
    options: [
      { value: "none", name: "None", level: 0, phrase: "no severe wind" }, // default
      { value: "sub_severe", name: "Sub-Severe (below 90 km/h)", level: 1, phrase: "sub-severe winds" },
      { value: "severe", name: "Severe (90–100 km/h)", level: 2, phrase: "severe winds" },
      { value: "damaging", name: "Damaging (100–120 km/h)", level: 3, phrase: "damaging winds" },
      { value: "destructive", name: "Destructive (120+ km/h)", level: 4, phrase: "destructive winds" },
    ],
  },
  flooding: {
    label: "Flooding",
    icon: CloudRain,
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

// ---------- helpers ----------
function levelFromSelection(sel: any) { return sel?.level || 0; }

function resolveOverallLevel(values: Record<string, any>) {
  let max = 0;
  Object.values(values).forEach((opt: any) => { max = Math.max(max, levelFromSelection(opt)); });
  const id = Math.min(Math.max(max, 1), 4);
  const meta = LEVELS.find((l) => l.id === id) || LEVELS[0];
  return { id, meta };
}

// Policy override (storm mode)
function computeFinalLevel(
  baseId: number,
  selection: Record<string, any>,
  _status: Record<string,"detected"|"reported">,
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

function formatTimestamp(d = new Date(), tz = "America/Toronto") {
  const date = d.toLocaleDateString("en-CA", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: tz });
  const time = d.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: tz, hour12: true });
  const tzLabel = new Intl.DateTimeFormat("en-CA", { timeZoneName: "short", timeZone: tz })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "ET";
  return `${date} at ${time} ${tzLabel}`;
}

function toTitleCase(s: string) { return s.replace(/\b\w/g, (m) => m.toUpperCase()); }

function orderedHazards(selection: Record<string, any>) {
  return HAZARD_PRIORITY
    .map((key) => ({ key, opt: selection[key] }))
    .filter((e) => e.opt && e.opt.level > 0)
    .sort((a, b) => b.opt.level - a.opt.level || HAZARD_PRIORITY.indexOf(a.key) - HAZARD_PRIORITY.indexOf(b.key));
}

function nytTitleCase(str: string) {
  const small = new Set(["a","an","the","and","but","or","nor","for","so","yet","as","at","by","in","of","on","per","to","via","vs","vs.","with","over","into","onto","from","off","up","down","out","about","near"]);
  return (str || "").split(/\s+/).map((w,i,arr)=>{
    const isFirst = i===0, isLast = i===arr.length-1;
    const hasLetters = /[A-Za-z]/.test(w);
    const isAcronym = hasLetters && w === w.toUpperCase() && w.length>1;
    if (isAcronym) return w;
    const lower = w.toLowerCase();
    if (!isFirst && !isLast && small.has(lower)) return lower;
    return lower.split("-").map((part,j,parts)=>{
      const firstLast = (isFirst && j===0) || (isLast && j===parts.length-1);
      return (small.has(part) && !firstLast) ? part : part.charAt(0).toUpperCase()+part.slice(1);
    }).join("-");
  }).join(" ");
}

// ---------- Headline helpers ----------
function headlinePhrase(key: HazardKey, value: string, status: "detected" | "reported") {
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
  }
}

function joinForHeadline(items: string[]) {
  if (items.length <= 1) return items[0] || "";
  if (items.length === 2) return `${items[0]} & ${items[1]}`;
  const head = items.slice(0, -1).join(", ");
  const tail = items[items.length - 1];
  return `${head} & ${tail}`;
}

function buildHeadlineStorm(
  selection: Record<string, any>,
  status: Record<string,"detected"|"reported">,
  overallId: number,
  overallLabel: string
) {
  const items = HAZARD_PRIORITY.map((key) => {
    const opt = selection[key];
    if (!opt || opt.level === 0) return null;
    return { key, level: opt.level, value: opt.value };
  }).filter(Boolean)
    // @ts-ignore - TS can't infer types from filter(Boolean) here
    .sort((a:any,b:any)=> b.level - a.level || HAZARD_PRIORITY.indexOf(a.key) - HAZARD_PRIORITY.indexOf(b.key));

  const phrases = (items as any[]).map(({key, value}) => {
    const stat =
      key === "rotation" || key === "funnel" ? "detected" :
      key === "tornado" ? "reported" :
      status[key];
    return headlinePhrase(key as HazardKey, value, stat as any);
  }).filter(Boolean) as string[];

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
  const phrases: string[] = [];
  if (opts.choice === "funnel") phrases.push("Funnel Cloud Potential");
  if (opts.choice === "severe") phrases.push("Severe Thunderstorm Potential");
  if (opts.choice === "severe" && opts.tornadoRisk) phrases.push("Tornado Risk");
  const textRaw = phrases.length ? joinForHeadline(phrases) : "Weather Potential";
  const category = overallLabel.toUpperCase();
  const needsAllCaps = overallId >= 3;
  const text = needsAllCaps ? textRaw.toUpperCase() : nytTitleCase(textRaw);
  return `${category}: ${text}`;
}

// ---------- component ----------
export default function NotificationGenerator() {
  // Inject meta tags to prevent indexing + force light UI to avoid dark native buttons
  useEffect(() => {
    const ensureMeta = (name: string, content: string) => {
      let el = document.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    };
    ensureMeta("robots", "noindex, nofollow, noarchive");
    ensureMeta("googlebot", "noindex, nofollow");

    // Add a small style block once to force light controls and full-page light bg
    const STYLE_ID = "__iw_light_ui__";
    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.innerHTML = `
        :root { color-scheme: light; }
        html, body, #root { min-height: 100%; background: #f6f7f9; }
        body { margin: 0; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  const [mode, setMode] = useState<Mode>("storm");
  const [province, setProvince] = useState<keyof typeof PROVINCE_TZ>("ON");
  const tz = PROVINCE_TZ[province] || "America/Toronto";

  // Social hashtag toggle
  const [addHashtags, setAddHashtags] = useState<boolean>(false);

  // Storm details
  const [location, setLocation] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("east");
  const [speed, setSpeed] = useState("");
  const [towns, setTowns] = useState("");
  const [timeWindow, setTimeWindow] = useState("the next 30 to 60 minutes");
  const [now, setNow] = useState(new Date());

  // Regional specifics
  const [regions, setRegions] = useState("");
  const [regionalChoice, setRegionalChoice] = useState<"funnel" | "severe" | null>(null);
  const [regionalSevere, setRegionalSevere] = useState<{ hail: boolean; wind: boolean; heavyRain: boolean; lightning: boolean }>({
    hail: true, wind: true, heavyRain: true, lightning: true,
  });
  const [regionalTornadoRisk, setRegionalTornadoRisk] = useState<boolean>(false);
  const [regionalTornadoRiskLevel, setRegionalTornadoRiskLevel] = useState<"low"|"moderate"|"high">("low");

  // Funnel subtype & reporter (storm mode)
  const [funnelSubtype, setFunnelSubtype] = useState<"supercell" | "non">("non");
  const [funnelReporter, setFunnelReporter] = useState<string>("");

  // Hazard selections (storm mode)
  const [selection, setSelection] = useState<Record<string, any>>({
    funnel: HAZARDS.funnel.options[0],
    rotation: HAZARDS.rotation.options[0],
    tornado: HAZARDS.tornado.options[0],
    hail: HAZARDS.hail.options[0],
    wind: HAZARDS.wind.options[0], // defaults to "none"
    flooding: HAZARDS.flooding.options[0],
  });

  // Optional detail fields
  const [hailMax, setHailMax] = useState<string>("");
  const [hailMajorPop, setHailMajorPop] = useState<boolean>(false);
  const [windMax, setWindMax] = useState<string>("");     // km/h
  const [rainMax, setRainMax] = useState<string>("");     // mm

  // Status (Detected/Reported) for hail, wind, flooding only
  const [status, setStatus] = useState<Record<string,"detected"|"reported">>({
    funnel: "detected",
    rotation: "detected",
    tornado: "detected",
    hail: "detected",
    wind: "detected",
    flooding: "detected",
  });
  const [reportNotes, setReportNotes] = useState<Record<string,string>>({
    funnel: "", rotation: "", tornado: "", hail: "", wind: "", flooding: "",
  });

  // Major population in path
  const [majorPopPath, setMajorPopPath] = useState<boolean>(false);

  // Overall level
  const baseOverall = useMemo(
    () => (mode === "storm" ? resolveOverallLevel(selection) : { id: 1, meta: LEVELS[0] }),
    [mode, selection]
  );
  const finalLevelId = useMemo(
    () => computeFinalLevel(baseOverall.id, selection, status, majorPopPath, hailMajorPop, mode),
    [baseOverall.id, selection, status, majorPopPath, hailMajorPop, mode]
  );
  const finalLevelMeta = LEVELS.find((l) => l.id === finalLevelId)!;

  const headlineBase = useMemo(() => {
    return mode === "storm"
      ? buildHeadlineStorm(selection, status, finalLevelId, finalLevelMeta.label)
      : buildHeadlineRegional({ choice: regionalChoice, tornadoRisk: regionalTornadoRisk }, finalLevelId, finalLevelMeta.label);
  }, [mode, selection, status, finalLevelId, finalLevelMeta.label, regionalChoice, regionalTornadoRisk]);

  // Prefix province hashtags if enabled
  const headline = useMemo(() => {
    if (!addHashtags) return headlineBase;
    const code = String(province).toUpperCase();
    const tags = `#${code}Storm #${code}wx`;
    return `${tags} ${headlineBase}`;
  }, [addHashtags, headlineBase, province]);

  const timestamp = useMemo(() => formatTimestamp(now, tz), [now, tz]);

  // ---------- Description ----------
  const description = useMemo(() => {
    const groupInfo = getStormReportGroupInfo(province);
    const reportLine =
      `Have a report? If it is safe, please post to ${groupInfo.name}` +
      `${groupInfo.url ? ` (${groupInfo.url})` : ""}. Include your exact location and the local date/time of your report.`;

    if (mode === "regional") {
      const areaText = regions ? `Regions impacted: ${regions}.` : "Regions impacted: multiple communities within the area.";
      const timeText = timeWindow ? ` Timeframe: ${timeWindow}.` : "";

      if (regionalChoice === "funnel") {
        const p1 = `This is a regional notification categorized as ${finalLevelMeta.label}: conditions are favourable for funnel clouds to develop in parts of the area. ${areaText}${timeText}`;
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
        const p1 = `This is a regional notification categorized as ${finalLevelMeta.label}: conditions may develop to produce severe thunderstorms in parts of the area. ${areaText}${timeText}`;
        const p2 = [riskLine, torLine].filter(Boolean).join(" ");
        const p3 = `What you should do: Have a way to receive notifications and stay tuned for future Instant Weather custom notifications and alerts from Environment Canada. Be ready to move indoors quickly if skies darken or thunder is heard.`;
        const p4 = `Reports: ${reportLine}`;
        return [p1, p2, p3, p4].filter(Boolean).join("\n\n");
      }

      const pFallback = `This is a regional notification categorized as ${finalLevelMeta.label}. ${areaText}${timeText}`;
      const pR = `Reports: ${reportLine}`;
      return [pFallback, pR].join("\n\n");
    }

    // Storm-based description
    const townsText = towns.split(/\n|,/).map((t) => t.trim()).filter(Boolean).join(", ");
    const spd = speed ? ` at about ${speed} km/h` : "";
    const pathText = townsText ? ` Areas in the path include ${townsText}.` : "";
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

    const descFor = (key: HazardKey, value: string) => {
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
            value === "destructive" ? "destructive winds" :
            value === "none" ? null : null;
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

    const primaryKey = primary?.key as HazardKey | undefined;
    const rotationVal = selection.rotation?.value as string | undefined;

    // Safety guidance
    let safetyLines: string[] = [];
    if (primaryKey === "rotation") {
      if (rotationVal === "weak") {
        safetyLines = [
          "Stay close to sturdy shelter and be ready to move indoors quickly if the storm approaches.",
          "Have a plan to reach an interior room away from windows on short notice.",
        ];
      } else if (rotationVal === "organized") {
        safetyLines = [
          "Be prepared to take shelter quickly in an interior room away from windows.",
          "Delay or reroute travel near the storm until it passes.",
        ];
      } else if (rotationVal === "strong") {
        safetyLines = majorPopPath ? [
          "Take shelter now on the lowest level or an interior room away from windows.",
          "Protect your head and neck; avoid large open rooms.",
        ] : [
          "Act now: move to an interior room away from windows.",
          "Avoid windows and large open rooms, and be ready to move to the lowest level if the storm intensifies.",
        ];
      } else if (rotationVal === "intense") {
        safetyLines = [
          "Take shelter now on the lowest level in a sturdy building.",
          "Put as many walls between you and the outside as possible; protect your head and neck.",
        ];
      }
    } else if (primaryKey === "tornado") {
      safetyLines = [
        "Go to the lowest level or an interior room away from windows.",
        "Protect your head and neck; a helmet or cushions can help.",
        "If outdoors or in a vehicle, seek a sturdy building immediately.",
      ];
    } else if (primaryKey === "funnel" && (selection.funnel.value === "reported" || selection.funnel.value === "landspout_reported")) {
      safetyLines = [
        "Be ready to shelter quickly if the funnel approaches.",
        "Move indoors and avoid windows until it dissipates or passes.",
      ];
    } else if (primaryKey === "hail") {
      safetyLines = ["Move indoors and stay away from windows and skylights.", "If driving, safely pull over under a sturdy structure if possible.", "Protect vehicles where you can; avoid parking under trees."];
    } else if (primaryKey === "wind") {
      safetyLines = ["Move to an interior room away from windows.", "Secure or bring inside loose outdoor items.", "Avoid travel during the peak of the storm if possible."];
    } else if (primaryKey === "flooding") {
      safetyLines = ["Never drive through flooded roads; turn around instead.", "Avoid low-lying areas, underpasses and fast-moving water.", "Move valuables off the floor in basements if safe to do so."];
    } else {
      safetyLines = ["Stay aware and be ready to act quickly if conditions worsen."];
    }
    safetyLines.push("Stay tuned for future Instant Weather custom notifications and alerts from Environment Canada.");

    const p1 =
      `This notification is categorized as ${finalLevelMeta.label}: ${levelMeaning}` +
      (location ? ` A storm is near ${location}, moving ${direction}${spd}.` : ` A storm is in your area, moving ${direction}${spd}.`) +
      pathText + timeText;

    const primaryPhrase = primary ? descFor(primary.key as HazardKey, primary.opt.value) : null;
    const p2 = primaryPhrase ? `Primary threat: ${primaryPhrase}.` : "";

    const extrasPhrases = extras.map((e) => descFor(e.key as HazardKey, e.opt.value)).filter(Boolean) as string[];
    let p3 = "";
    if (extrasPhrases.length === 1) p3 = `Additional threat: ${extrasPhrases[0]}.`;
    else if (extrasPhrases.length > 1) p3 = `Additional threats: ${extrasPhrases.slice(0,-1).join(", ")} & ${extrasPhrases[extrasPhrases.length-1]}.`;

    const p4 = `What you should do: ${safetyLines.join(" ")}`;

    const reportLineStorm =
      `Have a report? If it is safe, please post to ${groupInfo.name}` +
      `${groupInfo.url ? ` (${groupInfo.url})` : ""}. Include your exact location and the local date/time of your report.`;
    const p5 = `Reports: ${reportLineStorm}`;

    return [p1, p2, p3, p4, p5].filter(Boolean).join("\n\n");
  }, [
    mode, regions, regionalChoice, regionalSevere, regionalTornadoRisk, regionalTornadoRiskLevel, timeWindow,
    selection, status, reportNotes, hailMax, hailMajorPop, majorPopPath, funnelSubtype, funnelReporter,
    location, towns, direction, speed, finalLevelId, finalLevelMeta.label, province
  ]);

  function updateSelect(groupKey: HazardKey, value: string) {
    const group = (HAZARDS as any)[groupKey];
    const opt = group.options.find((o: any) => o.value === value) || group.options[0];
    setSelection((prev) => ({ ...prev, [groupKey]: opt }));
  }

  const updateStatus = (key: HazardKey, val: "detected" | "reported") =>
    setStatus((s) => ({ ...s, [key]: val }));

  const updateReportNote = (key: HazardKey, val: string) =>
    setReportNotes((r) => ({ ...r, [key]: val }));

  function copyToClipboard(text: string) {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  const levelColorStyle = { background: finalLevelMeta.color, color: "#fff" } as React.CSSProperties;

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
        <div className="max-w-none mx-auto p-4 sm:p-6 lg:p-8">
        <header className="mb-6">
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight flex items-center gap-3">
            <Eye className="w-7 h-7" />
            Instant Weather Notification Generator
          </h1>
          {/* Subtitle removed per request */}
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
                    onChange={(e) => setProvince(e.target.value as keyof typeof PROVINCE_TZ)}
                    className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {Object.keys(PROVINCE_TZ).map((p) => (<option key={p} value={p}>{p}</option>))}
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
                        value={selection[key].value}
                        onChange={(e) => {
                          updateSelect(key as HazardKey, e.target.value);
                          if (key === "hail" && e.target.value === "none") { setHailMax(""); setHailMajorPop(false); }
                          if (key === "tornado" && e.target.value === "none") setMajorPopPath(false);
                          if (key === "rotation" && !["strong","intense"].includes(e.target.value)) setMajorPopPath(false);
                          if (key === "funnel" && e.target.value !== "reported") setFunnelSubtype("non");
                          if (key === "wind" && (e.target.value === "sub_severe" || e.target.value === "none")) setWindMax("");
                          if (key === "flooding" && e.target.value === "none") setRainMax("");
                        }}
                        className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        {/* @ts-ignore */}
                        {group.options.map((opt: any) => (<option key={opt.value} value={opt.value}>{opt.name}</option>))}
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
                              <input
                                type="checkbox"
                                checked={hailMajorPop}
                                onChange={(e) => setHailMajorPop(e.target.checked)}
                                className="rounded border-neutral-300"
                              />
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
                            <input
                              type="checkbox"
                              checked={majorPopPath}
                              onChange={(e) => setMajorPopPath(e.target.checked)}
                              className="rounded border-neutral-300"
                            />
                            <span>Major population in path</span>
                          </label>
                        </div>
                      )}

                      {/* Tornado: major population checkbox */}
                      {key === "tornado" && (selection.tornado.value === "reported" || selection.tornado.value === "damaging_reported") && (
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <input
                            value={reportNotes.tornado || ""}
                            onChange={(e) => updateReportNote("tornado", e.target.value)}
                            placeholder="Reported by (e.g., trained spotter, OPP, photo/video)"
                            className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                          <label className="inline-flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={majorPopPath}
                              onChange={(e) => setMajorPopPath(e.target.checked)}
                              className="rounded border-neutral-300"
                            />
                            <span>Major population in path</span>
                          </label>
                        </div>
                      )}

                      {/* Status slider + report note (hidden for rotation, funnel, tornado) */}
                      {key !== "rotation" && key !== "funnel" && key !== "tornado" && (
                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] uppercase tracking-wide text-neutral-600">Status</span>
                            <div className="inline-flex rounded-md border border-neutral-300 overflow-hidden">
                              <button type="button" onClick={() => updateStatus(key as HazardKey, "detected")} className={`px-2.5 py-1 text-xs ${status[key]==="detected" ? "bg-white" : "bg-neutral-100"} hover:bg-white`}>Detected</button>
                              <button type="button" onClick={() => updateStatus(key as HazardKey, "reported")} className={`px-2.5 py-1 text-xs ${status[key]==="reported" ? "bg-white" : "bg-neutral-100"} hover:bg-white border-l border-neutral-300`}>Reported</button>
                            </div>
                          </div>
                          {status[key] === "reported" && (
                            <input
                              value={reportNotes[key] || ""}
                              onChange={(e) => updateReportNote(key as HazardKey, e.target.value)}
                              placeholder="How was it reported? (e.g., photo/video, spotter)"
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}

                          {/* Wind: optional max gust input (hidden when 'none') */}
                          {key === "wind" && selection.wind.value !== "none" && (
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={windMax}
                              onChange={(e) => setWindMax(e.target.value)}
                              placeholder="Max wind (km/h, optional)"
                              className="w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          )}

                          {/* Flooding: optional max rainfall input */}
                          {key === "flooding" && selection.flooding.value !== "none" && (
                            <input
                              type="number"
                              inputMode="numeric"
                              min={0}
                              value={rainMax}
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
                      <input type="radio" name="regionalChoice" className="rounded border-neutral-300"
                        checked={regionalChoice === "funnel"} onChange={() => setRegionalChoice("funnel")} />
                      <span>Funnel cloud potential</span>
                    </label>
                    <label className="inline-flex items-center gap-2 text-sm">
                      <input type="radio" name="regionalChoice" className="rounded border-neutral-300"
                        checked={regionalChoice === "severe"} onChange={() => setRegionalChoice("severe")} />
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
                {/* Hashtag toggle */}
                <label className="inline-flex items-center gap-2 text-sm mr-2">
                  <input
                    type="checkbox"
                    checked={addHashtags}
                    onChange={(e) => setAddHashtags(e.target.checked)}
                    className="rounded border-neutral-300"
                  />
                  <span>Add province hashtags to headline</span>
                </label>

                <button
                  onClick={() => setNow(new Date())}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50"
                  title="Refresh timestamp"
                >
                  <RefreshCcw className="w-4 h-4" /> Update time
                </button>
                <button
                  onClick={() => copyToClipboard(headline)}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50"
                  title="Copy headline"
                >
                  <Copy className="w-4 h-4"/> Copy headline
                </button>
              </div>
            </div>

            {/* Live card */}
            <div className="p-5">
              <div className="rounded-2xl border border-neutral-200 overflow-hidden">
                {/* Level banner */}
                <div className="px-5 py-3" style={{ background: finalLevelMeta.color }}>
                  <div className="flex items-center gap-2 text-white">
                    {finalLevelId === 4 ? <Tornado className="w-5 h-5"/> : finalLevelId === 3 ? <AlertTriangle className="w-5 h-5"/> : finalLevelId === 2 ? <Wind className="w-5 h-5"/> : <Eye className="w-5 h-5"/>}
                    <span className="text-xs uppercase tracking-wider opacity-90">Level {finalLevelId}</span>
                    <span className="font-semibold">{finalLevelMeta.label}</span>
                  </div>
                </div>
                {/* Content */}
                <div className="px-5 py-4 space-y-3 bg-white">
                  <h3 className="text-lg font-bold leading-snug">{headline}</h3>
                  <div className="text-xs text-neutral-600 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5"/>
                    <span>{timestamp}</span>
                  </div>
                  <p className="text-sm leading-relaxed whitespace-pre-wrap">{description}</p>
                </div>
              </div>

              {/* Copy full message */}
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={() => {
                    const full = `${headline}\n\n${timestamp}\n\n${description}`;
                    copyToClipboard(full);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white hover:bg-neutral-50"
                >
                  <Copy className="w-4 h-4"/> Copy full message
                </button>
              </div>

              {/* Chips of selected hazards */}
              <div className="mt-5">
                <p className="text-xs text-neutral-600 mb-2">Selected hazards</p>
                <div className="flex flex-wrap gap-2">
                  {mode === "storm" ? (
                    Object.entries(selection).map(([key, opt]) => (
                      // @ts-ignore
                      opt.level > 0 ? (
                        <span key={key} className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                          {key === "tornado" && <Tornado className="w-3.5 h-3.5"/>}
                          {key === "rotation" && <Tornado className="w-3.5 h-3.5"/>}
                          {key === "hail" && <AlertTriangle className="w-3.5 h-3.5"/>}
                          {key === "wind" && <Wind className="w-3.5 h-3.5"/>}
                          {key === "flooding" && <CloudRain className="w-3.5 h-3.5"/>}
                          {key === "funnel" && <CloudLightning className="w-3.5 h-3.5"/>}
                          <span className="capitalize">{key}</span>
                          {/* @ts-ignore */}
                          <span className="text-neutral-500">{opt.name}</span>
                          {key === "hail" && hailMax && <span className="text-neutral-500">· max {HAIL_MAX_OPTS.find(h=>h.value===hailMax)?.name?.toLowerCase()}</span>}
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
