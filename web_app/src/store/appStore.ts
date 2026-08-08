import { create } from 'zustand';

interface AppState {
  selectedPollutant: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide';
  selectedTimestamp: number; // -3 to +3
  isForecastPanelOpen: boolean;

  setPollutant: (p: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide') => void;
  setTimestamp: (t: number | ((prev: number) => number)) => void;
  toggleForecastPanel: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedPollutant: 'us_aqi',
  selectedTimestamp: 0, // Default to Today
  isForecastPanelOpen: true,

  setPollutant: (p) => set({ selectedPollutant: p }),
  setTimestamp: (t) =>
    set((state) => ({
      selectedTimestamp: typeof t === 'function' ? t(state.selectedTimestamp) : t,
    })),
  toggleForecastPanel: () =>
    set((state) => ({ isForecastPanelOpen: !state.isForecastPanelOpen })),
}));