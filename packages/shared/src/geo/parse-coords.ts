// Coordinate parsing (DESIGN §4): decimal (dot or comma), DMS, full plus codes
// (decoded from the OLC spec). Short plus codes are rejected.
import type { Point } from "./types";

const LAT_MAX = 90;
const LON_MAX = 180;

function valid(lat: number, lon: number): Point | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -LAT_MAX || lat > LAT_MAX || lon < -LON_MAX || lon > LON_MAX) return null;
  return { lat, lon };
}

/** Parses one decimal number with an optional dot/comma fraction. */
function decimalNumber(token: string): number | null {
  const s = token.trim();
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(s)) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

function parseDecimalPair(input: string): Point | null {
  const s = input.trim();
  // Two tokens separated by whitespace or a semicolon (decimal comma inside).
  const spaced = s.split(/[\s;]+/).filter(Boolean);
  if (spaced.length === 2) {
    const a = decimalNumber(spaced[0]);
    const b = decimalNumber(spaced[1]);
    if (a !== null && b !== null) return valid(a, b);
  }
  // Two tokens separated by a comma (decimal point inside, e.g. "51.1, 7.2").
  const comma = s.split(",");
  if (comma.length === 2) {
    const a = decimalNumber(comma[0]);
    const b = decimalNumber(comma[1]);
    if (a !== null && b !== null) return valid(a, b);
  }
  return null;
}

// A single DMS / degrees-decimal-minutes component, e.g. `51°07'24.4"N`,
// `N 51° 7.407'`, `7°07'24.4"E`. `O`/`W` are accepted as German Ost/West.
// The hemisphere suffix must touch the minutes/seconds: otherwise the next
// component's prefix ("E 7°…") would be swallowed as this one's suffix.
const DMS_COMPONENT =
  /([NSEOW])?\s*(\d{1,3})\s*°\s*(\d{1,2})(?:[.,](\d+))?\s*['′’](?:\s*(\d{1,2})(?:[.,](\d+))?\s*["″”])?([NSEOW])?/gi;

type DmsPart = {
  value: number;
  hemisphere: string | undefined;
  start: number;
  end: number;
};

function invalidPart(start: number, end: number): DmsPart {
  return { value: Number.NaN, hemisphere: undefined, start, end };
}

function dmsParts(text: string): DmsPart[] {
  const out: DmsPart[] = [];
  DMS_COMPONENT.lastIndex = 0;
  while (true) {
    const m = DMS_COMPONENT.exec(text);
    if (m === null) break;
    if (m[0].trim() === "" || m[2] === undefined) {
      DMS_COMPONENT.lastIndex += 1;
      continue;
    }
    const prefix = m[1]?.toUpperCase();
    const suffix = m[7]?.toUpperCase();
    const hemisphere = prefix ?? suffix;
    if (prefix && suffix && prefix !== suffix) {
      out.push(invalidPart(m.index, m.index + m[0].length));
      continue;
    }
    const degrees = Number(m[2]);
    const minutes = Number(m[3]) + (m[4] ? Number(`0.${m[4]}`) : 0);
    const seconds = m[5] ? Number(m[5]) + (m[6] ? Number(`0.${m[6]}`) : 0) : 0;
    if (minutes >= 60 || seconds >= 60) {
      out.push(invalidPart(m.index, m.index + m[0].length));
      continue;
    }
    let value = degrees + minutes / 60 + seconds / 3600;
    if (hemisphere === "S" || hemisphere === "W") value = -value;
    out.push({ value, hemisphere, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** First part is latitude (N/S), second longitude (E/W), in that order. */
function dmsPoint(parts: DmsPart[]): Point | null {
  if (parts.length < 2) return null;
  const [a, b] = parts;
  if (!Number.isFinite(a.value) || !Number.isFinite(b.value)) return null;
  if (a.hemisphere === "E" || a.hemisphere === "W") return null;
  if (b.hemisphere === "N" || b.hemisphere === "S") return null;
  if (a.end > b.start) return null;
  return valid(a.value, b.value);
}

const OLC_ALPHABET = "23456789CFGHJMPQRVWX";
const OLC_PAIR_PRECISION = 20 ** 3;
const OLC_PAIR_FIRST_PLACE = 20 ** 4;
const OLC_GRID_ROWS = 5;
const OLC_GRID_COLUMNS = 4;
const OLC_FINAL_LAT_PRECISION = OLC_PAIR_PRECISION * OLC_GRID_ROWS ** 5;
const OLC_FINAL_LNG_PRECISION = OLC_PAIR_PRECISION * OLC_GRID_COLUMNS ** 5;
const OLC_MAX_DIGITS = 15;

/**
 * Decodes a FULL Open Location Code to the centre of its area. Short codes
 * (separator before position 8) and padded codes are rejected: both need a
 * reference location, which this parser does not have.
 */
export function decodeOpenLocationCode(code: string): Point | null {
  const s = code.trim().toUpperCase();
  const plus = s.indexOf("+");
  if (plus !== 8 || s.lastIndexOf("+") !== plus) return null;
  const digits = s.slice(0, 8) + s.slice(9);
  if (digits.length < 8 || digits.length > OLC_MAX_DIGITS) return null;
  if (digits.includes("0")) return null; // padded = shortened, needs a reference
  for (const c of digits) if (!OLC_ALPHABET.includes(c)) return null;
  if (OLC_ALPHABET.indexOf(digits[0]) * 20 >= 180) return null;
  if (OLC_ALPHABET.indexOf(digits[1]) * 20 >= 360) return null;

  let normalLat = -LAT_MAX * OLC_PAIR_PRECISION;
  let normalLng = -LON_MAX * OLC_PAIR_PRECISION;
  const pairDigits = Math.min(digits.length, 10);
  let pv = OLC_PAIR_FIRST_PLACE;
  for (let i = 0; i < pairDigits; i += 2) {
    normalLat += OLC_ALPHABET.indexOf(digits[i]) * pv;
    normalLng += OLC_ALPHABET.indexOf(digits[i + 1]) * pv;
    if (i < pairDigits - 2) pv /= 20;
  }
  let lat = normalLat / OLC_PAIR_PRECISION;
  let lng = normalLng / OLC_PAIR_PRECISION;
  let latPrecision = pv / OLC_PAIR_PRECISION;
  let lngPrecision = pv / OLC_PAIR_PRECISION;

  if (digits.length > 10) {
    let rowPv = OLC_GRID_ROWS ** 4;
    let colPv = OLC_GRID_COLUMNS ** 4;
    let gridLat = 0;
    let gridLng = 0;
    const count = Math.min(digits.length, OLC_MAX_DIGITS);
    for (let i = 10; i < count; i++) {
      const v = OLC_ALPHABET.indexOf(digits[i]);
      const row = Math.floor(v / OLC_GRID_COLUMNS);
      const col = v % OLC_GRID_COLUMNS;
      gridLat += row * rowPv;
      gridLng += col * colPv;
      if (i < count - 1) {
        rowPv /= OLC_GRID_ROWS;
        colPv /= OLC_GRID_COLUMNS;
      }
    }
    lat += gridLat / OLC_FINAL_LAT_PRECISION;
    lng += gridLng / OLC_FINAL_LNG_PRECISION;
    latPrecision = rowPv / OLC_FINAL_LAT_PRECISION;
    lngPrecision = colPv / OLC_FINAL_LNG_PRECISION;
  }
  return valid(lat + latPrecision / 2, lng + lngPrecision / 2);
}

/** Parses any supported coordinate notation, or null when it is not one. */
export function parseCoordinates(input: string): Point | null {
  if (typeof input !== "string") return null;
  const s = input.trim();
  if (!s || s.length > 200) return null;
  if (s.includes("+")) return decodeOpenLocationCode(s);

  const point = dmsPoint(dmsParts(s));
  if (point) return point;
  return parseDecimalPair(s);
}

/** Always formats with a decimal POINT and five decimals, even in German UI. */
export function formatCoordinates({ lat, lon }: Point): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

export type CoordinateSpan = {
  start: number;
  end: number;
  text: string;
  kind: "decimal" | "dms" | "plus";
};

/**
 * All substrings of `text` that independently parse as coordinates. Used by
 * the free-text warning (coord-leak.ts). Decimal matches require a decimal
 * fraction on both numbers, so years ("1923"), prices ("12,50 €") and things
 * like "Tor 3, 2. Stock" are not flagged.
 */
export function findCoordinateSpans(text: string): CoordinateSpan[] {
  const out: CoordinateSpan[] = [];
  const number = "[+-]?\\d{1,3}[.,]\\d{2,}";
  const pair = new RegExp(`${number}\\s*[,; ]+\\s*${number}`, "g");
  for (const m of text.matchAll(pair)) {
    if (parseDecimalPair(m[0])) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: "decimal" });
    }
  }
  const parts = dmsParts(text);
  // At most two components form a pair, and only when they parse as a point.
  const two = dmsPoint(parts.slice(0, 2)) ? parts.slice(0, 2) : null;
  if (two && two[0].start !== two[1].start && parts.length >= 2) {
    out.push({
      start: two[0].start,
      end: two[1].end,
      text: text.slice(two[0].start, two[1].end),
      kind: "dms",
    });
  }
  const plusCode = /\b[2-9CFGHJMPQRVWX]{8}\+[2-9CFGHJMPQRVWX]{2,7}\b/gi;
  for (const m of text.matchAll(plusCode)) {
    if (decodeOpenLocationCode(m[0])) {
      out.push({ start: m.index, end: m.index + m[0].length, text: m[0], kind: "plus" });
    }
  }
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}
