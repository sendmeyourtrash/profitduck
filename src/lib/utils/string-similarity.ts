/**
 * Bigram (Dice coefficient) string similarity.
 * Returns 0-1 where 1 = identical, 0 = no overlap.
 */
export function bigramSimilarity(a: string, b: string): number {
  const sa = a.toLowerCase().trim();
  const sb = b.toLowerCase().trim();
  if (sa === sb) return 1;
  if (sa.length < 2 || sb.length < 2) return 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < sa.length - 1; i++) bigramsA.add(sa.slice(i, i + 2));

  const bigramsB = new Set<string>();
  for (let i = 0; i < sb.length - 1; i++) bigramsB.add(sb.slice(i, i + 2));

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/**
 * Find best matches for a needle among candidates.
 * Returns top N matches above the threshold, sorted by score descending.
 */
export function findBestMatches<T extends { name: string }>(
  needle: string,
  candidates: T[],
  topN = 2,
  threshold = 0.3
): Array<T & { score: number }> {
  const scored = candidates
    .map((c) => ({ ...c, score: bigramSimilarity(needle, c.name) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, topN);
}
