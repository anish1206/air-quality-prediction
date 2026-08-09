import { create } from 'zustand';

interface AppState {
  selectedPollutant: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide';
  selectedTimestamp: number;
  isForecastPanelOpen: boolean;
  isLayerPanelOpen: boolean;

  setPollutant: (p: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide') => void;
  setTimestamp: (t: number | ((prev: number) => number)) => void;
  toggleForecastPanel: () => void;
  toggleLayerPanel: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedPollutant: 'us_aqi',
  selectedTimestamp: 0,
  isForecastPanelOpen: true,
  isLayerPanelOpen: true,

  setPollutant: (p) => set({ selectedPollutant: p }),
  setTimestamp: (t) =>
    set((state) => ({
      selectedTimestamp: typeof t === 'function' ? t(state.selectedTimestamp) : t,
    })),
  toggleForecastPanel: () =>
    set((state) => ({ isForecastPanelOpen: !state.isForecastPanelOpen })),
  toggleLayerPanel: () =>
    set((state) => ({ isLayerPanelOpen: !state.isLayerPanelOpen })),
}));