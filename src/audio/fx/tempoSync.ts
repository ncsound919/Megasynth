/** Converts a note division string into real milliseconds given a BPM. */
export function divisionToMs(division: string, bpm: number): number {
  const quarterMs = 60000 / bpm;
  const table: Record<string, number> = {
    '1/1': quarterMs * 4,
    '1/2': quarterMs * 2,
    '1/4': quarterMs,
    '1/8': quarterMs / 2,
    '1/16': quarterMs / 4,
    '1/32': quarterMs / 8,
    '1/4T': (quarterMs * 2) / 3,
    '1/8T': quarterMs / 3,
    '1/16T': quarterMs / 6,
    '1/4D': quarterMs * 1.5,
    '1/8D': quarterMs * 0.75,
    '1/16D': quarterMs * 0.375,
  };
  return table[division] ?? quarterMs / 2;
}
