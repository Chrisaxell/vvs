import { getSekPerNok } from '../lib/currency.js'
import { getVmpKeys, setVmpKeys } from '../lib/storage.js'
import type { ExtMessage, ExtResponse } from '../lib/types.js'
const FLAG_SE = '\uD83C\uDDF8\uD83C\uDDEA'
const FLAG_NO = '\uD83C\uDDF3\uD83C\uDDF4'
const APPROX = '\u2248'
const ELLIP = '\u2026'
const ARROW = '\u2197'
const fxEl = document.getElementById('fx-value') as HTMLElement
const contextEl = document.getElementById('context-body') as HTMLElement
const refreshBtn = document.getElementById('refresh-btn') as HTMLButtonElement
// Settings elements
const settingsStatusEl = document.getElementById('settings-status') as HTMLElement
const vmpPrimaryEl = document.getElementById('vmp-primary') as HTMLInputElement
const vmpSecondaryEl = document.getElementById('vmp-secondary') as HTMLInputElement
const settingsSaveBtn = document.getElementById('settings-save') as HTMLButtonElement
const settingsClearBtn = document.getElementById('settings-clear') as HTMLButtonElement
const settingsShowBtn = document.getElementById('settings-show') as HTMLButtonElement
const settingsFeedbackEl = document.getElementById('settings-feedback') as HTMLElement
async function sendMessage<T>(message: ExtMessage): Promise<T | undefined> {
  const res = (await chrome.runtime.sendMessage(message)) as ExtResponse<T> | undefined
  if (!res) return undefined
  if (!res.ok) {
    console.warn('[vvs] popup message error:', res.error)
    return undefined
  }
  return res.data
}
// Keep sendMessage exported-ish so linter doesn't complain if we add uses later.
void sendMessage
async function refresh(): Promise<void> {
  fxEl.textContent = ELLIP
  try {
    const rate = await getSekPerNok()
    fxEl.textContent = `1 NOK ${APPROX} ${rate.toFixed(3)} SEK`
  } catch (err) {
    console.warn('[vvs] FX fetch failed:', err)
    fxEl.textContent = 'FX unavailable'
  }
  void renderContext()
}
const SB_URL = 'https://www.systembolaget.se/'
const VMP_URL = 'https://www.vinmonopolet.no/'
async function renderContext(): Promise<void> {
  let host = ''
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.url) host = new URL(tab.url).hostname
  } catch {
    /* no tabs permission or restricted page */
  }
  const onSb = host.endsWith('systembolaget.se')
  const onVmp = host.endsWith('vinmonopolet.no')
  if (onSb) {
    contextEl.innerHTML = `
      <div class="ctx-line">${FLAG_SE} You're on <strong>Systembolaget</strong>.</div>
      <div class="ctx-line muted">We'll show ${FLAG_NO} Vinmonopolet's price on product pages.</div>
      <a class="ctx-btn" href="${VMP_URL}" target="_blank" rel="noopener">${FLAG_NO} Open Vinmonopolet ${ARROW}</a>
    `
    return
  }
  if (onVmp) {
    contextEl.innerHTML = `
      <div class="ctx-line">${FLAG_NO} You're on <strong>Vinmonopolet</strong>.</div>
      <div class="ctx-line muted">We'll show ${FLAG_SE} Systembolaget's price on product pages.</div>
      <a class="ctx-btn" href="${SB_URL}" target="_blank" rel="noopener">${FLAG_SE} Open Systembolaget ${ARROW}</a>
    `
    return
  }
  contextEl.innerHTML = `
    <div class="ctx-line">Open one of the monopoly stores to start comparing:</div>
    <div class="ctx-btn-row">
      <a class="ctx-btn" href="${SB_URL}" target="_blank" rel="noopener">${FLAG_SE} Systembolaget</a>
      <a class="ctx-btn" href="${VMP_URL}" target="_blank" rel="noopener">${FLAG_NO} Vinmonopolet</a>
    </div>
  `
}
// ---------- Settings ----------
async function loadSettings(): Promise<void> {
  const keys = await getVmpKeys()
  vmpPrimaryEl.value = keys.primary ?? ''
  vmpSecondaryEl.value = keys.secondary ?? ''
  updateSettingsStatus()
}
function updateSettingsStatus(): void {
  const hasPrimary = vmpPrimaryEl.value.trim().length > 0
  const hasSecondary = vmpSecondaryEl.value.trim().length > 0
  if (hasPrimary && hasSecondary) {
    settingsStatusEl.textContent = 'primary + secondary'
    settingsStatusEl.className = 'settings-status ok'
  } else if (hasPrimary || hasSecondary) {
    settingsStatusEl.textContent = 'configured'
    settingsStatusEl.className = 'settings-status ok'
  } else {
    settingsStatusEl.textContent = 'not configured'
    settingsStatusEl.className = 'settings-status'
  }
}
function flashFeedback(msg: string, ok: boolean): void {
  settingsFeedbackEl.textContent = msg
  settingsFeedbackEl.className = `settings-feedback ${ok ? 'ok' : 'err'}`
  window.setTimeout(() => {
    if (settingsFeedbackEl.textContent === msg) {
      settingsFeedbackEl.textContent = ''
      settingsFeedbackEl.className = 'settings-feedback'
    }
  }, 4000)
}
settingsSaveBtn.addEventListener('click', () => {
  const primary = vmpPrimaryEl.value.trim() || undefined
  const secondary = vmpSecondaryEl.value.trim() || undefined
  setVmpKeys({ primary, secondary })
    .then(() => {
      updateSettingsStatus()
      flashFeedback('Saved. Rotate any leaked keys in the portal!', true)
    })
    .catch((err) => flashFeedback(`Save failed: ${err instanceof Error ? err.message : String(err)}`, false))
})
settingsClearBtn.addEventListener('click', () => {
  vmpPrimaryEl.value = ''
  vmpSecondaryEl.value = ''
  setVmpKeys({})
    .then(() => {
      updateSettingsStatus()
      flashFeedback('Cleared.', true)
    })
    .catch((err) => flashFeedback(`Clear failed: ${err instanceof Error ? err.message : String(err)}`, false))
})
settingsShowBtn.addEventListener('click', () => {
  const revealed = vmpPrimaryEl.type === 'text'
  vmpPrimaryEl.type = revealed ? 'password' : 'text'
  vmpSecondaryEl.type = revealed ? 'password' : 'text'
  settingsShowBtn.textContent = revealed ? 'Show' : 'Hide'
})
vmpPrimaryEl.addEventListener('input', updateSettingsStatus)
vmpSecondaryEl.addEventListener('input', updateSettingsStatus)
refreshBtn.addEventListener('click', () => {
  void refresh()
})
void refresh()
void loadSettings()
