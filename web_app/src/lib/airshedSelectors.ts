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

export const getHazardStyle = (score: number | null | undefined) => {
  if (score === null || score === undefined || isNaN(score)) {
    return { label: 'No Data', color: '#9ca3af', bg: 'rgba(156,163,175,0.10)', border: 'rgba(156,163,175,0.30)' };
  }
  if (score <= 25) return { label: 'Low Risk', color: '#27ae60', bg: 'rgba(39,174,96,0.10)', border: 'rgba(39,174,96,0.30)' };
  if (score <= 50) return { label: 'Moderate Risk', color: '#f39c12', bg: 'rgba(243,156,18,0.10)', border: 'rgba(243,156,18,0.30)' };
  if (score <= 75) return { label: 'High Hazard', color: '#e67e22', bg: 'rgba(230,126,34,0.10)', border: 'rgba(230,126,34,0.30)' };
  return { label: 'Critical Hazard', color: '#c00000', bg: 'rgba(192,0,0,0.10)', border: 'rgba(192,0,0,0.30)' };
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

    const validChhi = nodes.map(n => n.chhi_score).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
    const validAqi = nodes.map(n => n.us_aqi).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
    const validPm25 = nodes.map(n => n.pm2_5).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
    const validTemp = nodes.map(n => n.temp).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
    const validWind = nodes.map(n => n.wind_speed).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));

    days.push({
      offset: d - 3,
      date_str: slots[0]?.date_formatted?.split(',')[0] ?? `D${d - 3}`,
      chhi_score: validChhi.length ? validChhi.reduce((a, b) => a + b, 0) / validChhi.length : 0,
      us_aqi: validAqi.length ? validAqi.reduce((a, b) => a + b, 0) / validAqi.length : 0,
      pm2_5: validPm25.length ? validPm25.reduce((a, b) => a + b, 0) / validPm25.length : 0,
      temp_max: validTemp.length ? Math.max(...validTemp) : 0,
      temp_min: validTemp.length ? Math.min(...validTemp) : 0,
      wind_speed_max: validWind.length ? Math.max(...validWind) : 0,
      isObserved: slots.every((s) => s.is_observed),
      sub_daily: slots.map((s, i) => {
        const n = s.nodes[cityId];
        return {
          time: s.hour_ist ?? SLOT_TIMES[i],
          date_str: s.date_formatted,
          chhi_score: n?.chhi_score ?? 0,
          hazard_category: n?.hazard_level ?? 'Unknown',
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
