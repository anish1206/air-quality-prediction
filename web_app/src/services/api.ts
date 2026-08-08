import type { DayData } from '../components/forecast/ForecastPanel';

export const fetchPuneDataset = async (): Promise<DayData[]> => {
  const response = await fetch('/pune_data.json');
  if (!response.ok) {
    throw new Error('Failed to load real Pune dataset');
  }
  return response.json();
};