/** Injected on systembolaget.se — welcome bubble + product comparison. */
import { renderBanner, renderError, renderLoading, renderWelcome } from '../lib/banner.js'
import { getSystembolagetProduct, parseSystembolagetUrl } from '../lib/systembolaget.js'
import type { ComparisonResult, ExtMessage, ExtResponse, Product } from '../lib/types.js'
import { isNum, toMl } from '../lib/units.js'
import { extractAbv, extractVolumeMl } from '../lib/units.js'
console.log('[vvs] systembolaget content script loaded on', location.href)
try {
  chrome.runtime
    .sendMessage({ type: 'SCRIPT_LOADED', store: 'systembolaget', url: location.href } as ExtMessage)
    .catch((err) => console.warn('[vvs] SCRIPT_LOADED send failed:', err))
} catch (err) {
  console.warn('[vvs] cannot reach background worker:', err)
}
let lastHandledId: string | undefined
let greeted = false
async function handle(): Promise<void> {
  const id = parseSystembolagetUrl(location.href)
  console.log('[vvs] systembolaget parseUrl ->', id ?? '(no id)')
  if (!id) {
    if (!greeted) {
      greeted = true
      try { renderWelcome('systembolaget') } catch (err) { console.error('[vvs] renderWelcome failed:', err) }
    }
    return
  }
  if (id === lastHandledId) return
  lastHandledId = id
  greeted = true
  const provisional: Product = {
    store: 'systembolaget', id, name: 'Loading product…',
    price: NaN, currency: 'SEK', url: location.href,
  }
  try { renderLoading(provisional) } catch (err) { console.error('[vvs] renderLoading failed:', err) }
  try {
    // Progressive scrape: try DOM up to 3 times with delays for SPA hydration.
    let product: Product | undefined
    for (const delay of [0, 400, 1200]) {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay))
      const attempt = scrapeFromDom(id)
      if (attempt) {
        product = mergeProducts(product, attempt)
        if (isNum(product.price) && product.name && product.name !== 'Loading product…') break
      }
    }
    // If still no price, try the search-page fallback.
    if (!product || !isNum(product.price)) {
      console.log('[vvs] DOM incomplete, trying search fallback for id', id)
      try {
        const searched = await getSystembolagetProduct(id)
        if (searched) product = mergeProducts(product, searched)
      } catch (err) {
        console.warn('[vvs] search fallback failed:', err)
      }
    }
    // Last resort: build a minimal product from URL slug so we can still search.
    if (!product || !product.name || product.name === 'Loading product…') {
      const slugName = extractNameFromUrl(location.href)
      if (slugName) {
        product = {
          store: 'systembolaget', id, name: slugName,
          price: product?.price ?? NaN, currency: 'SEK', url: location.href,
        }
        console.log('[vvs] using URL-slug fallback product:', product)
      }
    }
    if (!product) {
      console.warn('[vvs] systembolaget: could not build product for id', id)
      renderError(`Could not read product ${id} from this page.`)
      return
    }
    console.log('[vvs] systembolaget product:', product)
    void sendMessage({ type: 'PAGE_PRODUCT', product })
    renderLoading(product)
    const result = await sendMessage<ComparisonResult>({ type: 'FIND_MATCH', product })
    console.log('[vvs] comparison result:', result)
    renderBanner(product, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[vvs] systembolaget handle failed:', err)
    try { renderError(msg) } catch (e2) { console.error('[vvs] renderError failed:', e2) }
  }
}
/** Merge two partial products, preferring non-empty fields from `b`. */
function mergeProducts(a: Product | undefined, b: Product): Product {
  if (!a) return b
  return {
    store: b.store,
    id: b.id || a.id,
    name: (b.name && b.name !== 'Loading product…') ? b.name : a.name,
    producer: b.producer ?? a.producer,
    country: b.country ?? a.country,
    category: b.category ?? a.category,
    volumeMl: b.volumeMl ?? a.volumeMl,
    abv: b.abv ?? a.abv,
    vintage: b.vintage ?? a.vintage,
    price: isNum(b.price) ? b.price : a.price,
    currency: b.currency || a.currency,
    url: b.url || a.url,
    imageUrl: b.imageUrl ?? a.imageUrl,
  }
}
/** Extract a readable product name from a Systembolaget URL slug.
 *  /produkt/vin/adobe-253108/ -> "Adobe"
 *  /produkt/vin/chateau-margaux-2015-77016-01/ -> "Chateau Margaux 2015" */
function extractNameFromUrl(url: string): string | undefined {
  const m = url.match(/\/produkt\/[^/]+\/([^/]+?)(?:-\d{4,7})(?:-\d{2})?\/?(?:[?#]|$)/)
  if (!m) return undefined
  return m[1]
    .split('-')
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ')
}
/** Progressive scrape: collect anything available from JSON-LD, OpenGraph,
 *  __NEXT_DATA__, or the DOM. Returns a partial product — caller merges. */
function scrapeFromDom(id: string): Product | undefined {
  let name: string | undefined
  let price = NaN
  let producer: string | undefined
  let imageUrl: string | undefined
  let volumeMl: number | undefined
  let abv: number | undefined
  let currency: 'SEK' = 'SEK'
  // 1) JSON-LD Product node
  for (const el of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(el.textContent ?? '')
      const nodes = Array.isArray(data) ? data : [data]
      for (const node of nodes) {
        if (!node || node['@type'] !== 'Product') continue
        if (!name && node.name) name = String(node.name).trim()
        if (!producer && node.brand) producer = node.brand?.name ?? node.brand
        if (!imageUrl && node.image) {
          imageUrl = typeof node.image === 'string' ? node.image : node.image?.[0]
        }
        const offer = Array.isArray(node.offers) ? node.offers[0] : node.offers
        const p = Number(offer?.price)
        if (isNum(p) && !isNum(price)) price = p
        if (offer?.priceCurrency) currency = offer.priceCurrency as 'SEK'
      }
    } catch { /* ignore malformed */ }
  }
  // 2) OpenGraph meta tags (server-rendered, always present)
  if (!name) {
    const og = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
    if (og) name = og.trim()
  }
  if (!isFinite(price)) {
    const ogPrice =
      document.querySelector('meta[property="product:price:amount"]')?.getAttribute('content')
      ?? document.querySelector('meta[property="og:price:amount"]')?.getAttribute('content')
    if (ogPrice) {
      const p = Number(ogPrice.replace(',', '.'))
      if (isFinite(p)) price = p
    }
  }
  if (!imageUrl) {
    const ogImg = document.querySelector('meta[property="og:image"]')?.getAttribute('content')
    if (ogImg) imageUrl = ogImg
  }
  // 3) __NEXT_DATA__ blob — traverse for any object whose productNumber matches
  const nextEl = document.getElementById('__NEXT_DATA__')
  if (nextEl?.textContent) {
    try {
      const data = JSON.parse(nextEl.textContent)
      const found = findProductInObject(data, id)
      if (found) {
        if (!name && found.name) name = found.name
        if (!producer && found.producer) producer = found.producer
        if (!isFinite(price) && isFinite(found.price)) price = found.price
        if (!imageUrl && found.imageUrl) imageUrl = found.imageUrl
        if (volumeMl == null && isNum(found.volumeMl)) volumeMl = found.volumeMl
        if (abv == null && isNum(found.abv)) abv = found.abv
      }
    } catch { /* ignore */ }
  }
  // 4) DOM h1 as a last name source
  if (!name) {
    const h1 = document.querySelector('h1')?.textContent?.trim()
    if (h1) name = h1
  }
  // 5) DOM price scrape (Systembolaget uses "199,90 kr" style).
  //    Try a broad set of selectors, then fall back to short text nodes matching
  //    "NNN,NN kr" — skipping comparative-price ("Jämförpris ... kr/l"),
  //    deposit ("pant"), and multi-buy ("2 för 400 kr") rows.
  if (!isFinite(price)) {
    // Must be a bare "NNN kr" or "NNN SEK" — reject "kr/l", "kr/liter".
    const priceRe = /^(?:ca\s*)?(\d{1,4}(?:[.,\s]\d{1,3})*(?:[.,]\d{1,2})?)\s*(?:kr|SEK)\s*$/i
    const looseRe = /(\d{1,4}(?:[.,\s]\d{1,3})*(?:[.,]\d{1,2})?)\s*(?:kr|SEK)(?!\s*\/)/i
    const skip = /jämför|jamfor|pant|\bför\b|\bfor\b\s*\d|\/\s*l/i
    const selectors = [
      '[data-testid*="price" i]',
      '[data-test-id*="price" i]',
      '[class*="Price" i]',
      '[class*="price" i]',
      'p, span, div',
    ]
    outer: for (const sel of selectors) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const txt = (el.textContent ?? '').trim()
        if (!txt || txt.length > 40) continue
        if (skip.test(txt)) continue
        const m = txt.match(priceRe) ?? txt.match(looseRe)
        if (m) {
          const p = Number(m[1].replace(/[\s.]/g, '').replace(',', '.'))
          if (isFinite(p) && p >= 10) { price = p; break outer }
        }
      }
    }
  }
  // 6) Volume + ABV: prefer the product name (og:title / h1 / JSON-LD name).
  //    Systembolaget's title is typically "Smirnoff No. 21, 70 cl, 37,5 %".
  if (volumeMl == null || abv == null) {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ?? ''
    const h1 = document.querySelector('h1')?.textContent ?? ''
    const nameSources = [name ?? '', ogTitle, h1].filter(Boolean).join(' | ')
    if (volumeMl == null) volumeMl = extractVolumeMl(nameSources)
    if (abv == null) abv = extractAbv(nameSources)
    // Last-ditch: labeled body text.
    const bodyText = document.body?.textContent ?? ''
    if (volumeMl == null) {
      const m = bodyText.match(/volym[^\n]{0,20}?(\d+(?:[.,]\d+)?)\s*(cl|ml|l)\b/i)
      if (m) volumeMl = extractVolumeMl(`${m[1]} ${m[2]}`)
    }
    if (abv == null) {
      const m = bodyText.match(/alkoholhalt[^\n]{0,20}?(\d{1,2}(?:[.,]\d)?)\s*%/i)
      if (m) abv = extractAbv(`${m[1]}%`)
    }
  }
  if (!name && !isFinite(price)) return undefined
  return {
    store: 'systembolaget', id,
    name: name ?? '',
    producer, volumeMl, abv, price, currency, url: location.href, imageUrl,
  }
}
/** Recursively look for a product node in a JSON blob. Permissive: matches on
 *  productNumber only; price and other fields are optional. */
function findProductInObject(node: unknown, id: string): Product | undefined {
  if (!node || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProductInObject(item, id)
      if (found) return found
    }
    return undefined
  }
  const obj = node as Record<string, unknown>
  const productNumber = obj.productNumber ?? obj.productId
  if (typeof productNumber === 'string' && productNumber === id) {
    const nameBold = obj.productNameBold as string | undefined
    const nameThin = obj.productNameThin as string | undefined
    const name = [nameBold, nameThin].filter(Boolean).join(' ').trim() ||
                 String(obj.name ?? '').trim()
    return {
      store: 'systembolaget', id,
      name: name || 'Unknown',
      producer: obj.producerName as string | undefined,
      country: obj.country as string | undefined,
      volumeMl: toMl(typeof obj.volume === 'number' ? obj.volume : undefined),
      abv: typeof obj.alcoholPercentage === 'number' ? obj.alcoholPercentage : undefined,
      price: typeof obj.price === 'number' ? obj.price : NaN,
      currency: 'SEK',
      url: location.href,
    }
  }
  for (const v of Object.values(obj)) {
    const found = findProductInObject(v, id)
    if (found) return found
  }
  return undefined
}
async function sendMessage<T>(message: ExtMessage): Promise<T | undefined> {
  const res = (await chrome.runtime.sendMessage(message)) as ExtResponse<T> | undefined
  if (!res) return undefined
  if (!res.ok) throw new Error(res.error ?? 'Unknown extension error')
  return res.data
}
function watchNavigation(): void {
  let lastHref = location.href
  const check = () => {
    if (location.href !== lastHref) {
      lastHref = location.href
      console.log('[vvs] navigation ->', lastHref)
      void handle()
    }
  }
  const attachObserver = () => {
    if (!document.body) return false
    new MutationObserver(check).observe(document.body, { childList: true, subtree: true })
    return true
  }
  if (!attachObserver()) {
    document.addEventListener('DOMContentLoaded', attachObserver, { once: true })
  }
  const wrap = (name: 'pushState' | 'replaceState') => {
    const orig = history[name] as Function
    history[name] = function (this: History) {
      const r = orig.apply(this, arguments as unknown as unknown[])
      queueMicrotask(check)
      return r
    } as History[typeof name]
  }
  wrap('pushState')
  wrap('replaceState')
  window.addEventListener('popstate', check)
}
try {
  void handle()
  watchNavigation()
} catch (err) {
  console.error('[vvs] systembolaget boot failed:', err)
}
