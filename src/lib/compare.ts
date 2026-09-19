import type { ComparisonResult, Product, ScoredProduct } from './types.js'
import { getSekPerNok, nokToSek } from './currency.js'
import { isNum, pricePerLitre } from './units.js'
/** Normalize a product name for fuzzy matching. Keeps numbers (so "No 21" and
 *  "Vanilla" are distinguishable) but strips vintage years and volume tokens. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')             // strip diacritics
    .replace(/\b(19|20)\d{2}\b/g, ' ')           // strip vintage years
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:cl|ml|l|%)\b/gi, ' ') // strip volume/pct
    .replace(/\bno\.?\s?(\d+)\b/gi, 'no$1')      // "No. 21" -> "no21" (single token)
    .replace(/[^\p{Letter}\p{Number}\s]/gu, ' ') // punctuation -> space
    .replace(/\s+/g, ' ')
    .trim()
}
/** Extract meaningful tokens. Keeps numbers and short flavour words. */
function tokens(name: string): string[] {
  const stop = new Set([
    'the', 'and', 'og', 'och', 'de', 'la', 'le', 'les', 'di', 'du', 'del',
    'della', 'da', 'vin', 'vino', 'wine', 'rouge', 'blanc',
  ])
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length > 0 && !stop.has(t))
}
/** Character-bigram (Dice) similarity — handles typos, plurals, and short
 *  words much better than token Jaccard. */
function diceBigram(a: string, b: string): number {
  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>()
    const t = ` ${s} `
    for (let i = 0; i < t.length - 1; i++) {
      const bg = t.slice(i, i + 2)
      m.set(bg, (m.get(bg) ?? 0) + 1)
    }
    return m
  }
  const A = bigrams(a)
  const B = bigrams(b)
  if (A.size === 0 || B.size === 0) return 0
  let overlap = 0
  for (const [bg, count] of A) {
    const other = B.get(bg)
    if (other) overlap += Math.min(count, other)
  }
  const total = [...A.values()].reduce((s, n) => s + n, 0) +
                [...B.values()].reduce((s, n) => s + n, 0)
  return (2 * overlap) / total
}
/** Blended name similarity: token-Jaccard for word overlap + character-bigram
 *  for spelling closeness. */
export function similarity(a: string, b: string): number {
  const at = new Set(tokens(a))
  const bt = new Set(tokens(b))
  if (at.size === 0 || bt.size === 0) return 0
  let intersect = 0
  for (const t of at) if (bt.has(t)) intersect++
  const jaccard = intersect / (at.size + bt.size - intersect)
  const bigram = diceBigram(normalizeName(a), normalizeName(b))
  return 0.55 * jaccard + 0.45 * bigram
}
/** Are these two products likely different variants of the same base product?
 *  Looks for distinguishing tokens in exactly one of them (e.g. "vanilla" in
 *  one but not the other) — these are strong "not the same" signals. */
function hasVariantConflict(a: Product, b: Product): boolean {
  const variantMarkers = new Set([
    'vanilla', 'vanille', 'lime', 'cherry', 'raspberry', 'peach', 'apple',
    'strawberry', 'watermelon', 'citrus', 'orange', 'mango', 'passion',
    'honey', 'spiced', 'gold', 'silver', 'black', 'red', 'white', 'blue',
    'green', 'reserve', 'special', 'limited', 'blueberry', 'chocolate',
    'coffee', 'caramel', 'mint', 'ginger', 'cucumber', 'rose',
  ])
  const at = new Set(tokens(a.name))
  const bt = new Set(tokens(b.name))
  for (const m of variantMarkers) {
    if (at.has(m) !== bt.has(m)) return true
  }
  return false
}
/** Score a candidate against a source product, blending name + producer + volume.
 *  Applies penalties for volume mismatch, ABV mismatch, and variant conflicts. */
export function scoreMatch(source: Product, candidate: Product): number {
  let score = similarity(source.name, candidate.name)
  // Producer alignment: strong bonus if it matches, small penalty if it clearly doesn't.
  if (source.producer && candidate.producer) {
    const pSim = similarity(source.producer, candidate.producer)
    score = 0.7 * score + 0.3 * pSim
  }
  // Volume: bottles need to be comparable. A 70cl vs 5cl mini is not the same product.
  if (source.volumeMl && candidate.volumeMl) {
    const ratio = Math.min(source.volumeMl, candidate.volumeMl) /
                  Math.max(source.volumeMl, candidate.volumeMl)
    if (ratio > 0.95) score += 0.08          // near-identical volume: bonus
    else if (ratio > 0.5) score -= 0.05      // 500ml vs 700ml: mild penalty
    else score -= 0.25                        // 700ml vs 50ml mini: heavy penalty
  }
  // ABV: alcohol percentage is a very strong category signal.
  //   Δ ≤ 0.5%  → same product (vintages vary slightly)
  //   Δ ≤ 2%   → probably same
  //   Δ ≤ 5%   → possibly variant (soft penalty)
  if (isNum(source.abv) && isNum(candidate.abv)) {
    const abvDiff = Math.abs(source.abv - candidate.abv)
    if (abvDiff <= 0.5) score += 0.08
    else if (abvDiff <= 2)  score += 0.02
    else if (abvDiff <= 5)  score -= 0.08
    else                    score -= 0.30
  }
  // Number tokens (No 21, 12yo, XV, etc.) are strong identifiers.
  const srcNums = tokens(source.name).filter((t) => /\d/.test(t))
  const candNums = tokens(candidate.name).filter((t) => /\d/.test(t))
  if (srcNums.length > 0 && candNums.length > 0) {
    const matchingNums = srcNums.filter((n) => candNums.includes(n)).length
    if (matchingNums === 0) score -= 0.15    // "No 21" vs anything with no matching number
    else score += 0.10 * matchingNums / Math.max(srcNums.length, candNums.length)
  } else if (srcNums.length !== candNums.length) {
    // One has a distinguishing number, the other doesn't — soft penalty.
    score -= 0.05
  }
  // Variant conflict: "vanilla" in one but not the other = probably different product.
  if (hasVariantConflict(source, candidate)) score -= 0.20
  return Math.max(0, Math.min(1, score))
}
/** Find the best match for `source` inside `candidates`. */
export function bestMatch(
  source: Product,
  candidates: Product[],
  minScore = 0.35,
): { product: Product; score: number } | undefined {
  let best: Product | undefined
  let bestScore = 0
  for (const c of candidates) {
    const s = scoreMatch(source, c)
    if (s > bestScore) {
      bestScore = s
      best = c
    }
  }
  return best && bestScore >= minScore ? { product: best, score: bestScore } : undefined
}
/** Return the top N candidates by score, descending. */
export function topMatches(source: Product, candidates: Product[], n = 3): ScoredProduct[] {
  const scored: ScoredProduct[] = candidates
    .map((product) => ({ product, score: scoreMatch(source, product) }))
    .filter((s) => s.score > 0)
  scored.sort((a, b) => b.score - a.score)
  const seen = new Set<string>()
  const unique: ScoredProduct[] = []
  for (const s of scored) {
    if (seen.has(s.product.id)) continue
    seen.add(s.product.id)
    unique.push(s)
    if (unique.length >= n) break
  }
  return unique
}
/** Build a comparison result including SEK-normalized price diff and per-litre SEK. */
export async function compare(
  se?: Product,
  no?: Product,
  score = 0,
  alternates: ScoredProduct[] = [],
): Promise<ComparisonResult> {
  const result: ComparisonResult = { se, no, score, alternates }
  if (se && no && isNum(se.price) && isNum(no.price)) {
    const rate = await getSekPerNok()
    result.priceDiffSek = nokToSek(no.price, rate) - se.price
    result.fxRate = rate
    // Per-litre in SEK — makes 75 cl vs 1.5 L a fair comparison.
    const sePerLitre = pricePerLitre(se.price, se.volumeMl)
    const noPerLitreNok = pricePerLitre(no.price, no.volumeMl)
    if (isNum(sePerLitre)) result.seSekPerLitre = sePerLitre
    if (isNum(noPerLitreNok)) result.noSekPerLitre = noPerLitreNok * rate
  }
  return result
}
