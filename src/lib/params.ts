import { useLocalSearchParams } from 'expo-router';

/** Reads lab/QA overrides from the URL (?seed=7&t=0.5&paper=cotton) so screenshots are reproducible. */
export function useLabParams() {
  const p = useLocalSearchParams<{ seed?: string; t?: string; paper?: string; ink?: string; font?: string }>();
  const num = (v?: string) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);
  return { seed: num(p.seed), t: num(p.t), paper: p.paper, ink: p.ink, font: p.font };
}
