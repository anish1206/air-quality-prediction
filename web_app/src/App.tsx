import { useQuery } from '@tanstack/react-query';
import AirQualityMap from './components/map/AirQualityMap';
import TimeController from './components/timeline/TimeController';
import ForecastPanel from './components/forecast/ForecastPanel';
import { useAppStore } from './store/appStore';
import { fetchPuneDataset } from './services/api';

export default function App() {
  const { isForecastPanelOpen, toggleForecastPanel } =
    useAppStore();

  const { data: puneData, isLoading, isError } = useQuery({
    queryKey: ['puneAirQuality'],
    queryFn: fetchPuneDataset,
  });

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#060606] font-sans select-none">
      {/* ── 1. Map ── */}
      <AirQualityMap />

      {/* ── 2. Top Bar ── */}
      <header
        className="
          absolute top-4 left-4 z-10
          flex items-center gap-3
          bg-[#0e0e0e] border border-[#2a2a2a]
          rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.6)]
          px-5 py-3
        "
      >
        {/* Live pulse dot */}
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#4285f4] opacity-60" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#4285f4]" />
        </span>

        <h1 className="text-[15px] font-medium tracking-[-0.1px] text-white">
          Air Quality Lab
        </h1>

        <span className="text-[12px] text-[#5f6368] px-2.5 py-1 rounded-full border border-[#2a2a2a] bg-[#161616]">
          Pune, MH
        </span>

        {/* Forecast panel toggle */}
        <button
          type="button"
          onClick={toggleForecastPanel}
          title={isForecastPanelOpen ? 'Hide forecast' : 'Show forecast'}
          className={`
            ml-1 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium
            border transition-all duration-200
            ${isForecastPanelOpen
              ? 'bg-[#1a3a6e] border-[#2a5bb0] text-[#7baff7]'
              : 'bg-[#1a1a1a] border-[#2a2a2a] text-[#6f6f6f] hover:text-[#bbbbbb] hover:border-[#3a3a3a]'
            }
          `}
        >
          {/* Bar-chart icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3"  y="12" width="4" height="9" rx="1" />
            <rect x="10" y="7"  width="4" height="14" rx="1" />
            <rect x="17" y="3"  width="4" height="18" rx="1" />
          </svg>
          Forecast
        </button>
      </header>

      {/* ── 3. Left Control Panel ──
      <aside
        className="
          absolute top-[72px] left-4 z-10
          w-48
          bg-[#0e0e0e] border border-[#2a2a2a]
          rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.6)]
          p-4
        "
      >
        <p className="text-[9px] font-medium uppercase tracking-[0.18em] text-[#6f6f6f] mb-3">
          Parameter
        </p>
        <div className="flex flex-col gap-1">
          {POLLUTANTS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setPollutant(key)}
              className={`
                px-3 py-2 rounded-[10px] text-left text-[12px] font-medium
                transition-all duration-150
                ${selectedPollutant === key
                  ? 'bg-[#1769d1] text-white'
                  : 'text-[#888888] hover:text-[#cccccc] hover:bg-[#1a1a1a]'
                }
              `}
            >
              {label}
            </button>
          ))}
        </div>
      </aside> */}

      {/* ── 4. Timeline (shifts left when forecast panel is open) ── */}
      <TimeController forecastOpen={isForecastPanelOpen} />

      {/* ── 5. Forecast Panel ── */}
      {isForecastPanelOpen && puneData && (
        <ForecastPanel data={puneData} onClose={toggleForecastPanel} />
      )}

      {/* Loading badge */}
      {isLoading && (
        <div
          className="
            absolute top-4 right-4 z-20
            bg-[#0e0e0e] border border-[#2a2a2a]
            px-3 py-1.5 rounded-full
            text-[10px] text-[#4285f4] tracking-widest animate-pulse
          "
        >
          Loading dataset…
        </div>
      )}

      {/* Error badge */}
      {isError && (
        <div
          className="
            absolute top-4 right-4 z-20
            bg-[#1e0a0a] border border-[#5c2a2a]
            text-[#f28b82] px-3 py-1.5 rounded-full text-[10px]
          "
        >
          Failed to load dataset
        </div>
      )}
    </div>
  );
}
