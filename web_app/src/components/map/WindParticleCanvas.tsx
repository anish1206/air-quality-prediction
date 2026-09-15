/**
 * WindParticleCanvas — Windy / Earth Nullschool–style animated wind particle canvas overlay.
 *
 * Mounts as a transparent canvas perfectly overlaid on the MapLibre canvas.
 * Renders faint translucent cyan streaks along interpolated wind vectors.
 */

import { useEffect, useRef } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { CityNodeStatus } from '../../types/airshed';

// ── Constants ─────────────────────────────────────────────────────────────────
const N_PARTICLES = 1800;
const LIFESPAN_MIN = 50;
const LIFESPAN_MAX = 90;
const SPEED_SCALE = 0.00048; // gentle atmospheric drift
const PARTICLE_W = 1.4;
const INDIA_BOUNDS = { minLon: 66, maxLon: 98, minLat: 6, maxLat: 38 };

// ── Speed-encoded color (WeatherLab style) ─────────────────────────────────
// speed in m/s from wind_u / wind_v magnitude
function windColor(speedMs: number): string {
    // calm  < 4 m/s  → cyan
    if (speedMs < 4)  return '56, 189, 248';   // #38bdf8
    // moderate 4–10  → warm amber
    if (speedMs < 10) return '251, 191,  36';   // #fbbf24
    // strong  ≥ 10   → crimson
    return '239,  68,  68';                     // #ef4444
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface NodeWind { lon: number; lat: number; u: number; v: number }

interface Particle {
    x: number; y: number;     // screen coords
    lon: number; lat: number; // geo coords
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
        const w = 1 / d2;
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
    const rafRef = useRef<number>(0);
    const particles = useRef<Particle[]>([]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const map = mapInstance;
        if (!canvas || !map) return;

        const ctx = canvas.getContext('2d')!;

        // Prepare node wind vectors
        const nodeWinds: NodeWind[] = Object.values(nodes).map((n) => ({
            lon: n.longitude, lat: n.latitude,
            u: n.wind_u ?? 0, v: n.wind_v ?? 0,
        }));

        // ── Resize canvas to match MapLibre container ──────────────────────────
        const resize = () => {
            const container = map.getContainer();
            canvas.width = container.clientWidth;
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

            // Trail fade effect
            ctx.fillStyle = `rgba(10,10,10,0.06)`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.lineWidth = PARTICLE_W;
            ctx.lineCap = 'round';

            for (const p of particles.current) {
                // Fade in/out over lifespan
                const lifeRatio = p.life / p.maxLife;
                p.alpha = Math.min(1, Math.sin(lifeRatio * Math.PI) * 0.9);

                const { u, v } = interpWind(p.lon, p.lat, nodeWinds);
                const speedMs = Math.sqrt(u * u + v * v);
                const color = windColor(speedMs);

                // Move in geo space
                const dx = u * SPEED_SCALE;
                const dy = -v * SPEED_SCALE;

                const oldPt = map.project([p.lon, p.lat]);
                const newLon = p.lon + dx;
                const newLat = p.lat + dy;
                const newPt = map.project([newLon, newLat]);

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${color}, ${p.alpha * 0.35})`;
                ctx.moveTo(oldPt.x, oldPt.y);
                ctx.lineTo(newPt.x, newPt.y);
                ctx.stroke();

                p.lon = newLon;
                p.lat = newLat;
                p.x = newPt.x;
                p.y = newPt.y;

                p.life += 1;

                // Respawn if expired or out of bounds
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
