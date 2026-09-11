import type {
  AirshedNetworkPayload,
  AirshedTimeStep,
  CityNodeStatus,
  HazardLevel,
} from '../types/airshed';
import { CITY_META, CLUSTER_DISPLAY } from './cityMeta';

export const SLOTS_PER_DAY = 6;
export const TOTAL_STEPS = 42;
export const SLOT_TIMES = ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00'];
export const SLOT_LABELS = ['Night', 'Early Dawn', 'Morning', 'Midday', 'Afternoon', 'Evening'];

export const stepToDayOffset = (step: number) => Math.floor(step / SLOTS_PER_DAY) - 3;
export const stepToSlot = (step: number) => step % SLOTS_PER_DAY;
export const toSubStep = (dayOffset: number, slot: number) =>
  (dayOffset + 3) * SLOTS_PER_DAY + slot;

export const zToChhi = (z: number) => Math.max(0, Math.min(100, 42 + z * 16));

export const normalizeHazard = (raw: string, chhi: number): HazardLevel => {
  const key = raw.toLowerCase();
  if (key.includes('critical')) return 'Critical Hazard';
  if (key.includes('high')) return 'High Hazard';
  if (key.includes('moderate')) return 'Moderate Risk';
  if (key.includes('low')) return 'Low Risk';
  if (chhi <= 25) return 'Low Risk';
  if (chhi <= 50) return 'Moderate Risk';
  if (chhi <= 75) return 'High Hazard';
  return 'Critical Hazard';
};

export const getHazardStyle = (score: number) => {
  if (score <= 25) return { label: 'Low Risk', color: '#10b981', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)' };
  if (score <= 50) return { label: 'Moderate Risk', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' };
  if (score <= 75) return { label: 'High Hazard', color: '#f97316', bg: 'rgba(249,115,22,0.08)', border: 'rgba(249,115,22,0.25)' };
  return { label: 'Critical Hazard', color: '#e11d48', bg: 'rgba(225,29,72,0.08)', border: 'rgba(225,29,72,0.25)' };
};

export const clusterColor = (clusterId: number, payload?: AirshedNetworkPayload | null) => {
  const fromData = payload?.clusters.find((c) => c.cluster_id === clusterId)?.color_hex;
  if (fromData && CLUSTER_DISPLAY[clusterId]) {
    if (payload!.clusters.filter((c) => c.color_hex === fromData).length > 1) {
      return CLUSTER_DISPLAY[clusterId].color;
    }
    return fromData;
  }
  return CLUSTER_DISPLAY[clusterId]?.color ?? '#38bdf8';
};

export const clusterLabel = (clusterId: number, payload?: AirshedNetworkPayload | null) => {
  const name = payload?.clusters.find((c) => c.cluster_id === clusterId)?.cluster_name;
  const unique = payload?.clusters.filter((c) => c.cluster_name === name).length === 1;
  if (name && unique) return name;
  return CLUSTER_DISPLAY[clusterId]?.short ?? `Airshed ${clusterId}`;
};

export const getStep = (payload: AirshedNetworkPayload | null, step: number): AirshedTimeStep | undefined =>
  payload?.time_steps[Math.max(0, Math.min(TOTAL_STEPS - 1, step))];

export const getNode = (
  payload: AirshedNetworkPayload | null,
  step: number,
  cityId: string,
): CityNodeStatus | undefined => getStep(payload, step)?.nodes[cityId];

export const cityLabel = (cityId: string, node?: CityNodeStatus) =>
  node?.city_name ?? CITY_META[cityId]?.name ?? cityId;

export const formatEta = (isoLike: string) => {
  const cleaned = isoLike.replace(' ', 'T');
  const d = new Date(cleaned);
  if (Number.isNaN(d.getTime())) return isoLike;
  return d.toLocaleString('en-IN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export interface DayForecast {
  offset: number;
  date_str: string;
  chhi_score: number;
  us_aqi: number;
  pm2_5: number;
  temp_max: number;
  temp_min: number;
  wind_speed_max: number;
  isObserved: boolean;
  sub_daily: {
    time: string;
    date_str: string;
    chhi_score: number;
    hazard_category: string;
    us_aqi: number;
    pm2_5: number;
    pm10: number;
    nitrogen_dioxide: number;
    wind_speed: number;
    wind_dir: number;
    temp: number;
  }[];
}

export const buildCityForecast = (payload: AirshedNetworkPayload, cityId: string): DayForecast[] => {
  const days: DayForecast[] = [];
  for (let d = 0; d < 7; d += 1) {
    const slots = payload.time_steps.slice(d * SLOTS_PER_DAY, d * SLOTS_PER_DAY + SLOTS_PER_DAY);
    const nodes = slots.map((s) => s.nodes[cityId]).filter(Boolean);
    if (!nodes.length) continue;
    days.push({
      offset: d - 3,
      date_str: slots[0]?.date_formatted?.split(',')[0] ?? `D${d - 3}`,
      chhi_score: nodes.reduce((a, n) => a + n.chhi_score, 0) / nodes.length,
      us_aqi: nodes.reduce((a, n) => a + n.us_aqi, 0) / nodes.length,
      pm2_5: nodes.reduce((a, n) => a + n.pm2_5, 0) / nodes.length,
      temp_max: Math.max(...nodes.map((n) => n.temp)),
      temp_min: Math.min(...nodes.map((n) => n.temp)),
      wind_speed_max: Math.max(...nodes.map((n) => n.wind_speed)),
      isObserved: slots.every((s) => s.is_observed),
      sub_daily: slots.map((s, i) => {
        const n = s.nodes[cityId];
        return {
          time: s.hour_ist ?? SLOT_TIMES[i],
          date_str: s.date_formatted,
          chhi_score: n?.chhi_score ?? 0,
          hazard_category: n?.hazard_level ?? 'Low Risk',
          us_aqi: n?.us_aqi ?? 0,
          pm2_5: n?.pm2_5 ?? 0,
          pm10: n?.pm10 ?? 0,
          nitrogen_dioxide: n?.nitrogen_dioxide ?? 0,
          wind_speed: n?.wind_speed ?? 0,
          wind_dir: n?.wind_dir ?? 0,
          temp: n?.temp ?? 0,
        };
      }),
    });
  }
  return days;
};
