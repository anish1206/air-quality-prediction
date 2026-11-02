import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import * as echarts from 'echarts';
import { fetchDriftSummary } from '../../services/driftApi';
import { CITY_META } from '../../lib/cityMeta';

interface Props {
  onClose: () => void;
}

export default function DriftDashboardModal({ onClose }: Props) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartInstance = useRef<echarts.ECharts | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['driftSummary'],
    queryFn: fetchDriftSummary,
  });

  // ── Render ECharts 30-Day Trend Chart ───────────────────────────────────────
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
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1a1a1a',
        borderColor: '#333',
        textStyle: { color: '#eee', fontSize: 12 },
      },
      legend: {
        data: ['MAE (µg/m³)', 'RMSE (µg/m³)', 'Mean Bias (µg/m³)'],
        textStyle: { color: '#888', fontSize: 11 },
        top: 0,
        right: 16,
      },
      grid: {
        top: 36,
        left: 48,
        right: 24,
        bottom: 24,
      },
      xAxis: {
        type: 'category',
        data: dates.length ? dates : ['No History'],
        axisLine: { lineStyle: { color: '#333' } },
        axisLabel: { color: '#777', fontSize: 10 },
      },
      yAxis: {
        type: 'value',
        name: 'µg/m³',
        nameTextStyle: { color: '#666', fontSize: 10 },
        splitLine: { lineStyle: { color: '#222' } },
        axisLabel: { color: '#777', fontSize: 10 },
      },
      series: [
        {
          name: 'MAE (µg/m³)',
          type: 'line',
          data: maes.length ? maes : [0],
          smooth: true,
          itemStyle: { color: '#38bdf8' },
          lineStyle: { width: 2.5 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(56, 189, 248, 0.25)' },
              { offset: 1, color: 'rgba(56, 189, 248, 0.0)' },
            ]),
          },
        },
        {
          name: 'RMSE (µg/m³)',
          type: 'line',
          data: rmses.length ? rmses : [0],
          smooth: true,
          itemStyle: { color: '#f43f5e' },
          lineStyle: { width: 1.5, type: 'dashed' },
        },
        {
          name: 'Mean Bias (µg/m³)',
          type: 'line',
          data: biases.length ? biases : [0],
          smooth: true,
          itemStyle: { color: '#eab308' },
          lineStyle: { width: 1.5 },
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0d0d0d] border border-[#2a2a2a] rounded-[24px] shadow-[0_24px_80px_rgba(0,0,0,0.85)] flex flex-col overflow-hidden text-white font-sans">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#222]">
          <div className="flex items-center gap-3">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight text-white flex items-center gap-2">
                Model Health & Drift Intelligence
                <span className="text-[11px] font-normal text-emerald-400 border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                  Option B: Adaptive Calibration
                </span>
              </h2>
              <p className="text-[11px] text-white/40">
                Continuous forecast-vs-actual verification & automated residual feedback loop
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {isLoading && (
            <div className="flex items-center justify-center py-16 text-white/40 text-[13px]">
              Loading model health telemetry...
            </div>
          )}

          {isError && (
            <div className="p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-[13px]">
              Unable to load drift summary payload. Ensure the pipeline has executed at least once.
            </div>
          )}

          {data && (
            <>
              {/* Stat Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-4 rounded-2xl bg-[#141414] border border-[#222]">
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">Rolling 7D MAE</div>
                  <div className="text-[22px] font-bold text-sky-400 mt-1">
                    {data.latest_mae.toFixed(1)} <span className="text-[12px] font-normal text-white/50">µg/m³</span>
                  </div>
                  <div className="text-[10px] text-emerald-400 mt-1">Target &lt; 15.0 µg/m³</div>
                </div>

                <div className="p-4 rounded-2xl bg-[#141414] border border-[#222]">
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">Rolling RMSE</div>
                  <div className="text-[22px] font-bold text-rose-400 mt-1">
                    {data.latest_rmse.toFixed(1)} <span className="text-[12px] font-normal text-white/50">µg/m³</span>
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">Quadratic penalty</div>
                </div>

                <div className="p-4 rounded-2xl bg-[#141414] border border-[#222]">
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">Mean Prediction Bias</div>
                  <div className="text-[22px] font-bold text-amber-400 mt-1">
                    {data.latest_bias > 0 ? `+${data.latest_bias.toFixed(1)}` : data.latest_bias.toFixed(1)}{' '}
                    <span className="text-[12px] font-normal text-white/50">µg/m³</span>
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">
                    {data.latest_bias > 0 ? 'Overpredicting' : 'Underpredicting'}
                  </div>
                </div>

                <div className="p-4 rounded-2xl bg-[#141414] border border-[#222]">
                  <div className="text-[11px] text-white/50 uppercase tracking-wider">Feature Drift (PSI)</div>
                  <div
                    className={`text-[22px] font-bold mt-1 ${
                      isPsiStable ? 'text-emerald-400' : isPsiWarning ? 'text-amber-400' : 'text-rose-400'
                    }`}
                  >
                    {psiVal.toFixed(3)}
                  </div>
                  <div className="text-[10px] text-white/40 mt-1">
                    {isPsiStable ? 'Stable (<0.1)' : isPsiWarning ? 'Moderate (0.1–0.2)' : 'High Drift (≥0.2)'}
                  </div>
                </div>
              </div>

              {/* Chart Card */}
              <div className="p-4 rounded-2xl bg-[#141414] border border-[#222]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[13px] font-medium text-white">30-Day Forecast Error Residuals</div>
                  <div className="text-[11px] text-white/40">Updated {new Date(data.updated_at).toLocaleDateString()}</div>
                </div>
                <div ref={chartRef} className="w-full h-[220px]" />
              </div>

              {/* Calibration Layer Telemetry */}
              <div className="p-4 rounded-2xl bg-[#141414] border border-[#222] space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-[13px] font-medium text-white flex items-center gap-2">
                    Option B: Active Calibration Layer Offsets
                    <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/30 px-2 py-0.5 rounded-full">
                      EWMA α = {data.calibration_status.alpha}
                    </span>
                  </div>
                  <div className="text-[11px] text-white/40">
                    Clamp limit: ±{data.calibration_status.max_clamp} µg/m³
                  </div>
                </div>

                <p className="text-[11px] text-white/50">
                  Daily residuals directly adjust forecast predictions via per-city bias correction:
                  <code className="text-sky-300 ml-1">PM2.5_cal = max(5.0, PM2.5_raw - Bias)</code>. The base LightGBM model remains
                  frozen to preserve long-term physical corridors while the calibration layer self-corrects short-term regional bias.
                </p>

                {Object.keys(data.city_performance).length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2 pt-2">
                    {Object.entries(data.city_performance).map(([cid, perf]) => {
                      const cityName = CITY_META[cid]?.name || cid;
                      const bias = perf.current_bias;
                      return (
                        <div
                          key={cid}
                          className="p-2.5 rounded-xl bg-black/40 border border-[#222] flex flex-col justify-between"
                        >
                          <div className="text-[11px] font-medium text-white truncate">{cityName}</div>
                          <div className="flex items-baseline justify-between mt-1.5">
                            <span className="text-[10px] text-white/40">Bias:</span>
                            <span
                              className={`text-[11px] font-mono font-semibold ${
                                bias > 0 ? 'text-amber-400' : bias < 0 ? 'text-sky-400' : 'text-white/60'
                              }`}
                            >
                              {bias > 0 ? `+${bias.toFixed(1)}` : bias.toFixed(1)}
                            </span>
                          </div>
                          <div className="flex items-baseline justify-between mt-0.5">
                            <span className="text-[10px] text-white/40">MAE:</span>
                            <span className="text-[11px] font-mono text-white/70">{perf.avg_mae.toFixed(1)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[11px] text-white/40 italic py-2">
                    Calibration layer initialized with zero baseline offset. Active corrections begin after tomorrow's first forecast
                    alignment cycle.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

