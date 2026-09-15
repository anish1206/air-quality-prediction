/**
 * WeatherLabRasterLayer — Google WeatherLab–style stepped threshold cloud layer.
 *
 * Renders an off-screen HTMLCanvasElement (512×512) using IDW-interpolated
 * field values from city nodes, then pushes the result as a MapLibre
 * `image` source covering India. No dummy point grids, no heatmap — pure
 * geo-correct raster overlay with zero zoom artifacts.
 *
 * Color palette (stepped, matching WeatherLab reflectivity):
 *   0–20   → transparent (clear)
 *   20–35  → pale sage          rgba(110,230,110, α)
 *   35–50  → warm yellow        rgba(240,220, 50, α)
 *   50–65  → vivid orange       rgba(250,140, 20, α)
 *   65–80  → deep crimson       rgba(210, 20, 40, α)
 *   80–100 → electric violet    rgba(170, 40,210, α)
 */

import type * as maplibregl from 'maplibre-gl';
import type { CityNodeStatus } from '../../types/airshed';

// ── Constants ────────────────────────────────────────────────────────────────
const CANVAS_SIZE = 512;

// India bounding box [west, east, south, north]
const BOUNDS = { minLon: 68.0, maxLon: 92.0, minLat: 8.0, maxLat: 36.0 };

// MapLibre image source corners: [[NW], [NE], [SE], [SW]]
export const WEATHERLAB_COORDS: [[number, number], [number, number], [number, number], [number, number]] = [
    [BOUNDS.minLon, BOUNDS.maxLat],
    [BOUNDS.maxLon, BOUNDS.maxLat],
    [BOUNDS.maxLon, BOUNDS.minLat],
    [BOUNDS.minLon, BOUNDS.minLat],
];

// Stepped threshold colour stops [minVal, maxVal, r, g, b, alpha]
const STEPS: [number, number, number, number, number, number][] = [
    [0,   20,  0,   0,   0,   0],      // clear — transparent
    [20,  35,  100, 230, 110, 0.28],   // sage green
    [35,  50,  240, 220,  50, 0.40],   // warm yellow
    [50,  65,  250, 140,  20, 0.52],   // vivid orange
    [65,  80,  210,  20,  40, 0.64],   // deep crimson
    [80, 100,  170,  40, 210, 0.75],   // electric violet
];

// IDW power parameter
const IDW_P = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────
interface NodeEntry { lon: number; lat: number; value: number }

function idwValue(lon: number, lat: number, nodes: NodeEntry[]): number {
    let wSum = 0, vSum = 0;
    for (const n of nodes) {
        const d2 = Math.pow(lon - n.lon, IDW_P) + Math.pow(lat - n.lat, IDW_P) + 1e-6;
        const w = 1 / d2;
        wSum += w;
        vSum += w * n.value;
    }
    return wSum > 0 ? vSum / wSum : 0;
}

function valueToColor(v: number): [number, number, number, number] {
    for (const [lo, hi, r, g, b, a] of STEPS) {
        if (v >= lo && v < hi) {
            // smooth within-band fraction for soft anti-aliasing
            const frac = (v - lo) / (hi - lo);
            return [r, g, b, a * (0.7 + 0.3 * frac)];
        }
    }
    // clamp to last step
    const last = STEPS[STEPS.length - 1];
    return [last[2], last[3], last[4], last[5]];
}

// ── Off-screen canvas renderer ────────────────────────────────────────────────
let _offCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let _offCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null = null;

function getOffCanvas(): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D } {
    if (!_offCanvas) {
        if (typeof OffscreenCanvas !== 'undefined') {
            _offCanvas = new OffscreenCanvas(CANVAS_SIZE, CANVAS_SIZE);
            _offCtx = _offCanvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        } else {
            const c = document.createElement('canvas');
            c.width = c.height = CANVAS_SIZE;
            _offCanvas = c;
            _offCtx = c.getContext('2d')!;
        }
    }
    return { canvas: _offCanvas!, ctx: _offCtx! };
}

/**
 * Renders the WeatherLab field into the off-screen canvas and returns
 * an ImageData-compatible object ready for maplibre `map.addImage` /
 * `(source as ImageSource).updateImage`.
 */
export function renderWeatherLabField(
    nodes: Record<string, CityNodeStatus>,
    metric: string,
): HTMLCanvasElement | ImageBitmap | null {
    const { ctx } = getOffCanvas();

    // Build node list for IDW
    const entries: NodeEntry[] = Object.values(nodes).map((n) => ({
        lon: n.longitude,
        lat: n.latitude,
        value: metricVal(n, metric),
    }));

    if (entries.length === 0) return null;

    const idata = ctx.createImageData(CANVAS_SIZE, CANVAS_SIZE);
    const px = idata.data;

    const lonRange = BOUNDS.maxLon - BOUNDS.minLon;
    const latRange = BOUNDS.maxLat - BOUNDS.minLat;

    for (let row = 0; row < CANVAS_SIZE; row++) {
        // top of canvas = maxLat, bottom = minLat
        const lat = BOUNDS.maxLat - (row / (CANVAS_SIZE - 1)) * latRange;
        for (let col = 0; col < CANVAS_SIZE; col++) {
            const lon = BOUNDS.minLon + (col / (CANVAS_SIZE - 1)) * lonRange;
            const v = idwValue(lon, lat, entries);
            const [r, g, b, a] = valueToColor(v);
            const i = (row * CANVAS_SIZE + col) * 4;
            px[i]     = r;
            px[i + 1] = g;
            px[i + 2] = b;
            px[i + 3] = Math.round(a * 255);
        }
    }

    ctx.putImageData(idata, 0, 0);

    // Return as HTMLCanvasElement for maplibre addImage
    if (_offCanvas instanceof HTMLCanvasElement) return _offCanvas;

    // OffscreenCanvas path — convert to ImageBitmap async isn't ideal here,
    // so fall back to a regular canvas copy
    const fallback = document.createElement('canvas');
    fallback.width = fallback.height = CANVAS_SIZE;
    const fctx = fallback.getContext('2d')!;
    fctx.putImageData(idata, 0, 0);
    return fallback;
}

// ── Metric accessor ───────────────────────────────────────────────────────────
function metricVal(n: CityNodeStatus, metric: string): number {
    if (metric === 'us_aqi') return n.us_aqi;
    if (metric === 'pm2_5') return n.pm2_5;
    if (metric === 'nitrogen_dioxide') return n.nitrogen_dioxide;
    return n.chhi_score;
}

// ── MapLibre source/layer registration ───────────────────────────────────────
const SOURCE_ID = 'weatherlab-raster';
const LAYER_ID  = 'weatherlab-overlay';

export function addWeatherLabLayer(map: maplibregl.Map): void {
    if (map.getSource(SOURCE_ID)) return;

    // Create a blank 1×1 transparent placeholder image
    const blank = document.createElement('canvas');
    blank.width = blank.height = 1;

    map.addSource(SOURCE_ID, {
        type: 'image',
        url: blank.toDataURL(),
        coordinates: WEATHERLAB_COORDS,
    });

    map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
            'raster-opacity': 0.82,
            'raster-resampling': 'linear',
            'raster-fade-duration': 300,
        },
    }, 'atmospheric-city-halos'); // insert below halos so city dots are on top
}

export function updateWeatherLabImage(
    map: maplibregl.Map,
    nodes: Record<string, CityNodeStatus>,
    metric: string,
): void {
    const src = map.getSource(SOURCE_ID);
    if (!src) return;

    const canvas = renderWeatherLabField(nodes, metric);
    if (!canvas || !(canvas instanceof HTMLCanvasElement)) return;

    const url = canvas.toDataURL('image/png');
    (src as maplibregl.ImageSource).updateImage({ url, coordinates: WEATHERLAB_COORDS });
}

export function setWeatherLabVisibility(map: maplibregl.Map, visible: boolean): void {
    if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
}

export { LAYER_ID as WEATHERLAB_LAYER_ID, SOURCE_ID as WEATHERLAB_SOURCE_ID };
