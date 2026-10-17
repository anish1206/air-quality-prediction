/**
 * AirshedNetworkMap — Operational Atmospheric Console with Native MapLibre Layers.
 *
 * Layers (bottom → top):
 *  1. Cluster Envelopes     — smoothed convex-hull basin polygons per airshed regime
 *  2. Dynamic Plumes        — soft Gaussian radial fadeout plumes advected by wind vectors
 *  3. Bézier Transport      — clean curved streamlines with midpoint ETA badges
 *  4. Station Pins & Badges — visual triage pins, breathing hazard rings & text pills
 *  5. Cascade Pulses        — animated particles along active causal edges
 *  6. WindParticleCanvas    — gentle 60 FPS wind particle stream overlay (Canvas)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAirshedStore } from '../../store/airshedStore';
import type { AirshedNetworkPayload, AirshedTimeStep, CityNodeStatus } from '../../types/airshed';
import { clusterColor } from '../../lib/airshedSelectors';
import { createBezierStreamline, createClusterEnvelope } from '../../utils/geoSplines';
import WindParticleCanvas from './WindParticleCanvas';

// ── GeoJSON helpers ───────────────────────────────────────────────────────────
type FC = {
    type: 'FeatureCollection';
    features: Array<{
        type: 'Feature';
        properties: Record<string, string | number>;
        geometry:
        | { type: 'Point'; coordinates: [number, number] }
        | { type: 'LineString'; coordinates: [number, number][] }
        | { type: 'Polygon'; coordinates: [number, number][][] };
    }>;
};

const emptyFC = (): FC => ({ type: 'FeatureCollection', features: [] });

const interpolate = (
    src: [number, number], tgt: [number, number], p: number,
): [number, number] => [src[0] + p * (tgt[0] - src[0]), src[1] + p * (tgt[1] - src[1])];

const hexToRgba = (hex: string, a: number) => {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

const metricValue = (node: CityNodeStatus, metric: string) => {
    if (metric === 'us_aqi') return node.us_aqi;
    if (metric === 'pm2_5') return node.pm2_5;
    if (metric === 'nitrogen_dioxide') return node.nitrogen_dioxide;
    return node.chhi_score;
};

function distKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return 6371 * c;
}

// Helper function to return severity color based purely on the active metric value
export function getSeverityColor(val: number, metric: string): { bg: string; border: string; glow: string } {
    if (metric === 'chhi_score') {
        if (val > 75) {
            // Critical Hazard -> Crimson Red
            return { bg: 'rgba(225, 29, 72, 0.85)', border: '#e11d48', glow: 'rgba(225, 29, 72, 0.45)' };
        } else if (val > 50) {
            // High Hazard -> Flame Orange
            return { bg: 'rgba(249, 115, 22, 0.80)', border: '#f97316', glow: 'rgba(249, 115, 22, 0.40)' };
        } else if (val > 25) {
            // Moderate -> Amber Yellow
            return { bg: 'rgba(234, 179, 8, 0.70)', border: '#eab308', glow: 'rgba(234, 179, 8, 0.35)' };
        } else {
            // Low Risk (<= 25) -> MINT GREEN!
            return { bg: 'rgba(34, 197, 94, 0.75)', border: '#22c55e', glow: 'rgba(34, 197, 94, 0.35)' };
        }
    }

    // Fallback for US AQI / PM2.5 / NO2
    if (val > 150) return { bg: 'rgba(225, 29, 72, 0.85)', border: '#e11d48', glow: 'rgba(225, 29, 72, 0.45)' };
    if (val > 100) return { bg: 'rgba(249, 115, 22, 0.80)', border: '#f97316', glow: 'rgba(249, 115, 22, 0.40)' };
    if (val > 50)  return { bg: 'rgba(234, 179, 8, 0.70)', border: '#eab308', glow: 'rgba(234, 179, 8, 0.35)' };
    return { bg: 'rgba(34, 197, 94, 0.75)', border: '#22c55e', glow: 'rgba(34, 197, 94, 0.35)' };
}

// Helper function to build dynamic GeoJSON for the ACTIVE time step
export function getDynamicPlumeGeoJSON(currentStep: AirshedTimeStep, selectedMetric: string) {
    if (!currentStep || !currentStep.nodes) return { type: 'FeatureCollection' as const, features: [] };

    const features = Object.entries(currentStep.nodes).map(([cityId, node]) => {
        // 1. Get the exact value for THIS specific time step
        const val = Number(
            node[selectedMetric as keyof CityNodeStatus] ??
            (selectedMetric === 'nitrogen_dioxide' ? (node as any).no2 : 0) ??
            0
        );

        // 2. Determine color and radius strictly based on this value
        const { glow } = getSeverityColor(val, selectedMetric);
        const plumeRadius = val > 75 ? 55 : (val > 50 ? 42 : (val > 25 ? 30 : 20));

        // 3. Shift coordinates downwind based on wind vectors
        const windU = Number(node.wind_u || 0);
        const windV = Number(node.wind_v || 0);
        const offsetLng = node.longitude + (windU * 0.035);
        const offsetLat = node.latitude + (windV * 0.035);

        return {
            type: 'Feature' as const,
            geometry: {
                type: 'Point' as const,
                coordinates: [offsetLng, offsetLat] as [number, number],
            },
            properties: {
                cityId,
                val,
                plume_color: glow, // Use the dynamic risk glow color! NOT cluster.color_hex!
                plume_radius: plumeRadius,
            },
        };
    });

    return { type: 'FeatureCollection' as const, features };
}

// ── Layer builder ─────────────────────────────────────────────────────────────
const buildLayers = (
    payload: AirshedNetworkPayload,
    step: AirshedTimeStep,
    clusterFilter: number | null,
    metric: string,
): { envelopes: FC; pins: FC; edges: FC; pulses: FC; edgeBadges: FC } => {

    const coords = new Map<string, [number, number]>();
    const visible = Object.entries(step.nodes).filter(
        ([, n]) => clusterFilter === null || n.cluster_id === clusterFilter,
    );
    visible.forEach(([id, n]) => coords.set(id, [n.longitude, n.latitude]));

    // ── 1. Cluster Envelopes ───────────────────────────────────────────────────
    const clusterMap = new Map<number, [number, number][]>();
    for (const [, n] of visible) {
        const cid = n.cluster_id;
        if (!clusterMap.has(cid)) clusterMap.set(cid, []);
        clusterMap.get(cid)!.push([n.longitude, n.latitude]);
    }

    const envelopes: FC = {
        type: 'FeatureCollection',
        features: Array.from(clusterMap.entries()).map(([cid, pts]) => {
            const ring = createClusterEnvelope(pts, 1.5);
            const col = clusterColor(cid, payload);
            return {
                type: 'Feature',
                properties: {
                    cluster_id: cid,
                    fill: hexToRgba(col, 0.08),
                    stroke: hexToRgba(col, 0.35),
                    active: clusterFilter === cid ? 1 : 0,
                },
                geometry: { type: 'Polygon', coordinates: [ring] },
            };
        }),
    };

    // ── 2. Bézier causal edges & Corridor Midpoint Status Badges ──────────────
    const edgeFeatures: FC['features'] = [];
    const edgeBadgeFeatures: FC['features'] = [];

    const filteredEdges = payload.causal_edges.filter((e) => {
        if (!coords.has(e.source_node) || !coords.has(e.target_node)) return false;
        return clusterFilter === null || e.cluster_id === clusterFilter;
    });

    filteredEdges.forEach((e) => {
        const srcNode = step.nodes[e.source_node];
        const tgtNode = step.nodes[e.target_node];
        if (!srcNode || !tgtNode) return;

        const src = coords.get(e.source_node)!;
        const tgt = coords.get(e.target_node)!;

        const dist = Math.hypot(tgt[0] - src[0], tgt[1] - src[1]);
        const pts = createBezierStreamline(src, tgt, dist * 0.22, e.corridor_bearing_deg ?? 0);

        const edgeColor = clusterColor(e.cluster_id, payload);
        const edgeWeight = Math.max(0.2, Math.min(1.0, Math.abs(e.correlation_coefficient)));

        edgeFeatures.push({
            type: 'Feature',
            properties: {
                color: edgeColor,
                weight: edgeWeight,
            },
            geometry: { type: 'LineString', coordinates: pts },
        });

        // Compute midpoint ETA badge
        const realDistKm = distKm(srcNode.longitude, srcNode.latitude, tgtNode.longitude, tgtNode.latitude);
        const avgWindSpeed = Math.max(6, (srcNode.wind_speed + tgtNode.wind_speed) / 2);
        const etaHours = Math.round(realDistKm / avgWindSpeed);
        const midPt = pts[Math.floor(pts.length / 2)] ?? interpolate(src, tgt, 0.5);

        edgeBadgeFeatures.push({
            type: 'Feature',
            properties: {
                badgeText: `${e.source_node} ──[ ${Math.round(avgWindSpeed)} km/h • ETA: ${etaHours}h ]──► ${e.target_node}`,
            },
            geometry: { type: 'Point', coordinates: midPt },
        });
    });

    const edges: FC = { type: 'FeatureCollection', features: edgeFeatures };
    const edgeBadges: FC = { type: 'FeatureCollection', features: edgeBadgeFeatures };

    // ── 3. Station Pins & Atmospheric Halos Source ────────────────────────────
    const pins: FC = {
        type: 'FeatureCollection',
        features: visible.map(([id, n]) => {
            const val = Math.round(metricValue(n, metric));
            const sev = getSeverityColor(val, metric);

            let severityClass = 0;
            if (metric === 'chhi_score') {
                if (val > 50) severityClass = 2;
                else if (val > 25) severityClass = 1;
            } else {
                if (val > 100) severityClass = 2;
                else if (val > 50) severityClass = 1;
            }

            return {
                type: 'Feature',
                properties: {
                    id,
                    name: n.city_name,
                    cluster_id: n.cluster_id,
                    color: sev.border, // Dynamic risk severity color (inner dot)
                    ring: sev.border,  // Dynamic risk severity color (border ring)
                    value: val,
                    chhi_score: n.chhi_score,
                    trigger: n.is_trigger_active ? 1 : 0,
                    wind_dir: n.wind_dir,
                    wind_speed: n.wind_speed,
                    severityClass,
                },
                geometry: { type: 'Point', coordinates: [n.longitude, n.latitude] },
            };
        }),
    };

    // ── 4. Cascade pulses ──────────────────────────────────────────────────────
    const pulses: FC = {
        type: 'FeatureCollection',
        features: step.active_cascade_pulses
            .filter((p) => coords.has(p.source_node) && coords.has(p.target_node))
            .map((p) => ({
                type: 'Feature',
                properties: { id: p.pulse_id, confidence: p.confidence_pct },
                geometry: {
                    type: 'Point',
                    coordinates: interpolate(
                        coords.get(p.source_node)!, coords.get(p.target_node)!, p.progress_ratio,
                    ),
                },
            })),
    };

    return { envelopes, pins, edges, pulses, edgeBadges };
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirshedNetworkMap() {
    const mapContainer = useRef<HTMLDivElement>(null);
    const map = useRef<maplibregl.Map | null>(null);
    const markers = useRef<maplibregl.Marker[]>([]);
    const pulseT = useRef(0);
    const raf = useRef<number>(0);
    const [mapReady, setMapReady] = useState(false);

    const payload = useAirshedStore((s) => s.payload);
    const selectedSubStep = useAirshedStore((s) => s.selectedSubStep);
    const selectedCityId = useAirshedStore((s) => s.selectedCityId);
    const selectedClusterFilter = useAirshedStore((s) => s.selectedClusterFilter);
    const selectedMetric = useAirshedStore((s) => s.selectedMetric);
    const layerVisibility = useAirshedStore((s) => s.layerVisibility);
    const setCityId = useAirshedStore((s) => s.setCityId);

    const step = payload?.time_steps[selectedSubStep] ?? payload?.time_steps[0];

    const geo = useMemo(() => {
        if (!payload || !step)
            return { envelopes: emptyFC(), pins: emptyFC(), edges: emptyFC(), pulses: emptyFC(), edgeBadges: emptyFC() };
        return buildLayers(payload, step, selectedClusterFilter, selectedMetric);
    }, [payload, step, selectedClusterFilter, selectedMetric]);

    // ── Init map once ──────────────────────────────────────────────────────────
    useEffect(() => {
        if (!mapContainer.current || map.current) return;

        const instance = new maplibregl.Map({
            container: mapContainer.current,
            style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
            center: [78.9629, 22.5937],
            zoom: 4.8,
            pitch: 18,
            attributionControl: false,
        });
        map.current = instance;
        instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

        instance.on('load', () => {
            const initialStep = payload?.time_steps[selectedSubStep] ?? payload?.time_steps[0];
            instance.addSource('dynamic-plumes-source', {
                type: 'geojson',
                data: initialStep ? (getDynamicPlumeGeoJSON(initialStep, selectedMetric) as never) : emptyFC(),
            });
            instance.addSource('envelopes', { type: 'geojson', data: emptyFC() });
            instance.addSource('edges', { type: 'geojson', data: emptyFC() });
            instance.addSource('edge-badges', { type: 'geojson', data: emptyFC() });
            instance.addSource('pins', { type: 'geojson', data: emptyFC() });
            instance.addSource('pulses', { type: 'geojson', data: emptyFC() });

            // ── Layer 1: Cluster envelopes (Airshed Regimes) ─────────────────────
            instance.addLayer({
                id: 'envelope-fill', type: 'fill', source: 'envelopes',
                paint: {
                    'fill-color': ['get', 'fill'],
                    'fill-opacity': 0.08,
                },
            });
            instance.addLayer({
                id: 'envelope-glow', type: 'line', source: 'envelopes',
                paint: {
                    'line-color': ['get', 'stroke'],
                    'line-width': 1.5,
                    'line-opacity': 0.35,
                    'line-blur': 4,
                },
            });

            // ── Layer 2: Station-Anchored Dynamic Atmospheric Plumes ──────────────
            instance.addLayer({
                id: 'dynamic-plumes-layer',
                type: 'circle',
                source: 'dynamic-plumes-source',
                paint: {
                    // Read directly from the feature properties calculated above!
                    'circle-color': ['get', 'plume_color'],
                    'circle-radius': [
                        'interpolate', ['linear'], ['zoom'],
                        4, ['get', 'plume_radius'],
                        8, ['*', ['get', 'plume_radius'], 2.5],
                    ],
                    'circle-blur': 0.90,
                    'circle-opacity': 0.85,
                },
            });

            // ── Layer 3: Bézier Streamlines ───────────────────────────────────────
            instance.addLayer({
                id: 'edges-glow', type: 'line', source: 'edges',
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': 3,
                    'line-opacity': 0.12,
                    'line-blur': 4,
                },
            });
            instance.addLayer({
                id: 'edges-core', type: 'line', source: 'edges',
                paint: {
                    'line-color': ['get', 'color'],
                    'line-width': 1.5,
                    'line-opacity': 0.35,
                },
            });

            // ── Layer 3b: Conduit Status Badges ──────────────────────────────────
            instance.addLayer({
                id: 'edge-badge-labels', type: 'symbol', source: 'edge-badges',
                layout: {
                    'text-field': ['get', 'badgeText'],
                    'text-size': 9,
                    'text-font': ['Noto Sans Regular'],
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                },
                paint: {
                    'text-color': '#38bdf8',
                    'text-halo-color': '#090909',
                    'text-halo-width': 1.8,
                },
            });

            // ── Layer 4: Station Pins & Badges ────────────────────────────────────
            instance.addLayer({
                id: 'pin-rings', type: 'circle', source: 'pins',
                paint: {
                    'circle-radius': ['case', ['==', ['get', 'severityClass'], 2], 16, ['case', ['==', ['get', 'severityClass'], 1], 11, 6]],
                    'circle-color': 'rgba(0,0,0,0)',
                    'circle-stroke-width': 1.8,
                    'circle-stroke-color': ['get', 'ring'],
                    'circle-opacity': 0,
                    'circle-stroke-opacity': 0.85,
                },
            });
            instance.addLayer({
                id: 'pin-cores', type: 'circle', source: 'pins',
                paint: {
                    'circle-radius': 5.5,
                    'circle-color': ['get', 'color'],
                    'circle-stroke-width': 1.5,
                    'circle-stroke-color': '#0a0a0a',
                },
            });
            instance.addLayer({
                id: 'pin-labels', type: 'symbol', source: 'pins',
                layout: {
                    'text-field': ['get', 'name'],
                    'text-size': 10,
                    'text-offset': [0, 1.3],
                    'text-anchor': 'top',
                    'text-font': ['Noto Sans Regular'],
                    'text-allow-overlap': false,
                    'text-ignore-placement': false,
                },
                paint: {
                    'text-color': '#e5e5e5',
                    'text-halo-color': '#0a0a0a',
                    'text-halo-width': 1.6,
                },
            });

            // ── Layer 5: Cascade pulse particles ──────────────────────────────────
            instance.addLayer({
                id: 'cascade-pulses', type: 'circle', source: 'pulses',
                paint: {
                    'circle-radius': 4,
                    'circle-color': '#38bdf8',
                    'circle-blur': 0.3,
                    'circle-stroke-width': 1,
                    'circle-stroke-color': '#f97316',
                    'circle-opacity': 0.90,
                },
            });

            // ── Interactivity ──────────────────────────────────────────────────────
            instance.on('click', 'pin-cores', (e) => {
                const id = e.features?.[0]?.properties?.id as string | undefined;
                if (id) setCityId(id);
            });
            instance.on('mouseenter', 'pin-cores', () => { instance.getCanvas().style.cursor = 'pointer'; });
            instance.on('mouseleave', 'pin-cores', () => { instance.getCanvas().style.cursor = ''; });

            // ── Pulse animation loop ───────────────────────────────────────────────
            const tick = () => {
                pulseT.current += 0.042;
                const t = pulseT.current;
                if (instance.getLayer('edges-core')) {
                    instance.setPaintProperty('edges-core', 'line-opacity', 0.25 + 0.12 * Math.sin(t));
                    instance.setPaintProperty('pin-rings', 'circle-radius', [
                        'case', ['==', ['get', 'trigger'], 1],
                        14 + 3 * (0.5 + 0.5 * Math.sin(t * 1.6)),
                        10 + 2 * (0.5 + 0.5 * Math.sin(t)),
                    ]);
                    instance.setPaintProperty('cascade-pulses', 'circle-radius',
                        3.5 + 1.5 * (0.5 + 0.5 * Math.sin(t * 2)));
                }
                raf.current = requestAnimationFrame(tick);
            };
            raf.current = requestAnimationFrame(tick);

            setMapReady(true);
        });

        return () => {
            cancelAnimationFrame(raf.current);
            instance.remove();
            map.current = null;
            setMapReady(false);
        };
    }, [setCityId]);

    // ── Update all sources when geo changes ───────────────────────────────────
    useEffect(() => {
        const instance = map.current;
        if (!instance) return;

        const apply = () => {
            if (!instance.getSource('pins')) return;
            const setData = (id: string, data: FC) => {
                (instance.getSource(id) as maplibregl.GeoJSONSource | undefined)?.setData(data as never);
            };
            setData('envelopes', geo.envelopes);
            setData('pins', geo.pins);
            setData('edges', geo.edges);
            setData('edge-badges', geo.edgeBadges);
            setData('pulses', geo.pulses);
        };

        if (instance.isStyleLoaded() && instance.getSource('pins')) {
            apply(); return;
        }
        if (instance.isStyleLoaded()) {
            const onSD = () => { if (instance.getSource('pins')) { apply(); instance.off('sourcedata', onSD); } };
            instance.on('sourcedata', onSD);
            return () => { instance.off('sourcedata', onSD); };
        }
        const onLoad = () => apply();
        instance.once('load', onLoad);
        return () => { instance.off('load', onLoad); };
    }, [geo]);

    // ── Hook reactivity to the timeline & metric (dynamic plume updates) ─────
    const data = payload;

    useEffect(() => {
        if (!map.current || !data?.time_steps) return;

        const currentStep = data.time_steps[selectedSubStep];
        if (!currentStep) return;

        const updatePlumes = () => {
            const source = map.current?.getSource('dynamic-plumes-source') as maplibregl.GeoJSONSource | undefined;
            if (source) {
                // Dynamically update the plume data on every timeline tick!
                source.setData(getDynamicPlumeGeoJSON(currentStep, selectedMetric));
            }
        };

        if (map.current.isStyleLoaded() && map.current.getSource('dynamic-plumes-source')) {
            updatePlumes();
        } else {
            map.current.once('load', updatePlumes);
        }
    }, [selectedSubStep, selectedMetric, data]);

    // ── Layer visibility ──────────────────────────────────────────────────────
    useEffect(() => {
        const instance = map.current;
        if (!instance?.isStyleLoaded()) return;
        const vis = (id: string, on: boolean) => {
            if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
        };
        const plumesVisible = layerVisibility.plumes && (layerVisibility.cloudField ?? true);
        vis('dynamic-plumes-layer', plumesVisible);
        vis('plume-ambient-layer', plumesVisible);
        vis('edges-glow', layerVisibility.edges);
        vis('edges-core', layerVisibility.edges);
        vis('edge-badge-labels', layerVisibility.edges);
        vis('cascade-pulses', layerVisibility.pulses);
        vis('envelope-fill', layerVisibility.plumes);
        vis('envelope-glow', layerVisibility.plumes);
        vis('pin-rings', layerVisibility.pins);
        vis('pin-cores', layerVisibility.pins);
        vis('pin-labels', layerVisibility.pins);
    }, [layerVisibility]);

    // ── Selected city marker ──────────────────────────────────────────────────
    useEffect(() => {
        markers.current.forEach((m) => m.remove());
        markers.current = [];
        const instance = map.current;
        if (!instance || !step) return;
        const node = step.nodes[selectedCityId];
        if (!node) return;

        const val = Math.round(metricValue(node, selectedMetric));
        const sev = getSeverityColor(val, selectedMetric);

        const el = document.createElement('div');
        el.style.cssText = `
      width: 24px; height: 24px; border-radius: 999px;
      border: 2px solid ${sev.border};
      box-shadow: 0 0 16px ${sev.border}80;
      background: transparent;
      pointer-events: none;
    `;
        markers.current = [
            new maplibregl.Marker({ element: el, anchor: 'center' })
                .setLngLat([node.longitude, node.latitude])
                .addTo(instance),
        ];
    }, [selectedCityId, step, selectedMetric]);

    return (
        <div className="absolute inset-0 w-full h-full" style={{ position: 'relative' }}>
            {/* MapLibre canvas */}
            <div ref={mapContainer} className="absolute inset-0 w-full h-full" />

            {/* Wind particle canvas overlay — toggleable via layerVisibility.plumes */}
            {mapReady && map.current && step && (
                <WindParticleCanvas
                    mapInstance={map.current}
                    nodes={step.nodes}
                    visible={layerVisibility.plumes}
                />
            )}
        </div>
    );
}
