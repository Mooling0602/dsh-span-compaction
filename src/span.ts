/**
 * Span planning for one summarization call.
 *
 * The stock range selection shadows everything between the surface head and the
 * retained tail, so on a long conversation each summarization request replays
 * the whole history. Lanes that refuse oversized side requests reject that
 * payload before it is forwarded, so one unbounded pass can never make
 * progress. This module picks the largest leading slice of a selected range
 * whose replay fits a budget, and keeps the cut on a tool-pairing boundary.
 *
 * @module dsh-span-compaction/span
 */

/**
 * Inclusive end index of the largest budget-bounded prefix of a range.
 * @param prices - route price of each node in the selected range, oldest first.
 * @param budget - maximum summed price the replayed prefix may carry.
 * @param isBalancedAfter - whether a tool call/result boundary falls after the
 * node at that index of the range.
 * @returns the cut index within the range, or `null` when no balanced cut exists.
 */
export function planSpanCut(prices: readonly number[], budget: number, isBalancedAfter: (index: number) => boolean): number | null {
  if (prices.length < 2) return null
  // Take the first node unconditionally: it is the smallest unsplittable unit a
  // caller can offer, and refusing it would never converge.
  let total = prices[0] ?? 0
  let cut = 0
  for (let index = 1; index < prices.length; index += 1) {
    const cost = prices[index] ?? 0
    if (total + cost > budget) break
    total += cost
    cut = index
  }
  // Never split an assistant tool call from its results: walk back from the
  // budget cut to the nearest balanced position instead of overshooting.
  while (cut > 0 && !isBalancedAfter(cut)) cut -= 1
  return isBalancedAfter(cut) ? cut : null
}

/**
 * Summed route price of a slice of prices.
 * @param prices - per-node prices.
 * @returns the total price.
 */
export function spanTotal(prices: readonly number[]): number {
  let total = 0
  for (const price of prices) total += price ?? 0
  return total
}
