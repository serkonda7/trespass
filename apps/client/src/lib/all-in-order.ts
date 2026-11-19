/**
 * Like Promise.all for route loaders, but waits for every promise and then
 * rethrows the first rejection in argument order. A loader that lists its
 * not-found check first therefore always answers 404 for an invisible item,
 * even when a later request (e.g. an admin/member-only list) fails faster.
 */
export async function allInOrder<const T extends readonly unknown[]>(
  ...promises: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(promises);
  for (const r of results) if (r.status === "rejected") throw r.reason;
  return results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as never;
}
