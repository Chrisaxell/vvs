/** Thin wrapper around chrome.storage.local with typed helpers. */
import type { ComparisonResult, Product } from './types.js'
const KEYS = {
  lastSeen: 'lastSeenProduct',
  lastComparison: 'lastComparison',
  fxRate: 'fxRateSekPerNok',
  fxUpdatedAt: 'fxUpdatedAt',
  vmpPrimaryKey: 'vmpPrimaryKey',
  vmpSecondaryKey: 'vmpSecondaryKey',
} as const
export async function setLastSeen(product: Product): Promise<void> {
  await chrome.storage.local.set({ [KEYS.lastSeen]: product })
}
export async function getLastSeen(): Promise<Product | undefined> {
  const res = await chrome.storage.local.get(KEYS.lastSeen)
  return res[KEYS.lastSeen] as Product | undefined
}
export async function setLastComparison(comparison: ComparisonResult): Promise<void> {
  await chrome.storage.local.set({ [KEYS.lastComparison]: comparison })
}
export async function getLastComparison(): Promise<ComparisonResult | undefined> {
  const res = await chrome.storage.local.get(KEYS.lastComparison)
  return res[KEYS.lastComparison] as ComparisonResult | undefined
}
export async function setFxRate(sekPerNok: number): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.fxRate]: sekPerNok,
    [KEYS.fxUpdatedAt]: Date.now(),
  })
}
export async function getFxRate(): Promise<{ rate: number; updatedAt: number } | undefined> {
  const res = await chrome.storage.local.get([KEYS.fxRate, KEYS.fxUpdatedAt])
  const rate = res[KEYS.fxRate] as number | undefined
  const updatedAt = res[KEYS.fxUpdatedAt] as number | undefined
  if (rate == null || updatedAt == null) return undefined
  return { rate, updatedAt }
}
/** Vinmonopolet portal-api keys (primary + optional secondary backup). */
export interface VmpKeys {
  primary?: string
  secondary?: string
}
export async function setVmpKeys(keys: VmpKeys): Promise<void> {
  await chrome.storage.local.set({
    [KEYS.vmpPrimaryKey]: keys.primary ?? '',
    [KEYS.vmpSecondaryKey]: keys.secondary ?? '',
  })
}
export async function getVmpKeys(): Promise<VmpKeys> {
  const res = await chrome.storage.local.get([KEYS.vmpPrimaryKey, KEYS.vmpSecondaryKey])
  return {
    primary: (res[KEYS.vmpPrimaryKey] as string) || undefined,
    secondary: (res[KEYS.vmpSecondaryKey] as string) || undefined,
  }
}
