export type HazardLevel =
    | 'Low Risk'
    | 'Moderate Risk'
    | 'High Hazard'
    | 'Critical Hazard'
    | 'Unknown'
    | 'No Data';

export type AirshedMetric = 'chhi_score' | 'us_aqi' | 'pm2_5' | 'nitrogen_dioxide';

export interface AirshedNetworkPayload {
    generated_at: string;
    forecast_horizon_hours: number;
    staleness_max_hours?: number;
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
    us_aqi: number | null;
    pm2_5: number | null;
    pm10: number | null;
    // JSON uses "no2" — keep both so nothing breaks
    no2: number | null;
    nitrogen_dioxide: number | null; // computed alias in selectors
    temp: number | null;
    humidity: number | null;
    wind_speed: number | null;
    wind_dir: number | null;
    wind_u: number | null;
    wind_v: number | null;
    surface_pressure?: number | null;
    anomaly_z_score: number | null;  // raw JSON field
    chhi_score: number | null;        // derived: zToChhi(anomaly_z_score) or null if no data
    hazard_level: HazardLevel;
    is_trigger_active: boolean;
    data_available?: boolean;
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
    cloudField: boolean;
}
