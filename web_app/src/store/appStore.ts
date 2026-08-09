import { create } from 'zustand';

// 7 days × 6 sub-daily slots = 42 total steps
// step 0 = day T-3 / 00:00,  step 41 = day T+3 / 20:00
export const SLOTS_PER_DAY = 6;
export const TOTAL_STEPS   = 42; // 7 × 6

export const SLOT_TIMES  = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
export const SLOT_LABELS = ['Night', 'Early Dawn', 'Morning', 'Midday', 'Afternoon', 'Evening'];

/** Convert global sub-step (0–41) → day offset (-3 … +3) */
export const stepToDayOffset = (step: number) => Math.floor(step / SLOTS_PER_DAY) - 3;
/** Convert global sub-step → slot index within day (0–5) */
export const stepToSlot      = (step: number) => step % SLOTS_PER_DAY;
/** Convert day offset + slot → global step */
export const toSubStep = (dayOffset: number, slot: number) =>
  (dayOffset + 3) * SLOTS_PER_DAY + slot;

interface AppState {
  selectedPollutant: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide';
  // Legacy per-day cursor (kept for ForecastPanel column highlighting)
  selectedTimestamp: number; // -3 … +3
  // New sub-daily cursor
  selectedSubStep: number;   // 0 … 41

  isForecastPanelOpen: boolean;
  isLayerPanelOpen: boolean;

  setPollutant:  (p: 'us_aqi' | 'pm2_5' | 'pm10' | 'nitrogen_dioxide') => void;
  setTimestamp:  (t: number | ((prev: number) => number)) => void;
  setSubStep:    (s: number) => void;
  nextSubStep:   () => void;
  prevSubStep:   () => void;
  toggleForecastPanel: () => void;
  toggleLayerPanel:    () => void;
}

export const useAppStore = create<AppState>((set) => ({
  selectedPollutant:   'us_aqi',
  selectedTimestamp:   0,
  selectedSubStep:     18, // default = day T (offset 0), slot 0 → step 18

  isForecastPanelOpen: true,
  isLayerPanelOpen:    true,

  setPollutant: (p) => set({ selectedPollutant: p }),

  setTimestamp: (t) =>
    set((state) => {
      const newTs = typeof t === 'function' ? t(state.selectedTimestamp) : t;
      // Keep sub-step's slot, jump to new day
      const slot  = stepToSlot(state.selectedSubStep);
      return {
        selectedTimestamp: newTs,
        selectedSubStep:   toSubStep(newTs, slot),
      };
    }),

  setSubStep: (s) =>
    set({
      selectedSubStep:   Math.max(0, Math.min(TOTAL_STEPS - 1, s)),
      selectedTimestamp: stepToDayOffset(Math.max(0, Math.min(TOTAL_STEPS - 1, s))),
    }),

  nextSubStep: () =>
    set((state) => {
      const next = Math.min(state.selectedSubStep + 1, TOTAL_STEPS - 1);
      return { selectedSubStep: next, selectedTimestamp: stepToDayOffset(next) };
    }),

  prevSubStep: () =>
    set((state) => {
      const prev = Math.max(state.selectedSubStep - 1, 0);
      return { selectedSubStep: prev, selectedTimestamp: stepToDayOffset(prev) };
    }),

  toggleForecastPanel: () =>
    set((state) => ({ isForecastPanelOpen: !state.isForecastPanelOpen })),
  toggleLayerPanel: () =>
    set((state) => ({ isLayerPanelOpen: !state.isLayerPanelOpen })),
}));
