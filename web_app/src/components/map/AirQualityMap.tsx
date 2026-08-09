import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '../../store/appStore';

// ── Stations ──────────────────────────────────────────────────────────────────
const PUNE_STATIONS = [
  { name: 'Shivajinagar', coords: [73.8446, 18.5314] as [number, number], weightMult: 1.00 },
  { name: 'Swargate',     coords: [73.8567, 18.5010] as [number, number], weightMult: 1.15 },
  { name: 'Kothrud',      coords: [73.8070, 18.5080] as [number, number], weightMult: 0.85 },
  { name: 'Bhosari PCMC', coords: [73.8375, 18.6186] as [number, number], weightMult: 1.35 },
  { name: 'Katraj',       coords: [73.8591, 18.4529] as [number, number], weightMult: 0.90 },
  { name: 'Hinjewadi',    coords: [73.7380, 18.5912] as [number, number], weightMult: 1.20 },
  { name: 'Hadapsar',     coords: [73.9260, 18.5180] as [number, number], weightMult: 1.25 },
  { name: 'Viman Nagar',  coords: [73.9140, 18.5670] as [number, number], weightMult: 0.95 },
  { name: 'Aundh',        coords: [73.8070, 18.5590] as [number, number], weightMult: 0.88 },
];

// ── Pollutant-specific colour palettes ────────────────────────────────────────
const POLLUTANT_PALETTES: Record<string, any> = {
  us_aqi: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.2, 'rgba(16, 185, 129, 0.45)',   // Green
    0.4, 'rgba(245, 158,  11, 0.55)',  // Amber
    0.7, 'rgba(249, 115,  22, 0.75)',  // Orange
    1.0, 'rgba(225,  29,  72, 0.90)',  // Red
  ],
  pm2_5: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.2, 'rgba(6,  182, 212, 0.45)',   // Cyan
    0.5, 'rgba(234, 179,   8, 0.65)',  // Gold
    0.8, 'rgba(239,  68,  68, 0.85)',  // Bright Red
    1.0, 'rgba(168,  85, 247, 0.95)',  // Magenta
  ],
  pm10: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.2, 'rgba(217, 119,   6, 0.45)',  // Ochre
    0.6, 'rgba(180,  83,   9, 0.65)',  // Rust
    1.0, 'rgba(120,  53,  15, 0.90)',  // Dark Earth
  ],
  nitrogen_dioxide: [
    'interpolate', ['linear'], ['heatmap-density'],
    0,   'rgba(0,0,0,0)',
    0.3, 'rgba(139,  92, 246, 0.50)',  // Violet
    0.7, 'rgba(192,  38, 211, 0.75)',  // Neon Pink
    1.0, 'rgba(244,  63,  94, 0.95)',  // Crimson
  ],
};

// ── Wind-vector plume generator ───────────────────────────────────────────────
// For each station we emit PLUME_STEPS micro-particles stretched downwind,
// decaying in intensity, which turns circular blobs into realistic asymmetric plumes.
const PLUME_STEPS = 6;

const createPlumeGeoJSON = (timeOffset: number, pollutant: string) => {
  // Pollutant-specific base values and sensitivity to time
  const bases: Record<string, number> = {
    us_aqi:           85 + timeOffset * 4.0 + Math.sin(timeOffset) * 6,
    pm2_5:            38 + timeOffset * 1.8 + Math.cos(timeOffset) * 4,
    pm10:             60 + timeOffset * 2.5 + Math.sin(timeOffset * 0.8) * 5,
    nitrogen_dioxide: 28 + timeOffset * 1.2 + Math.cos(timeOffset * 1.2) * 3,
  };
  const baseVal = bases[pollutant] ?? bases.us_aqi;

  // Wind vector: Pune predominantly experiences W→E and S→N flow.
  // We modulate slightly by timeOffset to simulate diurnal variation.
  const windU = 0.009 + Math.cos(timeOffset * 0.5) * 0.004; // eastward  (longitude shift per step)
  const windV = 0.004 + Math.sin(timeOffset * 0.5) * 0.002; // northward (latitude  shift per step)

  const features: any[] = [];

  PUNE_STATIONS.forEach((st) => {
    const stationVal = Math.max(5, baseVal * st.weightMult);

    for (let i = 0; i < PLUME_STEPS; i++) {
      // Intensity decays exponentially downwind — gives a comet-tail shape
      const decay = Math.pow(0.72, i);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [
            st.coords[0] + windU * i,
            st.coords[1] + windV * i,
          ],
        },
        properties: {
          intensity: stationVal * decay,
        },
      });
    }
  });

  return { type: 'FeatureCollection', features };
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirQualityMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map          = useRef<maplibregl.Map | null>(null);
  const { selectedTimestamp, selectedPollutant } = useAppStore();

  // Stable refs so the update effect always sees the latest values without
  // needing to re-register the map load listener.
  const tsRef        = useRef(selectedTimestamp);
  const pollutantRef = useRef(selectedPollutant);
  tsRef.current       = selectedTimestamp;
  pollutantRef.current = selectedPollutant;

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style:  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [73.8567, 18.5204],
      zoom:   11,
      pitch:  25,
    });

    map.current.addControl(new maplibregl.NavigationControl({}), 'bottom-right');

    map.current.on('load', () => {
      if (!map.current) return;

      map.current.addSource('plume-source', {
        type: 'geojson',
        data: createPlumeGeoJSON(tsRef.current, pollutantRef.current),
      });

      map.current.addLayer({
        id:      'plume-layer',
        type:    'heatmap',
        source:  'plume-source',
        maxzoom: 15,
        paint: {
          // Weight proportional to intensity value
          'heatmap-weight': [
            'interpolate', ['linear'], ['get', 'intensity'],
            0, 0, 200, 1,
          ],
          // Intensity ramps with zoom so plumes stay vivid when zoomed in
          'heatmap-intensity': [
            'interpolate', ['linear'], ['zoom'],
            9, 0.8, 12, 1.4, 15, 2.5,
          ],
          // Colour set by active pollutant (updated dynamically)
          'heatmap-color': POLLUTANT_PALETTES[pollutantRef.current] ?? POLLUTANT_PALETTES.us_aqi,
          // Larger radius = softer, more atmospheric plume
          'heatmap-radius': [
            'interpolate', ['linear'], ['zoom'],
            9, 55, 12, 115, 14, 185,
          ],
          'heatmap-opacity': 0.78,
        },
      });
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // ── Update plume data + palette when timestamp or pollutant changes ────────
  useEffect(() => {
    if (!map.current) return;

    const updateLayer = () => {
      if (!map.current) return;

      // 1. Reshape plume geometry (wind vector changes with time)
      const src = map.current.getSource('plume-source') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(createPlumeGeoJSON(selectedTimestamp, selectedPollutant));
      }

      // 2. Swap colour palette for the selected pollutant
      if (map.current.getLayer('plume-layer')) {
        const palette = POLLUTANT_PALETTES[selectedPollutant] ?? POLLUTANT_PALETTES.us_aqi;
        map.current.setPaintProperty('plume-layer', 'heatmap-color', palette);
      }
    };

    // If the map style hasn't fully loaded yet, wait for it
    if (map.current.isStyleLoaded()) {
      updateLayer();
    } else {
      map.current.once('load', updateLayer);
    }
  }, [selectedTimestamp, selectedPollutant]);

  return <div ref={mapContainer} className="w-full h-full" />;
}
