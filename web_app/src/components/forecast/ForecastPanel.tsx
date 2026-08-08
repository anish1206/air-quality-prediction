import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { useAppStore } from '../../store/appStore';

export interface DayData {
  offset: number;
  label: string;
  us_aqi: number;
  pm2_5: number;
  temp_max: number;
  temp_min: number;
  wind_speed_max: number;
  isObserved: boolean;
}

interface Props {
  data: DayData[];
  onClose: () => void;
}

const CONTENT_W  = 760;
const COLLAPSED_W = 480;
const LABEL_COL  = 80;
const N_COLS     = 7;
const CHART_GRID = { top: 14, right: 8, bottom: 4, left: LABEL_COL };

// ── inline style helpers (Tailwind can't scan dynamic grid-cols) ──────────────
const S = {
  /** 8-column grid: label col + 7 data cols */
  dataGrid: {
    display: 'grid',
    gridTemplateColumns: `${LABEL_COL}px repeat(${N_COLS}, minmax(0, 1fr))`,
  } as React.CSSProperties,

  /** 2-column grid: label col + 1fr */
  rowGrid: {
    display: 'grid',
    gridTemplateColumns: `${LABEL_COL}px 1fr`,
  } as React.CSSProperties,
};

export default function ForecastPanel({ data, onClose }: Props) {
  const aqiChartRef  = useRef<HTMLDivElement>(null);
  const pm25ChartRef = useRef<HTMLDivElement>(null);
  const tempChartRef = useRef<HTMLDivElement>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  const { selectedTimestamp, setTimestamp } = useAppStore();

  // ── colour helpers ────────────────────────────────────────────────────────
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

  // ── ECharts factory ───────────────────────────────────────────────────────
  const createChart = (
    el: HTMLDivElement,
    values: number[],
    labels: string[],
    unit: string,
    lineColor: string,
  ) => {
    const existing = echarts.getInstanceByDom(el);
    if (existing) existing.dispose();

    const chart = echarts.init(el);
    chart.setOption({
      backgroundColor: 'transparent',
      animation: true,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#111',
        borderColor: '#303030',
        borderWidth: 1,
        textStyle: { color: '#fff', fontSize: 13 },
        formatter: (params: any[]) => {
          if (!params?.length) return '';
          const p = params[0];
          return `<div style="font-size:11px;color:#888;margin-bottom:4px">${p.axisValue}</div>
                  <div style="font-size:13px;font-weight:500;color:#fff">${p.value}${unit}</div>`;
        },
      },
      grid: CHART_GRID,
      xAxis: {
        type: 'category',
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#303030' } },
        axisTick: { show: false },
        axisLabel: { show: false },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#777', fontSize: 11 },
        splitLine: { lineStyle: { color: '#333', type: 'dashed' } },
      },
      series: [{
        type: 'line',
        data: values,
        smooth: true,
        symbol: 'none',
        lineStyle: { color: lineColor, width: 2 },
        itemStyle: { color: lineColor },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${lineColor}30` },
            { offset: 1, color: `${lineColor}00` },
          ]),
        },
      }],
    });
    return chart;
  };

  // ── mount / resize charts ─────────────────────────────────────────────────
  // Each chart gets its own effect so it initializes as soon as its ref is ready,
  // rather than all three being tied to a single effect that may fire before the
  // first two divs have nonzero dimensions (StrictMode + scrollable container).
  const initChart = (
    ref: React.RefObject<HTMLDivElement | null>,
    values: number[],
    labels: string[],
    unit: string,
    lineColor: string,
  ) => {
    if (!ref.current || !data?.length) return;
    const chart = createChart(ref.current, values, labels, unit, lineColor);
    // Resize when the inner wrapper changes size (expand/collapse animation)
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.dispose();
    };
  };

  useEffect(
    () => initChart(aqiChartRef,  data?.map((d) => d.us_aqi)   ?? [], data?.map((d) => d.label) ?? [], '',       '#42b7e8'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  useEffect(
    () => initChart(pm25ChartRef, data?.map((d) => d.pm2_5)    ?? [], data?.map((d) => d.label) ?? [], ' µg/m³', '#79c7a2'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );
  useEffect(
    () => initChart(tempChartRef, data?.map((d) => d.temp_max) ?? [], data?.map((d) => d.label) ?? [], '°C',     '#e5a06f'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  // ── active column highlight strip ─────────────────────────────────────────
  const activeColIdx = selectedTimestamp + 3; // 0–6
  const highlightStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: -300,
    // px-5 = 20px padding; then label col; then activeColIdx * (1/7) of the remaining
    left:  `calc(20px + ${LABEL_COL}px + ${activeColIdx} * (100% - 40px - ${LABEL_COL}px) / ${N_COLS})`,
    width: `calc((100% - 40px - ${LABEL_COL}px) / ${N_COLS})`,
    background: 'rgba(255,255,255,0.045)',
    pointerEvents: 'none',
    zIndex: 1,
  };

  const activeDay = data.find((d) => d.offset === selectedTimestamp) ?? data[3] ?? data[0];

  // ── reusable row wrappers ─────────────────────────────────────────────────
  const DividerRow = ({ left, children }: { left: React.ReactNode; children: React.ReactNode }) => (
    <div style={S.rowGrid} className="border-b border-[#252525]">
      <div className="py-2 text-[11px] text-white">{left}</div>
      <div className="grid grid-cols-7">{children}</div>
    </div>
  );

  return (
    <aside
      style={{
        width: isExpanded ? `${CONTENT_W}px` : `${COLLAPSED_W}px`,
        overflowX: isExpanded ? 'hidden' : 'auto',
      }}
      className="
        absolute right-4 top-16 bottom-4 z-30
        overflow-hidden
        rounded-[26px]
        border border-[#303030]
        bg-[#090909]
        shadow-[0_16px_60px_rgba(0,0,0,0.65)]
        text-white
        transition-[width] duration-300 ease-in-out
        [scrollbar-width:thin]
        [scrollbar-color:#3a3a3a_transparent]
      "
    >
      {/* fixed-width inner wrapper — always CONTENT_W wide */}
      <div style={{ width: `${CONTENT_W}px` }} className="h-full flex flex-col">

        {/* ── HEADER ── */}
        <div className="flex h-[70px] shrink-0 items-center justify-between border-b border-[#252525] px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center text-[#4285f4]">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
                <circle cx="12" cy="10" r="2.5" />
              </svg>
            </div>
            <div>
              <div className="text-[17px] font-medium tracking-[-0.1px] text-white">
                Pune, Maharashtra, India - [Forecast · 7 Days]
              </div>
              <div className="mt-[3px] text-[12px] text-[#8a8a8a]">18.5204° N, 73.8567° E</div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button type="button" onClick={() => setIsExpanded((v) => !v)}
              className="text-[#777] transition hover:text-white"
              title={isExpanded ? 'Collapse' : 'Expand'}>
              {isExpanded ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3v5H3"/><path d="M16 21v-5h5"/>
                  <path d="M3 8l7 7"/><path d="M21 16l-7-7"/>
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 3h6v6"/><path d="M9 21H3v-6"/>
                  <path d="M21 3l-7 7"/><path d="M3 21l7-7"/>
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

        {/* ── SCROLLABLE BODY ── */}
        <div className="relative flex-1 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:#3a3a3a_transparent]">

          {/* Active column highlight — full scroll height */}
          <div style={highlightStyle} />

          <div className="relative z-10 px-5 pb-8">

            {/* ── FORECAST HEADER ── */}
            <div className="mt-5 mb-3 text-[12px] font-medium uppercase tracking-[0.16em] text-white">
              Random Forest based
            </div>

            {/* Date row */}
            <div style={S.dataGrid} className="border-b border-[#303030]">
              <div className="flex items-center pb-2 text-[12px] font-medium text-white">Date</div>
              {data.map((d) => (
                <button key={`date-${d.offset}`} type="button"
                  onClick={() => setTimestamp(d.offset)}
                  className="border-l border-[#252525] px-1 pb-2 text-center text-white transition hover:opacity-80">
                  <div className="text-[12px] font-medium">{d.label}</div>
                  <div className={`mt-1 text-[10px] uppercase tracking-wider ${d.isObserved ? 'text-white/40' : 'text-[#4285f4]'}`}>
                    {d.isObserved ? 'Observed' : 'Forecast'}
                  </div>
                </button>
              ))}
            </div>

            {/* Horizon row */}
            <div style={S.dataGrid} className="border-b border-[#252525]">
              <div className="py-2 text-[12px] text-white">Horizon</div>
              {data.map((d) => (
                <button key={`horizon-${d.offset}`} type="button"
                  onClick={() => setTimestamp(d.offset)}
                  className="border-l border-[#252525] py-2 text-[12px] text-white transition hover:opacity-80">
                  {d.offset === 0 ? 'T' : d.offset > 0 ? `T+${d.offset}` : `T${d.offset}`}
                </button>
              ))}
            </div>

            {/* ══ AQI ══════════════════════════════════════════════ */}
            <section className="mt-6">
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
                      onClick={() => setTimestamp(d.offset)}
                      className={`h-[36px] rounded-[7px] text-[13px] font-semibold transition ${getAqiColor(d.us_aqi)} ${d.offset === selectedTimestamp ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Math.round(d.us_aqi)}
                    </button>
                  ))}
                </div>
              </div>

              <DividerRow left="Status">
                {data.map((d) => (
                  <div key={`aqi-s-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[11px] text-white/60">
                    {d.isObserved ? 'Observed' : 'Predicted'}
                  </div>
                ))}
              </DividerRow>

              <div className="mt-1">
                <div ref={aqiChartRef} className="h-[150px] w-full" />
              </div>
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
                      onClick={() => setTimestamp(d.offset)}
                      className={`h-[36px] rounded-[7px] text-[13px] font-semibold transition ${getPm25Color(d.pm2_5)} ${d.offset === selectedTimestamp ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Number(d.pm2_5).toFixed(1)}
                    </button>
                  ))}
                </div>
              </div>

              <DividerRow left="Unit">
                {data.map((d) => (
                  <div key={`pm-u-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[11px] text-white/60">
                    µg/m³
                  </div>
                ))}
              </DividerRow>

              <div className="mt-1">
                <div ref={pm25ChartRef} className="h-[150px] w-full" />
              </div>
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
                      onClick={() => setTimestamp(d.offset)}
                      className={`flex h-[36px] items-center justify-center rounded-[7px] bg-[#e5a06f] text-[13px] font-semibold text-[#171717] transition ${d.offset === selectedTimestamp ? 'ring-1 ring-[#4285f4] ring-offset-1 ring-offset-[#090909]' : ''}`}>
                      {Number(d.temp_max).toFixed(1)}°
                    </button>
                  ))}
                </div>
              </div>

              <DividerRow left="Min / Max">
                {data.map((d) => (
                  <div key={`temp-r-${d.offset}`} className="border-l border-[#252525] py-2 text-center text-[11px] text-white/60">
                    {Number(d.temp_min).toFixed(0)}° / {Number(d.temp_max).toFixed(0)}°
                  </div>
                ))}
              </DividerRow>

              <div className="mt-1">
                <div ref={tempChartRef} className="h-[150px] w-full" />
              </div>
            </section>

            {/* ── SELECTED DAY SUMMARY ── */}
            <section className="mt-6">
              <div className="mb-2 text-[12px] font-medium uppercase tracking-[0.16em] text-white">
                Selected Forecast
              </div>
              <div className="grid grid-cols-3 overflow-hidden rounded-[9px] border border-[#282828] bg-[#111]">
                <div className="border-r border-[#282828] px-3 py-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-white/50">US AQI</div>
                  <div className="mt-1 text-[19px] font-semibold text-white">{Math.round(activeDay.us_aqi)}</div>
                </div>
                <div className="border-r border-[#282828] px-3 py-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-white/50">Temp.</div>
                  <div className="mt-1 text-[19px] font-semibold text-white">{Number(activeDay.temp_max).toFixed(1)}°C</div>
                </div>
                <div className="px-3 py-3 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-white/50">Max Wind</div>
                  <div className="mt-1 text-[19px] font-semibold text-white">{Number(activeDay.wind_speed_max).toFixed(1)} km/h</div>
                </div>
              </div>
            </section>

          </div>
        </div>
      </div>
    </aside>
  );
}
