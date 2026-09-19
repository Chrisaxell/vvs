/** Injected on vinmonopolet.no — welcome bubble + product comparison. */
import { renderBanner, renderError, renderLoading, renderWelcome } from '../lib/banner.js'
import type { ComparisonResult, ExtMessage, ExtResponse, Product } from '../lib/types.js'
import { isNum } from '../lib/units.js'
import {
  getVinmonopoletProduct,
  parseVinmonopoletUrl,
  scrapeVinmonopoletFromDom,
} from '../lib/vinmonopolet.js'
console.log('[vvs] vinmonopolet content script loaded on', location.href)
try {
  chrome.runtime
    .sendMessage({ type: 'SCRIPT_LOADED', store: 'vinmonopolet', url: location.href } as ExtMessage)
    .catch((err) => console.warn('[vvs] SCRIPT_LOADED send failed:', err))
} catch (err) {
  console.warn('[vvs] cannot reach background worker:', err)
}
let lastHandledCode: string | undefined
let greeted = false
/** Try DOM first (fast, no network), then fall back to the API. */
async function resolveProduct(code: string): Promise<Product | undefined> {
  const fromDom = scrapeVinmonopoletFromDom(code)
  if (fromDom && isNum(fromDom.price)) {
    console.log('[vvs] vinmonopolet product from DOM:', fromDom)
    return fromDom
  }
  // DOM not ready yet — wait a beat for JSON-LD to appear, then retry.
  await new Promise((r) => setTimeout(r, 400))
  const retry = scrapeVinmonopoletFromDom(code)
  if (retry && isNum(retry.price)) {
    console.log('[vvs] vinmonopolet product from DOM (retry):', retry)
    return retry
  }
  // Last resort: the API (often returns 400, but harmless — returns undefined).
  const fromApi = await getVinmonopoletProduct(code)
  if (fromApi) {
    console.log('[vvs] vinmonopolet product from API:', fromApi)
    return fromApi
  }
  // Give the caller *something* so it can still render a banner + trigger search.
  return retry ?? fromDom
}
async function handle(): Promise<void> {
  const code = parseVinmonopoletUrl(location.href)
  console.log('[vvs] vinmonopolet parseUrl ->', code ?? '(no code)')
  if (!code) {
    if (!greeted) {
      greeted = true
      try { renderWelcome('vinmonopolet') } catch (err) { console.error('[vvs] renderWelcome failed:', err) }
    }
    return
  }
  if (code === lastHandledCode) return
  lastHandledCode = code
  greeted = true
  // Show something IMMEDIATELY so we know the script is alive on this page.
  const provisional: Product = {
    store: 'vinmonopolet', id: code, name: 'Loading product…',
    price: NaN, currency: 'NOK', url: location.href,
  }
  try { renderLoading(provisional) } catch (err) { console.error('[vvs] renderLoading failed:', err) }
  try {
    const product = await resolveProduct(code)
    if (!product) {
      console.warn('[vvs] vinmonopolet: no product for code', code)
      renderError(`Could not read product ${code} from this page.`)
      return
    }
    void sendMessage({ type: 'PAGE_PRODUCT', product })
    renderLoading(product)
    const result = await sendMessage<ComparisonResult>({ type: 'FIND_MATCH', product })
    console.log('[vvs] comparison result:', result)
    renderBanner(product, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[vvs] vinmonopolet handle failed:', err)
    try { renderError(msg) } catch (e2) { console.error('[vvs] renderError failed:', e2) }
  }
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
  console.error('[vvs] vinmonopolet boot failed:', err)
}
