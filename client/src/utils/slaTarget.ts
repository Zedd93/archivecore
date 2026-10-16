export function slaTargetStatus(completed: number, breached: number, target: number): 'below' | 'met' | 'noData' {
  if (completed === 0) return 'noData';
  const rate = Math.round((completed - breached) / completed * 100);
  return rate < target ? 'below' : 'met';
}
