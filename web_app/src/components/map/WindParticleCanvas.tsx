/**
 * WindParticleCanvas — animated wind-flow particle overlay.
 *
 * Transparent canvas with faint neutral streaks advected by IDW-interpolated
 * wind vectors. Uses destination-out compositing for trail fade so the canvas
 * stays transparent and doesn't darken the basemap.
 */

import { useEffect, useRef, useCallback } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { CityNodeStatus } from '../../types/airshed';

const N_PARTICLES = 1200;
const LIFESPAN_MIN = 50;
const LIFESPAN_MAX = 90;
const SPEED_SCALE = 0.00048;
const PARTICLE_W = 1;
const PARTICLE_ALPHA = 0.25;
const INDIA_BOUNDS = { minLon: 66, maxLon: 98, minLat: 6, maxLat: 38 };

// Neutral cyan-white so particles don't compete with severity band colours
const PARTICLE_RGB = '200, 220, 230';

interface NodeWind { lon: number; lat: number; u: number; v: number }

interface Particle {
    x: number; y: number;
    lon: number; lat: number;
    life: number; maxLife: number;
    alpha: number;
}

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

function randIndia(): { lon: number; lat: number } {
    return {
        lon: INDIA_BOUNDS.minLon + Math.random() * (INDIA_BOUNDS.maxLon - INDIA_BOUNDS.minLon),
        lat: INDIA_BOUNDS.minLat + Math.random() * (INDIA_BOUNDS.maxLat - INDIA_BOUNDS.minLat),
    };
}

interface Props {
    mapInstance: maplibregl.Map | null;
    nodes: Record<string, CityNodeStatus>;
    visible: boolean;
}

export default function WindParticleCanvas({ mapInstance, nodes, visible }: Props) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const rafRef = useRef<number>(0);
    const particles = useRef<Particle[]>([]);
    const nodeWindsRef = useRef<NodeWind[]>([]);

    // Update wind data in a ref so the animation loop picks up new values
    // without tearing down and re-initialising all particles.
    const updateWinds = useCallback((n: Record<string, CityNodeStatus>) => {
        nodeWindsRef.current = Object.values(n).map((nd) => ({
            lon: nd.longitude, lat: nd.latitude,
            u: nd.wind_u ?? 0, v: nd.wind_v ?? 0,
        }));
    }, []);

    // Sync wind data when nodes change, without re-running the main effect
    useEffect(() => {
        updateWinds(nodes);
    }, [nodes, updateWinds]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const map = mapInstance;
        if (!canvas || !map) return;

        const ctx = canvas.getContext('2d')!;

        // Seed wind data on first mount
        if (nodeWindsRef.current.length === 0) updateWinds(nodes);

        const resize = () => {
            const container = map.getContainer();
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
        };
        resize();
        map.on('resize', resize);

        const spawnParticle = (): Particle => {
            const { lon, lat } = randIndia();
            const pt = map.project([lon, lat] as [number, number]);
            const maxLife = LIFESPAN_MIN + Math.random() * (LIFESPAN_MAX - LIFESPAN_MIN);
            return { x: pt.x, y: pt.y, lon, lat, life: Math.random() * maxLife, maxLife, alpha: 0 };
        };

        if (particles.current.length === 0) {
            for (let i = 0; i < N_PARTICLES; i++) particles.current.push(spawnParticle());
        }

        const frame = () => {
            if (!visible) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                rafRef.current = requestAnimationFrame(frame);
                return;
            }

            // Fade trails by erasing alpha, keeps canvas transparent
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fillStyle = 'rgba(0,0,0,0.08)';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';

            ctx.lineWidth = PARTICLE_W;
            ctx.lineCap = 'round';

            const nodeWinds = nodeWindsRef.current;

            for (const p of particles.current) {
                const lifeRatio = p.life / p.maxLife;
                p.alpha = Math.min(1, Math.sin(lifeRatio * Math.PI) * 0.9);

                const { u, v } = interpWind(p.lon, p.lat, nodeWinds);

                const dx = u * SPEED_SCALE;
                const dy = -v * SPEED_SCALE;

                const oldPt = map.project([p.lon, p.lat]);
                const newLon = p.lon + dx;
                const newLat = p.lat + dy;
                const newPt = map.project([newLon, newLat]);

                ctx.beginPath();
                ctx.strokeStyle = `rgba(${PARTICLE_RGB}, ${p.alpha * PARTICLE_ALPHA})`;
                ctx.moveTo(oldPt.x, oldPt.y);
                ctx.lineTo(newPt.x, newPt.y);
                ctx.stroke();

                p.lon = newLon;
                p.lat = newLat;
                p.x = newPt.x;
                p.y = newPt.y;
                p.life += 1;

                if (
                    p.life >= p.maxLife ||
                    p.lon < INDIA_BOUNDS.minLon || p.lon > INDIA_BOUNDS.maxLon ||
                    p.lat < INDIA_BOUNDS.minLat || p.lat > INDIA_BOUNDS.maxLat ||
                    p.x < 0 || p.x > canvas.width || p.y < 0 || p.y > canvas.height
                ) {
                    Object.assign(p, spawnParticle());
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
    // Intentionally excludes `nodes` — wind data syncs via the ref above
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapInstance, visible]);

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
            style={{ zIndex: 2 }}
        />
    );
}
