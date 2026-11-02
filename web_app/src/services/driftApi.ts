import type { DriftSummaryPayload } from '../types/drift';

export const fetchDriftSummary = async (): Promise<DriftSummaryPayload> => {
  const res = await fetch('/drift_summary.json');
  if (!res.ok) {
    throw new Error('Failed to load model drift and calibration summary');
  }
  return res.json() as Promise<DriftSummaryPayload>;
};

