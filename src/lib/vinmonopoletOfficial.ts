/** Vinmonopolet OFFICIAL API client (apis.vinmonopolet.no).
 *  Requires a subscription key from portal-api.vinmonopolet.no.
 *  Uses the primary key by default; retries once with the secondary if that
 *  fails with 401/403/429 — that matches how the portal expects rotation. */
import { getVmpKeys } from './storage.js'
import type { Product } from './types.js'
import { toMl } from './units.js'
const BASE = 'https://apis.vinmonopolet.no/products/v0'
interface OfficialProduct {
  code?: string
  productShortName?: string
  productLongName?: string
  price?: number
  volume?: number      // in millilitres
  alcoholContent?: number
  vintage?: number | string
  district?: { name?: string }
  country?: { name?: string }
  productCategory?: { name?: string }
  producer?: { name?: string }
  images?: Array<{ url?: string }>
}
function toProduct(p: OfficialProduct): Product | undefined {
  const id = p.code
  const name = (p.productLongName ?? p.productShortName ?? '').trim()
  const price = typeof p.price === 'number' ? p.price : undefined
  if (!id || !name || price == null) return undefined
  return {
    store: 'vinmonopolet',
    id,
    name,
    producer: p.producer?.name,
    country: p.country?.name,
    volumeMl: toMl(p.volume),
    abv: typeof p.alcoholContent === 'number' ? p.alcoholContent : undefined,
    vintage: p.vintage ? Number(p.vintage) || undefined : undefined,
    price,
    currency: 'NOK',
    url: `https://www.vinmonopolet.no/p/${id}`,
    imageUrl: p.images?.[0]?.url,
  }
}
/** True if at least one key is configured. */
export async function hasVmpKey(): Promise<boolean> {
  const { primary, secondary } = await getVmpKeys()
  return Boolean(primary || secondary)
}
async function fetchWithKey(path: string, key: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: {
      'Ocp-Apim-Subscription-Key': key,
      Accept: 'application/json;api-version=1.0',
    },
  })
}
/** Try primary then secondary. Returns Response on 2xx, throws on final failure. */
async function fetchWithKeys(path: string): Promise<Response> {
  const { primary, secondary } = await getVmpKeys()
  const keys = [primary, secondary].filter((k): k is string => !!k)
  if (keys.length === 0) throw new Error('No Vinmonopolet API key configured')
  let lastStatus = 0
  for (const key of keys) {
    const res = await fetchWithKey(path, key)
    if (res.ok) return res
    lastStatus = res.status
    // 401/403/429 → try the other key. 4xx/5xx otherwise: give up.
    if (![401, 403, 429].includes(res.status)) break
  }
  throw new Error(`Vinmonopolet official API HTTP ${lastStatus}`)
}
/**
 * Search the official products endpoint.
 *
 * ⚠ The v0 official API does NOT expose a search endpoint — it's bulk-download
 * only. Calling /products?query=… returns HTTP 404. Until a search-capable
 * version is released, this returns an empty list silently so callers can
 * fall back to the public /vmpws path without noise in the console.
 */
export async function searchVinmonopoletOfficial(
  _query: string,
  _pageSize = 15,
): Promise<Product[]> {
  return []
}
/** Look up a single product by code via the official API. */
export async function getVinmonopoletProductOfficial(
  code: string,
): Promise<Product | undefined> {
  try {
    const res = await fetchWithKeys(`/products/${encodeURIComponent(code)}`)
    const json = (await res.json()) as OfficialProduct
    return toProduct(json)
  } catch (err) {
    console.warn('[vvs] official API lookup failed:', err)
    return undefined
  }
}
