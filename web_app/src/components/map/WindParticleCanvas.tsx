/**
 * WindParticleCanvas — Windy / Earth Nullschool–style animated wind particles.
 *
 * Mounts as a transparent canvas perfectly overlaid on the MapLibre canvas.
 * Synchronises position/transform with the map on every render frame.
 * Wind field is interpolated via Inverse Distance Weighting across the 20 city nodes.
 */

import { useEffect, useRef } from 'react';
import type maplibregl from 'maplibre-gl';
import type { CityNodeStatus } from '../../types/airshed';

// ── Constants ─────────────────────────────────────────────────────────────────
const N_PARTICLES   = 1800;   // particle count — keeps 60 FPS
const LIFESPAN_MIN  = 35;
const LIFESPAN_MAX  = 65;
const SPEED_SCALE   = 0.18;   // pixel-per-frame multiplier for wind vectors
const TRAIL_ALPHA   = 0.93;   // canvas fade factor — higher = shorter trails
const PARTICLE_W    = 1.8;    // stroke line width
const STREAM_COLOR  = '56, 189, 248';   // #38bdf8 cyan — matches accent token
const INDIA_BOUNDS  = { minLon: 66, maxLon: 98, minLat: 6, maxLat: 38 };

// ── Types ─────────────────────────────────────────────────────────────────────
interface NodeWind { lon: number; lat: number; u: number; v: number }

interface Particle {
  x: number; y: number;     // screen coords
  lon: number; lat: number; // geo coords (for respawn within India)
  life: number; maxLife: number;
  alpha: number;
}

// ── IDW Wind Interpolation ────────────────────────────────────────────────────
function interpWind(
  lon: number, lat: number,
  nodes: NodeWind[],
): { u: number; v: number } {
  let wSum = 0, uSum = 0, vSum = 0;
  for (const n of nodes) {
    const d2 = (lon - n.lon) ** 2 + (lat - n.lat) ** 2 + 1e-4;
    const w  = 1 / d2;
    wSum += w; uSum += w * n.u; vSum += w * n.v;
  }
  return { u: uSum / wSum, v: vSum / wSum };
}

// ── Random point over India ───────────────────────────────────────────────────
function randIndia(): { lon: number; lat: number } {
  return {
    lon: INDIA_BOUNDS.minLon + Math.random() * (INDIA_BOUNDS.maxLon - INDIA_BOUNDS.minLon),
    lat: INDIA_BOUNDS.minLat + Math.random() * (INDIA_BOUNDS.maxLat - INDIA_BOUNDS.minLat),
  };
}

// ── Props ─────────────────────────────────────────────────────────────────────
interface Props {
  mapInstance: maplibregl.Map | null;
  nodes: Record<string, CityNodeStatus>;
  visible: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function WindParticleCanvas({ mapInstance, nodes, visible }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const particles = useRef<Particle[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const map    = mapInstance;
    if (!canvas || !map) return;

    const ctx = canvas.getContext('2d')!;

    // Prepare node wind vectors once per effect run
    const nodeWinds: NodeWind[] = Object.values(nodes).map((n) => ({
      lon: n.longitude, lat: n.latitude,
      u: n.wind_u ?? 0, v: n.wind_v ?? 0,
    }));

    // ── Resize canvas to match MapLibre container ──────────────────────────
    const resize = () => {
      const container = map.getContainer();
      canvas.width  = container.clientWidth;
      canvas.height = container.clientHeight;
    };
    resize();
    map.on('resize', resize);

    // ── Initialise particles ───────────────────────────────────────────────
    const spawnParticle = (): Particle => {
      const { lon, lat } = randIndia();
      const pt = map.project([lon, lat] as [number, number]);
      const maxLife = LIFESPAN_MIN + Math.random() * (LIFESPAN_MAX - LIFESPAN_MIN);
      return { x: pt.x, y: pt.y, lon, lat, life: Math.random() * maxLife, maxLife, alpha: 0 };
    };

    if (particles.current.length === 0) {
      for (let i = 0; i < N_PARTICLES; i++) particles.current.push(spawnParticle());
    }

    // ── Animation loop ─────────────────────────────────────────────────────
    const frame = () => {
      if (!visible) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        rafRef.current = requestAnimationFrame(frame);
        return;
      }

      // Fade trail
      ctx.fillStyle = `rgba(10,10,10,${1 - TRAIL_ALPHA})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = PARTICLE_W;
      ctx.lineCap   = 'round';

      for (const p of particles.current) {
        // Fade in/out over lifespan
        const lifeRatio = p.life / p.maxLife;
        p.alpha = Math.min(1, Math.sin(lifeRatio * Math.PI) * 0.9);

        // Interpolate wind at current geo position
        const { u, v } = interpWind(p.lon, p.lat, nodeWinds);

        // Move in screen space — project derivative
        // u = eastward m/s → positive x; v = northward m/s → negative y (screen)
        const speed  = Math.hypot(u, v);
        const scale  = SPEED_SCALE * (0.6 + 0.4 * Math.min(speed / 20, 1));
        const dx     = u * scale;
        const dy     = -v * scale;

        // Draw segment from old to new position
        ctx.beginPath();
        ctx.strokeStyle = `rgba(${STREAM_COLOR},${p.alpha * 0.45})`;
        ctx.moveTo(p.x, p.y);

        const nx = p.x + dx;
        const ny = p.y + dy;
        ctx.lineTo(nx, ny);
        ctx.stroke();

        // Update position
        p.x = nx;
        p.y = ny;

        // Back-project to geo for IDW interpolation next frame
        const lngLat = map.unproject([p.x, p.y]);
        p.lon = lngLat.lng;
        p.lat = lngLat.lat;

        p.life += 1;

        // Respawn if expired or out of India bounds
        if (
          p.life >= p.maxLife ||
          p.lon < INDIA_BOUNDS.minLon || p.lon > INDIA_BOUNDS.maxLon ||
          p.lat < INDIA_BOUNDS.minLat || p.lat > INDIA_BOUNDS.maxLat ||
          p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height
        ) {
          const np = spawnParticle();
          Object.assign(p, np);
        }
      }

      rafRef.current = requestAnimationFrame(frame);
    };

    rafRef.current = requestAnimationFrame(frame);

    // ── Sync canvas position on map move ──────────────────────────────────
    // Re-project all particles after pan/zoom so they stay geo-anchored
    const onMapMove = () => {
      for (const p of particles.current) {
        const pt = map.project([p.lon, p.lat]);
        p.x = pt.x;
        p.y = pt.y;
      }
    };
    map.on('move', onMapMove);

    return () => {
      cancelAnimationFrame(rafRef.current);
      map.off('resize', resize);
      map.off('move', onMapMove);
    };
  }, [mapInstance, nodes, visible]);

  // Clear canvas when hidden
  useEffect(() => {
    if (!visible) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
      particles.current = [];
    }
  }, [visible]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 2, mixBlendMode: 'screen' }}
    />
  );
}
