/**
 * Systembolaget client.
 *
 * Uses the public JSON search endpoint that powers systembolaget.se's own
 * search page. If that fails (Akamai bot filter, geo-block, etc.) we fall
 * back to scraping __NEXT_DATA__ from the HTML search page.
 */

import type { Product } from './types.js'
import { toMl } from './units.js'

const SITE = 'https://www.systembolaget.se'
const API = 'https://api-extern.systembolaget.se/sb-api-ecommerce/v1/productsearch'

interface SbApiProduct {
  productId?: string
  productNumber?: string
  productNameBold?: string
  productNameThin?: string
  category?: string
  categoryLevel1?: string
  categoryLevel2?: string
  price?: number
  volume?: number
  alcoholPercentage?: number
  country?: string
  producerName?: string
  vintage?: string | number
  images?: Array<{ imageUrl?: string }>
  productNumberShort?: string
  slug?: string
}

function toProduct(p: SbApiProduct): Product | undefined {
  const id = p.productNumber ?? p.productId ?? p.productNumberShort
  const nameParts = [p.productNameBold, p.productNameThin].filter(Boolean).join(' ').trim()
  const name = nameParts || undefined
  const price = typeof p.price === 'number' ? p.price : undefined
  if (!id || !name || price == null) return undefined

  const slug = p.slug ?? `${(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}`
  const url = `${SITE}/produkt/${p.categoryLevel1?.toLowerCase() ?? 'ovrigt'}/${slug}-${id}/`

  const image = p.images?.[0]?.imageUrl
  const imageUrl = image
    ? image.startsWith('http')
      ? image
      : `https:${image}`
    : undefined

  return {
    store: 'systembolaget',
    id: String(id),
    name,
    producer: p.producerName,
    country: p.country,
    volumeMl: toMl(p.volume),
    abv: typeof p.alcoholPercentage === 'number' ? p.alcoholPercentage : undefined,
    vintage: p.vintage ? Number(p.vintage) || undefined : undefined,
    price,
    currency: 'SEK',
    url,
    imageUrl,
  }
}

interface NextDataShape {
  props?: {
    pageProps?: {
      searchResult?: { products?: SbApiProduct[] }
      initialSearchResult?: { products?: SbApiProduct[] }
      product?: SbApiProduct
    }
  }
}

/** Extract the Next.js data payload from a Systembolaget HTML page. */
function extractNextData(html: string): NextDataShape | undefined {
  const match = html.match(
    /<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/,
  )
  if (!match) return undefined
  try {
    return JSON.parse(match[1]) as NextDataShape
  } catch (err) {
    console.warn('[vvs] failed to parse __NEXT_DATA__:', err)
    return undefined
  }
}

/** Recursively walks any object looking for arrays that look like product lists. */
function findProductArrays(node: unknown, out: SbApiProduct[][] = []): SbApiProduct[][] {
  if (!node || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    if (
      node.length > 0 &&
      typeof node[0] === 'object' &&
      node[0] !== null &&
      ('productNumber' in node[0] || 'productId' in node[0])
    ) {
      out.push(node as SbApiProduct[])
    }
    for (const item of node) findProductArrays(item, out)
    return out
  }
  for (const v of Object.values(node as Record<string, unknown>)) findProductArrays(v, out)
  return out
}

/** Try Systembolaget's JSON search endpoint. This is the same one their site
 *  uses for the search page — public, no auth. Returns [] on any failure. */
async function searchSbJson(query: string, pageSize: number): Promise<Product[]> {
  const params = new URLSearchParams({
    'size': String(Math.max(pageSize, 10)),
    'page': '1',
    'sortBy': 'Score',
    'sortDirection': 'Descending',
    'q': query,
  })
  const url = `${API}/search?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
      // These two are what their own site sends; without them Akamai often
      // returns 403. `Ocp-Apim-Subscription-Key` is the site's public key —
      // it's embedded in their JS bundle and rotated rarely.
      'Ocp-Apim-Subscription-Key': 'cfc702aed3094c86b92d6d4ff7a54c84',
      'Origin': SITE,
      'Referer': `${SITE}/`,
    },
  })
  if (!res.ok) throw new Error(`SB JSON HTTP ${res.status}`)
  const json = await res.json() as { products?: SbApiProduct[] }
  const raw = Array.isArray(json.products) ? json.products : []
  const out: Product[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const prod = toProduct(p)
    if (!prod || seen.has(prod.id)) continue
    seen.add(prod.id)
    out.push(prod)
    if (out.length >= pageSize) break
  }
  return out
}

/** HTML fallback: fetch /sortiment/?q=... and dig products out of __NEXT_DATA__. */
async function searchSbHtml(query: string, pageSize: number): Promise<Product[]> {
  const url = `${SITE}/sortiment/?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'sv-SE,sv;q=0.9,en;q=0.8',
    },
  })
  if (!res.ok) {
    if (res.status === 429 || res.status >= 500) return []
    throw new Error(`SB HTML HTTP ${res.status}`)
  }
  const html = await res.text()
  const data = extractNextData(html)
  if (!data) return []
  const arrays = findProductArrays(data)
  arrays.sort((a, b) => b.length - a.length)
  const seen = new Set<string>()
  const out: Product[] = []
  for (const arr of arrays) {
    for (const raw of arr) {
      const p = toProduct(raw)
      if (!p || seen.has(p.id)) continue
      seen.add(p.id)
      out.push(p)
      if (out.length >= pageSize) return out
    }
  }
  return out
}

export async function searchSystembolaget(query: string, pageSize = 10): Promise<Product[]> {
  // 1) JSON API — fast, clean, low bot-detection risk.
  try {
    const jsonHits = await searchSbJson(query, pageSize)
    console.log(`[vvs] SB JSON search "${query}" ->`, jsonHits.length, 'hits')
    if (jsonHits.length > 0) return jsonHits
  } catch (err) {
    console.warn('[vvs] SB JSON search failed, falling back to HTML:', err)
  }
  // 2) HTML __NEXT_DATA__ fallback.
  try {
    const htmlHits = await searchSbHtml(query, pageSize)
    console.log(`[vvs] SB HTML search "${query}" ->`, htmlHits.length, 'hits')
    return htmlHits
  } catch (err) {
    console.warn('[vvs] SB HTML search failed:', err)
    return []
  }
}

export async function getSystembolagetProduct(id: string): Promise<Product | undefined> {
  // We don't know the slug, but Systembolaget accepts a search by product number.
  const results = await searchSystembolaget(id, 5)
  return results.find((p) => p.id === id) ?? results[0]
}

/** Parses a Systembolaget product URL and returns the numeric product id. */
export function parseSystembolagetUrl(url: string): string | undefined {
  // Real URLs look like:
  //   /produkt/vin/name-77016/
  //   /produkt/vin/name-77016-01/
  //   /produkt/vin/name-77016     (no trailing slash)
  // The id is the last 4-7 digit block, optionally followed by -DD.
  const m = url.match(/-(\d{4,7})(?:-\d{2})?(?:[/?#]|$)/)
  return m?.[1]
}
