export const APP_LOCK_EVENT = 'verge:app-lock'
const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 8
const PIN_HASH_PATTERN = /^[a-f0-9]{64}$/
const MAX_AUTO_LOCK_MINUTES = 24 * 60

type AppLockConfig = {
  enable_app_lock?: boolean | null
  app_lock_pin_hash?: string | null
  app_lock_auto_lock_mins?: number | null
} | null

export const isValidPin = (pin: string) =>
  new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)

export const isPinHash = (value?: string | null): value is string =>
  typeof value === 'string' && PIN_HASH_PATTERN.test(value)

export const isAppLockConfigured = (verge?: AppLockConfig) =>
  Boolean(verge?.enable_app_lock) && isPinHash(verge?.app_lock_pin_hash)

export const appLockDelayMs = (minutes?: number | null) => {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.min(Math.floor(minutes), MAX_AUTO_LOCK_MINUTES) * 60_000
}

export const clampAutoLockMinutes = (minutes: number) => {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  return Math.min(Math.floor(minutes), MAX_AUTO_LOCK_MINUTES)
}

export async function hashPin(pin: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(pin),
  )
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export const hashesEqual = (left: string, right: string) => {
  if (left.length !== right.length) return false
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

export const requestAppLock = () => {
  window.dispatchEvent(new Event(APP_LOCK_EVENT))
}
