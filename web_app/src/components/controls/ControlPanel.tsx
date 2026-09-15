import { useAirshedStore } from '../../store/airshedStore';
import type { AirshedMetric } from '../../types/airshed';
import { CLUSTER_FILTERS, CLUSTER_DISPLAY } from '../../lib/cityMeta';

const METRICS: { key: AirshedMetric; label: string; sub: string }[] = [
    { key: 'chhi_score', label: 'CHHI Hazard (AI)', sub: 'Compound health index' },
    { key: 'us_aqi', label: 'US AQI', sub: 'Air quality index' },
    { key: 'pm2_5', label: 'PM 2.5', sub: 'Fine particulates' },
    { key: 'nitrogen_dioxide', label: 'NO₂', sub: 'Vehicle emissions' },
];

const LAYERS: { key: keyof import('../../types/airshed').LayerVisibility; label: string; desc: string }[] = [
    { key: 'cloudField', label: 'Cloud / Smog Field', desc: 'WeatherLab stepped threshold' },
    { key: 'plumes',     label: 'Atmospheric Plumes',  desc: 'City halos + airshed envelopes' },
    { key: 'edges',      label: 'Causal Edges',        desc: 'Transport streamlines' },
    { key: 'pulses',     label: 'Cascade Pulses',      desc: 'Active pollution fronts' },
    { key: 'pins',       label: 'Station Pins',        desc: 'City markers & labels' },
];

export default function ControlPanel() {
    const {
        selectedClusterFilter, setClusterFilter,
        selectedMetric, setMetric,
        layerVisibility, toggleLayer,
        isLayerPanelOpen, toggleLayerPanel,
    } = useAirshedStore();

    if (!isLayerPanelOpen) return null;

    const clusters = CLUSTER_FILTERS.filter((c) => c.id !== null);

    return (
        <aside className="
      absolute top-[76px] left-4 bottom-5 z-20
      w-[210px]
      bg-[#000000] border border-[#303030]
      rounded-[26px] shadow-[0_16px_60px_rgba(0,0,0,0.65)]
      overflow-y-auto overflow-x-hidden hide-scroll
      flex flex-col
    ">
            <div className="flex items-center justify-between border-b border-[#252525] px-4 py-3 shrink-0">
                <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white">
                    Airshed Regime
                </span>
                <button type="button" onClick={toggleLayerPanel} className="text-[#777] transition hover:text-white" title="Close">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                    </svg>
                </button>
            </div>

            <div className="flex flex-col gap-0.5 p-3">
                {CLUSTER_FILTERS.map((p) => {
                    const active = selectedClusterFilter === p.id;
                    return (
                        <button
                            key={String(p.id)}
                            type="button"
                            onClick={() => setClusterFilter(p.id)}
                            className={`
                w-full px-3 py-[7px] rounded-[8px] text-left cursor-pointer transition-all duration-150
                ${active ? 'bg-[#1769d1] text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'}
              `}
                        >
                            <div className="text-[12px] font-medium leading-none">{p.label}</div>
                            <div className={`text-[9px] leading-none mt-[3px] ${active ? 'text-white/65' : 'text-white/30'}`}>
                                {p.sub}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="px-4 pb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-white border-t border-[#252525] pt-3">
                Display Metric
            </div>
            <div className="flex flex-col gap-0.5 p-3 pt-2">
                {METRICS.map((p) => {
                    const active = selectedMetric === p.key;
                    return (
                        <button
                            key={p.key}
                            type="button"
                            onClick={() => setMetric(p.key)}
                            className={`
                w-full px-3 py-[7px] rounded-[8px] text-left cursor-pointer transition-all duration-150
                ${active ? 'bg-[#1769d1] text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.04]'}
              `}
                        >
                            <div className="text-[12px] font-medium leading-none">{p.label}</div>
                            <div className={`text-[9px] leading-none mt-[3px] ${active ? 'text-white/65' : 'text-white/30'}`}>
                                {p.sub}
                            </div>
                        </button>
                    );
                })}
            </div>

            <div className="mx-3 pt-3 border-t border-[#252525]">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white mb-2">Map Layers</div>
                <div className="flex flex-col gap-1">
                    {LAYERS.map((layer) => {
                        const on = layerVisibility[layer.key];
                        return (
                            <button
                                key={layer.key}
                                type="button"
                                onClick={() => toggleLayer(layer.key)}
                                className="flex items-center justify-between px-2 py-1.5 rounded-[8px] hover:bg-white/[0.04] group"
                            >
                                <span className="flex flex-col text-left">
                                    <span className="text-[12px] text-white/80 group-hover:text-white transition-colors">{layer.label}</span>
                                    <span className="text-[9px] text-white/35">{layer.desc}</span>
                                </span>
                                <span
                                    className="w-8 h-[16px] rounded-full relative transition-colors shrink-0 ml-2"
                                    style={{ background: on ? '#1769d1' : '#2a2a2a' }}
                                >
                                    <span
                                        className="absolute top-[2px] w-3 h-3 rounded-full bg-white transition-all"
                                        style={{ left: on ? 17 : 3 }}
                                    />
                                </span>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="mx-3 mt-auto mb-3 pt-3 border-t border-[#252525]">
                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white mb-2">
                    Airshed Clusters
                </div>
                <div className="flex flex-col gap-1.5 mb-3">
                    {clusters.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 px-1">
                            <span
                                className="w-2.5 h-2.5 rounded-full shrink-0"
                                style={{ background: CLUSTER_DISPLAY[c.id as number].color }}
                            />
                            <span className="text-[11px] text-white/70">{c.label}</span>
                        </div>
                    ))}
                </div>

                <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-white mb-2">
                    CHHI Severity
                </div>
                <div
                    className="h-[5px] w-full rounded-full mb-1.5"
                    style={{
                        background: 'linear-gradient(90deg, #10b981 0%, #f59e0b 40%, #f97316 70%, #e11d48 100%)',
                    }}
                />
                <div className="flex justify-between text-[8px] text-white/35 font-mono mb-1">
                    <span>0–25</span>
                    <span>26–50</span>
                    <span>51–75</span>
                    <span>76–100</span>
                </div>
                <div className="flex justify-between text-[8px] text-white/50">
                    <span>Low</span>
                    <span>Moderate</span>
                    <span>High</span>
                    <span>Critical</span>
                </div>
            </div>
        </aside>
    );
}
