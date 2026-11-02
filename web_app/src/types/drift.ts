export interface DailyDriftRecord {
  date: string;
  timestamp: string;
  overall_mae: number;
  overall_rmse: number;
  overall_bias: number;
  psi: Record<string, number>;
  city_mae: Record<string, number>;
}

export interface CityPerformance {
  avg_mae: number;
  current_bias: number;
}

export interface CalibrationStatus {
  updated_at?: string;
  alpha: number;
  max_clamp: number;
}

export interface DriftSummaryPayload {
  updated_at: string;
  latest_mae: number;
  latest_rmse: number;
  latest_bias: number;
  history_30d: DailyDriftRecord[];
  psi_metrics: Record<string, number>;
  city_performance: Record<string, CityPerformance>;
  calibration_status: CalibrationStatus;
}

