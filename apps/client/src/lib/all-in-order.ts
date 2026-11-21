/**
 * Promise.all that settles everything, then rethrows the first rejection in
 * argument order — so a loader's leading not-found check always wins.
 */
export async function allInOrder<const T extends readonly unknown[]>(
  ...promises: T
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }> {
  const results = await Promise.allSettled(promises);
  for (const r of results) if (r.status === "rejected") throw r.reason;
  return results.map((r) => (r as PromiseFulfilledResult<unknown>).value) as never;
}
