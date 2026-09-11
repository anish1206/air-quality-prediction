export type HazardLevel =
  | 'Low Risk'
  | 'Moderate Risk'
  | 'High Hazard'
  | 'Critical Hazard';

export type AirshedMetric = 'chhi_score' | 'us_aqi' | 'pm2_5' | 'nitrogen_dioxide';

export interface AirshedNetworkPayload {
  generated_at: string;
  forecast_horizon_hours: number;
  time_steps: AirshedTimeStep[];
  clusters: AirshedClusterDefinition[];
  causal_edges: CausalNetworkEdge[];
}

export interface AirshedTimeStep {
  step_index: number;
  offset_days: number;
  hour_ist: string;
  date_formatted: string;
  is_observed: boolean;
  nodes: Record<string, CityNodeStatus>;
  active_cascade_pulses: ActiveCascadePulse[];
}

export interface CityNodeStatus {
  city_name: string;
  cluster_id: number;
  latitude: number;
  longitude: number;
  us_aqi: number;
  pm2_5: number;
  pm10: number;
  nitrogen_dioxide: number;
  temp: number;
  humidity: number;
  wind_speed: number;
  wind_dir: number;
  wind_u: number;
  wind_v: number;
  chhi_score: number;
  hazard_level: HazardLevel;
  is_trigger_active: boolean;
}

export interface CausalNetworkEdge {
  source_node: string;
  target_node: string;
  cluster_id: number;
  correlation_coefficient: number;
  delay_hours: number;
  granger_p_value: number | null;
  corridor_bearing_deg: number;
  transmission_type: string;
}

export interface ActiveCascadePulse {
  pulse_id: string;
  source_node: string;
  target_node: string;
  progress_ratio: number;
  estimated_arrival_ist: string;
  confidence_pct: number;
  severity_delta_pm25: number;
}

export interface AirshedClusterDefinition {
  cluster_id: number;
  cluster_name: string;
  dominant_mechanism: string;
  member_cities: string[];
  color_hex: string;
}

export interface LayerVisibility {
  edges: boolean;
  pulses: boolean;
  plumes: boolean;
  pins: boolean;
}
