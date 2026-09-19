export type Store = 'systembolaget' | 'vinmonopolet'
export type Currency = 'SEK' | 'NOK'
export interface Product {
  store: Store
  id: string
  name: string
  producer?: string
  country?: string
  category?: string
  volumeMl?: number
  abv?: number
  vintage?: number
  price: number
  currency: Currency
  url: string
  imageUrl?: string
}
export interface ScoredProduct {
  product: Product
  score: number
}
export interface ComparisonResult {
  se?: Product
  no?: Product
  score: number
  /** Price difference in SEK. Positive => NO is more expensive. */
  priceDiffSek?: number
  /** FX rate used for the diff (SEK per 1 NOK). */
  fxRate?: number
  /** SE price per litre in SEK. Set when SE volume is known. */
  seSekPerLitre?: number
  /** NO price per litre in SEK (already converted via fxRate). Set when NO volume is known. */
  noSekPerLitre?: number
  /**
   * Other plausible matches for the source product, ordered by score desc.
   * Excludes the best match (which is in se/no). Empty if no candidates.
   */
  alternates?: ScoredProduct[]
  /** Non-fatal note when the cross-store search failed (e.g. HTTP 400). */
  searchError?: string
}
export type ExtMessage =
  | { type: 'PING' }
  | { type: 'SCRIPT_LOADED'; store: Store; url: string }
  | { type: 'PAGE_PRODUCT'; product: Product }
  | { type: 'FIND_MATCH'; product: Product }
  | { type: 'GET_LAST_SEEN' }
  | { type: 'GET_LAST_COMPARISON' }
export interface ExtResponse<T = unknown> {
  ok: boolean
  data?: T
  error?: string
}
