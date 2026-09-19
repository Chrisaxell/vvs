/** Vinmonopolet client. Public search + DOM scraping.
 *  Strategy for cross-store search (no auth):
 *    1. OCC JSON: /vmpws/v2/vmp/products/search?query=...&pageSize=...
 *    2. Fallback: scrape https://www.vinmonopolet.no/search?q=... HTML
 *  Strategy for current-page product: scrape JSON-LD (see scrapeVinmonopoletFromDom). */
import type { Product } from './types.js'
import { extractAbv, extractVolumeMl, isNum, toMl } from './units.js'
const BASE = 'https://www.vinmonopolet.no/vmpws/v2/vmp'
const SITE = 'https://www.vinmonopolet.no'
interface VmpApiPrice { value?: number; formattedValue?: string }
interface VmpApiProduct {
  code?: string
  name?: string
  productShortName?: string
  productLongName?: string
  url?: string
  price?: VmpApiPrice | number
  images?: Array<{ format?: string; url?: string; imageType?: string }>
  main_category?: { name?: string }
  main_country?: { name?: string }
  main_producer?: { name?: string }
  producer?: { name?: string } | string
  volume?: { value?: number; formattedValue?: string } | number
  alcohol?: { value?: number; formattedValue?: string }
  year?: string
}
interface VmpSearchResponse {
  productSearchResult?: { products?: VmpApiProduct[] }
  products?: VmpApiProduct[]
}
function toProduct(p: VmpApiProduct): Product | undefined {
  const id = p.code
  const name = (p.name ?? p.productLongName ?? p.productShortName ?? '').trim()
  const rawPrice = typeof p.price === 'object' ? p.price?.value : p.price
  const price = typeof rawPrice === 'number' ? rawPrice : undefined
  if (!id || !name || price == null) return undefined
  const url = p.url
    ? p.url.startsWith('http') ? p.url : `${SITE}${p.url}`
    : `${SITE}/p/${id}`
  const image = p.images?.find((i) => i.format === 'product') ?? p.images?.[0]
  const imageUrl = image?.url
    ? image.url.startsWith('http') ? image.url : `https://bilder.vinmonopolet.no${image.url}`
    : undefined
  const producerName =
    typeof p.producer === 'string' ? p.producer :
    p.producer?.name ?? p.main_producer?.name
  const rawVolume = typeof p.volume === 'number' ? p.volume : p.volume?.value
  const volumeMl = toMl(rawVolume)
  return {
    store: 'vinmonopolet',
    id,
    name,
    producer: producerName,
    country: p.main_country?.name,
    category: p.main_category?.name,
    volumeMl,
    abv: p.alcohol?.value,
    vintage: p.year ? Number(p.year) || undefined : undefined,
    price,
    currency: 'NOK',
    url,
    imageUrl,
  }
}
/** Public search — tries OCC JSON path first, then HTML scrape. Never throws. */
export async function searchVinmonopolet(query: string, pageSize = 10): Promise<Product[]> {
  try {
    const results = await searchVmpOccApi(query, pageSize)
    if (results.length > 0) {
      console.log('[vvs] Vinmonopolet OCC search got', results.length, 'results')
      return results
    }
  } catch (err) {
    console.warn('[vvs] Vinmonopolet OCC search failed:', err)
  }
  try {
    const results = await searchVmpHtml(query, pageSize)
    console.log('[vvs] Vinmonopolet HTML search got', results.length, 'results')
    return results
  } catch (err) {
    // Rethrow so background can record a searchError note.
    throw new Error(`Vinmonopolet search failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}
/** OCC standard path: /vmpws/v2/vmp/products/search?query=...&pageSize=...&currentPage=0 */
async function searchVmpOccApi(query: string, pageSize: number): Promise<Product[]> {
  const params = new URLSearchParams({
    query,
    pageSize: String(pageSize),
    currentPage: '0',
    fields: 'FULL',
  })
  const url = `${BASE}/products/search?${params.toString()}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; vvs-extension/0.2)',
    },
  })
  if (!res.ok) throw new Error(`OCC search HTTP ${res.status} for ${url}`)
  const json = (await res.json()) as VmpSearchResponse
  const products = json.productSearchResult?.products ?? json.products ?? []
  return products.map(toProduct).filter((p): p is Product => !!p)
}
/** Fallback: fetch the public search page HTML and dig products out of it. */
async function searchVmpHtml(query: string, pageSize: number): Promise<Product[]> {
  const url = `${SITE}/search?q=${encodeURIComponent(query)}`
  const res = await fetch(url, {
    headers: {
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'nb-NO,nb;q=0.9,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 (compatible; vvs-extension/0.2)',
    },
  })
  if (!res.ok) throw new Error(`HTML search HTTP ${res.status} for ${url}`)
  const html = await res.text()
  return parseVmpSearchHtml(html, pageSize)
}
function parseVmpSearchHtml(html: string, pageSize: number): Product[] {
  const out: Product[] = []
  const seen = new Set<string>()
  // 1) __NEXT_DATA__ (Next.js hydration payload — richest source)
  const nextMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)
  if (nextMatch) {
    try {
      const data = JSON.parse(nextMatch[1])
      collectVmpProducts(data, seen, out, pageSize)
    } catch (err) {
      console.warn('[vvs] failed to parse Vinmonopolet __NEXT_DATA__:', err)
    }
  }
  if (out.length > 0) return out
  // 2) Any other <script type="application/json"> blocks
  const rx = /<script[^>]*type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g
  let m: RegExpExecArray | null
  while ((m = rx.exec(html)) && out.length < pageSize) {
    try {
      const data = JSON.parse(m[1])
      collectVmpProducts(data, seen, out, pageSize)
    } catch { /* ignore */ }
  }
  return out
}
function collectVmpProducts(
  node: unknown, seen: Set<string>, out: Product[], pageSize: number,
): void {
  if (out.length >= pageSize) return
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) {
      if (out.length >= pageSize) return
      collectVmpProducts(item, seen, out, pageSize)
    }
    return
  }
  const obj = node as Record<string, unknown>
  const code = obj.code as string | undefined
  const hasName = obj.name || obj.productShortName || obj.productLongName
  if (typeof code === 'string' && hasName && !seen.has(code)) {
    const p = toProduct(obj as VmpApiProduct)
    if (p) {
      seen.add(code)
      out.push(p)
      if (out.length >= pageSize) return
    }
  }
  for (const v of Object.values(obj)) {
    if (out.length >= pageSize) return
    collectVmpProducts(v, seen, out, pageSize)
  }
}
/** Scrape a Vinmonopolet product from the current page's DOM. */
export function scrapeVinmonopoletFromDom(
  code: string, doc = document, href = location.href,
): Product | undefined {
  // Volume + ABV: try the product name first (JSON-LD name / og:title / h1) —
  // that string is authoritative and free of "5 cl mini" noise from related
  // products. Fall back to labeled body text, then any plausible bare match.
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
  const h1Text = doc.querySelector('h1')?.textContent ?? ''
  let ldName = ''
  for (const el of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(el.textContent ?? '')
      const nodes = Array.isArray(data) ? data : [data]
      for (const n of nodes) if (n?.['@type'] === 'Product' && n.name) { ldName = String(n.name); break }
    } catch { /* ignore */ }
    if (ldName) break
  }
  const nameSources = [ldName, ogTitle, h1Text].filter(Boolean).join(' | ')
  const bodyText = doc.body?.textContent ?? ''
  const labeledVol = bodyText.match(/volum[^\n]{0,20}?(\d+(?:[.,]\d+)?)\s*(cl|ml|l)\b/i)
  const labeledVolStr = labeledVol ? `${labeledVol[1]} ${labeledVol[2]}` : ''
  const volumeMl = extractVolumeMl(nameSources) ?? extractVolumeMl(labeledVolStr) ?? toMl(undefined)
  const labeledAbv = bodyText.match(/alkohol[^\n]{0,20}?(\d{1,2}(?:[.,]\d)?)\s*%/i)
  const abv = extractAbv(nameSources) ?? (labeledAbv ? extractAbv(`${labeledAbv[1]}%`) : undefined)

  for (const el of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(el.textContent ?? '')
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        if (!node || node['@type'] !== 'Product') continue
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
        const price = Number(offer?.price)
        if (!isNum(price)) continue
        return {
          store: 'vinmonopolet',
          id: code,
          name: String(node.name ?? '').trim(),
          producer: node.brand?.name ?? node.brand,
          volumeMl,
          abv: isNum(abv) ? abv : undefined,
          price,
          currency: (offer?.priceCurrency ?? 'NOK') as 'NOK',
          url: href,
          imageUrl: typeof node.image === 'string' ? node.image : node.image?.[0],
        }
      }
    } catch { /* ignore malformed */ }
  }
  const name = (doc.querySelector('h1')?.textContent
    ?? doc.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ?? '').trim()
  const priceText = doc.querySelector('[class*="price" i]')?.textContent ?? ''
  const priceMatch = priceText.match(/(\d+[\s.,]?\d*)/)
  const price = priceMatch ? Number(priceMatch[1].replace(/[\s.]/g, '').replace(',', '.')) : NaN
  if (!name) return undefined
  return {
    store: 'vinmonopolet',
    id: code,
    name,
    volumeMl,
    abv: isNum(abv) ? abv : undefined,
    price: isNum(price) ? price : NaN,
    currency: 'NOK',
    url: href,
  }
}
/** Legacy — retained for popup manual lookups. Returns undefined on failure. */
export async function getVinmonopoletProduct(code: string): Promise<Product | undefined> {
  try {
    const url = `${BASE}/products/${encodeURIComponent(code)}?fields=FULL`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) return undefined
    const json = (await res.json()) as VmpApiProduct
    return toProduct(json)
  } catch {
    return undefined
  }
}
/** Parses a Vinmonopolet product URL and returns the product code. */
export function parseVinmonopoletUrl(url: string): string | undefined {
  const m = url.match(/\/p\/(?:[^/?#]+\/)*(\d{4,8})(?:[/?#]|$)/)
  return m?.[1]
}
