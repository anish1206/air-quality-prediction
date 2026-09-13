/**
 * AirshedNetworkMap — Living atmospheric fluid-dynamics visualization.
 *
 * Layers (bottom → top):
 *  1. Cluster Envelopes   — smoothed convex-hull basin polygons per airshed regime
 *  2. Bézier Streamlines  — curved aerodynamic causal edges following pressure gradients
 *  3. City plume glyphs   — directional elliptic plumes driven by wind_u / wind_v
 *  4. Station glyphs      — hazard aura rings + metric capsule badges
 *  5. Cascade pulses      — animated travelling particles on active edges
 *  6. WindParticleCanvas  — Windy-style 60 FPS particle stream overlay (Canvas)
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAirshedStore } from '../../store/airshedStore';
import type { AirshedNetworkPayload, AirshedTimeStep, CityNodeStatus } from '../../types/airshed';
import { clusterColor, getHazardStyle } from '../../lib/airshedSelectors';
import { CITY_META, CLUSTER_DISPLAY } from '../../lib/cityMeta';
import { createBezierStreamline, createClusterEnvelope } from '../../utils/geoSplines';
import WindParticleCanvas from './WindParticleCanvas';

// ── GeoJSON helpers ───────────────────────────────────────────────────────────
type FC = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, string | number>;
    geometry:
      | { type: 'Point';      coordinates: [number, number]    }
      | { type: 'LineString'; coordinates: [number, number][]  }
      | { type: 'Polygon';    coordinates: [number, number][][] };
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
  if (metric === 'us_aqi')           return node.us_aqi;
  if (metric === 'pm2_5')            return node.pm2_5;
  if (metric === 'nitrogen_dioxide') return node.nitrogen_dioxide;
  return node.chhi_score;
};

// ── Directional plume ellipse ─────────────────────────────────────────────────
const plumeRing = (
  lon: number, lat: number, u: number, v: number,
): [number, number][] => {
  const mag = Math.hypot(u, v);
  const dx  = mag > 0.15 ? u / mag : 0;
  const dy  = mag > 0.15 ? v / mag : 1;
  const px  = -dy; const py = dx;
  const len = 0.22 + Math.min(mag, 18) * 0.028;
  const hw  = 0.07;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i++) {
    const a  = (i / 24) * Math.PI * 2;
    const lx = Math.cos(a) * hw;
    const ly = Math.sin(a) * len * 0.5 + len * 0.45;
    pts.push([lon + lx * px + ly * dx, lat + lx * py + ly * dy]);
  }
  pts.push(pts[0]);
  return pts;
};

// ── Layer builder ─────────────────────────────────────────────────────────────
const buildLayers = (
  payload: AirshedNetworkPayload,
  step: AirshedTimeStep,
  clusterFilter: number | null,
  metric: string,
): { envelopes: FC; pins: FC; edges: FC; pulses: FC; plumes: FC } => {

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
      const col  = clusterColor(cid, payload);
      return {
        type: 'Feature',
        properties: {
          cluster_id:    cid,
          fill:          hexToRgba(col, 0.10),
          stroke:        hexToRgba(col, 0.40),
          active:        clusterFilter === cid ? 1 : 0,
        },
        geometry: { type: 'Polygon', coordinates: [ring] },
      };
    }),
  };

  // ── 2. Curved Bézier causal edges ─────────────────────────────────────────
  const edges: FC = {
    type: 'FeatureCollection',
    features: payload.causal_edges
      .filter((e) => {
        if (!coords.has(e.source_node) || !coords.has(e.target_node)) return false;
        return clusterFilter === null || e.cluster_id === clusterFilter;
      })
      .map((e) => {
        const src = coords.get(e.source_node)!;
        const tgt = coords.get(e.target_node)!;
        // Curvature proportional to distance; bearing from edge corridor metadata
        const dist = Math.hypot(tgt[0] - src[0], tgt[1] - src[1]);
        const pts  = createBezierStreamline(src, tgt, dist * 0.22, e.corridor_bearing_deg ?? 0);
        return {
          type: 'Feature',
          properties: {
            color:  clusterColor(e.cluster_id, payload),
            weight: Math.max(0.15, Math.min(1, Math.abs(e.correlation_coefficient))),
          },
          geometry: { type: 'LineString', coordinates: pts },
        };
      }),
  };

  // ── 3. Station pins ────────────────────────────────────────────────────────
  const pins: FC = {
    type: 'FeatureCollection',
    features: visible.map(([id, n]) => {
      const hazard = getHazardStyle(n.chhi_score);
      // Aura radius: expands under stagnation (low wind + high CHHI)
      const stagnation = Math.max(0, (1 - n.wind_speed / 18)) * (n.chhi_score / 100);
      const auraR = 10 + stagnation * 14;
      return {
        type: 'Feature',
        properties: {
          id,
          name:       n.city_name,
          cluster_id: n.cluster_id,
          color:      clusterColor(n.cluster_id, payload),
          ring:       hazard.color,
          value:      Math.round(metricValue(n, metric)),
          trigger:    n.is_trigger_active ? 1 : 0,
          wind_dir:   n.wind_dir,
          wind_speed: n.wind_speed,
          aura_r:     auraR,
        },
        geometry: { type: 'Point', coordinates: [n.longitude, n.latitude] },
      };
    }),
  };

  // ── 4. Directional plumes ──────────────────────────────────────────────────
  const plumes: FC = {
    type: 'FeatureCollection',
    features: visible.map(([id, n]) => ({
      type: 'Feature',
      properties: {
        id,
        fill:   hexToRgba(clusterColor(n.cluster_id, payload), 0.20),
        stroke: hexToRgba(clusterColor(n.cluster_id, payload), 0.60),
      },
      geometry: {
        type: 'Polygon',
        coordinates: [plumeRing(n.longitude, n.latitude, n.wind_u, n.wind_v)],
      },
    })),
  };

  // ── 5. Cascade pulses ──────────────────────────────────────────────────────
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

  return { envelopes, pins, edges, pulses, plumes };
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirshedNetworkMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map          = useRef<maplibregl.Map | null>(null);
  const markers      = useRef<maplibregl.Marker[]>([]);
  const pulseT       = useRef(0);
  const raf          = useRef<number>(0);
  const [mapReady, setMapReady] = useState(false);

  const payload             = useAirshedStore((s) => s.payload);
  const selectedSubStep     = useAirshedStore((s) => s.selectedSubStep);
  const selectedCityId      = useAirshedStore((s) => s.selectedCityId);
  const selectedClusterFilter = useAirshedStore((s) => s.selectedClusterFilter);
  const selectedMetric      = useAirshedStore((s) => s.selectedMetric);
  const layerVisibility     = useAirshedStore((s) => s.layerVisibility);
  const setCityId           = useAirshedStore((s) => s.setCityId);

  const step = payload?.time_steps[selectedSubStep] ?? payload?.time_steps[0];

  const geo = useMemo(() => {
    if (!payload || !step)
      return { envelopes: emptyFC(), pins: emptyFC(), edges: emptyFC(), pulses: emptyFC(), plumes: emptyFC() };
    return buildLayers(payload, step, selectedClusterFilter, selectedMetric);
  }, [payload, step, selectedClusterFilter, selectedMetric]);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const instance = new maplibregl.Map({
      container: mapContainer.current,
      style:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [78.9629, 22.5937],
      zoom:   4.8,
      pitch:  18,
      attributionControl: false,
    });
    map.current = instance;
    instance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    instance.on('load', () => {
      // ── Sources ──────────────────────────────────────────────────────────
      instance.addSource('envelopes', { type: 'geojson', data: emptyFC() });
      instance.addSource('plumes',    { type: 'geojson', data: emptyFC() });
      instance.addSource('edges',     { type: 'geojson', data: emptyFC() });
      instance.addSource('pins',      { type: 'geojson', data: emptyFC() });
      instance.addSource('pulses',    { type: 'geojson', data: emptyFC() });

      // ── Layer 1: Cluster envelopes ────────────────────────────────────────
      instance.addLayer({
        id: 'envelope-fill', type: 'fill', source: 'envelopes',
        paint: {
          'fill-color':   ['get', 'fill'],
          'fill-opacity': ['case', ['==', ['get', 'active'], 1], 0.22, 0.10],
        },
      });
      instance.addLayer({
        id: 'envelope-glow', type: 'line', source: 'envelopes',
        paint: {
          'line-color':   ['get', 'stroke'],
          'line-width':   ['case', ['==', ['get', 'active'], 1], 2.5, 1.2],
          'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.80, 0.35],
          'line-blur':    6,
        },
      });
      instance.addLayer({
        id: 'envelope-line', type: 'line', source: 'envelopes',
        paint: {
          'line-color':   ['get', 'stroke'],
          'line-width':   1,
          'line-opacity': ['case', ['==', ['get', 'active'], 1], 0.70, 0.25],
        },
      });

      // ── Layer 2: Plume ellipses ────────────────────────────────────────────
      instance.addLayer({
        id: 'plumes-fill', type: 'fill', source: 'plumes',
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.80 },
      });
      instance.addLayer({
        id: 'plumes-line', type: 'line', source: 'plumes',
        paint: { 'line-color': ['get', 'stroke'], 'line-width': 1.0, 'line-opacity': 0.65 },
      });

      // ── Layer 3: Bézier causal edges ──────────────────────────────────────
      instance.addLayer({
        id: 'edges-glow', type: 'line', source: 'edges',
        paint: {
          'line-color':   ['get', 'color'],
          'line-width':   ['interpolate', ['linear'], ['get', 'weight'], 0.15, 2.5, 1, 5],
          'line-opacity': 0.18,
          'line-blur':    3.5,
        },
      });
      instance.addLayer({
        id: 'edges-core', type: 'line', source: 'edges',
        paint: {
          'line-color':      ['get', 'color'],
          'line-width':      ['interpolate', ['linear'], ['get', 'weight'], 0.15, 0.7, 1, 1.8],
          'line-opacity':    0.55,
          'line-dasharray':  [3, 2],
        },
      });

      // ── Layer 4a: Hazard aura rings ────────────────────────────────────────
      instance.addLayer({
        id: 'pin-auras', type: 'circle', source: 'pins',
        paint: {
          'circle-radius':        ['get', 'aura_r'],
          'circle-color':         ['get', 'ring'],
          'circle-opacity':       0.06,
          'circle-blur':          0.65,
          'circle-stroke-width':  0,
        },
      });
      // Outer hazard ring
      instance.addLayer({
        id: 'pin-rings', type: 'circle', source: 'pins',
        paint: {
          'circle-radius':         ['case', ['==', ['get', 'trigger'], 1], 16, 11],
          'circle-color':          'rgba(0,0,0,0)',
          'circle-stroke-width':   1.8,
          'circle-stroke-color':   ['get', 'ring'],
          'circle-opacity':        0,
          'circle-stroke-opacity': 0.85,
        },
      });
      // Core dot
      instance.addLayer({
        id: 'pin-cores', type: 'circle', source: 'pins',
        paint: {
          'circle-radius':       5.5,
          'circle-color':        ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0a0a0a',
        },
      });
      // City name + metric badge
      instance.addLayer({
        id: 'pin-labels', type: 'symbol', source: 'pins',
        layout: {
          'text-field':  ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'value']]],
          'text-size':   10,
          'text-offset': [0, 1.35],
          'text-anchor': 'top',
          'text-font':   ['Noto Sans Regular'],
        },
        paint: {
          'text-color':       '#e5e5e5',
          'text-halo-color':  '#0a0a0a',
          'text-halo-width':  1.2,
        },
      });

      // ── Layer 5: Cascade pulse particles ──────────────────────────────────
      instance.addLayer({
        id: 'cascade-pulses', type: 'circle', source: 'pulses',
        paint: {
          'circle-radius':       7,
          'circle-color':        '#38bdf8',
          'circle-blur':         0.15,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f97316',
          'circle-opacity':      0.95,
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
          instance.setPaintProperty('edges-core', 'line-opacity', 0.35 + 0.22 * Math.sin(t));
          instance.setPaintProperty('pin-rings', 'circle-radius', [
            'case', ['==', ['get', 'trigger'], 1],
            14 + 4 * (0.5 + 0.5 * Math.sin(t * 1.6)),
            10 + 2.5 * (0.5 + 0.5 * Math.sin(t)),
          ]);
          instance.setPaintProperty('cascade-pulses', 'circle-radius',
            6 + 3 * (0.5 + 0.5 * Math.sin(t * 2)));
          // Pulse envelope glow opacity
          instance.setPaintProperty('envelope-glow', 'line-opacity', [
            'case', ['==', ['get', 'active'], 1],
            0.65 + 0.15 * (0.5 + 0.5 * Math.sin(t * 0.7)),
            0.25,
          ]);
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
      setData('pins',      geo.pins);
      setData('edges',     geo.edges);
      setData('pulses',    geo.pulses);
      setData('plumes',    geo.plumes);
    };

    if (instance.isStyleLoaded() && instance.getSource('pins')) {
      apply(); return;
    }
    if (instance.isStyleLoaded()) {
      const onSD = () => { if (instance.getSource('pins')) { apply(); instance.off('sourcedata', onSD); } };
      instance.on('sourcedata', onSD);
      return () => instance.off('sourcedata', onSD);
    }
    const onLoad = () => apply();
    instance.once('load', onLoad);
    return () => instance.off('load', onLoad);
  }, [geo]);

  // ── Layer visibility ──────────────────────────────────────────────────────
  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    const vis = (id: string, on: boolean) => {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    vis('edges-glow',      layerVisibility.edges);
    vis('edges-core',      layerVisibility.edges);
    vis('cascade-pulses',  layerVisibility.pulses);
    vis('plumes-fill',     layerVisibility.plumes);
    vis('plumes-line',     layerVisibility.plumes);
    vis('envelope-fill',   layerVisibility.plumes);
    vis('envelope-glow',   layerVisibility.plumes);
    vis('envelope-line',   layerVisibility.plumes);
    vis('pin-auras',       layerVisibility.pins);
    vis('pin-rings',       layerVisibility.pins);
    vis('pin-cores',       layerVisibility.pins);
    vis('pin-labels',      layerVisibility.pins);
  }, [layerVisibility]);

  // ── Selected city selection marker ────────────────────────────────────────
  useEffect(() => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const instance = map.current;
    if (!instance || !step) return;
    const node = step.nodes[selectedCityId];
    if (!node) return;

    const el = document.createElement('div');
    el.style.cssText = `
      width: 22px; height: 22px; border-radius: 999px;
      border: 2px solid #4285f4;
      box-shadow: 0 0 12px #4285f440;
      background: transparent;
      pointer-events: none;
    `;
    markers.current = [
      new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([node.longitude, node.latitude])
        .addTo(instance),
    ];
  }, [selectedCityId, step]);

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
