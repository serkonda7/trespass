// Name normalization helpers for duplicate detection (DESIGN §4). Simple and
// deterministic: normalized substring match or a trigram Jaccard of >= 0.5.
import { normalizeSearchText } from "../normalize";

function trigrams(value: string): Set<string> {
  const padded = `  ${value} `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) out.add(padded.slice(i, i + 3));
  return out;
}

/** Jaccard similarity over character trigrams, in [0, 1]. */
export function trigramJaccard(a: string, b: string): number {
  const left = trigrams(normalizeSearchText(a));
  const right = trigrams(normalizeSearchText(b));
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const t of left) if (right.has(t)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

/** True when either normalized name contains the other, or trigrams overlap >= 0.5. */
export function similarNames(a: string, b: string): boolean {
  const x = normalizeSearchText(a);
  const y = normalizeSearchText(b);
  if (!x || !y) return false;
  if (x.includes(y) || y.includes(x)) return true;
  return trigramJaccard(x, y) >= 0.5;
}
