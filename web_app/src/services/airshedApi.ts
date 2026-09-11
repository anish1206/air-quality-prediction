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
  us_aqi: number;
  pm2_5: number;
  pm10: number;
  no2?: number;
  nitrogen_dioxide?: number;
  temp: number;
  humidity: number;
  wind_speed: number;
  wind_dir: number;
  wind_u: number;
  wind_v: number;
  chhi_score?: number;
  anomaly_z_score?: number;
  hazard_level: string;
  is_trigger_active: boolean;
}

interface RawPayload {
  generated_at: string;
  forecast_horizon_hours: number;
  time_steps: Array<Omit<AirshedTimeStep, 'nodes'> & { nodes: Record<string, RawCityNode> }>;
  clusters: AirshedNetworkPayload['clusters'];
  causal_edges: CausalNetworkEdge[];
}

const normalizeNode = (raw: RawCityNode): CityNodeStatus => {
  const no2 = raw.nitrogen_dioxide ?? raw.no2 ?? 0;
  const chhi = raw.chhi_score ?? zToChhi(raw.anomaly_z_score ?? 0);
  return {
    city_name: raw.city_name,
    cluster_id: raw.cluster_id,
    latitude: raw.latitude,
    longitude: raw.longitude,
    us_aqi: raw.us_aqi,
    pm2_5: raw.pm2_5,
    pm10: raw.pm10,
    nitrogen_dioxide: no2,
    temp: raw.temp,
    humidity: raw.humidity,
    wind_speed: raw.wind_speed,
    wind_dir: raw.wind_dir,
    wind_u: raw.wind_u,
    wind_v: raw.wind_v,
    chhi_score: chhi,
    hazard_level: normalizeHazard(raw.hazard_level, chhi),
    is_trigger_active: raw.is_trigger_active,
  };
};

export const fetchAirshedPayload = async (): Promise<AirshedNetworkPayload> => {
  const res = await fetch('/airshed_data.json');
  if (!res.ok) throw new Error('Failed to load airshed intelligence dataset');
  const raw = (await res.json()) as RawPayload;
  return {
    generated_at: raw.generated_at,
    forecast_horizon_hours: raw.forecast_horizon_hours,
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
