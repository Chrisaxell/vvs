/** Volume + price-per-litre utilities shared across the extension. */

/**
 * True when v is a finite number. Unlike `isFinite`, this rejects `null`,
 * `undefined`, and non-number values — important because `isFinite(null) === true`
 * (null coerces to 0), which trips up code like `null.toFixed(0)` after
 * chrome.storage.local serialization turns cached NaN prices into null.
 */
export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * Normalize a raw "volume" number into millilitres.
 * Handles the three common wire formats seen in the wild:
 *   -  < 10  ⇒ litres      (0.75 → 750)
 *   -  < 200 ⇒ centilitres (70   → 700)
 *   -  ≥ 200 ⇒ millilitres (750  → 750)
 */
export function toMl(v: number | null | undefined): number | undefined {
  if (v == null || !isFinite(v) || v <= 0) return undefined
  if (v < 10) return Math.round(v * 1000)
  if (v < 200) return Math.round(v * 10)
  return Math.round(v)
}

/** Human-friendly volume string. 700 → "70 cl", 1500 → "1.5 L", 50 → "50 ml". */
export function formatVolume(ml: number | undefined): string {
  if (ml == null || !isFinite(ml) || ml <= 0) return ''
  if (ml >= 1000) {
    const l = ml / 1000
    if (Number.isInteger(l)) return `${l} L`
    return `${l.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} L`
  }
  if (ml % 10 === 0) return `${ml / 10} cl`
  return `${ml} ml`
}

/** Price per litre in the product's own currency. */
export function pricePerLitre(price: number, volumeMl: number | undefined): number | undefined {
  if (!isNum(price) || !isNum(volumeMl) || volumeMl <= 0) return undefined
  return price / (volumeMl / 1000)
}

/**
 * Return how much cheaper `cheaper` is vs `pricier`, as a percentage of the
 * pricier value. Returns undefined if inputs are invalid.
 * e.g. percentCheaper(80, 100) → 20  (80 is 20% cheaper than 100)
 */
export function percentCheaper(cheaper: number, pricier: number): number | undefined {
  if (!isNum(cheaper) || !isNum(pricier) || pricier <= 0) return undefined
  if (cheaper >= pricier) return 0
  return ((pricier - cheaper) / pricier) * 100
}

/** Parse a bottle volume out of a product-name-ish string.
 *  Handles "Smirnoff No. 21, 70 cl", "Absolut 1 L", "Mini 5 cl", "0,7 l".
 *  Returns undefined if the number looks implausible for a bottle. */
export function extractVolumeMl(text: string | undefined | null): number | undefined {
  if (!text) return undefined
  const rx = /(\d+(?:[.,]\d+)?)\s*(cl|ml|l)\b/gi
  let m: RegExpExecArray | null
  while ((m = rx.exec(text))) {
    const n = Number(m[1].replace(',', '.'))
    if (!isFinite(n)) continue
    const u = m[2].toLowerCase()
    const ml = u === 'ml' ? Math.round(n) : u === 'cl' ? Math.round(n * 10) : Math.round(n * 1000)
    if (ml >= 20 && ml <= 6000) return ml
  }
  return undefined
}

/** Parse ABV percent from a product-name-ish string. Prefers "NN % vol" / "NN%". */
export function extractAbv(text: string | undefined | null): number | undefined {
  if (!text) return undefined
  const m = text.match(/(\d{1,2}(?:[.,]\d)?)\s*%/)
  if (!m) return undefined
  const n = Number(m[1].replace(',', '.'))
  return isFinite(n) && n > 0 && n <= 80 ? n : undefined
}
