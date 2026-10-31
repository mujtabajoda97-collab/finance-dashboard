/**
 * Set NEXT_PUBLIC_SCHEMA_V3=1 only after migration 0003 has been applied to the database.
 * Until then the app works with the original schema (no idempotency keys are sent).
 */
export const SCHEMA_V3 = process.env.NEXT_PUBLIC_SCHEMA_V3 === '1';

export function newRequestId(): string | null {
  if (!SCHEMA_V3) return null;
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : null;
}
