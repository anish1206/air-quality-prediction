import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import AirshedNetworkMap from './components/map/AirshedNetworkMap';
import TimeController from './components/timeline/TimeController';
import ForecastPanel from './components/forecast/ForecastPanel';
import ControlPanel from './components/controls/ControlPanel';
import { useAirshedStore } from './store/airshedStore';
import { fetchAirshedPayload } from './services/airshedApi';

export default function App() {
  const {
    payload, setPayload,
    isForecastPanelOpen, toggleForecastPanel,
    isLayerPanelOpen, toggleLayerPanel,
  } = useAirshedStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['airshedNetwork'],
    queryFn: fetchAirshedPayload,
  });

  useEffect(() => {
    if (data) setPayload(data);
  }, [data, setPayload]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0a0a0a] font-sans select-none">
      <AirshedNetworkMap />

      <header className="absolute top-4 left-4 z-10 flex items-center gap-3 bg-[#000000] border border-[#2a2a2a] rounded-[20px] shadow-[0_8px_32px_rgba(0,0,0,0.6)] px-5 py-3">
        <h1 className="text-[15px] font-medium tracking-[-0.1px] text-white">
          NAICEWS <span className="text-white/35">•</span> National Airshed Intelligence
        </h1>
        <span className="text-[12px] text-white px-2.5 py-1 rounded-full border border-[#2a2a2a] bg-[#161616]">
          20 Nodes · 4 Regimes
        </span>

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2 2 7l10 5 10-5-10-5Z"/>
            <path d="m2 12 10 5 10-5"/>
            <path d="m2 17 10 5 10-5"/>
          </svg>
          Layers
        </button>

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

      <ControlPanel />
      <TimeController forecastOpen={isForecastPanelOpen} layerOpen={isLayerPanelOpen} />

      {isForecastPanelOpen && payload && (
        <ForecastPanel payload={payload} onClose={toggleForecastPanel} />
      )}

      {isLoading && (
        <div className="absolute top-4 right-4 z-20 bg-[#0e0e0e] border border-[#2a2a2a] px-3 py-1.5 rounded-full text-[10px] text-[#38bdf8] tracking-widest animate-pulse">
          Loading airshed intelligence…
        </div>
      )}
      {isError && (
        <div className="absolute top-4 right-4 z-20 bg-[#1e0a0a] border border-[#5c2a2a] text-[#f28b82] px-3 py-1.5 rounded-full text-[10px]">
          Failed to load airshed dataset
        </div>
      )}
    </div>
  );
}
