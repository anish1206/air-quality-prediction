import { CLUSTER_FILTERS, CLUSTER_DISPLAY } from '../../lib/cityMeta';

export default function AirshedLegend() {
  const clusters = CLUSTER_FILTERS.filter((c) => c.id !== null);

  return (
    <div
      className="absolute bottom-[88px] right-14 z-10 pointer-events-none"
      style={{
        background: 'rgba(0,0,0,0.72)',
        backdropFilter: 'blur(12px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: '14px',
        padding: '10px 13px',
        minWidth: '176px',
      }}
    >
      <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-2">
        Airshed Clusters
      </div>
      <div className="flex flex-col gap-1 mb-3">
        {clusters.map((c) => (
          <div key={c.id} className="flex items-center gap-2">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: CLUSTER_DISPLAY[c.id as number].color, boxShadow: `0 0 8px ${CLUSTER_DISPLAY[c.id as number].color}` }}
            />
            <span className="text-[10px] text-white/75">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-white/40 mb-1.5">
        CHHI Severity
      </div>
      <div
        className="h-[6px] w-full rounded-full mb-1"
        style={{
          background: 'linear-gradient(90deg, rgba(16,185,129,0.9) 0%, rgba(245,158,11,0.9) 40%, rgba(249,115,22,0.9) 70%, rgba(225,29,72,0.9) 100%)',
        }}
      />
      <div className="flex justify-between text-[8px] text-white/40 mb-1 font-mono">
        <span>0–25</span>
        <span>26–50</span>
        <span>51–75</span>
        <span>76–100</span>
      </div>
      <div className="flex justify-between text-[8px]">
        <span style={{ color: '#10b981' }}>Low</span>
        <span style={{ color: '#f59e0b' }}>Moderate</span>
        <span style={{ color: '#f97316' }}>High</span>
        <span style={{ color: '#e11d48' }}>Critical</span>
      </div>
    </div>
  );
}
