/**
 * Geography resolution.
 *
 * Contracts almost never name city pairs. They name markets: "US to Israel",
 * "transatlantic", "domestic". Resolving a ticket into a market means mapping
 * airports to countries and countries to regions, then deciding which point of
 * a multi-coupon journey counts as its destination.
 *
 * The airport table is *data*, injected through the calculation context. The
 * engine ships a starter set; anything not in the table resolves to `null`,
 * which surfaces as INCOMPLETE rather than a guess. Guessing a country is
 * guessing a commission rate.
 */

import type { Coupon } from "./types.js";

export type AirportTable = Readonly<Record<string, string>>;
export type RegionTable = Readonly<Record<string, readonly string[]>>;

/** Airports seen most often on the contracts this engine was built for. */
export const DEFAULT_AIRPORTS: AirportTable = {
  // United States
  JFK: "US", EWR: "US", LGA: "US", BOS: "US", PHL: "US", BWI: "US", IAD: "US",
  DCA: "US", MIA: "US", FLL: "US", MCO: "US", TPA: "US", ATL: "US", CLT: "US",
  ORD: "US", MDW: "US", DTW: "US", MSP: "US", DFW: "US", IAH: "US", DEN: "US",
  PHX: "US", LAS: "US", LAX: "US", SFO: "US", SEA: "US", SAN: "US", PDX: "US",
  SLC: "US", STL: "US", CLE: "US", PIT: "US", CVG: "US", BNA: "US", AUS: "US",
  HNL: "US", ANC: "US", SJU: "US",
  // Israel
  TLV: "IL", ETH: "IL", VDA: "IL", HFA: "IL",
  // Canada
  YYZ: "CA", YUL: "CA", YVR: "CA", YYC: "CA", YOW: "CA", YEG: "CA", YHZ: "CA",
  // Mexico / Caribbean / Central America
  MEX: "MX", CUN: "MX", GDL: "MX", PVR: "MX", SJD: "MX",
  PUJ: "DO", SDQ: "DO", MBJ: "JM", KIN: "JM", NAS: "BS", AUA: "AW", CUR: "CW",
  SJO: "CR", PTY: "PA", GUA: "GT", SAL: "SV",
  // Europe
  LHR: "GB", LGW: "GB", LCY: "GB", STN: "GB", MAN: "GB", EDI: "GB", DUB: "IE",
  CDG: "FR", ORY: "FR", NCE: "FR", LYS: "FR", MRS: "FR",
  FRA: "DE", MUC: "DE", DUS: "DE", TXL: "DE", BER: "DE", HAM: "DE", STR: "DE",
  AMS: "NL", BRU: "BE", LUX: "LU", ZRH: "CH", GVA: "CH", VIE: "AT",
  FCO: "IT", MXP: "IT", LIN: "IT", VCE: "IT", NAP: "IT", BLQ: "IT",
  MAD: "ES", BCN: "ES", AGP: "ES", PMI: "ES", LIS: "PT", OPO: "PT",
  CPH: "DK", ARN: "SE", GOT: "SE", OSL: "NO", HEL: "FI", KEF: "IS",
  WAW: "PL", KRK: "PL", PRG: "CZ", BUD: "HU", OTP: "RO", SOF: "BG",
  ATH: "GR", SKG: "GR", ZAG: "HR", BEG: "RS", LJU: "SI", RIX: "LV",
  VNO: "LT", TLL: "EE", KBP: "UA", IST: "TR", SAW: "TR", AYT: "TR",
  // Middle East / Africa
  DXB: "AE", AUH: "AE", DOH: "QA", AMM: "JO", CAI: "EG", SSH: "EG",
  RUH: "SA", JED: "SA", BAH: "BH", KWI: "KW", MCT: "OM", BEY: "LB",
  JNB: "ZA", CPT: "ZA", NBO: "KE", ADD: "ET", CMN: "MA", TUN: "TN", LOS: "NG",
  // Asia / Pacific
  NRT: "JP", HND: "JP", KIX: "JP", ICN: "KR", PEK: "CN", PVG: "CN", CAN: "CN",
  HKG: "HK", TPE: "TW", SIN: "SG", BKK: "TH", HKT: "TH", KUL: "MY", CGK: "ID",
  MNL: "PH", DEL: "IN", BOM: "IN", BLR: "IN", MAA: "IN", HYD: "IN",
  SYD: "AU", MEL: "AU", BNE: "AU", PER: "AU", AKL: "NZ",
  // South America
  GRU: "BR", GIG: "BR", EZE: "AR", SCL: "CL", LIM: "PE", BOG: "CO", UIO: "EC",
};

/**
 * Regions a contract might name. Members are country codes or other regions,
 * resolved recursively. TC1/TC2/TC3 are the IATA traffic conference areas.
 */
export const DEFAULT_REGIONS: RegionTable = {
  NORTH_AMERICA: ["US", "CA", "MX"],
  CARIBBEAN: ["DO", "JM", "BS", "AW", "CW", "PR", "TT", "BB"],
  CENTRAL_AMERICA: ["CR", "PA", "GT", "SV", "HN", "NI", "BZ"],
  SOUTH_AMERICA: ["BR", "AR", "CL", "PE", "CO", "EC", "UY", "PY", "BO", "VE"],
  WESTERN_EUROPE: [
    "GB", "IE", "FR", "DE", "NL", "BE", "LU", "CH", "AT", "IT", "ES", "PT",
    "DK", "SE", "NO", "FI", "IS", "GR", "MT", "CY",
  ],
  EASTERN_EUROPE: [
    "PL", "CZ", "HU", "RO", "BG", "HR", "RS", "SI", "SK", "LV", "LT", "EE", "UA",
  ],
  EUROPE: ["WESTERN_EUROPE", "EASTERN_EUROPE", "TR"],
  MIDDLE_EAST: ["IL", "JO", "AE", "QA", "SA", "BH", "KW", "OM", "LB", "EG"],
  AFRICA: ["ZA", "KE", "ET", "MA", "TN", "NG", "EG", "GH", "TZ", "UG"],
  ASIA: [
    "JP", "KR", "CN", "HK", "TW", "SG", "TH", "MY", "ID", "PH", "VN", "IN",
    "PK", "BD", "LK", "NP",
  ],
  SOUTHWEST_PACIFIC: ["AU", "NZ", "FJ", "PG"],
  // IATA traffic conference areas
  TC1: ["NORTH_AMERICA", "CARIBBEAN", "CENTRAL_AMERICA", "SOUTH_AMERICA"],
  TC2: ["EUROPE", "MIDDLE_EAST", "AFRICA"],
  TC3: ["ASIA", "SOUTHWEST_PACIFIC"],
};

export interface GeoContext {
  readonly airports: AirportTable;
  readonly regions: RegionTable;
}

export const DEFAULT_GEO: GeoContext = {
  airports: DEFAULT_AIRPORTS,
  regions: DEFAULT_REGIONS,
};

/** Country for an airport code, or null when the table does not know it. */
export function countryOf(airport: string, geo: GeoContext): string | null {
  return geo.airports[airport.toUpperCase()] ?? null;
}

/**
 * Does `place` (an airport, a country, or a region) fall inside `scope`
 * (a country or a region)? Airports resolve to their country first.
 */
export function isWithin(
  place: string,
  scope: string,
  geo: GeoContext,
  seen: ReadonlySet<string> = new Set(),
): boolean {
  const p = place.toUpperCase();
  const s = scope.toUpperCase();
  if (p === s) return true;

  // An airport code — resolve to its country and retry.
  if (p.length === 3 && geo.airports[p]) {
    return isWithin(geo.airports[p], s, geo, seen);
  }

  const members = geo.regions[s];
  if (!members || seen.has(s)) return false;
  const next = new Set(seen).add(s);
  return members.some((m) => isWithin(p, m, geo, next));
}

/**
 * The journey's destination — the turnaround point, not the last coupon.
 *
 * A JFK–TLV–JFK ticket is a US→IL journey, not a US→US one. The turnaround is
 * the last point on the ticket that lies outside the country the journey began
 * in; a wholly domestic ticket falls back to the final coupon's destination.
 */
export function journeyDestination(
  coupons: readonly Coupon[],
  geo: GeoContext,
): string {
  if (coupons.length === 0) throw new Error("journeyDestination: no coupons");
  const last = coupons[coupons.length - 1].destination;
  const originCountry = countryOf(coupons[0].origin, geo);
  if (!originCountry) return last;

  for (let i = coupons.length - 1; i >= 0; i--) {
    const c = countryOf(coupons[i].destination, geo);
    if (c && c !== originCountry) return coupons[i].destination;
  }
  return last;
}

export function journeyOrigin(coupons: readonly Coupon[]): string {
  if (coupons.length === 0) throw new Error("journeyOrigin: no coupons");
  return coupons[0].origin;
}

export interface MarketMatchResult {
  readonly matched: boolean;
  /** Human-readable for the trace: "JFK(US) → TLV(IL)". */
  readonly describe: string;
  /** True when the airport table could not place one of the endpoints. */
  readonly unresolved: boolean;
}

/**
 * Test an origin/destination pair against a contract market condition.
 * `direction: "either"` — the default in real contracts — treats the pair as
 * unordered, so one clause covers both halves of a round trip.
 */
export function matchMarket(
  origin: string,
  destination: string,
  condition: { from: string; to: string; direction?: "outbound" | "either" },
  geo: GeoContext,
): MarketMatchResult {
  const oc = countryOf(origin, geo);
  const dc = countryOf(destination, geo);
  const describe = `${origin}(${oc ?? "?"}) → ${destination}(${dc ?? "?"})`;
  const unresolved = oc === null || dc === null;

  const forward =
    isWithin(origin, condition.from, geo) && isWithin(destination, condition.to, geo);
  const reverse =
    condition.direction !== "outbound" &&
    isWithin(origin, condition.to, geo) &&
    isWithin(destination, condition.from, geo);

  return { matched: forward || reverse, describe, unresolved };
}

/**
 * Split a journey into its directional halves.
 *
 * A round trip is two half-round-trip sectors: everything up to and including
 * the turnaround, and everything after it. A one-way is a single sector. This
 * is the unit EL AL's clause 12.1 prices on, and it is not the same as a
 * coupon — a JFK–LHR–TLV outbound is two coupons but one half.
 */
export function splitHalves(
  coupons: readonly Coupon[],
  geo: GeoContext,
): { label: string; coupons: Coupon[] }[] {
  if (coupons.length === 0) return [];
  const turnaround = journeyDestination(coupons, geo);
  const idx = coupons.findIndex((c) => c.destination === turnaround);
  if (idx === -1 || idx === coupons.length - 1) {
    return [{ label: `${coupons[0].origin}–${turnaround}`, coupons: [...coupons] }];
  }
  const out = coupons.slice(0, idx + 1);
  const back = coupons.slice(idx + 1);
  return [
    { label: `${out[0].origin}–${out[out.length - 1].destination}`, coupons: out },
    { label: `${back[0].origin}–${back[back.length - 1].destination}`, coupons: back },
  ];
}
