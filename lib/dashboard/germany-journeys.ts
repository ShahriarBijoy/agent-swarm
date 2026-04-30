/**
 * Germany journey generator — deterministically synthesizes the last N
 * city-to-city legs for a given vehicle id. Used by the trips-on-road
 * widget to render fleet-wide arcs across the country without depending
 * on real GPS-grade trip data.
 *
 * Each call is pure: same input → same output, so render order is stable
 * across SSR / client polls.
 */

export type GermanCity = {
  /** IATA-ish three letter code, used as the React/MapArc key. */
  code: string;
  name: string;
  lng: number;
  lat: number;
};

export const GERMANY_CITIES: GermanCity[] = [
  { code: 'BER', name: 'Berlin', lng: 13.405, lat: 52.52 },
  { code: 'HAM', name: 'Hamburg', lng: 9.9937, lat: 53.5511 },
  { code: 'MUC', name: 'Munich', lng: 11.582, lat: 48.1351 },
  { code: 'CGN', name: 'Cologne', lng: 6.9603, lat: 50.9375 },
  { code: 'FRA', name: 'Frankfurt', lng: 8.6821, lat: 50.1109 },
  { code: 'STG', name: 'Stuttgart', lng: 9.1829, lat: 48.7758 },
  { code: 'DUS', name: 'Düsseldorf', lng: 6.7735, lat: 51.2277 },
  { code: 'BRE', name: 'Bremen', lng: 8.8017, lat: 53.0793 },
  { code: 'HAN', name: 'Hannover', lng: 9.732, lat: 52.3759 },
  { code: 'LEJ', name: 'Leipzig', lng: 12.3731, lat: 51.3397 },
  { code: 'DRS', name: 'Dresden', lng: 13.7373, lat: 51.0504 },
  { code: 'NUE', name: 'Nuremberg', lng: 11.0767, lat: 49.4521 },
  { code: 'DTM', name: 'Dortmund', lng: 7.4653, lat: 51.5136 },
  { code: 'ESS', name: 'Essen', lng: 7.0116, lat: 51.4556 },
  { code: 'KIE', name: 'Kiel', lng: 10.1228, lat: 54.3233 },
];

export type Journey = {
  /** Stable id keyed `${vehicleId}-${legIndex}` so MapArc can track hover state. */
  id: string;
  vehicleId: string;
  vehiclePlate: string;
  segment: 'sedan' | 'suv' | 'van' | 'truck';
  legIndex: number;
  from: GermanCity;
  to: GermanCity;
};

/** Hash a UUID-ish string into a 32-bit int. Stable across runs. */
function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nextSeeded(seed: number): number {
  // mulberry32 — good enough for visual variety, not crypto.
  let t = (seed + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function generateJourneys(input: {
  vehicleId: string;
  vehiclePlate: string;
  segment: Journey['segment'];
  count?: number;
}): Journey[] {
  const count = input.count ?? 5;
  let seed = hashString(input.vehicleId);

  const startIdx = Math.floor(nextSeeded(seed) * GERMANY_CITIES.length);
  let cur = GERMANY_CITIES[startIdx]!;
  seed = (seed * 1103515245 + 12345) >>> 0;

  const out: Journey[] = [];
  for (let i = 0; i < count; i += 1) {
    let candidate = cur;
    let guard = 0;
    while (candidate.code === cur.code && guard < 8) {
      const r = nextSeeded(seed + i * 7 + guard);
      candidate = GERMANY_CITIES[Math.floor(r * GERMANY_CITIES.length)]!;
      guard += 1;
    }
    out.push({
      id: `${input.vehicleId}-${i}`,
      vehicleId: input.vehicleId,
      vehiclePlate: input.vehiclePlate,
      segment: input.segment,
      legIndex: i,
      from: cur,
      to: candidate,
    });
    cur = candidate;
  }
  return out;
}
