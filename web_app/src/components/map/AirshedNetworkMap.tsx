import { useEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAirshedStore } from '../../store/airshedStore';
import type { AirshedNetworkPayload, AirshedTimeStep, CityNodeStatus } from '../../types/airshed';
import { clusterColor, getHazardStyle } from '../../lib/airshedSelectors';

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
  src: [number, number],
  tgt: [number, number],
  p: number,
): [number, number] => [src[0] + p * (tgt[0] - src[0]), src[1] + p * (tgt[1] - src[1])];

const plumeRing = (lon: number, lat: number, u: number, v: number): [number, number][] => {
  const mag = Math.hypot(u, v);
  const dx = mag > 0.15 ? u / mag : 0;
  const dy = mag > 0.15 ? v / mag : 1;
  const px = -dy;
  const py = dx;
  const len = 0.28 + Math.min(mag, 18) * 0.035;
  const halfW = 0.09;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 24; i += 1) {
    const a = (i / 24) * Math.PI * 2;
    const localX = Math.cos(a) * halfW;
    const localY = Math.sin(a) * len * 0.5 + len * 0.45;
    pts.push([lon + localX * px + localY * dx, lat + localX * py + localY * dy]);
  }
  pts.push(pts[0]);
  return pts;
};

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

const buildLayers = (
  payload: AirshedNetworkPayload,
  step: AirshedTimeStep,
  clusterFilter: number | null,
  metric: string,
): { pins: FC; edges: FC; pulses: FC; plumes: FC } => {
  const coords = new Map<string, [number, number]>();
  const visible = Object.entries(step.nodes).filter(
    ([, n]) => clusterFilter === null || n.cluster_id === clusterFilter,
  );

  visible.forEach(([id, n]) => coords.set(id, [n.longitude, n.latitude]));

  const pins: FC = {
    type: 'FeatureCollection',
    features: visible.map(([id, n]) => {
      const hazard = getHazardStyle(n.chhi_score);
      return {
        type: 'Feature',
        properties: {
          id,
          name: n.city_name,
          cluster_id: n.cluster_id,
          color: clusterColor(n.cluster_id, payload),
          ring: hazard.color,
          value: Math.round(metricValue(n, metric)),
          trigger: n.is_trigger_active ? 1 : 0,
        },
        geometry: { type: 'Point', coordinates: [n.longitude, n.latitude] },
      };
    }),
  };

  const edges: FC = {
    type: 'FeatureCollection',
    features: payload.causal_edges
      .filter((e) => {
        if (!coords.has(e.source_node) || !coords.has(e.target_node)) return false;
        if (clusterFilter === null) return true;
        return e.cluster_id === clusterFilter;
      })
      .map((e) => ({
        type: 'Feature',
        properties: {
          color: clusterColor(e.cluster_id, payload),
          weight: Math.max(0.15, Math.min(1, Math.abs(e.correlation_coefficient))),
        },
        geometry: {
          type: 'LineString',
          coordinates: [coords.get(e.source_node)!, coords.get(e.target_node)!],
        },
      })),
  };

  const pulses: FC = {
    type: 'FeatureCollection',
    features: step.active_cascade_pulses
      .filter((p) => coords.has(p.source_node) && coords.has(p.target_node))
      .map((p) => ({
        type: 'Feature',
        properties: { id: p.pulse_id, confidence: p.confidence_pct },
        geometry: {
          type: 'Point',
          coordinates: interpolate(coords.get(p.source_node)!, coords.get(p.target_node)!, p.progress_ratio),
        },
      })),
  };

  const plumes: FC = {
    type: 'FeatureCollection',
    features: visible.map(([id, n]) => ({
      type: 'Feature',
      properties: {
        id,
        fill: hexToRgba(clusterColor(n.cluster_id, payload), 0.18),
        stroke: hexToRgba(clusterColor(n.cluster_id, payload), 0.55),
      },
      geometry: { type: 'Polygon', coordinates: [plumeRing(n.longitude, n.latitude, n.wind_u, n.wind_v)] },
    })),
  };

  return { pins, edges, pulses, plumes };
};

export default function AirshedNetworkMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pulseT = useRef(0);
  const raf = useRef<number>(0);

  const payload = useAirshedStore((s) => s.payload);
  const selectedSubStep = useAirshedStore((s) => s.selectedSubStep);
  const selectedCityId = useAirshedStore((s) => s.selectedCityId);
  const selectedClusterFilter = useAirshedStore((s) => s.selectedClusterFilter);
  const selectedMetric = useAirshedStore((s) => s.selectedMetric);
  const layerVisibility = useAirshedStore((s) => s.layerVisibility);
  const setCityId = useAirshedStore((s) => s.setCityId);

  const step = payload?.time_steps[selectedSubStep] ?? payload?.time_steps[0];

  const geo = useMemo(() => {
    if (!payload || !step) return { pins: emptyFC(), edges: emptyFC(), pulses: emptyFC(), plumes: emptyFC() };
    return buildLayers(payload, step, selectedClusterFilter, selectedMetric);
  }, [payload, step, selectedClusterFilter, selectedMetric]);

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
      instance.addSource('plumes', { type: 'geojson', data: emptyFC() });
      instance.addSource('edges', { type: 'geojson', data: emptyFC() });
      instance.addSource('pins', { type: 'geojson', data: emptyFC() });
      instance.addSource('pulses', { type: 'geojson', data: emptyFC() });

      instance.addLayer({
        id: 'plumes-fill',
        type: 'fill',
        source: 'plumes',
        paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 0.85 },
      });
      instance.addLayer({
        id: 'plumes-line',
        type: 'line',
        source: 'plumes',
        paint: { 'line-color': ['get', 'stroke'], 'line-width': 1.2, 'line-opacity': 0.7 },
      });
      instance.addLayer({
        id: 'edges-glow',
        type: 'line',
        source: 'edges',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['get', 'weight'], 0.15, 1.2, 1, 3.4],
          'line-opacity': 0.22,
          'line-blur': 1.4,
        },
      });
      instance.addLayer({
        id: 'edges-core',
        type: 'line',
        source: 'edges',
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['get', 'weight'], 0.15, 0.6, 1, 1.6],
          'line-opacity': 0.55,
          'line-dasharray': [2, 1.4],
        },
      });
      instance.addLayer({
        id: 'pin-rings',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'trigger'], 1], 16, 11],
          'circle-color': 'rgba(0,0,0,0)',
          'circle-stroke-width': 2,
          'circle-stroke-color': ['get', 'ring'],
          'circle-opacity': 0.15,
          'circle-stroke-opacity': 0.85,
        },
      });
      instance.addLayer({
        id: 'pin-cores',
        type: 'circle',
        source: 'pins',
        paint: {
          'circle-radius': 5.5,
          'circle-color': ['get', 'color'],
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#0a0a0a',
        },
      });
      instance.addLayer({
        id: 'pin-labels',
        type: 'symbol',
        source: 'pins',
        layout: {
          'text-field': ['concat', ['get', 'name'], '\n', ['to-string', ['get', 'value']]],
          'text-size': 10,
          'text-offset': [0, 1.35],
          'text-anchor': 'top',
        },
        paint: {
          'text-color': '#e5e5e5',
          'text-halo-color': '#0a0a0a',
          'text-halo-width': 1.2,
        },
      });
      instance.addLayer({
        id: 'cascade-pulses',
        type: 'circle',
        source: 'pulses',
        paint: {
          'circle-radius': 7,
          'circle-color': '#38bdf8',
          'circle-blur': 0.15,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#f97316',
          'circle-opacity': 0.95,
        },
      });

      instance.on('click', 'pin-cores', (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) setCityId(id);
      });
      instance.on('mouseenter', 'pin-cores', () => {
        instance.getCanvas().style.cursor = 'pointer';
      });
      instance.on('mouseleave', 'pin-cores', () => {
        instance.getCanvas().style.cursor = '';
      });

      const tick = () => {
        pulseT.current += 0.045;
        if (instance.getLayer('edges-core')) {
          const op = 0.38 + 0.22 * Math.sin(pulseT.current);
          instance.setPaintProperty('edges-core', 'line-opacity', op);
          instance.setPaintProperty('pin-rings', 'circle-radius', [
            'case',
            ['==', ['get', 'trigger'], 1],
            14 + 4 * (0.5 + 0.5 * Math.sin(pulseT.current * 1.6)),
            10 + 2.5 * (0.5 + 0.5 * Math.sin(pulseT.current)),
          ]);
          instance.setPaintProperty(
            'cascade-pulses',
            'circle-radius',
            6 + 3 * (0.5 + 0.5 * Math.sin(pulseT.current * 2)),
          );
        }
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf.current);
      instance.remove();
      map.current = null;
    };
  }, [setCityId]);

  useEffect(() => {
    const instance = map.current;
    if (!instance) return;

    const apply = () => {
      if (!instance.getSource('pins')) return;
      const setData = (id: string, data: FC) => {
        const src = instance.getSource(id) as maplibregl.GeoJSONSource | undefined;
        src?.setData(data as never);
      };
      setData('pins',   geo.pins);
      setData('edges',  geo.edges);
      setData('pulses', geo.pulses);
      setData('plumes', geo.plumes);
    };

    // Case 1: Map is fully ready right now — apply immediately
    if (instance.isStyleLoaded() && instance.getSource('pins')) {
      apply();
      return;
    }

    // Case 2: Map style is loaded but sources not added yet (shouldn't happen, but guard anyway)
    if (instance.isStyleLoaded()) {
      const onSourceData = () => {
        if (instance.getSource('pins')) {
          apply();
          instance.off('sourcedata', onSourceData);
        }
      };
      instance.on('sourcedata', onSourceData);
      return () => instance.off('sourcedata', onSourceData);
    }

    // Case 3: Map hasn't loaded yet — wait for 'load' then apply
    const onLoad = () => apply();
    instance.once('load', onLoad);
    return () => instance.off('load', onLoad);
  }, [geo]);

  useEffect(() => {
    const instance = map.current;
    if (!instance?.isStyleLoaded()) return;
    const vis = (id: string, on: boolean) => {
      if (instance.getLayer(id)) instance.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    vis('edges-glow', layerVisibility.edges);
    vis('edges-core', layerVisibility.edges);
    vis('cascade-pulses', layerVisibility.pulses);
    vis('plumes-fill', layerVisibility.plumes);
    vis('plumes-line', layerVisibility.plumes);
    vis('pin-rings', layerVisibility.pins);
    vis('pin-cores', layerVisibility.pins);
    vis('pin-labels', layerVisibility.pins);
  }, [layerVisibility]);

  useEffect(() => {
    markers.current.forEach((m) => m.remove());
    markers.current = [];
    const instance = map.current;
    if (!instance || !step) return;
    const node = step.nodes[selectedCityId];
    if (!node) return;
    const el = document.createElement('div');
    el.style.cssText = `
      width: 18px; height: 18px; border-radius: 999px;
      border: 2px solid #4285f4;
      background: transparent;
      pointer-events: none;
    `;
    const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
      .setLngLat([node.longitude, node.latitude])
      .addTo(instance);
    markers.current = [marker];
  }, [selectedCityId, step]);

  return <div ref={mapContainer} className="absolute inset-0 w-full h-full" />;
}
