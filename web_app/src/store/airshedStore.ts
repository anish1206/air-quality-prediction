import { create } from 'zustand';
import type { AirshedMetric, AirshedNetworkPayload, CityNodeStatus, LayerVisibility } from '../types/airshed';
import { TOTAL_STEPS, stepToDayOffset, toSubStep, stepToSlot, zToChhi } from '../lib/airshedSelectors';

export { SLOTS_PER_DAY, TOTAL_STEPS, SLOT_TIMES, SLOT_LABELS, stepToDayOffset, stepToSlot, toSubStep } from '../lib/airshedSelectors';

// ── Enrich raw JSON nodes with derived fields ─────────────────────────────────
// The JSON has `no2` and `anomaly_z_score` but the UI expects `nitrogen_dioxide`
// and `chhi_score`. We compute them once on load so all consumers just read them.
const enrichPayload = (raw: AirshedNetworkPayload): AirshedNetworkPayload => ({
    ...raw,
    time_steps: raw.time_steps.map((ts) => ({
        ...ts,
        nodes: Object.fromEntries(
            Object.entries(ts.nodes).map(([id, n]) => {
                const chhi = zToChhi((n as any).anomaly_z_score ?? 0);
                const enriched: CityNodeStatus = {
                    ...n,
                    chhi_score: chhi,
                    nitrogen_dioxide: (n as any).no2 ?? (n as any).nitrogen_dioxide ?? 0,
                };
                return [id, enriched];
            }),
        ),
    })),
});

interface AirshedState {
    payload: AirshedNetworkPayload | null;
    selectedCityId: string;
    selectedSubStep: number;
    selectedTimestamp: number;
    selectedClusterFilter: number | null;
    selectedMetric: AirshedMetric;
    layerVisibility: LayerVisibility;
    isForecastPanelOpen: boolean;
    isLayerPanelOpen: boolean;

    setPayload: (payload: AirshedNetworkPayload) => void;
    setCityId: (id: string) => void;
    setSubStep: (step: number) => void;
    setTimestamp: (t: number | ((prev: number) => number)) => void;
    setClusterFilter: (id: number | null) => void;
    setMetric: (metric: AirshedMetric) => void;
    toggleLayer: (layer: keyof LayerVisibility) => void;
    toggleForecastPanel: () => void;
    toggleLayerPanel: () => void;
}

export const useAirshedStore = create<AirshedState>((set) => ({
    payload: null,
    selectedCityId: 'PUN',
    selectedSubStep: 18,
    selectedTimestamp: 0,
    selectedClusterFilter: null,
    selectedMetric: 'chhi_score',
    layerVisibility: { edges: true, pulses: true, plumes: true, pins: true, cloudField: true },
    isForecastPanelOpen: true,
    isLayerPanelOpen: true,

    setPayload: (payload) => set({ payload: enrichPayload(payload) }),
    setCityId: (id) => set({ selectedCityId: id }),
    setSubStep: (s) => {
        const step = Math.max(0, Math.min(TOTAL_STEPS - 1, s));
        return set({ selectedSubStep: step, selectedTimestamp: stepToDayOffset(step) });
    },
    setTimestamp: (t) =>
        set((state) => {
            const newTs = typeof t === 'function' ? t(state.selectedTimestamp) : t;
            const slot = stepToSlot(state.selectedSubStep);
            return { selectedTimestamp: newTs, selectedSubStep: toSubStep(newTs, slot) };
        }),
    setClusterFilter: (id) => set({ selectedClusterFilter: id }),
    setMetric: (metric) => set({ selectedMetric: metric }),
    toggleLayer: (layer) =>
        set((state) => ({
            layerVisibility: { ...state.layerVisibility, [layer]: !state.layerVisibility[layer] },
        })),
    toggleForecastPanel: () => set((state) => ({ isForecastPanelOpen: !state.isForecastPanelOpen })),
    toggleLayerPanel: () => set((state) => ({ isLayerPanelOpen: !state.isLayerPanelOpen })),
}));

/** @deprecated use useAirshedStore */
export const useAppStore = useAirshedStore;
