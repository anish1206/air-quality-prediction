export const CITY_META: Record<string, { name: string; state: string; lat: number; lon: number }> = {
  DEL: { name: 'Delhi', state: 'Delhi NCT', lat: 28.6139, lon: 77.209 },
  AGR: { name: 'Agra', state: 'Uttar Pradesh', lat: 27.1767, lon: 78.0081 },
  KNP: { name: 'Kanpur', state: 'Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
  LKO: { name: 'Lucknow', state: 'Uttar Pradesh', lat: 26.8467, lon: 80.9462 },
  VAR: { name: 'Varanasi', state: 'Uttar Pradesh', lat: 25.3176, lon: 82.9739 },
  PAT: { name: 'Patna', state: 'Bihar', lat: 25.5941, lon: 85.1376 },
  KOL: { name: 'Kolkata', state: 'West Bengal', lat: 22.5726, lon: 88.3639 },
  PUN: { name: 'Pune', state: 'Maharashtra', lat: 18.5204, lon: 73.8567 },
  NSK: { name: 'Nashik', state: 'Maharashtra', lat: 19.9975, lon: 73.7898 },
  CSN: { name: 'Chh. Sambhajinagar', state: 'Maharashtra', lat: 19.8762, lon: 75.3433 },
  NAG: { name: 'Nagpur', state: 'Maharashtra', lat: 21.1458, lon: 79.0882 },
  BHO: { name: 'Bhopal', state: 'Madhya Pradesh', lat: 23.2599, lon: 77.4126 },
  IND: { name: 'Indore', state: 'Madhya Pradesh', lat: 22.7196, lon: 75.8577 },
  AHM: { name: 'Ahmedabad', state: 'Gujarat', lat: 23.0225, lon: 72.5714 },
  BOM: { name: 'Mumbai', state: 'Maharashtra', lat: 19.076, lon: 72.8777 },
  SUR: { name: 'Surat', state: 'Gujarat', lat: 21.1702, lon: 72.8311 },
  HYD: { name: 'Hyderabad', state: 'Telangana', lat: 17.385, lon: 78.4867 },
  BLR: { name: 'Bengaluru', state: 'Karnataka', lat: 12.9716, lon: 77.5946 },
  MAA: { name: 'Chennai', state: 'Tamil Nadu', lat: 13.0827, lon: 80.2707 },
  JAI: { name: 'Jaipur', state: 'Rajasthan', lat: 26.9124, lon: 75.7873 },
};

export const CLUSTER_FILTERS: { id: number | null; label: string; sub: string }[] = [
  { id: null, label: 'All India', sub: 'National topology' },
  { id: 0, label: 'IGP Corridor', sub: 'Indo-Gangetic advective' },
  { id: 1, label: 'Deccan Plateau', sub: 'Western thermal stagnation' },
  { id: 2, label: 'Central Inland', sub: 'Eastern Gangetic sink' },
  { id: 3, label: 'Coastal Marine', sub: 'Marine ventilation belt' },
];

export const CLUSTER_DISPLAY: Record<number, { short: string; color: string }> = {
  0: { short: 'IGP Corridor', color: '#f43f5e' },
  1: { short: 'Deccan Plateau', color: '#f59e0b' },
  2: { short: 'Central Inland', color: '#38bdf8' },
  3: { short: 'Coastal Marine', color: '#34d399' },
};
