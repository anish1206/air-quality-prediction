import { useQuery } from '@tanstack/react-query';
import AirQualityMap from './components/map/AirQualityMap';
import TimeController from './components/timeline/TimeController';
import ForecastPanel from './components/forecast/ForecastPanel';
import { useAppStore } from './store/appStore';
import { fetchPuneDataset } from './services/api';

const POLLUTANTS = [
  {
    key:   'chhi_score'        as const,
    label: 'COMPOUND RISK (CHHI)',
    sub:   'Heat Index + Air Chemistry',
    gradient: 'linear-gradient(90deg, #10b981 0%, #f59e0b 35%, #f97316 65%, #e11d48 100%)',
  },
  {
    key:   'us_aqi'           as const,
    label: 'US AQI',
    sub:   'Air Quality Index',
    gradient: 'linear-gradient(90deg, #10b981 0%, #f59e0b 40%, #f97316 70%, #e11d48 100%)',
  },
  {
    key:   'pm2_5'            as const,
    label: 'PM 2.5',
    sub:   'Fine Particulates',
    gradient: 'linear-gradient(90deg, #06b6d4 0%, #84cc16 35%, #eab308 65%, #dc2626 100%)',
  },
  {
    key:   'pm10'             as const,
    label: 'PM 10',
    sub:   'Coarse Dust',
    gradient: 'linear-gradient(90deg, #d97706 0%, #b45309 50%, #78350f 100%)',
  },
  {
    key:   'nitrogen_dioxide' as const,
    label: 'NO₂',
    sub:   'Vehicle Emissions',
    gradient: 'linear-gradient(90deg, #7c3aed 0%, #a855f7 50%, #c026d3 75%, #f43f5e 100%)',
  },
  {
    key:   'temp'              as const,
    label: 'Temp & Humidity',
    sub:   'Thermal Metrics',
    gradient: 'linear-gradient(90deg, #3b82f6 0%, #eab308 50%, #ef4444 100%)',
  },
];

export default function App() {
  const {
    selectedPollutant, setPollutant,
    isForecastPanelOpen, toggleForecastPanel,
    isLayerPanelOpen,   toggleLayerPanel,
  } = useAppStore();

  const { data: puneData, isLoading, isError } = useQuery({
    queryKey: ['puneAirQuality'],
    queryFn: fetchPuneDataset,
  });

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#060606] font-sans select-none">
      {/* ── 1. Map ── */}
      <AirQualityMap />

      {/* ── 2. Top Bar ── */}
      <header className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-[#000000] border border-[#2a2a2a] rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] px-5 py-3">

        <h1 className="text-[15px] font-medium tracking-[-0.1px] text-white">Air Quality Lab</h1>

        <span className="text-[12px] text-white px-2.5 py-1 rounded-full border border-[#2a2a2a] bg-[#161616]">
          Pune, MH
        </span>

        {/* Layer panel toggle */}
        <button
          type="button"
          onClick={toggleLayerPanel}
          title={isLayerPanelOpen ? 'Hide layers' : 'Show layers'}
          className={`
            ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium
            border transition-all duration-200
            ${isLayerPanelOpen
              ? 'bg-[#1a3a6e] border-[#2a5bb0] text-white'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-white hover:text-[#bbbbbb] hover:border-[#3a3a3a]'
            }
          `}
        >
          {/* Layers icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2 2 7l10 5 10-5-10-5Z"/>
            <path d="m2 12 10 5 10-5"/>
            <path d="m2 17 10 5 10-5"/>
          </svg>
          Layers
        </button>

        {/* Forecast panel toggle */}
        <button
          type="button"
          onClick={toggleForecastPanel}
          title={isForecastPanelOpen ? 'Hide forecast' : 'Show forecast'}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium
            border transition-all duration-200
            ${isForecastPanelOpen
              ? 'bg-[#1a3a6e] border-[#2a5bb0] text-white'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-white hover:text-[#bbbbbb] hover:border-[#3a3a3a]'
            }
          `}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3"  y="12" width="4" height="9"  rx="1" />
            <rect x="10" y="7"  width="4" height="14" rx="1" />
            <rect x="17" y="3"  width="4" height="18" rx="1" />
          </svg>
          Forecast
        </button>
      </header>

      {/* ── 3. Left Pollutant Panel ── */}
      {isLayerPanelOpen && (
        <aside className="
          absolute top-[76px] left-4 z-10
          w-[210px]
          bg-[#000000] border border-[#303030]
          rounded-[26px] shadow-[0_16px_60px_rgba(0,0,0,0.65)]
          overflow-hidden
        ">
          {/* Panel header */}
          <div className="flex items-center justify-between border-b border-[#252525] px-4 py-3">
            <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-white">
              Risk Overlays
            </span>
            <button
              type="button"
              onClick={toggleLayerPanel}
              className="text-[#777] transition hover:text-white"
              title="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18"/><path d="m6 6 12 12"/>
              </svg>
            </button>
          </div>

          {/* Pollutant buttons */}
          <div className="flex flex-col gap-1 p-3">
            {POLLUTANTS.map((p) => {
              const active = selectedPollutant === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setPollutant(p.key)}
                  className={`
                    w-full px-3 py-2 rounded-[8px] text-left cursor-pointer
                    transition-all duration-150
                    ${active
                      ? 'bg-[#1769d1] text-white'
                      : 'text-white/60 hover:text-white hover:bg-white/[0.04]'
                    }
                  `}
                >
                  <div className="text-[12px] font-medium leading-none">{p.label}</div>
                  <div className={`text-[9px] leading-none mt-[4px] ${active ? 'text-white/65' : 'text-white/30'}`}>
                    {p.sub}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Legend bar — updates with active pollutant */}
          {(() => {
            const active = POLLUTANTS.find((p) => p.key === selectedPollutant) || POLLUTANTS[0];
            return (
              <div className="mx-3 mb-3 mt-1 pt-3 border-t border-[#252525]">
                <div className="h-[5px] w-full rounded-full" style={{ background: active.gradient }} />
                <div className="flex justify-between mt-1.5 text-[9px] text-white/25">
                  <span>Low</span>
                  <span>Moderate</span>
                  <span>High</span>
                </div>
              </div>
            );
          })()}
        </aside>
      )}

      {/* ── 4. Timeline ── */}
      <TimeController forecastOpen={isForecastPanelOpen} />

      {/* ── 5. Forecast Panel ── */}
      {isForecastPanelOpen && puneData && (
        <ForecastPanel data={puneData} onClose={toggleForecastPanel} />
      )}

      {isLoading && (
        <div className="absolute top-4 right-4 z-20 bg-[#0e0e0e] border border-[#2a2a2a] px-3 py-1.5 rounded-full text-[10px] text-[#4285f4] tracking-widest animate-pulse">
          Loading dataset…
        </div>
      )}
      {isError && (
        <div className="absolute top-4 right-4 z-20 bg-[#1e0a0a] border border-[#5c2a2a] text-[#f28b82] px-3 py-1.5 rounded-full text-[10px]">
          Failed to load dataset
        </div>
      )}
    </div>
  );
}
