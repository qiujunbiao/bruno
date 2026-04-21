/**
 * Hosted OpenCollection docs scroll to `section-${dn(yn(item))}` where
 * `yn` prefers `id` / `uid` over display names. Without a stable `id`,
 * duplicate request names produce duplicate DOM ids and the wrong section scrolls.
 */
export const readOpenCollectionStableId = (body: unknown): string | undefined => {
  const b = body as { id?: unknown; uuid?: unknown } | null | undefined;
  if (typeof b?.id === 'string' && b.id.trim()) {
    return b.id.trim();
  }
  if (typeof b?.uuid === 'string' && b.uuid.trim()) {
    return b.uuid.trim();
  }
  return undefined;
};
