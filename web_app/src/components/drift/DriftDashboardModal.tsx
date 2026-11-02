import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { fetchDriftSummary } from '../../services/driftApi';
import { CITY_META } from '../../lib/cityMeta';

const CONTENT_W   = 760;
const COLLAPSED_W = 480;

interface Props {
  onClose: () => void;
}

export default function DriftDashboardModal({ onClose }: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const { data } = useQuery({
    queryKey: ['driftSummary'],
    queryFn: fetchDriftSummary,
  });

  // ── Render ECharts 30-Day Trend Chart matching ForecastPanel style ───────────
  useEffect(() => {
    if (!chartRef.current || !data) return;

    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current);
    }

    const history = data.history_30d || [];
    const dates = history.map((h) => h.date);
    const maes = history.map((h) => h.overall_mae);
    const rmses = history.map((h) => h.overall_rmse);
    const biases = history.map((h) => h.overall_bias);

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#161616',
        borderColor: '#303030',
        textStyle: { color: '#ffffff', fontSize: 11, fontFamily: 'monospace' },
        padding: [6, 10],
      },
      legend: {
        data: ['MAE (µg/m³)', 'RMSE (µg/m³)', 'Mean Bias (µg/m³)'],
        textStyle: { color: '#8a8a8a', fontSize: 10, fontFamily: 'monospace' },
        top: 0,
        right: 8,
        itemWidth: 14,
        itemHeight: 8,
      },
      grid: {
        top: 28,
        left: 42,
        right: 12,
        bottom: 24,
      },
      xAxis: {
        type: 'category',
        data: dates.length ? dates : ['Initial Epoch'],
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#303030' } },
        axisTick: { show: false },
        axisLabel: { color: '#666', fontSize: 9, fontFamily: 'monospace' },
        splitLine: { show: true, lineStyle: { color: '#202020', type: 'solid' } },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: '#777', fontSize: 10, fontFamily: 'monospace' },
        splitLine: { lineStyle: { color: '#252525', type: 'dashed' } },
      },
      series: [
        {
          name: 'MAE (µg/m³)',
          type: 'line',
          data: maes.length ? maes : [0],
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#38bdf8', width: 2 },
          itemStyle: { color: '#38bdf8' },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(56, 189, 248, 0.16)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0.00)' },
            ]),
          },
        },
        {
          name: 'RMSE (µg/m³)',
          type: 'line',
          data: rmses.length ? rmses : [0],
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#f43f5e', width: 1.5, type: 'dashed' },
          itemStyle: { color: '#f43f5e' },
        },
        {
          name: 'Mean Bias (µg/m³)',
          type: 'line',
          data: biases.length ? biases : [0],
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#f59e0b', width: 1.5 },
          itemStyle: { color: '#f59e0b' },
        },
      ],
    };

    chartInstance.current.setOption(option);

    const handleResize = () => chartInstance.current?.resize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [data]);

  const psiVal = data?.psi_metrics?.source_pm25_t ?? 0.0;
  const isPsiStable = psiVal < 0.1;
  const isPsiWarning = psiVal >= 0.1 && psiVal < 0.2;

  const updatedDateStr = data?.updated_at
    ? new Date(data.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—';
  const updatedTimeStr = data?.updated_at
    ? new Date(data.updated_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    : '—';

  return (
    <aside
      style={{ width: isExpanded ? `${CONTENT_W}px` : `${COLLAPSED_W}px` }}
      className="
        absolute right-4 top-16 bottom-4 z-30 overflow-hidden
        rounded-[26px] border border-[#303030]
        bg-[#090909] shadow-[0_16px_60px_rgba(0,0,0,0.65)]
        text-white transition-[width] duration-300 ease-in-out
        flex flex-col select-none
      "
    >
      {/* ── HEADER ── */}
      <div className="flex h-[70px] shrink-0 items-center border-b border-[#252525] px-5">
        <div className="flex items-center gap-3 flex-1 min-w-0 overflow-hidden">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center text-[#4285f4]">
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 3v18h18" />
              <path d="m19 9-5 5-4-4-3 3" />
            </svg>
          </div>
          <div className="min-w-0 overflow-hidden">
            <div className="text-[16px] font-medium tracking-[-0.1px] text-white truncate">
              Model Health &amp; Drift Intelligence
            </div>
            <div className="mt-[2px] text-[11px] text-[#8a8a8a] truncate font-mono">
              Evaluated {updatedDateStr} · {updatedTimeStr} IST &nbsp;·&nbsp; Option B Adaptive Calibration
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-4 pl-3">
          <button
            type="button"
            onClick={() => setIsExpanded((v) => !v)}
            className="text-[#777] transition hover:text-white"
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3v5H3" />
                <path d="M16 21v-5h5" />
                <path d="M3 8l7 7" />
                <path d="M21 16l-7-7" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M15 3h6v6" />
                <path d="M9 21H3v-6" />
                <path d="M21 3l-7 7" />
                <path d="M3 21l7-7" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="text-[#777] transition hover:text-white"
            title="Close"
          >
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
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
            {/* ── Top Status Badges (matching ForecastPanel regime tag style) ── */}
            <div className="mt-4 mb-3 flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-white/50">
                Calibration Regime
              </span>
              <span
                className="text-[10px] px-2.5 py-1 rounded-full border"
                style={{
                  color: '#38bdf8',
                  borderColor: 'rgba(56,189,248,0.35)',
                  background: 'rgba(56,189,248,0.08)',
                }}
              >
                Option B · EWMA α = {data?.calibration_status?.alpha ?? 0.15}
              </span>
              <span className="text-[10px] font-mono text-white/40">
                CLAMP: ±{data?.calibration_status?.max_clamp ?? 25.0} µg/m³
              </span>
              <span
                className={`text-[10px] px-2.5 py-0.5 rounded-full border font-mono tracking-wide ${
                  isPsiStable
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400'
                    : isPsiWarning
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-400'
                    : 'border-rose-500/40 bg-rose-500/10 text-rose-400'
                }`}
              >
                PSI: {psiVal.toFixed(3)} {isPsiStable ? '(STABLE)' : isPsiWarning ? '(DRIFT WARNING)' : '(ACTION REQUIRED)'}
              </span>
            </div>

            {/* ── Information / Advisory Banner (matching ForecastPanel cascade advisory banner) ── */}
            <div className="mb-4 rounded-[12px] border border-[#1769d1]/40 bg-[#1769d1]/10 px-3 py-2.5 text-[11px] leading-relaxed">
              <span className="font-semibold text-[#38bdf8]">ℹ️ FEEDBACK LOOP:</span>
              <span className="text-white/85">
                {' '}Forecasts are archived prior to each daily update. Residual errors (pred − obs) update per-city additive biases to dynamically adjust next-day predictions: <code className="text-[#38bdf8] font-mono">PM2.5_cal = max(5.0, PM2.5_raw - Bias)</code>.
              </span>
            </div>

            {/* ── Section Title: Telemetry Grid ── */}
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white">
              Telemetry · 7-Day Performance &amp; Stability
            </div>

            {/* ── Key Metrics Grid (styled like ForecastPanel dataGrid) ── */}
            <div className="grid grid-cols-4 border border-[#252525] rounded-[14px] bg-[#0c0c0c] mb-6 overflow-hidden">
              <div className="p-3 border-r border-[#252525]">
                <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Rolling 7D MAE</div>
                <div className="mt-1 text-[20px] font-mono font-medium text-white">
                  {data ? data.latest_mae.toFixed(1) : '—'}{' '}
                  <span className="text-[10px] text-white/40 font-normal">µg/m³</span>
                </div>
                <div className="text-[9px] font-mono text-[#10b981] mt-0.5">Target &lt; 15.0</div>
              </div>

              <div className="p-3 border-r border-[#252525]">
                <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Rolling RMSE</div>
                <div className="mt-1 text-[20px] font-mono font-medium text-white">
                  {data ? data.latest_rmse.toFixed(1) : '—'}{' '}
                  <span className="text-[10px] text-white/40 font-normal">µg/m³</span>
                </div>
                <div className="text-[9px] font-mono text-white/30 mt-0.5">L2 Penalty</div>
              </div>

              <div className="p-3 border-r border-[#252525]">
                <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Mean Pred. Bias</div>
                <div className="mt-1 text-[20px] font-mono font-medium">
                  <span className={data && data.latest_bias > 0 ? 'text-[#f59e0b]' : 'text-[#38bdf8]'}>
                    {data ? (data.latest_bias > 0 ? `+${data.latest_bias.toFixed(1)}` : data.latest_bias.toFixed(1)) : '—'}
                  </span>{' '}
                  <span className="text-[10px] text-white/40 font-normal">µg/m³</span>
                </div>
                <div className="text-[9px] font-mono text-white/30 mt-0.5">
                  {data && data.latest_bias > 0 ? 'Overpredicting' : 'Underpredicting'}
                </div>
              </div>

              <div className="p-3">
                <div className="text-[10px] font-mono text-white/50 uppercase tracking-wider">Distribution PSI</div>
                <div
                  className={`mt-1 text-[20px] font-mono font-medium ${
                    isPsiStable ? 'text-[#10b981]' : isPsiWarning ? 'text-[#f59e0b]' : 'text-[#e11d48]'
                  }`}
                >
                  {psiVal.toFixed(3)}
                </div>
                <div className="text-[9px] font-mono text-white/30 mt-0.5">
                  {isPsiStable ? 'Stable (<0.1)' : 'Shift Detected'}
                </div>
              </div>
            </div>

            {/* ── Section Title: Error Residuals Chart ── */}
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white flex items-center justify-between">
              <span>Forecast Error Residuals · 30-Day Trajectory</span>
              <span className="text-[10px] font-mono text-[#8a8a8a]">Historical Window</span>
            </div>

            {/* ── ECharts Container ── */}
            <div className="rounded-[14px] border border-[#252525] bg-[#0c0c0c] p-3 mb-6">
              <div ref={chartRef} className="w-full h-[200px]" />
            </div>

            {/* ── Section Title: Per-City Active Calibration Table ── */}
            <div className="mb-3 text-[11px] font-medium uppercase tracking-[0.16em] text-white flex items-center justify-between">
              <span>Per-Station Residual Calibration · Current Offsets</span>
              <span className="text-[10px] font-mono text-[#8a8a8a]">20 Monitoring Stations</span>
            </div>

            {/* ── Data Grid Table (matching ForecastPanel layout) ── */}
            <div className="border border-[#252525] rounded-[14px] bg-[#0c0c0c] overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-12 border-b border-[#252525] px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-white/50">
                <div className="col-span-4">Station / City</div>
                <div className="col-span-3">Airshed Corridor</div>
                <div className="col-span-2 text-right">Avg MAE</div>
                <div className="col-span-3 text-right">Active Bias Offset</div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-[#1c1c1c] max-h-[260px] overflow-y-auto [scrollbar-width:thin] [scrollbar-color:#3a3a3a_transparent]">
                {Object.entries(CITY_META).map(([cid, meta]) => {
                  const perf = data?.city_performance?.[cid];
                  const bias = perf?.current_bias ?? 0.0;
                  const mae = perf?.avg_mae ?? 0.0;

                  return (
                    <div
                      key={cid}
                      className="grid grid-cols-12 px-3 py-2 text-[11px] items-center hover:bg-white/[0.02] transition"
                    >
                      <div className="col-span-4 flex items-center gap-2">
                        <span className="font-mono text-white/50 text-[10px]">{cid}</span>
                        <span className="text-white font-medium truncate">{meta.name}</span>
                      </div>

                      <div className="col-span-3 flex items-center">
                        <span className="text-[10px] font-mono text-white/50 truncate">
                          {meta.state}
                        </span>
                      </div>

                      <div className="col-span-2 text-right font-mono text-white/70">
                        {mae > 0 ? `${mae.toFixed(1)}` : '0.0'}
                      </div>

                      <div className="col-span-3 text-right font-mono font-medium">
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] ${
                            bias > 0
                              ? 'text-[#f59e0b] bg-[#f59e0b]/10'
                              : bias < 0
                              ? 'text-[#38bdf8] bg-[#38bdf8]/10'
                              : 'text-white/40'
                          }`}
                        >
                          {bias > 0 ? `+${bias.toFixed(1)} µg/m³` : bias < 0 ? `${bias.toFixed(1)} µg/m³` : '0.0 µg/m³'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
