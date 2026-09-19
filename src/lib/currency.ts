import { getFxRate, setFxRate } from './storage.js'

const ONE_DAY_MS = 24 * 60 * 60 * 1000
const FALLBACK_SEK_PER_NOK = 0.92

/**
 * Returns how many SEK 1 NOK is worth.
 * Cached in chrome.storage for up to 24h.
 */
export async function getSekPerNok(): Promise<number> {
  const cached = await getFxRate()
  if (cached && Date.now() - cached.updatedAt < ONE_DAY_MS) {
    return cached.rate
  }

  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=NOK&to=SEK')
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { rates?: { SEK?: number } }
    const rate = json.rates?.SEK
    if (typeof rate !== 'number' || !isFinite(rate)) throw new Error('Bad rate')
    await setFxRate(rate)
    return rate
  } catch (err) {
    console.warn('[vvs] FX fetch failed, using fallback:', err)
    return cached?.rate ?? FALLBACK_SEK_PER_NOK
  }
}

export function nokToSek(nok: number, rate: number): number {
  return nok * rate
}

export function sekToNok(sek: number, rate: number): number {
  return sek / rate
}
