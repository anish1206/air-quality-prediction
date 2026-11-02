/**
 * WeatherLabRasterLayer — IDW-interpolated pollution field rendered as
 * stepped severity bands, styled after weather-radar / Google Weather Lab.
 *
 * Produces one continuous scalar field across India using Shepard IDW from
 * station readings, quantises into discrete colour bands, and pushes the
 * result as a MapLibre image source.
 */

import type * as maplibregl from 'maplibre-gl';
import type { CityNodeStatus } from '../../types/airshed';

// ── Config constants ──────────────────────────────────────────────────────────
const GRID_W = 240;
const GRID_H = 270;
const IDW_POWER = 2.5;
const MAX_RADIUS_DEG = 4.5;
const COVERAGE_SIGMA_DEG = 2.2;
const BLUR_RADIUS = 2;
const STYLE_MODE: 'radar' | 'smooth' = 'radar';

const BAND_THRESHOLDS = [10, 20, 30, 40, 50, 60, 75, 90];
const BAND_COLORS: Array<{ r: number; g: number; b: number; a: number }> = [
    { r: 0, g: 0, b: 0, a: 0 },  // 0–10:  invisible
    { r: 134, g: 239, b: 172, a: 0.30 },   // 10–20: #86efac
    { r: 74, g: 222, b: 128, a: 0.38 },   // 20–30: #4ade80
    { r: 163, g: 230, b: 53, a: 0.45 },   // 30–40: #a3e635
    { r: 250, g: 204, b: 21, a: 0.50 },   // 40–50: #facc15
    { r: 251, g: 146, b: 60, a: 0.55 },   // 50–60: #fb923c
    { r: 239, g: 68, b: 68, a: 0.60 },   // 60–75: #ef4444
    { r: 185, g: 28, b: 28, a: 0.66 },   // 75–90: #b91c1c
    { r: 127, g: 29, b: 29, a: 0.72 },   // 90+:   #7f1d1d
];

// India bounding box
const BOUNDS = { minLon: 68.0, maxLon: 92.0, minLat: 8.0, maxLat: 36.0 };

export const WEATHERLAB_COORDS: [
    [number, number], [number, number], [number, number], [number, number]
] = [
        [BOUNDS.minLon, BOUNDS.maxLat],
        [BOUNDS.maxLon, BOUNDS.maxLat],
        [BOUNDS.maxLon, BOUNDS.minLat],
        [BOUNDS.minLon, BOUNDS.minLat],
    ];

const SOURCE_ID = 'weatherlab-raster';
const LAYER_ID = 'weatherlab-overlay';

// ── Web Mercator helpers ──────────────────────────────────────────────────────
function mercY(lat: number): number {
    const rad = lat * Math.PI / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function invMercY(y: number): number {
    return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI;
}

const MERC_Y_MIN = mercY(BOUNDS.minLat);
const MERC_Y_MAX = mercY(BOUNDS.maxLat);

// Row index → latitude (evenly spaced in Mercator Y)
function rowToLat(row: number): number {
    const t = row / (GRID_H - 1);
    const my = MERC_Y_MAX - t * (MERC_Y_MAX - MERC_Y_MIN); // top row = maxLat
    return invMercY(my);
}

// Col index → longitude
function colToLon(col: number): number {
    return BOUNDS.minLon + (col / (GRID_W - 1)) * (BOUNDS.maxLon - BOUNDS.minLon);
}

// ── Metric normalisation ──────────────────────────────────────────────────────
function normalise(val: number, metric: string): number {
    if (metric === 'us_aqi') return Math.min(100, (val / 300) * 100);
    if (metric === 'pm2_5') return Math.min(100, (val / 150) * 100);
    if (metric === 'nitrogen_dioxide') return Math.min(100, (val / 200) * 100);
    return Math.min(100, val); // chhi_score already 0–100
}

function metricVal(n: CityNodeStatus, metric: string): number {
    if (metric === 'us_aqi') return n.us_aqi ?? 0;
    if (metric === 'pm2_5') return n.pm2_5 ?? 0;
    if (metric === 'nitrogen_dioxide') return n.nitrogen_dioxide ?? 0;
    return n.chhi_score ?? 0;
}

// ── Smoothstep ────────────────────────────────────────────────────────────────
function smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
}

// ── Band lookup ───────────────────────────────────────────────────────────────
function bandIndex(v: number): number {
    for (let i = 0; i < BAND_THRESHOLDS.length; i++) {
        if (v < BAND_THRESHOLDS[i]) return i;
    }
    return BAND_THRESHOLDS.length;
}

function bandColor(v: number): { r: number; g: number; b: number; a: number } {
    if (STYLE_MODE === 'smooth') {
        const idx = bandIndex(v);
        if (idx === 0) return BAND_COLORS[0];
        if (idx >= BAND_COLORS.length - 1) return BAND_COLORS[BAND_COLORS.length - 1];
        const lo = idx === 0 ? 0 : BAND_THRESHOLDS[idx - 1];
        const hi = BAND_THRESHOLDS[idx];
        const t = (v - lo) / (hi - lo);
        const a = BAND_COLORS[idx], b = BAND_COLORS[idx + 1];
        return {
            r: a.r + t * (b.r - a.r),
            g: a.g + t * (b.g - a.g),
            b: a.b + t * (b.b - a.b),
            a: a.a + t * (b.a - a.a),
        };
    }
    return BAND_COLORS[bandIndex(v)];
}

// ── Separable box blur on a Float32 grid ──────────────────────────────────────
function boxBlur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
    const dst = new Float32Array(w * h);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0, count = 0;
            for (let dx = -radius; dx <= radius; dx++) {
                const nx = x + dx;
                if (nx >= 0 && nx < w) { sum += src[y * w + nx]; count++; }
            }
            dst[y * w + x] = sum / count;
        }
    }

    const out = new Float32Array(w * h);
    // Vertical pass
    for (let x = 0; x < w; x++) {
        for (let y = 0; y < h; y++) {
            let sum = 0, count = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                const ny = y + dy;
                if (ny >= 0 && ny < h) { sum += dst[ny * w + x]; count++; }
            }
            out[y * w + x] = sum / count;
        }
    }
    return out;
}

// ── Off-screen canvas ─────────────────────────────────────────────────────────
let _canvas: HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | null = null;

function getCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
    if (!_canvas) {
        _canvas = document.createElement('canvas');
        _canvas.width = GRID_W;
        _canvas.height = GRID_H;
        _ctx = _canvas.getContext('2d', { willReadFrequently: true })!;
    }
    return { canvas: _canvas, ctx: _ctx! };
}

// ── Main renderer ─────────────────────────────────────────────────────────────
interface StationEntry { lon: number; lat: number; val: number }

export function renderWeatherLabField(
    nodes: Record<string, CityNodeStatus>,
    metric: string,
): HTMLCanvasElement | null {
    const { canvas, ctx } = getCanvas();

    const entries: StationEntry[] = [];
    for (const n of Object.values(nodes)) {
        if (n.data_available === false || n.pm2_5 === null || n.pm2_5 === undefined) continue;
        const raw = metricVal(n, metric);
        if (raw <= 0) continue;
        entries.push({ lon: n.longitude, lat: n.latitude, val: normalise(raw, metric) });
    }

    if (entries.length === 0) {
        ctx.clearRect(0, 0, GRID_W, GRID_H);
        return canvas;
    }

    // Pre-compute cos(lat) for each station for longitude distance correction
    const cosLats = entries.map(e => Math.cos(e.lat * Math.PI / 180));

    // Build scalar field + coverage mask via IDW
    const field = new Float32Array(GRID_W * GRID_H);
    const coverage = new Float32Array(GRID_W * GRID_H);

    const maxR2 = MAX_RADIUS_DEG * MAX_RADIUS_DEG;
    const sig2 = COVERAGE_SIGMA_DEG * COVERAGE_SIGMA_DEG;

    for (let row = 0; row < GRID_H; row++) {
        const lat = rowToLat(row);
        const cosLat = Math.cos(lat * Math.PI / 180);

        for (let col = 0; col < GRID_W; col++) {
            const lon = colToLon(col);
            let wSum = 0, vSum = 0, maxCov = 0;

            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                const dLon = (lon - e.lon) * cosLat;
                const dLat = lat - e.lat;
                const d2 = dLon * dLon + dLat * dLat;

                if (d2 > maxR2) continue;

                const d = Math.sqrt(d2);
                const w = 1 / (Math.pow(d, IDW_POWER) + 1e-6);
                wSum += w;
                vSum += w * e.val;

                const cov = Math.exp(-d2 / sig2);
                if (cov > maxCov) maxCov = cov;
            }

            const idx = row * GRID_W + col;
            field[idx] = wSum > 0 ? vSum / wSum : 0;
            coverage[idx] = maxCov;
        }
    }

    // Smooth IDW bullseyes
    const smoothed = boxBlur(field, GRID_W, GRID_H, BLUR_RADIUS);

    // Write pixels
    const imgData = ctx.createImageData(GRID_W, GRID_H);
    const px = imgData.data;

    for (let i = 0; i < GRID_W * GRID_H; i++) {
        const v = smoothed[i];
        const cov = smoothstep(0.08, 0.5, coverage[i]);
        const c = bandColor(v);

        const off = i * 4;
        const a = c.a * cov;
        // Pre-multiply alpha for correct compositing
        px[off] = (c.r * a) | 0;
        px[off + 1] = (c.g * a) | 0;
        px[off + 2] = (c.b * a) | 0;
        px[off + 3] = (a * 255) | 0;
    }

    ctx.putImageData(imgData, 0, 0);

    // Light 1px alpha-only blur for band anti-aliasing (draw over self with slight blur)
    const tmp = document.createElement('canvas');
    tmp.width = GRID_W;
    tmp.height = GRID_H;
    const tctx = tmp.getContext('2d')!;
    tctx.filter = 'blur(0.6px)';
    tctx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, GRID_W, GRID_H);
    ctx.drawImage(tmp, 0, 0);

    return canvas;
}

// ── Blob URL management (faster than toDataURL) ──────────────────────────────
let _prevUrl: string | null = null;

function canvasToBlobUrl(canvas: HTMLCanvasElement): Promise<string> {
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (_prevUrl) URL.revokeObjectURL(_prevUrl);
            const url = URL.createObjectURL(blob!);
            _prevUrl = url;
            resolve(url);
        }, 'image/png');
    });
}

// ── MapLibre integration ──────────────────────────────────────────────────────
export function addWeatherLabLayer(map: maplibregl.Map): void {
    if (map.getSource(SOURCE_ID)) return;

    const blank = document.createElement('canvas');
    blank.width = blank.height = 1;

    map.addSource(SOURCE_ID, {
        type: 'image',
        url: blank.toDataURL(),
        coordinates: WEATHERLAB_COORDS,
    });

    // Insert below the first symbol layer so basemap labels stay on top
    const layers = map.getStyle().layers || [];
    let beforeId: string | undefined;
    for (const l of layers) {
        if (l.type === 'symbol') { beforeId = l.id; break; }
    }

    map.addLayer({
        id: LAYER_ID,
        type: 'raster',
        source: SOURCE_ID,
        paint: {
            'raster-opacity': 0.85,
            'raster-resampling': STYLE_MODE === 'radar' ? 'nearest' : 'linear',
            'raster-fade-duration': 300,
        },
    }, beforeId);
}

// Debounce timer for update calls
let _updateTimer: ReturnType<typeof setTimeout> | null = null;

export function updateWeatherLabImage(
    map: maplibregl.Map,
    nodes: Record<string, CityNodeStatus>,
    metric: string,
): void {
    if (_updateTimer) clearTimeout(_updateTimer);
    _updateTimer = setTimeout(() => {
        const src = map.getSource(SOURCE_ID) as maplibregl.ImageSource | undefined;
        if (!src) return;

        const canvas = renderWeatherLabField(nodes, metric);
        if (!canvas) return;

        canvasToBlobUrl(canvas).then((url) => {
            src.updateImage({ url, coordinates: WEATHERLAB_COORDS });
        });
    }, 150);
}

export function setWeatherLabVisibility(map: maplibregl.Map, visible: boolean): void {
    if (map.getLayer(LAYER_ID)) {
        map.setLayoutProperty(LAYER_ID, 'visibility', visible ? 'visible' : 'none');
    }
}

export { LAYER_ID as WEATHERLAB_LAYER_ID, SOURCE_ID as WEATHERLAB_SOURCE_ID };
