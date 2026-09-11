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

// ── Pollutant colour palettes ─────────────────────────────────────────────────
const POLLUTANT_PALETTES: Record<string, any> = {
  us_aqi: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)', 0.2, 'rgba(16,185,129,0.45)',
    0.4, 'rgba(245,158,11,0.55)', 0.7, 'rgba(249,115,22,0.75)',
    1.0, 'rgba(225,29,72,0.90)',
  ],
  pm2_5: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)', 0.2, 'rgba(6,182,212,0.45)',
    0.5, 'rgba(234,179,8,0.65)', 0.8, 'rgba(239,68,68,0.85)',
    1.0, 'rgba(168,85,247,0.95)',
  ],
  pm10: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)', 0.2, 'rgba(217,119,6,0.45)',
    0.6, 'rgba(180,83,9,0.65)', 1.0, 'rgba(120,53,15,0.90)',
  ],
  nitrogen_dioxide: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)', 0.3, 'rgba(139,92,246,0.50)',
    0.7, 'rgba(192,38,211,0.75)', 1.0, 'rgba(244,63,94,0.95)',
  ],
  chhi_score: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)',
    0.25, 'rgba(16, 185, 129, 0.4)',
    0.50, 'rgba(245, 158, 11, 0.55)',
    0.75, 'rgba(249, 115, 22, 0.75)',
    1.00, 'rgba(225, 29, 72, 0.90)',
  ],
  temp: [
    'interpolate', ['linear'], ['heatmap-density'],
    0, 'rgba(0,0,0,0)',
    0.3, 'rgba(59, 130, 246, 0.45)',
    0.75, 'rgba(245, 158, 11, 0.65)',
    1.0, 'rgba(239, 68, 68, 0.85)',
  ],
};

// ── Sub-daily wind data (mirrors pune_data.json, keyed by step) ──────────────
// wind_speed in km/h, wind_dir in degrees
// Rather than importing the JSON (circular dep), we inline the same values.
const WIND_DATA: { speed: number; dir: number }[] = [
  // T-3 (steps 0-5)
  {speed:4.2,dir:220},{speed:3.8,dir:205},{speed:6.5,dir:245},{speed:18.2,dir:280},{speed:21.4,dir:295},{speed:9.1,dir:255},
  // T-2 (steps 6-11)
  {speed:5.1,dir:210},{speed:4.4,dir:198},{speed:7.8,dir:238},{speed:19.6,dir:272},{speed:22.8,dir:288},{speed:10.3,dir:248},
  // T-1 (steps 12-17)
  {speed:4.8,dir:230},{speed:4.1,dir:215},{speed:6.9,dir:250},{speed:17.4,dir:275},{speed:20.1,dir:290},{speed:8.6,dir:260},
  // T   (steps 18-23)
  {speed:4.6,dir:218},{speed:3.9,dir:202},{speed:7.2,dir:242},{speed:16.8,dir:278},{speed:20.4,dir:292},{speed:8.8,dir:252},
  // T+1 (steps 24-29)
  {speed:5.0,dir:222},{speed:4.2,dir:208},{speed:7.6,dir:246},{speed:17.9,dir:276},{speed:21.2,dir:290},{speed:9.4,dir:256},
  // T+2 (steps 30-35)
  {speed:5.3,dir:225},{speed:4.6,dir:211},{speed:8.1,dir:249},{speed:18.6,dir:279},{speed:22.1,dir:293},{speed:10.2,dir:258},
  // T+3 (steps 36-41)
  {speed:5.1,dir:220},{speed:4.3,dir:206},{speed:7.8,dir:244},{speed:18.1,dir:277},{speed:21.6,dir:291},{speed:9.8,dir:254},
];

// ── Pollutant base values per sub-step ───────────────────────────────────────
const AQI_DATA   = [118.2,122.5,115.3,98.4,94.1,110.8,109.4,113.1,106.7,91.2,87.9,103.2,106.2,110.4,103.8,88.1,84.3,101.5,92.4,96.8,90.1,74.3,70.8,88.2,89.3,93.6,87.4,71.8,68.4,85.1,91.6,95.9,89.8,73.4,70.1,87.6,90.4,94.7,88.6,72.1,68.9,86.4];
const PM25_DATA  = [42.1,44.8,39.6,31.2,28.9,38.4,49.2,51.6,47.3,38.4,36.1,44.8,39.8,42.1,38.2,29.6,27.1,35.8,31.2,33.4,29.8,22.1,20.4,28.9,29.8,32.1,28.2,21.4,19.8,27.4,31.0,33.2,29.4,22.8,21.2,28.6,30.4,32.6,28.8,21.8,20.2,28.1];
const PM10_DATA  = [67.3,70.1,63.4,52.8,49.7,61.2,51.8,54.2,49.1,39.8,37.5,47.1,44.2,46.8,41.5,33.2,31.4,40.1,48.1,51.2,46.4,37.8,35.9,44.6,46.2,49.1,44.3,36.1,34.2,42.8,47.8,50.4,45.6,37.4,35.6,43.9,47.1,49.8,44.9,36.8,34.9,43.2];
const NO2_DATA   = [11.2,12.1,13.8,7.9,6.4,10.1,12.3,13.1,14.6,8.2,6.9,9.8,12.8,13.6,15.2,8.6,7.1,9.9,23.4,25.1,28.6,16.2,14.1,19.8,21.1,22.8,25.4,15.2,13.4,18.2,22.2,23.9,26.8,15.8,14.2,19.4,21.8,23.4,26.1,15.5,13.8,19.1];
const CHHI_DATA  = [31.8, 31.3, 38.0, 43.4, 35.4, 31.1, 27.7, 26.5, 31.1, 34.6, 35.5, 29.8, 30.9, 30.1, 33.7, 40.5, 39.0, 32.4, 29.7, 29.4, 33.6, 40.0, 36.2, 31.1, 34.6, 41.8, 39.7, 33.3, 30.8, 29.9, 34.3, 42.2, 40.0, 33.6, 31.0, 30.2, 34.9, 42.9, 41.2, 34.9, 32.3, 31.3];
const TEMP_DATA  = [22.6, 22.4, 24.6, 26.7, 24.0, 22.7, 23.1, 22.9, 25.0, 27.2, 25.1, 23.5, 22.8, 22.5, 24.8, 26.9, 24.2, 22.9, 22.6, 22.3, 24.5, 26.6, 23.9, 22.6, 23.0, 22.7, 24.9, 27.0, 24.3, 23.0, 23.2, 22.9, 25.1, 27.3, 24.5, 23.1, 22.9, 22.6, 24.7, 26.8, 24.1, 22.8];

const POLLUTANT_SERIES: Record<string, number[]> = {
  us_aqi: AQI_DATA, pm2_5: PM25_DATA, pm10: PM10_DATA, nitrogen_dioxide: NO2_DATA, chhi_score: CHHI_DATA, temp: TEMP_DATA,
};

// Convert met wind direction + speed into lon/lat displacement components
// Met convention: dir = direction FROM which wind blows (0=N, 90=E, 180=S, 270=W)
// Positive U = eastward, positive V = northward
const windToUV = (speedKmh: number, dirDeg: number) => {
  const rad  = dirDeg * (Math.PI / 180);
  const norm = speedKmh / 1000; // scale to degree-fraction per step
  const U    = -norm * Math.sin(rad); // eastward component
  const V    = -norm * Math.cos(rad); // northward component
  return { U, V };
};

const PUNE_BOUNDS = {
  minLon: 73.50,
  maxLon: 74.20,
  minLat: 18.25,
  maxLat: 18.80,
};

const createPlumeGeoJSON = (subStep: number, pollutant: string) => {
  const wind = WIND_DATA[subStep] ?? { speed: 8, dir: 270 };
  const { U, V } = windToUV(wind.speed, wind.dir);
  const series = POLLUTANT_SERIES[pollutant] ?? AQI_DATA;
  const baseVal = series[subStep] ?? 80;

  // Scale plume stretch based on wind speed
  const stretch = Math.min(wind.speed / 10, 2.5);

  const gridCols = 40;
  const gridRows = 40;
  const features: any[] = [];

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      // Base grid coordinates
      const baseLon = PUNE_BOUNDS.minLon + (c / (gridCols - 1)) * (PUNE_BOUNDS.maxLon - PUNE_BOUNDS.minLon);
      const baseLat = PUNE_BOUNDS.minLat + (r / (gridRows - 1)) * (PUNE_BOUNDS.maxLat - PUNE_BOUNDS.minLat);

      // Center coordinates
      const cLon = 73.8567;
      const cLat = 18.5204;
      const dLonC = baseLon - cLon;
      const dLatC = baseLat - cLat;
      const dCenter = Math.sqrt(dLonC * dLonC + dLatC * dLatC);

      // Multi-frequency wave perturbation to simulate organic cloud/plume turbulence
      const radialWave = Math.sin(dCenter * 140 - subStep * 0.15);
      const cellPattern = Math.sin(baseLon * 160) * Math.cos(baseLat * 160);
      const windWave = Math.sin((baseLon * U + baseLat * V) * 300 + subStep * 0.3);
      
      const noise = radialWave * 0.4 + cellPattern * 0.4 + windWave * 0.2;
      
      const rippleAmp = 0.007 + 0.004 * Math.min(wind.speed / 8, 2.5);
      const lon = baseLon + noise * rippleAmp;
      const lat = baseLat + noise * rippleAmp;

      // Advection/Shift: Sample the station readings backwards along the wind vector
      const sampleLon = lon - U * stretch * 0.55;
      const sampleLat = lat - V * stretch * 0.55;

      // Calculate Inverse Distance Weighting (IDW)
      let weightedSum = 0;
      let sumOfWeights = 0;
      let minDistance = Infinity;

      for (const st of PUNE_STATIONS) {
        const stationVal = Math.max(5, baseVal * st.weightMult);
        
        const dLon = sampleLon - st.coords[0];
        const dLat = sampleLat - st.coords[1];
        const dist = Math.sqrt(dLon * dLon + dLat * dLat);

        if (dist < minDistance) {
          minDistance = dist;
        }

        // IDW weight calculation (power of 2)
        const weight = 1 / (dist * dist + 0.0008);
        weightedSum += stationVal * weight;
        sumOfWeights += weight;
      }

      const rawVal = sumOfWeights > 0 ? weightedSum / sumOfWeights : 0;

      // Gaussian decay based on distance to nearest station to ensure smooth fading before grid boundary
      const decayRadius = 0.085 + 0.02 * Math.min(wind.speed / 15, 1.0); // wider dispersion when windy
      const falloff = Math.exp(-Math.pow(minDistance / decayRadius, 2));
      const intensity = rawVal * falloff;

      if (intensity > 1.5) {
        features.push({
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [lon, lat],
          },
          properties: { intensity },
        });
      }
    }
  }

  return { type: 'FeatureCollection', features };
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function AirQualityMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map          = useRef<maplibregl.Map | null>(null);
  const { selectedSubStep, selectedPollutant } = useAppStore();

  const subStepRef    = useRef(selectedSubStep);
  const pollutantRef  = useRef(selectedPollutant);
  subStepRef.current   = selectedSubStep;
  pollutantRef.current = selectedPollutant;

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [73.8567, 18.5204],
      zoom: 11,
      pitch: 25,
    });
    map.current.addControl(new maplibregl.NavigationControl({}), 'bottom-right');

    map.current.on('load', () => {
      if (!map.current) return;
      map.current.addSource('plume-source', {
        type: 'geojson',
        data: createPlumeGeoJSON(subStepRef.current, pollutantRef.current) as any,
      });

      // Dynamic radius: wider when wind is strong (afternoon dispersion)
      const wind = WIND_DATA[subStepRef.current] ?? { speed: 8, dir: 270 };
      const radiusBoost = 1 + Math.min(wind.speed / 25, 0.8);

      map.current.addLayer({
        id: 'plume-layer',
        type: 'heatmap',
        source: 'plume-source',
        maxzoom: 15,
        paint: {
          'heatmap-weight':     ['interpolate', ['linear'], ['get', 'intensity'], 0, 0, 200, 1],
          'heatmap-intensity':  ['interpolate', ['linear'], ['zoom'], 9, 0.8, 12, 1.4, 15, 2.5],
          'heatmap-color':       POLLUTANT_PALETTES[pollutantRef.current] ?? POLLUTANT_PALETTES.us_aqi,
          'heatmap-radius':     [
            'interpolate', ['linear'], ['zoom'],
            9, 30 * radiusBoost, 12, 65 * radiusBoost, 14, 110 * radiusBoost,
          ],
          'heatmap-opacity': 0.78,
        },
      });
    });

    return () => { map.current?.remove(); map.current = null; };
  }, []);

  // ── Update plume + palette when sub-step or pollutant changes ──────────────
  useEffect(() => {
    if (!map.current) return;

    const updateLayer = () => {
      if (!map.current) return;

      const src = map.current.getSource('plume-source') as maplibregl.GeoJSONSource | undefined;
      if (src) {
        src.setData(createPlumeGeoJSON(selectedSubStep, selectedPollutant) as any);
      }

      if (map.current.getLayer('plume-layer')) {
        map.current.setPaintProperty('plume-layer', 'heatmap-color',
          POLLUTANT_PALETTES[selectedPollutant] ?? POLLUTANT_PALETTES.us_aqi);

        // Adjust radius based on current wind speed
        const wind = WIND_DATA[selectedSubStep] ?? { speed: 8, dir: 270 };
        const rb = 1 + Math.min(wind.speed / 25, 0.8);
        map.current.setPaintProperty('plume-layer', 'heatmap-radius', [
          'interpolate', ['linear'], ['zoom'],
          9, 30 * rb, 12, 65 * rb, 14, 110 * rb,
        ]);
      }
    };

    if (map.current.isStyleLoaded()) updateLayer();
    else map.current.once('load', updateLayer);
  }, [selectedSubStep, selectedPollutant]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* ── Floating CHHI Map Legend ── */}
      <div
        className="absolute bottom-[88px] right-14 z-10 pointer-events-none"
        style={{
          background: 'rgba(0,0,0,0.72)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: '14px',
          padding: '10px 13px',
          minWidth: '168px',
        }}
      >
        <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-1.5">
          Compound Health Risk (CHHI)
        </div>
        {/* Color gradient bar */}
        <div
          className="h-[6px] w-full rounded-full mb-1"
          style={{
            background: 'linear-gradient(90deg, rgba(16,185,129,0.9) 0%, rgba(245,158,11,0.9) 40%, rgba(249,115,22,0.9) 70%, rgba(225,29,72,0.9) 100%)',
          }}
        />
        {/* Scale markers */}
        <div className="flex justify-between text-[8px] text-white/40 mb-1.5">
          <span>0</span>
          <span>25</span>
          <span>50</span>
          <span>75</span>
          <span>100</span>
        </div>
        {/* Category labels */}
        <div className="flex justify-between text-[8px]">
          <span style={{ color: '#10b981' }}>Low</span>
          <span style={{ color: '#f59e0b' }}>Moderate</span>
          <span style={{ color: '#f97316' }}>High</span>
          <span style={{ color: '#e11d48' }}>Critical</span>
        </div>
        <div className="text-[7px] text-white/25 mt-1.5 text-center">
          Heat Index + Smog Chemistry
        </div>
      </div>
    </div>
  );
}
