export function formatIdentityConflict(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'Identity conflict requires readback.';
  const record = value as Record<string, unknown>;
  const reason = typeof record.kind === 'string' ? record.kind : typeof record.reason === 'string' ? record.reason : 'identity conflict';
  const detail = typeof record.error === 'string' ? `: ${record.error.slice(0, 240)}` : '';
  return `${reason.replaceAll('_', ' ')}${detail}`;
}
