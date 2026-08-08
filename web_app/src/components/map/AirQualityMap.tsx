import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useAppStore } from '../../store/appStore';

// Pune Neighborhood Grid Points for the Cloud Overlay
const PUNE_GRID_POINTS = [
  { name: 'Shivajinagar', coords: [73.8446, 18.5314], weightMult: 1.0 },
  { name: 'Swargate', coords: [73.8567, 18.5010], weightMult: 1.15 },
  { name: 'Kothrud', coords: [73.8070, 18.5080], weightMult: 0.85 },
  { name: 'Bhosari PCMC', coords: [73.8375, 18.6186], weightMult: 1.3 },
  { name: 'Katraj', coords: [73.8591, 18.4529], weightMult: 0.9 },
  { name: 'Hinjewadi', coords: [73.7380, 18.5912], weightMult: 1.1 },
  { name: 'Hadapsar', coords: [73.9260, 18.5180], weightMult: 1.2 },
  { name: 'Viman Nagar', coords: [73.9140, 18.5670], weightMult: 0.95 },
  { name: 'Aundh', coords: [73.8070, 18.5590], weightMult: 0.88 },
];

export default function AirQualityMap() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const { selectedTimestamp, selectedPollutant } = useAppStore();

  // Helper to construct GeoJSON for the Hazard Cloud
  const createGeoJSON = (timeOffset: number) => {
    // Base AQI fluctuates realistically based on timestamp (-3 to +3)
    const baseAqi = 85 + timeOffset * 3.5 + Math.sin(timeOffset) * 8;

    return {
      type: 'FeatureCollection',
      features: PUNE_GRID_POINTS.map((pt) => ({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: pt.coords,
        },
        properties: {
          intensity: Math.max(10, baseAqi * pt.weightMult),
        },
      })),
    };
  };

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    // Initialize MapLibre with Carto Dark Base
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [73.8567, 18.5204], // Centered on Pune
      zoom: 11,
      pitch: 30, // Slight 3D tilt for scientific tool perspective
    });

    map.current.addControl(new maplibregl.NavigationControl({}), 'bottom-right');

    map.current.on('load', () => {
      if (!map.current) return;

      // 1. Add GeoJSON Source
      map.current.addSource('hazard-cloud-source', {
        type: 'geojson',
        data: createGeoJSON(selectedTimestamp) as any,
      });

      // 2. Add Heatmap "Atmospheric Cloud" Layer
      map.current.addLayer({
        id: 'hazard-cloud-layer',
        type: 'heatmap',
        source: 'hazard-cloud-source',
        maxzoom: 15,
        paint: {
          // Increase weight based on intensity
          'heatmap-weight': [
            'interpolate',
            ['linear'],
            ['get', 'intensity'],
            0, 0,
            150, 1,
          ],
          // Increase intensity as zoom level increases
          'heatmap-intensity': [
            'interpolate',
            ['linear'],
            ['zoom'],
            0, 1,
            15, 3,
          ],
          // Smooth hazard color gradient (Emerald -> Amber -> Orange -> Deep Red)
          'heatmap-color': [
            'interpolate',
            ['linear'],
            ['heatmap-density'],
            0, 'rgba(0, 0, 0, 0)',
            0.2, 'rgba(16, 185, 129, 0.4)',  // Good (Green)
            0.4, 'rgba(245, 158, 11, 0.5)',  // Moderate (Amber)
            0.7, 'rgba(249, 115, 22, 0.7)',  // Unhealthy (Orange)
            1.0, 'rgba(225, 29, 72, 0.85)',   // Hazardous (Red)
          ],
          // Adjust blur radius for smooth volumetric cloud effect
          'heatmap-radius': [
            'interpolate',
            ['linear'],
            ['zoom'],
            9, 65,    // Increased from 35 -> 65 (city-wide overview)
            12, 120,  // Added explicit city-level zoom (Pune view)
            14, 190,  // Increased from 80 -> 190 (zoomed-in neighborhood view)
            ],
            
          // Keep semi-transparent so dark base map remains visible underneath
          'heatmap-opacity': 0.75,
        },
      });
    });

    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Update Cloud in real-time when timeline slider or pollutant changes
  useEffect(() => {
    if (!map.current) return;
    const source = map.current.getSource('hazard-cloud-source') as maplibregl.GeoJSONSource;
    if (source) {
      source.setData(createGeoJSON(selectedTimestamp) as any);
    }
  }, [selectedTimestamp, selectedPollutant]);

  return <div ref={mapContainer} className="w-full h-full" />;
}