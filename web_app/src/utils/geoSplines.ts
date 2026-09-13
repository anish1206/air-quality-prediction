/**
 * Geo-spline utilities for NAICEWS atmospheric visualization.
 * Bézier streamlines + convex-hull cluster envelopes.
 */

// ── Bézier Streamline ─────────────────────────────────────────────────────────

/**
 * Samples `n` evenly-spaced points along a quadratic Bézier curve.
 * The control point is offset perpendicularly to the chord by `curvature` degrees,
 * additionally bent by the corridor bearing so lines follow pressure gradients.
 */
export function createBezierStreamline(
  src: [number, number],
  tgt: [number, number],
  curvature = 0.5,
  corridorBearing = 0,
  nPoints = 24,
): [number, number][] {
  const [x1, y1] = src;
  const [x2, y2] = tgt;

  // Midpoint
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;

  // Perpendicular direction (rotate chord 90°)
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;

  // Perpendicular unit vector, scaled by curvature
  const perpX = (-dy / len) * curvature;
  const perpY = (dx / len) * curvature;

  // Blend with corridor bearing to simulate wind-following paths
  const bearRad = (corridorBearing * Math.PI) / 180;
  const windX = Math.cos(bearRad) * curvature * 0.3;
  const windY = Math.sin(bearRad) * curvature * 0.3;

  // Control point
  const cx = mx + perpX + windX;
  const cy = my + perpY + windY;

  // Sample quadratic Bézier: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
  const pts: [number, number][] = [];
  for (let i = 0; i <= nPoints; i++) {
    const t = i / nPoints;
    const mt = 1 - t;
    pts.push([
      mt * mt * x1 + 2 * mt * t * cx + t * t * x2,
      mt * mt * y1 + 2 * mt * t * cy + t * t * y2,
    ]);
  }
  return pts;
}

// ── Convex Hull ───────────────────────────────────────────────────────────────

/** Simple gift-wrapping convex hull. Returns vertices in CCW order. */
function convexHull(pts: [number, number][]): [number, number][] {
  if (pts.length < 3) return pts;
  const sorted = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return [...lower, ...upper];
}

/** Expand each hull vertex outward from the centroid by `bufferDeg`. */
function bufferHull(hull: [number, number][], bufferDeg: number): [number, number][] {
  if (!hull.length) return hull;
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
  return hull.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * bufferDeg, y + (dy / len) * bufferDeg] as [number, number];
  });
}

/**
 * Catmull-Rom spline through a closed ring of points.
 * Produces a smooth, organic polygon from angular hull vertices.
 */
function catmullRomClosed(pts: [number, number][], tension = 0.5, nSeg = 8): [number, number][] {
  const n = pts.length;
  if (n < 3) return pts;
  const result: [number, number][] = [];

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    for (let j = 0; j < nSeg; j++) {
      const t = j / nSeg;
      const t2 = t * t;
      const t3 = t2 * t;

      // Catmull-Rom coefficients
      const c0 = -tension * t + 2 * tension * t2 - tension * t3;
      const c1 = 1 + (tension - 3) * t2 + (2 - tension) * t3;
      const c2 = tension * t + (3 - 2 * tension) * t2 + (tension - 2) * t3;
      const c3 = -tension * t2 + tension * t3;

      result.push([
        c0 * p0[0] + c1 * p1[0] + c2 * p2[0] + c3 * p3[0],
        c0 * p0[1] + c1 * p1[1] + c2 * p2[1] + c3 * p3[1],
      ]);
    }
  }
  // Close the ring
  result.push(result[0]);
  return result;
}

/**
 * Build a smoothed, buffered GeoJSON polygon envelope for a cluster.
 * @param cityCoords  Array of [lon, lat] for each member city.
 * @param bufferDeg   How many degrees to expand the hull outward (default 1.4°).
 */
export function createClusterEnvelope(
  cityCoords: [number, number][],
  bufferDeg = 1.4,
): [number, number][] {
  if (cityCoords.length === 0) return [];
  if (cityCoords.length === 1) {
    // Single point — circular approximation
    const [cx, cy] = cityCoords[0];
    const ring: [number, number][] = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ring.push([cx + Math.cos(a) * bufferDeg, cy + Math.sin(a) * bufferDeg]);
    }
    return ring;
  }
  if (cityCoords.length === 2) {
    // Two points — pill shape
    cityCoords = [
      ...cityCoords,
      [cityCoords[0][0] + 0.001, cityCoords[0][1] + 0.001],
    ];
  }

  const hull = convexHull(cityCoords);
  const buffered = bufferHull(hull, bufferDeg);
  return catmullRomClosed(buffered, 0.5, 10);
}
