/** Injects a floating comparison banner into the current page. */
import type { ComparisonResult, Product, Store } from './types.js'
import { formatVolume, isNum, percentCheaper } from './units.js'
const HOST_ID = 'vvs-banner-host'
const FLAG_SE = '\uD83C\uDDF8\uD83C\uDDEA'
const FLAG_NO = '\uD83C\uDDF3\uD83C\uDDF4'
const WARN = '\u26A0'
export function renderBanner(source: Product, result: ComparisonResult | undefined): void {
  const host = ensureHost()
  const shadow = host.shadowRoot!
  const other = source.store === 'systembolaget' ? result?.no : result?.se
  const otherLabel = source.store === 'systembolaget' ? 'Vinmonopolet' : 'Systembolaget'
  const otherFlag = source.store === 'systembolaget' ? FLAG_NO : FLAG_SE
  const alternates = result?.alternates ?? []
  const otherLoneCurrencyLine = other && isNum(other.price)
    ? `<div class="row"><span class="price">${other.price.toFixed(0)} ${other.currency}</span></div>`
    : ''
  const priceLine = renderPriceLine(source, result)
  const scoreLine = result && result.score > 0
    ? `<span class="score" title="Match confidence">match ${(result.score * 100).toFixed(0)}%</span>`
    : ''
  const errLine = result?.searchError
    ? `<div class="soft-err" title="${escape(result.searchError)}">${WARN} Search failed: ${escape(shortenErr(result.searchError))}</div>`
    : ''
  const alternatesBlock = alternates.length
    ? `
      <details class="alts"${alternates.length > 1 ? ' open' : ''}>
        <summary>${alternates.length === 1 ? 'Other match' : `Other matches (${alternates.length})`}</summary>
        <ul>
          ${alternates.map((a) => renderAltItem(a.product, a.score)).join('')}
        </ul>
      </details>
    `
    : ''
  const otherMeta = other ? renderMeta(other) : ''
  shadow.querySelector('.body')!.innerHTML = other
    ? `
      <div class="row">
        <div class="label">${otherFlag} ${escape(otherLabel)}</div>
        ${scoreLine}
      </div>
      <a class="name" href="${escape(other.url)}" target="_blank" rel="noopener">
        ${escape(other.name)}
      </a>
      ${otherMeta}
      ${priceLine || otherLoneCurrencyLine}
      ${errLine}
      ${alternatesBlock}
    `
    : alternates.length
      ? `
        <div class="row"><div class="label">${otherFlag} ${escape(otherLabel)}</div></div>
        <div class="muted">No confident match. Closest candidates:</div>
        <ul class="picker">
          ${alternates.map((a) => renderAltItem(a.product, a.score)).join('')}
        </ul>
        ${errLine}
      `
      : `
        <div class="row"><div class="label">${otherFlag} ${escape(otherLabel)}</div></div>
        <div class="muted">${result?.searchError ? "Couldn't search the other store." : 'No match found.'}</div>
        ${errLine}
      `
}
/** Small meta line under the main product name: volume, abv, vintage. */
function renderMeta(p: Product): string {
  const parts: string[] = []
  const vol = formatVolume(p.volumeMl)
  if (vol) parts.push(vol)
  if (isNum(p.abv)) parts.push(`${p.abv.toFixed(1)}%`)
  if (p.vintage) parts.push(String(p.vintage))
  if (parts.length === 0) return ''
  return `<div class="meta">${parts.map(escape).join(' \u00B7 ')}</div>`
}
function shortenErr(msg: string): string {
  return msg.length > 80 ? `${msg.slice(0, 77)}\u2026` : msg
}
function renderAltItem(p: Product, score: number): string {
  const price = isNum(p.price) ? `${p.price.toFixed(2)} ${p.currency}` : '\u2014'
  const vol = formatVolume(p.volumeMl)
  const volBadge = vol ? ` <span class="alt-vol">${escape(vol)}</span>` : ''
  const pct = Math.round(score * 100)
  return `
    <li>
      <a href="${escape(p.url)}" target="_blank" rel="noopener">
        <span class="alt-score" title="Match confidence">${pct}%</span>
        <span class="alt-name">${escape(p.name)}${volBadge}</span>
        <span class="alt-price">${price}</span>
      </a>
    </li>
  `
}
export function renderLoading(source: Product): void {
  const host = ensureHost()
  const shadow = host.shadowRoot!
  const otherLabel = source.store === 'systembolaget' ? 'Vinmonopolet' : 'Systembolaget'
  const otherFlag = source.store === 'systembolaget' ? FLAG_NO : FLAG_SE
  shadow.querySelector('.body')!.innerHTML = `
    <div class="row"><div class="label">${otherFlag} ${otherLabel}</div></div>
    <div class="muted">Searching\u2026</div>
  `
}
/**
 * Show a lightweight welcome bubble on any page of the two supported stores.
 * Auto-hides after autoHideMs if nothing upgrades it to a real comparison.
 */
export function renderWelcome(sourceStore: Store, autoHideMs = 8000): void {
  const host = ensureHost()
  const shadow = host.shadowRoot!
  const otherLabel = sourceStore === 'systembolaget' ? 'Vinmonopolet' : 'Systembolaget'
  const otherFlag = sourceStore === 'systembolaget' ? FLAG_NO : FLAG_SE
  const otherUrl = sourceStore === 'systembolaget'
    ? 'https://www.vinmonopolet.no/'
    : 'https://www.systembolaget.se/'
  shadow.querySelector('.body')!.innerHTML = `
    <div class="row"><div class="label">Systempolet is watching</div></div>
    <div class="welcome">
      Browse any product and we'll show you the price at
      <a class="welcome-link" href="${escape(otherUrl)}" target="_blank" rel="noopener">
        <strong>${otherFlag} ${escape(otherLabel)}</strong> \u2197
      </a>.
    </div>
  `
  if (autoHideMs > 0) {
    window.setTimeout(() => {
      if (shadow.querySelector('.welcome')) host.remove()
    }, autoHideMs)
  }
}
export function renderError(msg: string): void {
  const host = ensureHost()
  const shadow = host.shadowRoot!
  shadow.querySelector('.body')!.innerHTML = `
    <div class="row"><div class="label">${WARN} Error</div></div>
    <div class="muted">${escape(msg)}</div>
  `
}
/** Single line: matched product's price, followed by "N% cheaper/pricier per L". */
function renderPriceLine(source: Product, result: ComparisonResult | undefined): string {
  const other = source.store === 'systembolaget' ? result?.no : result?.se
  if (!other || !isNum(other.price)) return ''
  const priceStr = `${other.price.toFixed(0)} ${other.currency}`

  let pctBadge = ''
  if (result?.se && result?.no && isNum(result.fxRate) &&
      isNum(result.se.price) && isNum(result.no.price)) {
    const usePerL = isNum(result.seSekPerLitre) && isNum(result.noSekPerLitre)
    const seVal = usePerL ? result.seSekPerLitre! : result.se.price
    const noVal = usePerL ? result.noSekPerLitre! : result.no.price * result.fxRate
    const unit = usePerL ? '/L' : ''
    const pct = percentCheaper(Math.min(seVal, noVal), Math.max(seVal, noVal)) ?? 0
    console.log('[vvs] priceLine inputs:', {
      sourceStore: source.store,
      seName: result.se.name, sePrice: result.se.price, seVolumeMl: result.se.volumeMl, seSekPerLitre: result.seSekPerLitre,
      noName: result.no.name, noPrice: result.no.price, noVolumeMl: result.no.volumeMl, noSekPerLitre: result.noSekPerLitre,
      fxRate: result.fxRate, usePerL, seVal, noVal, pct,
    })
    if (pct >= 1) {
      // Is the OTHER store (the matched one) cheaper than the source?
      const otherCheaper = source.store === 'systembolaget' ? noVal < seVal : seVal < noVal
      const cls = otherCheaper ? 'cheaper' : 'pricier'
      const word = otherCheaper ? 'cheaper' : 'pricier'
      pctBadge = ` <span class="pct ${cls}">${pct.toFixed(0)}% ${word}${unit}</span>`
    }
  }
  return `<div class="row"><span class="price">${priceStr}</span>${pctBadge}</div>`
}

function escape(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}
/** Idempotent: creates the shadow-DOM host on first call, returns it thereafter. */
function ensureHost(): HTMLElement {
  const existing = document.getElementById(HOST_ID) as HTMLElement | null
  if (existing) return existing
  const host = document.createElement('div')
  host.id = HOST_ID
  host.style.cssText = [
    'position: fixed !important',
    'bottom: 16px !important',
    'right: 16px !important',
    'top: auto !important',
    'left: auto !important',
    'z-index: 2147483647 !important',
    'width: auto !important',
    'height: auto !important',
    'max-width: 320px !important',
    'display: block !important',
    'visibility: visible !important',
    'opacity: 1 !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: 0 !important',
    'transform: none !important',
    'pointer-events: auto !important',
  ].join('; ')
  const shadow = host.attachShadow({ mode: 'open' })
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .card {
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: 13px;
        color: #f5f5f5;
        background: #14161a;
        border: 1px solid #2a2f37;
        border-radius: 10px;
        padding: 12px 14px;
        width: 280px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      }
      .head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 6px;
      }
      .brand { color: #e0b25a; font-weight: 700; letter-spacing: 0.5px; }
      .close {
        cursor: pointer; color: #9aa0a6; background: none; border: 0;
        font-size: 16px; line-height: 1; padding: 0 4px;
      }
      .close:hover { color: #f5f5f5; }
      .body { display: flex; flex-direction: column; gap: 6px; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .label { color: #9aa0a6; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
      .name { color: #f5f5f5; font-weight: 600; text-decoration: none; }
      .name:hover { text-decoration: underline; }
      .price { color: #e0b25a; font-weight: 700; }
      .pct {
        font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
        margin-left: 6px;
      }
      .pct.cheaper { background: rgba(126,231,135,0.15); color: #7ee787; }
      .pct.pricier { background: rgba(255,120,120,0.15); color: #ff9a9a; }
      .muted { color: #9aa0a6; font-size: 12px; }
      .meta { color: #9aa0a6; font-size: 11px; margin-top: -2px; }
      .score {
        color: #9aa0a6; background: #1e2127; border: 1px solid #2a2f37;
        border-radius: 999px; padding: 1px 8px; font-size: 11px;
      }
      .diff { font-size: 12px; font-weight: 600; }
      .diff.se { color: #7ec9ff; }
      .diff.no { color: #7ee787; }
      .diff.neutral { color: #9aa0a6; }
      div.diff {
        margin-top: 6px; padding: 6px 8px; border-radius: 4px;
        background: #1e2127; border: 1px solid #2a2f37; line-height: 1.35;
      }
      .diff-sub {
        margin-top: 4px; padding-top: 4px;
        border-top: 1px dashed #2a2f37;
        font-size: 11px; color: #9aa0a6; font-weight: normal;
      }
      .diff-sub strong { color: #f5f5f5; }
      .diff-headline {
        display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px;
        font-size: 14px; line-height: 1.2;
      }
      .diff-pct {
        font-size: 24px; font-weight: 800; line-height: 1;
        color: #7ee787;
        padding: 0 2px;
      }
      .diff.se .diff-pct { color: #7ec9ff; }
      .diff.no .diff-pct { color: #7ee787; }
      .diff-unit { color: #9aa0a6; font-size: 11px; font-weight: normal; }
      .prices {
        display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 4px;
      }
      .price-cell {
        background: #1e2127; border: 1px solid #2a2f37; border-radius: 6px;
        padding: 6px 8px; text-align: center;
        position: relative;
        transition: border-color 0.15s ease;
      }
      .price-cell.winner {
        border-color: #7ee787;
        box-shadow: 0 0 0 1px rgba(126, 231, 135, 0.25);
      }
      .price-flag {
        color: #9aa0a6; font-size: 10px; text-transform: uppercase;
        letter-spacing: 0.5px; margin-bottom: 2px;
      }
      .price-main { color: #e0b25a; font-weight: 700; font-size: 14px; }
      .price-sub { color: #9aa0a6; font-size: 10px; margin-top: 1px; }
      .save-badge {
        display: inline-block;
        margin-top: 4px;
        padding: 2px 6px;
        background: #7ee787;
        color: #14161a;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.5px;
        border-radius: 3px;
      }
      .alts {
        margin-top: 4px; border-top: 1px dashed #2a2f37; padding-top: 6px;
      }
      .alts summary {
        cursor: pointer; color: #9aa0a6; font-size: 11px;
        text-transform: uppercase; letter-spacing: 0.5px;
        list-style: none; user-select: none;
      }
      .alts summary::-webkit-details-marker { display: none; }
      .alts summary::before { content: "\u25B8 "; }
      .alts[open] summary::before { content: "\u25BE "; }
      ul.picker, .alts ul {
        list-style: none; margin: 6px 0 0; padding: 0;
        display: flex; flex-direction: column; gap: 4px;
      }
      ul.picker li a, .alts ul li a {
        display: flex; justify-content: space-between; align-items: center;
        gap: 8px; color: #f5f5f5; text-decoration: none; font-size: 12px;
        padding: 4px 6px; border-radius: 4px;
      }
      ul.picker li a:hover, .alts ul li a:hover {
        background: #1e2127; color: #e0b25a;
      }
      .alt-name {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        flex: 1 1 auto; min-width: 0;
      }
      .alt-price { color: #e0b25a; font-weight: 600; flex: 0 0 auto; }
      .alt-score {
        display: inline-block;
        min-width: 34px;
        text-align: center;
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        background: #1e2127;
        border: 1px solid #2a2f37;
        color: #9aa0a6;
        flex: 0 0 auto;
      }
      .alt-vol {
        display: inline-block; background: #14161a; border: 1px solid #2a2f37;
        border-radius: 3px; padding: 0 4px; margin-left: 4px;
        font-size: 10px; color: #9aa0a6; font-weight: normal; vertical-align: middle;
      }
      .welcome { color: #f5f5f5; font-size: 13px; line-height: 1.4; }
      .welcome-link { color: #e0b25a; text-decoration: none; white-space: nowrap; }
      .welcome-link:hover { text-decoration: underline; }
      .soft-err {
        margin-top: 6px; padding: 6px 8px; border-radius: 4px;
        background: #3a2a1a; border: 1px solid #6b4a2a; color: #ffb977;
        font-size: 11px; line-height: 1.35;
      }
    </style>
    <div class="card">
      <div class="head">
        <span class="brand">Systempolet</span>
        <button class="close" title="Hide">\u2715</button>
      </div>
      <div class="body"></div>
    </div>
  `
  shadow.querySelector('.close')!.addEventListener('click', () => {
    host.remove()
  })
  document.documentElement.appendChild(host)
  return host
}
