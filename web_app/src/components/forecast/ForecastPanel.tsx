import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  useAirshedStore,
  SLOT_TIMES,
  SLOT_LABELS,
  stepToDayOffset,
  stepToSlot,
  toSubStep,
} from '../../store/airshedStore';
import type { AirshedNetworkPayload } from '../../types/airshed';
import { CITY_META } from '../../lib/cityMeta';
import { buildCityForecast, clusterLabel, cityLabel, formatEta } from '../../lib/airshedSelectors';

// ── Data types ────────────────────────────────────────────────────────────────
export interface SubSlot {
  time: string;
  date_str: string;
  chhi_score: number;
  hazard_category: string;
  us_aqi: number;
  pm2_5: number;
  pm10: number;
  nitrogen_dioxide: number;
  wind_speed: number;
  wind_dir: number;
  temp: number;
}

export interface DayData {
  offset: number;
  label: string;
  date_str: string;
  chhi_score: number;
  us_aqi: number;
  pm2_5: number;
  temp_max: number;
  temp_min: number;
  wind_speed_max: number;
  isObserved: boolean;
  sub_daily: SubSlot[];
}

interface Props {
  payload: AirshedNetworkPayload;
  onClose: () => void;
}

// ── Layout ────────────────────────────────────────────────────────────────────
const CONTENT_W   = 760;
const COLLAPSED_W = 480;
const LABEL_COL   = 80;
const N_COLS      = 7;
const CHART_GRID  = { top: 16, right: 12, bottom: 4, left: LABEL_COL };

const S = {
  dataGrid: { display: 'grid', gridTemplateColumns: `${LABEL_COL}px repeat(${N_COLS}, minmax(0, 1fr))` } as React.CSSProperties,
  rowGrid:  { display: 'grid', gridTemplateColumns: `${LABEL_COL}px 1fr` } as React.CSSProperties,
};

// Flatten all sub-daily slots into a single 42-element array in day order
const flattenSubDaily = (data: DayData[]): SubSlot[] =>
  [...data].sort((a, b) => a.offset - b.offset).flatMap((d) => d.sub_daily);

// ── CHHI helpers ──────────────────────────────────────────────────────────────
const getHazardLevel = (score: number) => {
  if (score <= 25) return { label: 'Low Risk',        color: '#10b981', bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.25)' };
  if (score <= 50) return { label: 'Moderate Hazard', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' };
  if (score <= 75) return { label: 'High Health Risk',color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' };
  return                 { label: 'Critical Hazard',  color: '#e11d48', bg: 'rgba(225,29,72,0.08)',  border: 'rgba(225,29,72,0.25)'  };
};

const getAdvisory = (score: number) => {
  if (score <= 25) return 'Safe for all outdoor activities and exercise.';
  if (score <= 50) return 'Unusually sensitive individuals should limit prolonged outdoor exertion.';
  if (score <= 75) return 'Asthma & Cardiac Alert: Restrict strenuous outdoor activities during peak hours.';
  return                  'Severe Compound Threat: Avoid outdoor exposure. Keep windows closed.';
};

// ── Colour helpers ────────────────────────────────────────────────────────────
const getAqiColor = (v: number) => {
  if (v <= 50)  return 'bg-[#b8dfbd] text-[#111]';
  if (v <= 100) return 'bg-[#f0d36b] text-[#111]';
  if (v <= 150) return 'bg-[#e9897f] text-[#111]';
  if (v <= 200) return 'bg-[#c95b5b] text-white';
  return 'bg-[#913f4a] text-white';
};
const getPm25Color = (v: number) => {
  if (v <= 30) return 'bg-[#b9ddc4] text-[#111]';
  if (v <= 60) return 'bg-[#e6d58b] text-[#111]';
  if (v <= 90) return 'bg-[#e49a78] text-[#111]';
  return 'bg-[#c95b5b] text-white';
};

// ── Wind arrow ────────────────────────────────────────────────────────────────
function WindArrow({ deg, size = 16 }: { deg: number; size?: number }) {
  const goingDeg = (deg + 180) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      style={{ transform: `rotate(${goingDeg}deg)`, display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

// ── ECharts generic line chart ────────────────────────────────────────────────
const createLineChart = (
  el: HTMLDivElement,
  values: number[],
  unit: string,
  lineColor: string,
  activeIdx: number,
  allSlots: SubSlot[],
) => {
  const existing = echarts.getInstanceByDom(el);
  if (existing) existing.dispose();

  const xLabels = values.map((_, i) => {
    const day  = Math.floor(i / 6);
    const slot = i % 6;
    return slot === 0 ? `D${day - 3}` : SLOT_TIMES[slot];
  });

  const chart = echarts.init(el);
  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#111', borderColor: '#303030', borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params: any[]) => {
        if (!params?.length) return '';
        const p = params[0];
        const i = p.dataIndex as number;
        const s = allSlots[i];
        if (!s) return '';
        return `<div style="font-size:10px;color:#888;margin-bottom:2px">${s.date_str} ${s.time}</div>
                <div style="font-size:13px;font-weight:500;color:#fff">${p.value}${unit}</div>`;
      },
    },
    grid: CHART_GRID,
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: '#303030' } },
      axisTick: { show: false },
      axisLabel: { show: true, color: '#555', fontSize: 9, interval: (i: number) => i % 6 === 0 },
      splitLine: { show: true, interval: (i: number) => i % 6 === 0, lineStyle: { color: '#252525', type: 'solid' } },
    },
    yAxis: {
      type: 'value', axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#777', fontSize: 10 },
      splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
    },
    series: [
      {
        type: 'line', data: values, smooth: true, symbol: 'none',
        lineStyle: { color: lineColor, width: 2 },
        itemStyle: { color: lineColor },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${lineColor}28` },
            { offset: 1, color: `${lineColor}00` },
          ]),
        },
        markLine: {
          silent: true, symbol: 'none', label: { show: false },
          data: [{ xAxis: activeIdx, lineStyle: { color: 'rgba(56,189,248,0.55)', type: 'solid', width: 1 } }],
        },
      },
      {
        type: 'scatter', data: [[activeIdx, values[activeIdx]]],
        symbol: 'circle', symbolSize: 7,
        itemStyle: { color: '#fff', borderColor: lineColor, borderWidth: 2 },
        z: 10,
      },
    ],
  });

  return chart;
};

// ── CHHI chart with hazard bands ──────────────────────────────────────────────
const createChhiChart = (
  el: HTMLDivElement,
  values: number[],
  activeIdx: number,
  allSlots: SubSlot[],
) => {
  const existing = echarts.getInstanceByDom(el);
  if (existing) existing.dispose();

  const xLabels = values.map((_, i) => {
    const slot = i % 6;
    return slot === 0 ? `D${Math.floor(i / 6) - 3}` : SLOT_TIMES[slot];
  });

  const chart = echarts.init(el);
  chart.setOption({
    backgroundColor: 'transparent',
    animation: false,
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#111', borderColor: '#303030', borderWidth: 1,
      textStyle: { color: '#fff', fontSize: 12 },
      formatter: (params: any[]) => {
        if (!params?.length) return '';
        const p = params[0];
        const s = allSlots[p.dataIndex as number];
        if (!s) return '';
        const h = getHazardLevel(s.chhi_score ?? 35);
        return `<div style="font-size:10px;color:#888;margin-bottom:2px">${s.date_str} ${s.time}</div>
                <div style="font-size:13px;font-weight:500;color:${h.color}">${(s.chhi_score ?? 0).toFixed(1)} <span style="font-size:10px;color:#888">/ 100 · ${h.label}</span></div>`;
      },
    },
    grid: CHART_GRID,
    xAxis: {
      type: 'category', data: xLabels, boundaryGap: false,
      axisLine: { lineStyle: { color: '#303030' } },
      axisTick: { show: false },
      axisLabel: { show: true, color: '#555', fontSize: 9, interval: (i: number) => i % 6 === 0 },
      splitLine: { show: true, interval: (i: number) => i % 6 === 0, lineStyle: { color: '#252525', type: 'solid' } },
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      axisLine: { show: false }, axisTick: { show: false },
      axisLabel: { color: '#555', fontSize: 9 },
      splitLine: { lineStyle: { color: '#2a2a2a', type: 'dashed' } },
    },
    series: [
      {
        type: 'line', data: values, smooth: true, symbol: 'none',
        lineStyle: { color: '#f97316', width: 2 },
        itemStyle: { color: '#f97316' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(249,115,22,0.22)' },
            { offset: 1, color: 'rgba(249,115,22,0.01)' },
          ]),
        },
        markArea: {
          silent: true,
          data: [
            [{ yAxis: 0,  itemStyle: { color: 'rgba(16,185,129,0.05)'  } }, { yAxis: 25  }],
            [{ yAxis: 25, itemStyle: { color: 'rgba(245,158,11,0.05)'  } }, { yAxis: 50  }],
            [{ yAxis: 50, itemStyle: { color: 'rgba(249,115,22,0.06)'  } }, { yAxis: 75  }],
            [{ yAxis: 75, itemStyle: { color: 'rgba(225,29,72,0.07)'   } }, { yAxis: 100 }],
          ],
        },
        markLine: {
          silent: true, symbol: 'none', label: { show: false },
          data: [
            { yAxis: 25,  lineStyle: { color: 'rgba(16,185,129,0.2)',  type: 'dashed', width: 1 } },
            { yAxis: 50,  lineStyle: { color: 'rgba(245,158,11,0.2)',  type: 'dashed', width: 1 } },
            { yAxis: 75,  lineStyle: { color: 'rgba(249,115,22,0.2)',  type: 'dashed', width: 1 } },
            { xAxis: activeIdx, lineStyle: { color: 'rgba(56,189,248,0.55)', type: 'solid', width: 1 } },
          ],
        },
      },
      {
        type: 'scatter', data: [[activeIdx, values[activeIdx]]],
        symbol: 'circle', symbolSize: 7,
        itemStyle: { color: '#fff', borderColor: '#f97316', borderWidth: 2 },
        z: 10,
      },
    ],
  });

  return chart;
};

// ── Component ─────────────────────────────────────────────────────────────────
export default function ForecastPanel({ payload, onClose }: Props) {
  const chhiChartElRef = useRef<HTMLDivElement>(null);
  const aqiChartRef  = useRef<HTMLDivElement>(null);
  const pm25ChartRef = useRef<HTMLDivElement>(null);
  const tempChartRef = useRef<HTMLDivElement>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  const { selectedSubStep, setSubStep, setTimestamp, selectedCityId } = useAirshedStore();
  const data = useMemo(() => buildCityForecast(payload, selectedCityId) as DayData[], [payload, selectedCityId]);
  const activeNode = payload.time_steps[selectedSubStep]?.nodes[selectedCityId];
  const meta = CITY_META[selectedCityId];
  const incoming = (payload.time_steps[selectedSubStep]?.active_cascade_pulses ?? []).filter(
    (p) => p.target_node === selectedCityId,
  );
  const originName = incoming[0] ? cityLabel(incoming[0].source_node, payload.time_steps[selectedSubStep]?.nodes[incoming[0].source_node]) : '';

  const dayOffset  = stepToDayOffset(selectedSubStep);
  const slotIdx    = stepToSlot(selectedSubStep);
  const isObserved = selectedSubStep < 24;

  const allSlots   = flattenSubDaily(data);
  const activeSlot = allSlots[selectedSubStep] ?? allSlots[18];
  const activeChhi = activeSlot?.chhi_score ?? 35;
  const hazard     = getHazardLevel(activeChhi);

  // ── Charts ────────────────────────────────────────────────────────────────
  const initChart = (
    ref: React.RefObject<HTMLDivElement | null>,
    values: number[],
    unit: string,
    color: string,
  ) => {
    if (!ref.current || !allSlots.length) return;
    const chart = createLineChart(ref.current, values, unit, color, selectedSubStep, allSlots);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  };

  // CHHI chart
  useEffect(() => {
    if (!chhiChartElRef.current || !allSlots.length) return;
    const values = allSlots.map((s) => s.chhi_score ?? 35);
    const chart = createChhiChart(chhiChartElRef.current, values, selectedSubStep, allSlots);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(chhiChartElRef.current);
    return () => { ro.disconnect(); chart.dispose(); };
  }, [data, selectedSubStep]);

  useEffect(() => initChart(aqiChartRef,  allSlots.map((s) => s.us_aqi),  '',       '#42b7e8'), [data, selectedSubStep]);
  useEffect(() => initChart(pm25ChartRef, allSlots.map((s) => s.pm2_5),   ' µg/m³', '#79c7a2'), [data, selectedSubStep]);
  useEffect(() => initChart(tempChartRef, allSlots.map((s) => s.temp),    '°C',     '#e5a06f'), [data, selectedSubStep]);

  const DividerRow = ({ left, children }: { left: React.ReactNode; children: React.ReactNode }) => (
    <div style={S.rowGrid} className="border-b border-[#252525]">
      <div className="py-2 text-[11px] text-white">{left}</div>
      <div className="grid grid-cols-7">{children}</div>
    </div>
  );

  return (
    <aside
      style={{ width: isExpanded ? `${CONTENT_W}px` : `${COLLAPSED_W}px` }}
      className="
        absolute right-4 top-16 bottom-4 z-30 overflow-hidden
        rounded-[26px] border border-[#303030]
        bg-[#090909] shadow-[0_16px_60px_rgba(0,0,0,0.65)]
        text-white transition-[width] duration-300 ease-in-out
        flex flex-col
      "
    >
      {/* ── HEADER ── */}
      <div className="flex h-[70px] shrink-0 items-center border-b border-[#252525] px-5">
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center text-[#4285f4]">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="text-[16px] font-medium tracking-[-0.1px] text-white truncate">
              {activeNode?.city_name ?? meta?.name ?? selectedCityId}, {meta?.state ?? 'India'}
            </div>
            <div className="mt-[2px] text-[11px] text-[#8a8a8a] truncate font-mono">
              {activeNode ? `${activeNode.latitude.toFixed(4)}°N, ${activeNode.longitude.toFixed(4)}°E` : ''}
              &nbsp;·&nbsp;{activeSlot?.date_str} · {activeSlot?.time} IST
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 pl-3">
          <button type="button" onClick={() => setIsExpanded((v) => !v)}
            className="text-[#777] transition hover:text-white"
            title={isExpanded ? 'Collapse' : 'Expand'}>
            {isExpanded ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v5H3"/><path d="M16 21v-5h5"/><path d="M3 8l7 7"/><path d="M21 16l-7-7"/>
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
              </svg>
            )}
          </button>
          <button type="button" onClick={onClose}
            className="text-[#777] transition hover:text-white" title="Close">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
            </svg>
          </button>
        </div>
      </div>

      {/* ── BODY ── */}
      <div
        className="relative flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#3a3a3a_transparent]"
        style={{ overflowX: isExpanded ? 'hidden' : 'auto' }}
      >
        <div style={{ width: `${CONTENT_W}px`, minHeight: '100%', position: 'relative' }}>
          <div className="relative z-10 px-5 pb-8">

            <div className="mt-4 mb-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/50">Airshed Regime</span>
              <span
                className="text-[10px] px-2.5 py-1 rounded-full border"
                style={{
                  color: '#38bdf8',
                  borderColor: 'rgba(56,189,248,0.35)',
                  background: 'rgba(56,189,248,0.08)',
                }}
              >
                {activeNode ? clusterLabel(activeNode.cluster_id, payload) : '—'}
              </span>
              <span className="text-[10px] font-mono text-white/40">
                {isObserved ? 'OBSERVED' : 'FORECAST'} · {SLOT_LABELS[slotIdx]}
              </span>
            </div>

            {incoming[0] && (
              <div className="mb-4 rounded-[12px] border border-[#f97316]/40 bg-[#f97316]/10 px-3 py-2.5 text-[11px] leading-relaxed">
                <span className="font-semibold text-[#f97316]">⚠️ INCOMING CASCADE:</span>
                <span className="text-white/85">
                  {' '}Origin: {originName} ({incoming[0].source_node}) • ETA: {formatEta(incoming[0].estimated_arrival_ist)} • Confidence: {incoming[0].confidence_pct.toFixed(1)}% • ΔPM2.5: +{incoming[0].severity_delta_pm25.toFixed(0)} µg/m³
                </span>
              </div>
            )}

            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
              Forecast · 7 Days · 42 Sub-Daily Slots
            </div>

            {/* ── Date header grid ── */}
            <div style={S.dataGrid} className="border-b border-[#303030]">
              <div className="flex items-center pb-2 text-[12px] font-medium text-white">Date</div>
              {data.map((d) => (
                <button key={`date-${d.offset}`} type="button"
                  onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                  className="border-l border-[#252525] px-1 pb-2 text-center text-white transition hover:opacity-80">
                  <div className="text-[11px] font-medium">{d.date_str}</div>
                </button>
              ))}
            </div>

            {/* ── Sub-slot row ── */}
            <div style={S.dataGrid} className="border-b border-[#252525]">
              <div className="py-2 text-[11px] text-white">Time</div>
              {data.map((d) => {
                const isActiveDay = d.offset === dayOffset;
                return (
                  <div key={`slots-${d.offset}`} className="border-l border-[#252525] py-1 flex flex-col gap-[2px] items-center">
                    {SLOT_TIMES.map((t, si) => {
                      const step = toSubStep(d.offset, si);
                      const isActiveSlot = step === selectedSubStep;
                      return (
                        <button key={t} type="button" onClick={() => setSubStep(step)}
                          className={`text-[8px] px-1 py-0.5 rounded transition w-full text-center
                            ${isActiveSlot
                              ? 'bg-[#1769d1] text-white font-medium'
                              : isActiveDay
                              ? 'text-white hover:text-white hover:bg-white/5'
                              : 'text-white hover:text-white hover:bg-white/5'
                            }`}>
                          {t}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* ══ CHHI HERO ═══════════════════════════════════════════════ */}
            <section className="mt-6">
              <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
                Compound Health Hazard Index (CHHI)
              </div>

              {/* Score + badge row */}
              <div
                className="flex items-center justify-between rounded-[12px] px-4 py-3 mb-3"
                style={{ background: hazard.bg, border: `1px solid ${hazard.border}` }}
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[36px] font-bold leading-none" style={{ color: hazard.color }}>
                    {activeChhi.toFixed(1)}
                  </span>
                  <span className="text-[15px] text-white/30">/ 100</span>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ color: hazard.color, background: `${hazard.color}22`, border: `1px solid ${hazard.border}` }}
                  >
                    {hazard.label}
                  </span>
                  <span className="text-[10px] text-white/40 text-right max-w-[180px] leading-snug">
                    {getAdvisory(activeChhi)}
                  </span>
                </div>
              </div>

              {/* CHHI per-day grid */}
              <div style={S.rowGrid} className="items-center">
                <div className="pr-2">
                  <div
                    className="flex h-[36px] flex-col items-start justify-center rounded-[7px] px-2"
                    style={{ background: hazard.bg, border: `1px solid ${hazard.border}` }}
                  >
                    <span className="text-[13px] font-medium leading-none" style={{ color: hazard.color }}>CHHI</span>
                    <span className="text-[10px] leading-none mt-0.5 text-white/40">/ 100</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {data.map((d) => {
                    const h = getHazardLevel(d.chhi_score ?? 35);
                    const isActive = d.offset === dayOffset;
                    return (
                      <button
                        key={`chhi-${d.offset}`} type="button"
                        onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                        className="h-[36px] rounded-[7px] text-[13px] font-semibold transition"
                        style={{
                          background: h.bg, color: h.color,
                          border: `1px solid ${isActive ? h.color : h.border}`,
                          boxShadow: isActive ? `0 0 0 2px ${h.color}55` : 'none',
                        }}
                      >
                        {(d.chhi_score ?? 0).toFixed(0)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <DividerRow left="Hazard">
                {data.map((d) => {
                  const h = getHazardLevel(d.chhi_score ?? 35);
                  return (
                    <div key={`chhi-h-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[9px]"
                      style={{ color: h.color }}>
                      {h.label.split(' ')[0]}
                    </div>
                  );
                })}
              </DividerRow>

              {/* CHHI chart */}
              <div className="mt-1">
                <div ref={chhiChartElRef} className="h-[140px] w-full" />
              </div>
            </section>

            {/* ══ US AQI ════════════════════════════════════════════════════ */}
            <section className="mt-5">
              <div style={S.rowGrid} className="items-center">
                <div className="pr-2">
                  <div className="flex h-[36px] flex-col items-start justify-center rounded-[7px] bg-[#1769d1] px-2">
                    <span className="text-[13px] font-medium text-white leading-none">US AQI</span>
                    <span className="text-[10px] text-white/50 leading-none mt-0.5">index</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {data.map((d) => (
                    <button key={`aqi-${d.offset}`} type="button"
                      onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                      className={`h-[36px] rounded-[7px] text-[13px] font-semibold transition
                        ${getAqiColor(d.us_aqi)}
                        ${d.offset === dayOffset ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Math.round(d.us_aqi)}
                    </button>
                  ))}
                </div>
              </div>
              <DividerRow left="Status">
                {data.map((d) => (
                  <div key={`aqi-s-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[10px] text-white/60">
                    {d.isObserved ? 'Observed' : 'Predicted'}
                  </div>
                ))}
              </DividerRow>
              <div className="mt-1"><div ref={aqiChartRef} className="h-[140px] w-full" /></div>
            </section>

            {/* ══ PM 2.5 ════════════════════════════════════════════════════ */}
            <section className="mt-5">
              <div style={S.rowGrid} className="items-center">
                <div className="pr-2">
                  <div className="flex h-[36px] flex-col items-start justify-center rounded-[7px] bg-[#1769d1] px-2">
                    <span className="text-[13px] font-medium text-white leading-none">PM 2.5</span>
                    <span className="text-[10px] text-white/50 leading-none mt-0.5">µg/m³</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {data.map((d) => (
                    <button key={`pm-${d.offset}`} type="button"
                      onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                      className={`h-[36px] rounded-[7px] text-[13px] font-semibold transition
                        ${getPm25Color(d.pm2_5)}
                        ${d.offset === dayOffset ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Number(d.pm2_5).toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
              <DividerRow left="Unit">
                {data.map((d) => (
                  <div key={`pm-u-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[10px] text-white/60">µg/m³</div>
                ))}
              </DividerRow>
              <div className="mt-1"><div ref={pm25ChartRef} className="h-[140px] w-full" /></div>
            </section>

            {/* ══ TEMPERATURE ═══════════════════════════════════════════════ */}
            <section className="mt-5">
              <div style={S.rowGrid} className="items-center">
                <div className="pr-2">
                  <div className="flex h-[36px] flex-col items-start justify-center rounded-[7px] bg-[#1769d1] px-2">
                    <span className="text-[13px] font-medium text-white leading-none">Temp.</span>
                    <span className="text-[10px] text-white/50 leading-none mt-0.5">°C</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {data.map((d) => (
                    <button key={`temp-${d.offset}`} type="button"
                      onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                      className={`flex h-[36px] items-center justify-center rounded-[7px] bg-[#e5a06f] text-[13px] font-semibold text-[#171717] transition
                        ${d.offset === dayOffset ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Number(d.temp_max).toFixed(1)}°
                    </button>
                  ))}
                </div>
              </div>
              <DividerRow left="Min / Max">
                {data.map((d) => (
                  <div key={`temp-r-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[10px] text-white/60">
                    {Number(d.temp_min).toFixed(0)}° / {Number(d.temp_max).toFixed(0)}°
                  </div>
                ))}
              </DividerRow>
              <div className="mt-1"><div ref={tempChartRef} className="h-[140px] w-full" /></div>
            </section>

            <section className="mt-5">
              <div style={S.rowGrid} className="items-center">
                <div className="pr-2">
                  <div className="flex h-[36px] flex-col items-start justify-center rounded-[7px] bg-[#1769d1] px-1.5">
                    <span className="text-[12px] font-medium text-white leading-none whitespace-nowrap tracking-tight">Max Wind</span>
                    <span className="text-[10px] text-white/50 leading-none mt-0.5">km/h</span>
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-[3px]">
                  {data.map((d) => (
                    <button key={`wind-${d.offset}`} type="button"
                      onClick={() => { setTimestamp(d.offset); setSubStep(toSubStep(d.offset, slotIdx)); }}
                      className={`h-[36px] rounded-[7px] text-[13px] font-semibold bg-[#1a1a1a] text-white border border-[#2a2a2a] transition
                        ${d.offset === dayOffset ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Number(d.wind_speed_max).toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            {/* ── ACTIVE SLOT SUMMARY ── */}
            <section className="mt-6">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.16em] text-white">
                Active Slot — {activeSlot?.date_str} {activeSlot?.time} IST
              </div>
              <div className="grid grid-cols-4 overflow-hidden rounded-[9px] border border-[#282828] bg-[#010101]">
                <div className="border-r border-[#282828] px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-white/50">US AQI</div>
                  <div className="mt-1 text-[18px] font-semibold text-white">{Math.round(activeSlot?.us_aqi ?? 0)}</div>
                </div>
                <div className="border-r border-[#282828] px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-white/50">Temp.</div>
                  <div className="mt-1 text-[18px] font-semibold text-white">{Number(activeSlot?.temp ?? 0).toFixed(1)}°C</div>
                </div>
                <div className="border-r border-[#282828] px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-white/50">Wind</div>
                  <div className="mt-1 text-[18px] font-semibold text-white flex items-center justify-center gap-1">
                    {Number(activeSlot?.wind_speed ?? 0).toFixed(1)}
                    <span className="text-[11px] text-white/50">km/h</span>
                    <WindArrow deg={activeSlot?.wind_dir ?? 0} size={14} />
                  </div>
                </div>
                <div className="px-3 py-3 text-center">
                  <div className="text-[10px] uppercase tracking-wider text-white/50">PM 2.5</div>
                  <div className="mt-1 text-[18px] font-semibold text-white">{Number(activeSlot?.pm2_5 ?? 0).toFixed(1)}</div>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </aside>
  );
}
