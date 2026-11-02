import type {
  AirshedNetworkPayload,
  AirshedTimeStep,
  CityNodeStatus,
  CausalNetworkEdge,
} from '../types/airshed';
import { normalizeHazard, zToChhi } from '../lib/airshedSelectors';

interface RawCityNode {
  city_name: string;
  cluster_id: number;
  latitude: number;
  longitude: number;
  us_aqi?: number | null;
  pm2_5?: number | null;
  pm10?: number | null;
  no2?: number | null;
  nitrogen_dioxide?: number | null;
  temp?: number | null;
  humidity?: number | null;
  wind_speed?: number | null;
  wind_dir?: number | null;
  wind_u?: number | null;
  wind_v?: number | null;
  surface_pressure?: number | null;
  chhi_score?: number | null;
  anomaly_z_score?: number | null;
  hazard_level?: string;
  is_trigger_active?: boolean;
  data_available?: boolean;
}

interface RawPayload {
  generated_at: string;
  forecast_horizon_hours: number;
  time_steps: Array<Omit<AirshedTimeStep, 'nodes'> & { nodes: Record<string, RawCityNode> }>;
  clusters: AirshedNetworkPayload['clusters'];
  causal_edges: CausalNetworkEdge[];
}

const normalizeNode = (raw: RawCityNode): CityNodeStatus => {
  const isAvailable = raw.data_available ?? (raw.pm2_5 !== null && raw.pm2_5 !== undefined);

  if (!isAvailable) {
    return {
      city_name: raw.city_name,
      cluster_id: raw.cluster_id,
      latitude: raw.latitude,
      longitude: raw.longitude,
      us_aqi: null,
      pm2_5: null,
      pm10: null,
      no2: null,
      nitrogen_dioxide: null,
      temp: null,
      humidity: null,
      wind_speed: null,
      wind_dir: null,
      wind_u: null,
      wind_v: null,
      surface_pressure: null,
      anomaly_z_score: null,
      chhi_score: null,
      hazard_level: 'Unknown',
      is_trigger_active: false,
      data_available: false,
    };
  }

  const no2 = raw.nitrogen_dioxide ?? raw.no2 ?? null;
  const chhi = raw.chhi_score ?? (raw.anomaly_z_score !== null && raw.anomaly_z_score !== undefined ? zToChhi(raw.anomaly_z_score) : null);
  return {
    city_name: raw.city_name,
    cluster_id: raw.cluster_id,
    latitude: raw.latitude,
    longitude: raw.longitude,
    us_aqi: raw.us_aqi ?? null,
    pm2_5: raw.pm2_5 ?? null,
    pm10: raw.pm10 ?? null,
    no2,
    nitrogen_dioxide: no2,
    temp: raw.temp ?? null,
    humidity: raw.humidity ?? null,
    wind_speed: raw.wind_speed ?? null,
    wind_dir: raw.wind_dir ?? null,
    wind_u: raw.wind_u ?? null,
    wind_v: raw.wind_v ?? null,
    surface_pressure: raw.surface_pressure ?? null,
    anomaly_z_score: raw.anomaly_z_score ?? null,
    chhi_score: chhi,
    hazard_level: chhi !== null ? normalizeHazard(raw.hazard_level || '', chhi) : 'Unknown',
    is_trigger_active: Boolean(raw.is_trigger_active),
    data_available: true,
  };
};

export const fetchAirshedPayload = async (): Promise<AirshedNetworkPayload> => {
  const res = await fetch('/airshed_data.json');
  if (!res.ok) throw new Error('Failed to load airshed intelligence dataset');
  const raw = (await res.json()) as RawPayload;
  return {
    generated_at: raw.generated_at,
    forecast_horizon_hours: raw.forecast_horizon_hours,
    staleness_max_hours: (raw as any).staleness_max_hours ?? 30,
    clusters: raw.clusters,
    causal_edges: raw.causal_edges,
    time_steps: raw.time_steps.map((step) => ({
      ...step,
      nodes: Object.fromEntries(
        Object.entries(step.nodes).map(([id, node]) => [id, normalizeNode(node)]),
      ),
    })),
  };
};
