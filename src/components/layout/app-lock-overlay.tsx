import { BackspaceOutlined, LockOutlined } from '@mui/icons-material'
import { Box, IconButton, Typography, alpha } from '@mui/material'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import { WindowControls } from '@/components/layout/window-controller'
import { useVerge } from '@/hooks/use-verge'
import { useWindowDecorations } from '@/hooks/use-window'
import { getPreloadConfig } from '@/services/preload'
import {
  APP_LOCK_EVENT,
  PIN_MAX_LENGTH,
  appLockDelayMs,
  hashPin,
  hashesEqual,
  isAppLockConfigured,
  isPinHash,
  isValidPin,
} from '@/utils/app-lock'
import getSystem from '@/utils/get-system'

const OS = getSystem()
const NUMPAD_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  'backspace',
  '0',
  'enter',
] as const

const AppLockOverlay = () => {
  const { t } = useTranslation()
  const { verge } = useVerge()
  const { decorated } = useWindowDecorations()
  const configured = isAppLockConfigured(verge)
  const delayMs = appLockDelayMs(verge?.app_lock_auto_lock_mins)
  const storedHash = verge?.app_lock_pin_hash ?? ''
  const [initiallyLocked] = useState(() =>
    isAppLockConfigured(getPreloadConfig() ?? verge),
  )
  const [sessionUnlocked, setSessionUnlocked] = useState(false)
  const [holdLocked, setHoldLocked] = useState(false)
  const [pin, setPin] = useState('')
  const [invalid, setInvalid] = useState(false)
  const [shake, setShake] = useState(0)
  const obscuredRef = useRef(false)
  const pinRef = useRef('')
  const submittingRef = useRef(false)
  const showLock =
    configured && (holdLocked || (initiallyLocked && !sessionUnlocked))

  const replacePin = useCallback((next: string) => {
    const value = next.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH)
    pinRef.current = value
    setPin(value)
    setInvalid(false)
  }, [])

  const rejectPin = useCallback(() => {
    pinRef.current = ''
    setPin('')
    setInvalid(true)
    setShake((count) => count + 1)
  }, [])

  const submitPin = useCallback(async () => {
    if (submittingRef.current) return
    const current = pinRef.current
    if (!isValidPin(current) || !isPinHash(storedHash)) {
      rejectPin()
      return
    }
    submittingRef.current = true
    try {
      const digest = await hashPin(current)
      if (hashesEqual(digest, storedHash)) {
        pinRef.current = ''
        setPin('')
        setInvalid(false)
        setSessionUnlocked(true)
        setHoldLocked(false)
        return
      }
      rejectPin()
    } catch (error) {
      console.error('[AppLock] Failed to verify PIN:', error)
      rejectPin()
    } finally {
      submittingRef.current = false
    }
  }, [rejectPin, storedHash])

  useEffect(() => {
    const onLockRequest = () => {
      if (configured) setHoldLocked(true)
    }
    const onShortcut = (event: KeyboardEvent) => {
      if (event.repeat) return
      const lockShortcut =
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'l'
      if (!lockShortcut || !configured) return
      event.preventDefault()
      setHoldLocked(true)
    }
    window.addEventListener(APP_LOCK_EVENT, onLockRequest)
    window.addEventListener('keydown', onShortcut)
    return () => {
      window.removeEventListener(APP_LOCK_EVENT, onLockRequest)
      window.removeEventListener('keydown', onShortcut)
    }
  }, [configured])

  useEffect(() => {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const appWindow = getCurrentWindow()

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    const scheduleLock = () => {
      clearTimer()
      if (!configured) return
      if (delayMs <= 0) {
        setHoldLocked(true)
        return
      }
      timer = setTimeout(() => {
        timer = null
        setHoldLocked(true)
      }, delayMs)
    }
    const applyObscured = (next: boolean) => {
      if (obscuredRef.current === next) return
      obscuredRef.current = next
      if (next) scheduleLock()
      else clearTimer()
    }
    const refresh = async () => {
      const [visible, minimized] = await Promise.all([
        appWindow.isVisible().catch(() => true),
        appWindow.isMinimized().catch(() => false),
      ])
      if (!disposed) applyObscured(!visible || minimized)
    }

    const onVisibility = () => {
      void refresh()
    }
    if (obscuredRef.current) {
      timer = setTimeout(scheduleLock, 0)
    }
    const unlistenFocus = appWindow.onFocusChanged(onVisibility)
    const unlistenClose = appWindow.onCloseRequested(() => {
      applyObscured(true)
    })
    document.addEventListener('visibilitychange', onVisibility)
    void refresh()

    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      void unlistenFocus.then((unlisten) => unlisten())
      void unlistenClose.then((unlisten) => unlisten())
    }
  }, [configured, delayMs])

  useEffect(() => {
    if (!showLock) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (/^\d$/.test(event.key)) {
        event.preventDefault()
        replacePin(pinRef.current + event.key)
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        replacePin(pinRef.current.slice(0, -1))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        void submitPin()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [replacePin, showLock, submitPin])

  if (!showLock) return null

  return createPortal(
    <Box
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.modals.appLock.overlay.title')}
      sx={(theme) => ({
        position: 'fixed',
        inset: 0,
        zIndex: 20000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.primary',
        bgcolor: 'background.default',
        backgroundImage: `radial-gradient(circle at top, ${alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.22 : 0.14)}, transparent 58%)`,
      })}
    >
      <Box
        data-tauri-drag-region
        sx={{ position: 'absolute', top: 0, right: 0, left: 0, height: 36 }}
      />
      {decorated === false && (
        <Box
          data-tauri-drag-region="false"
          sx={{
            position: 'absolute',
            top: 8,
            zIndex: 1,
            ...(OS === 'macos' ? { left: 8 } : { right: 8 }),
          }}
        >
          <WindowControls />
        </Box>
      )}

      <Box
        sx={{
          width: 320,
          maxWidth: '100%',
          px: 2,
          textAlign: 'center',
        }}
      >
        <LockOutlined sx={{ fontSize: 46, color: 'primary.main' }} />
        <Typography variant="h5" sx={{ mt: 1, fontWeight: 700 }}>
          {t('settings.modals.appLock.overlay.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {t('settings.modals.appLock.messages.proxyKeepsRunning')}
        </Typography>

        <Typography
          key={shake}
          variant="h4"
          aria-hidden
          sx={{
            mt: 3,
            minHeight: 48,
            letterSpacing: 8,
            animation: invalid ? 'appLockShake 0.42s ease' : 'none',
            '@keyframes appLockShake': {
              '0%, 100%': { transform: 'translateX(0)' },
              '20%': { transform: 'translateX(-10px)' },
              '40%': { transform: 'translateX(10px)' },
              '60%': { transform: 'translateX(-6px)' },
              '80%': { transform: 'translateX(6px)' },
            },
          }}
        >
          {'•'.repeat(pin.length) || ' '}
        </Typography>
        <Typography
          variant="body2"
          color={invalid ? 'error' : 'text.secondary'}
          sx={{ minHeight: 24 }}
        >
          {invalid
            ? t('settings.modals.appLock.overlay.wrongPin')
            : t('settings.modals.appLock.overlay.prompt')}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 72px)',
            gap: 1.5,
            justifyContent: 'center',
            mt: 2,
          }}
        >
          {NUMPAD_KEYS.map((key) => {
            const label =
              key === 'backspace'
                ? t('settings.modals.appLock.overlay.backspace')
                : key === 'enter'
                  ? t('settings.modals.appLock.overlay.unlock')
                  : key
            return (
              <IconButton
                key={key}
                aria-label={label}
                onClick={() => {
                  if (key === 'backspace') {
                    replacePin(pin.slice(0, -1))
                    return
                  }
                  if (key === 'enter') {
                    void submitPin()
                    return
                  }
                  replacePin(pin + key)
                }}
                sx={{
                  width: 72,
                  height: 56,
                  borderRadius: 2,
                  fontSize: key === 'enter' || key === 'backspace' ? 14 : 22,
                  fontWeight: 600,
                  bgcolor: (theme) => alpha(theme.palette.text.primary, 0.06),
                  '&:hover': {
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
                  },
                }}
              >
                {key === 'backspace' ? (
                  <BackspaceOutlined fontSize="small" />
                ) : key === 'enter' ? (
                  t('settings.modals.appLock.overlay.unlock')
                ) : (
                  key
                )}
              </IconButton>
            )
          })}
        </Box>
      </Box>
    </Box>,
    document.body,
  )
}

export default AppLockOverlay
