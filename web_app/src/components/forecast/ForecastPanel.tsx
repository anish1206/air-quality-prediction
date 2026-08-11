import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import {
  useAppStore,
  SLOT_TIMES,
  SLOT_LABELS,
  stepToDayOffset,
  stepToSlot,
  toSubStep,
} from '../../store/appStore';

// ── Data types ────────────────────────────────────────────────────────────────
export interface SubSlot {
  time: string;
  date_str: string;
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
  us_aqi: number;
  pm2_5: number;
  pm10: number;
  nitrogen_dioxide: number;
  temp_max: number;
  temp_min: number;
  wind_speed_max: number;
  isObserved: boolean;
  sub_daily: SubSlot[];
}

interface Props {
  data: DayData[];
  onClose: () => void;
}

// ── Layout ────────────────────────────────────────────────────────────────────
const CONTENT_W  = 760;
const COLLAPSED_W = 480;
const LABEL_COL  = 80;
const N_COLS     = 7;
const CHART_GRID = { top: 16, right: 12, bottom: 4, left: LABEL_COL };

const S = {
  dataGrid: { display: 'grid', gridTemplateColumns: `${LABEL_COL}px repeat(${N_COLS}, minmax(0, 1fr))` } as React.CSSProperties,
  rowGrid:  { display: 'grid', gridTemplateColumns: `${LABEL_COL}px 1fr` } as React.CSSProperties,
};

// Flatten all sub-daily slots into a single 42-element array in day order
const flattenSubDaily = (data: DayData[]): SubSlot[] =>
  [...data].sort((a, b) => a.offset - b.offset).flatMap((d) => d.sub_daily);

// ── Wind direction arrow (rotate SVG) ────────────────────────────────────────
function WindArrow({ deg, size = 16 }: { deg: number; size?: number }) {
  // Arrow points in the direction the wind is GOING (opposite of met convention)
  const goingDeg = (deg + 180) % 360;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2"
      style={{ transform: `rotate(${goingDeg}deg)`, display: 'inline-block', verticalAlign: 'middle' }}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  );
}

export default function ForecastPanel({ data, onClose }: Props) {
  const aqiChartRef  = useRef<HTMLDivElement>(null);
  const pm25ChartRef = useRef<HTMLDivElement>(null);
  const tempChartRef = useRef<HTMLDivElement>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  const { selectedSubStep, setSubStep, setTimestamp } = useAppStore();

  const dayOffset  = stepToDayOffset(selectedSubStep);
  const slotIdx    = stepToSlot(selectedSubStep);
  const isObserved = selectedSubStep < 24;

  // Flatten all 42 sub-daily slots
  const allSlots   = flattenSubDaily(data);
  const activeSlot = allSlots[selectedSubStep] ?? allSlots[18];

  // Colour helpers (per-day averages for column cells)
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

  // ── ECharts sub-daily chart ───────────────────────────────────────────────
  const createChart = (
    el: HTMLDivElement,
    values: number[],
    unit: string,
    lineColor: string,
    activeIdx: number,
  ) => {
    const existing = echarts.getInstanceByDom(el);
    if (existing) existing.dispose();

    // x-axis labels: "Aug 6\n00:00" every 6th slot = day boundary label, else just time
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
        type: 'category',
        data: xLabels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#303030' } },
        axisTick: { show: false },
        axisLabel: {
          show: true, color: '#555', fontSize: 9,
          // only show at day boundaries (every 6th tick)
          interval: (i: number) => i % 6 === 0,
        },
        // Vertical lines at day boundaries
        splitLine: {
          show: true,
          interval: (i: number) => i % 6 === 0,
          lineStyle: { color: '#252525', type: 'solid' },
        },
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
        },
        // Crosshair marker for active sub-step
        {
          type: 'scatter', data: [[activeIdx, values[activeIdx]]],
          symbol: 'circle', symbolSize: 7,
          itemStyle: { color: '#fff', borderColor: lineColor, borderWidth: 2 },
          z: 10,
        },
      ],
      // Vertical crosshair line
      markLine: undefined,
    });

    return chart;
  };

  // Per-chart effects
  const initChart = (
    ref: React.RefObject<HTMLDivElement | null>,
    values: number[],
    unit: string,
    color: string,
  ) => {
    if (!ref.current || !allSlots.length) return;
    const chart = createChart(ref.current, values, unit, color, selectedSubStep);
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.dispose(); };
  };

  useEffect(() => initChart(aqiChartRef,  allSlots.map((s) => s.us_aqi),          '',       '#42b7e8'), [data, selectedSubStep]);
  useEffect(() => initChart(pm25ChartRef, allSlots.map((s) => s.pm2_5),           ' µg/m³', '#79c7a2'), [data, selectedSubStep]);
  useEffect(() => initChart(tempChartRef, allSlots.map((s) => s.temp),             '°C',     '#e5a06f'), [data, selectedSubStep]);

  // ── Active column highlight (per-day, not per-slot) ───────────────────────
  const activeColIdx = dayOffset + 3;
  const highlightStyle: React.CSSProperties = {
    position: 'absolute', top: 20, bottom: 200,
    left:  `calc(38px + ${LABEL_COL}px + ${activeColIdx} * (100% - 80px - ${LABEL_COL}px) / ${N_COLS})`,
    width: `calc((100% - 40px - ${LABEL_COL}px) / ${N_COLS})`,
    background: 'rgba(255,255,255,0.045)', pointerEvents: 'none', zIndex: 1,
  };

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
      {/* ── HEADER — always as wide as the visible panel, buttons pinned right ── */}
      <div className="flex h-[70px] shrink-0 items-center border-b border-[#252525] px-5">
        {/* Left: location info — clipped naturally by panel width */}
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center text-[#4285f4]">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
              <circle cx="12" cy="10" r="2.5" />
            </svg>
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="text-[16px] font-medium tracking-[-0.1px] text-white truncate">
              Pune, Maharashtra, India
            </div>
            <div className="mt-[2px] text-[11px] text-[#8a8a8a] truncate">
              {activeSlot?.date_str} · {activeSlot?.time} IST ·&nbsp;
              <span style={{ color: isObserved ? '#79c7a2' : '#4285f4' }}>
                {isObserved ? 'Observed' : 'AI Forecast'} · {SLOT_LABELS[slotIdx]}
              </span>
            </div>
          </div>
        </div>

        {/* Right: expand + close — always visible, never scrolled away */}
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

      {/* ── BODY — fixed inner width, horizontal scroll only here ── */}
      <div
        className="relative flex-1 overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#3a3a3a_transparent]"
        style={{ overflowX: isExpanded ? 'hidden' : 'auto' }}
      >
        {/* Inner content always at full CONTENT_W */}
        <div style={{ width: `${CONTENT_W}px`, minHeight: '100%', position: 'relative' }}>
          {/* Active column highlight — spans full scroll height */}
          <div style={highlightStyle} />

          <div className="relative z-10 px-5 pb-8">

          <div className="relative z-10 px-5 pb-8">

            {/* Section label */}
            <div className="mt-5 mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
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
                  {/* <div className="text-[10px] font-medium mt-0.5">{d.label}</div> */}
                  {/* <div className={`mt-1 text-[9px] uppercase tracking-wider ${d.isObserved ? 'text-white/35' : 'text-[#4285f4]'}`}>
                    {d.isObserved ? 'Observed' : 'Forecast'}
                  </div> */}
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
                        <button key={t} type="button"
                          onClick={() => setSubStep(step)}
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

            {/* ══ AQI ══════════════════════════════════════════════ */}
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
              {/* 42-point sub-daily chart */}
              <div className="mt-1"><div ref={aqiChartRef} className="h-[140px] w-full" /></div>
            </section>

            {/* ══ PM 2.5 ═══════════════════════════════════════════ */}
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

            {/* ══ TEMPERATURE ══════════════════════════════════════ */}
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
    </div>
    </aside>
  );
}
