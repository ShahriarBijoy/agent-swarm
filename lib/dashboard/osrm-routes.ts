/**
 * Route polylines for the trips-on-road widget.
 *
 * Routes are synthesized client-side by threading the path between two cities
 * through any other German cities that lie roughly along the corridor. The
 * result is a bent polyline that visually evokes an autobahn (Berlin → Munich
 * via Leipzig and Nuremberg, Hamburg → Munich via Hannover, Frankfurt, and
 * Stuttgart, etc.) without depending on a routing API at runtime.
 *
 * If you'd later like real OSRM road geometry, swap `synthRoute` for a fetch
 * call against `https://router.project-osrm.org/...` and cache the JSON. The
 * widget already accepts whatever polyline this returns.
 */

import { GERMANY_CITIES, type GermanCity } from './germany-journeys';

export type RoutePolyline = [number, number][]; // [lng, lat] pairs

const memoryCache = new Map<string, RoutePolyline>();

/** Direction-insensitive cache key. */
function pairKey(a: GermanCity, b: GermanCity): string {
  return a.code < b.code ? `${a.code}-${b.code}` : `${b.code}-${a.code}`;
}

// ---- Route synthesis -------------------------------------------------------

/**
 * Project city `c` onto the segment AB. Returns the parameter t (0..1 if the
 * projection lies between A and B) and the perpendicular distance in degrees.
 */
function projectOntoSegment(
  a: GermanCity,
  b: GermanCity,
  c: GermanCity,
): { t: number; perpDeg: number } {
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const cx = c.lng;
  const cy = c.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return { t: 0, perpDeg: Number.POSITIVE_INFINITY };
  const t = ((cx - ax) * dx + (cy - ay) * dy) / len2;
  // Perpendicular distance from c to AB
  const px = ax + t * dx;
  const py = ay + t * dy;
  const perpDeg = Math.hypot(cx - px, cy - py);
  return { t, perpDeg };
}

/** Smooth a polyline by inserting one quadratic Bezier interpolation between
 *  each consecutive triplet, so the route bends gently at each waypoint
 *  instead of pivoting on hard corners. */
function smooth(points: RoutePolyline, samples = 6): RoutePolyline {
  if (points.length < 3) return points;
  const out: RoutePolyline = [];
  out.push(points[0]!);
  for (let i = 1; i < points.length - 1; i += 1) {
    const p0 = points[i - 1]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    // Take the midpoint of segment (p0,p1) as the curve's start, midpoint of
    // (p1,p2) as the end, and p1 as the control. This produces a Bezier that
    // joins smoothly with neighbouring straights.
    const mid01: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    const mid12: [number, number] = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    out.push(mid01);
    for (let s = 1; s <= samples; s += 1) {
      const t = s / (samples + 1);
      const inv = 1 - t;
      const x = inv * inv * mid01[0] + 2 * inv * t * p1[0] + t * t * mid12[0];
      const y = inv * inv * mid01[1] + 2 * inv * t * p1[1] + t * t * mid12[1];
      out.push([x, y]);
    }
    out.push(mid12);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Build a road-like polyline between two cities by stringing other cities
 *  through any that lie roughly along the corridor. */
export function synthRoute(from: GermanCity, to: GermanCity): RoutePolyline {
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const distDeg = Math.hypot(dx, dy);

  // Short hops: a single straight segment suffices.
  if (distDeg < 0.6) {
    return [
      [from.lng, from.lat],
      [to.lng, to.lat],
    ];
  }

  // Longer hops: gather all cities whose projection onto AB lies in (0,1) and
  // whose perpendicular distance is within ~0.65deg (≈ 70km). That radius is
  // narrow enough that we don't detour through unrelated cities, wide enough
  // that we capture realistic stopovers (Hamburg→Munich passes near
  // Hannover/Frankfurt/Stuttgart).
  const corridor = 0.65;
  const candidates = GERMANY_CITIES.filter(
    (c) => c.code !== from.code && c.code !== to.code,
  )
    .map((c) => ({ city: c, ...projectOntoSegment(from, to, c) }))
    .filter((p) => p.t > 0.05 && p.t < 0.95 && p.perpDeg < corridor)
    .sort((a, b) => a.t - b.t);

  // Cap at 3 waypoints so the polyline stays scannable on widget-sized
  // viewports and we don't accidentally over-stitch every city.
  const trimmed = candidates.slice(0, 3);

  const points: RoutePolyline = [
    [from.lng, from.lat],
    ...trimmed.map((c) => [c.city.lng, c.city.lat] as [number, number]),
    [to.lng, to.lat],
  ];

  return smooth(points);
}

export async function fetchRoutePolyline(
  from: GermanCity,
  to: GermanCity,
): Promise<RoutePolyline> {
  const key = pairKey(from, to);
  const cached = memoryCache.get(key);
  if (cached) return cached;
  const route = synthRoute(from, to);
  memoryCache.set(key, route);
  return route;
}

export { pairKey };
