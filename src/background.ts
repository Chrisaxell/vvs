import { bestMatch, compare, topMatches } from './lib/compare.js'
import { getSekPerNok } from './lib/currency.js'
import {
  getLastComparison,
  getLastSeen,
  setLastComparison,
  setLastSeen,
} from './lib/storage.js'
import { searchSystembolaget } from './lib/systembolaget.js'
import { searchVinmonopolet } from './lib/vinmonopolet.js'
import { hasVmpKey, searchVinmonopoletOfficial } from './lib/vinmonopoletOfficial.js'
import type { ComparisonResult, ExtMessage, ExtResponse, Product } from './lib/types.js'

chrome.runtime.onInstalled.addListener(async () => {
  console.log('[vvs] installed')
  try {
    await getSekPerNok()
  } catch (err) {
    console.warn('[vvs] initial FX fetch failed:', err)
  }
})

// Clear badge on tab switch / URL change so stale state doesn't confuse.
chrome.tabs.onActivated.addListener(({ tabId }) => {
  void chrome.action.setBadgeText({ tabId, text: '' })
})

async function setBadge(tabId: number | undefined, text: string, color = '#e0b25a'): Promise<void> {
  if (tabId == null) return
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color })
    await chrome.action.setBadgeText({ tabId, text })
  } catch (err) {
    console.warn('[vvs] setBadge failed:', err)
  }
}

chrome.runtime.onMessage.addListener(
  (message: ExtMessage, sender, sendResponse: (r: ExtResponse) => void) => {
    handleMessage(message, sender)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err: unknown) =>
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      )
    return true
  },
)

async function handleMessage(
  message: ExtMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  switch (message.type) {
    case 'PING':
      return 'pong'

    case 'SCRIPT_LOADED': {
      console.log('[vvs] SCRIPT_LOADED from', message.store, message.url, 'tabId=', sender.tab?.id)
      const badge = message.store === 'systembolaget' ? 'SE' : 'NO'
      await setBadge(sender.tab?.id, badge, '#4a5568')
      return { acknowledged: true }
    }

    case 'PAGE_PRODUCT':
      await setLastSeen(message.product)
      await setBadge(sender.tab?.id, '$', '#38a169')
      return { stored: true }

    case 'GET_LAST_SEEN':
      return await getLastSeen()

    case 'GET_LAST_COMPARISON':
      return await getLastComparison()

    case 'FIND_MATCH':
      return await findMatch(message.product)

    default: {
      const _exhaustive: never = message
      throw new Error(`Unknown message: ${JSON.stringify(_exhaustive)}`)
    }
  }
}

/**
 * Given a product from one store, search the other store for the best match
 * and return a ComparisonResult. Also caches it for the popup.
 *
 * Never throws on search failure — returns a soft-fail result carrying the
 * original product plus a `searchError` note, so the content script can still
 * show the user something useful.
 */
async function findMatch(source: Product): Promise<ComparisonResult> {
  const queries = buildQueryVariants(source)
  console.log('[vvs] findMatch source:', {
    store: source.store, id: source.id, name: source.name,
    producer: source.producer, volumeMl: source.volumeMl, abv: source.abv,
  })
  console.log('[vvs] findMatch query ladder:', queries)

  let candidates: Product[] = []
  let searchError: string | undefined
  let usedQuery: string | undefined

  for (const query of queries) {
    try {
      const results = source.store === 'vinmonopolet'
        ? await searchSystembolaget(query, 15)
        : await searchVinmonopoletBest(query, 15)
      console.log(`[vvs] query "${query}" -> ${results.length} candidates`)
      if (results.length > 0) {
        candidates = results
        usedQuery = query
        break
      }
    } catch (err) {
      searchError = err instanceof Error ? err.message : String(err)
      console.warn(`[vvs] query "${query}" failed:`, searchError)
      // Try the next variant even after an error — the shorter query might work.
    }
  }

  if (candidates.length === 0 && !searchError) {
    searchError = `No results for any of ${queries.length} query variants`
    console.warn('[vvs]', searchError)
  } else if (candidates.length > 0) {
    console.log(`[vvs] using query "${usedQuery}" with`, candidates.length, 'candidates:',
      candidates.slice(0, 5).map((c) => `${c.name} (${c.id})`))
  }

  const ranked = topMatches(source, candidates, 4) // 1 best + up to 3 alternates
  const best = bestMatch(source, candidates)
  console.log('[vvs] best match:', best ? `${best.product.name} score=${best.score.toFixed(2)}` : 'none')

  let se: Product | undefined
  let no: Product | undefined
  let score = 0
  const alternates = ranked
    .filter((r) => !best || r.product.id !== best.product.id)
    .slice(0, 3)

  if (source.store === 'vinmonopolet') {
    no = source
    if (best) {
      se = best.product
      score = best.score
    }
  } else {
    se = source
    if (best) {
      no = best.product
      score = best.score
    }
  }

  const result = await compare(se, no, score, alternates)
  if (searchError) result.searchError = searchError
  await setLastComparison(result)
  return result
}

/**
 * Build a ladder of progressively shorter/simpler queries to try in order.
 * Returns [full, medium, short, single-token] with duplicates removed.
 * This helps when a name like "La Brezza Calcarea Verdicchio di Matelica"
 * has zero hits — we then try "Brezza Calcarea", then "Brezza", etc.
 */
function buildQueryVariants(p: Product): string[] {
  const stop = new Set([
    'the', 'de', 'la', 'le', 'les', 'di', 'du', 'del', 'della', 'da',
    'og', 'och', 'and', 'vin', 'vino', 'wine', 'rouge', 'blanc', 'red', 'white',
  ])
  const tokens = p.name
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b\d+(?:[.,]\d+)?\s?(?:cl|ml|l|%)\b/gi, ' ')
    .replace(/[^\p{Letter}\p{Number}\s-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !stop.has(t.toLowerCase()) && !/^\d+$/.test(t))

  const variants = new Set<string>()

  // 1. Producer + first name token (best for wines: "Château Margaux Grand Vin"
  //    is more likely to find a match on producer name alone)
  if (p.producer && tokens.length > 0) {
    const producerToken = p.producer.split(/\s+/).find((t) => t.length >= 3)
    if (producerToken) {
      variants.add(`${producerToken} ${tokens[0]}`.trim())
      variants.add(producerToken)
    }
  }

  // 2. First 3 tokens (previous default behavior)
  if (tokens.length >= 3) variants.add(tokens.slice(0, 3).join(' '))
  // 3. First 2 tokens
  if (tokens.length >= 2) variants.add(tokens.slice(0, 2).join(' '))
  // 4. Just the first significant token
  if (tokens.length >= 1) variants.add(tokens[0])
  // 5. Producer alone as last-ditch (if not already added)
  if (p.producer) {
    const producerToken = p.producer.split(/\s+/).find((t) => t.length >= 3)
    if (producerToken) variants.add(producerToken)
  }

  // Fallback: raw name if nothing else worked
  if (variants.size === 0) variants.add(p.name.slice(0, 40))

  return [...variants]
}
/**
 * Cross-store search for Vinmonopolet.
 *
 * NOTE: the official portal-api (v0) is bulk-download only and has no search
 * endpoint (returns HTTP 404). Until Vinmonopolet ships a search-capable
 * version we go straight to the public /vmpws path, which now internally
 * tries OCC JSON first, then falls back to scraping the /search HTML.
 * API keys are still stored — they'll be used automatically when we add
 * per-code lookups or v1 gets released.
 */
async function searchVinmonopoletBest(query: string, pageSize: number): Promise<Product[]> {
  // Reserved for future use; suppresses "unused import" until we call it.
  void hasVmpKey
  void searchVinmonopoletOfficial

  const results = await searchVinmonopolet(query, pageSize)
  console.log('[vvs] Vinmonopolet search got', results.length, 'results for', JSON.stringify(query))
  return results
}


