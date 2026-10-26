import {
  Button,
  InputAdornment,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Typography,
} from '@mui/material'
import { useLockFn } from 'ahooks'
import type { Ref } from 'react'
import { useImperativeHandle, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { BaseDialog, DialogRef } from '@/components/base'
import { useVerge } from '@/hooks/use-verge'
import { showNotice } from '@/services/notice-service'
import {
  PIN_MAX_LENGTH,
  clampAutoLockMinutes,
  hashPin,
  hashesEqual,
  isAppLockConfigured,
  isValidPin,
  requestAppLock,
} from '@/utils/app-lock'

const pinFieldProps = {
  autoComplete: 'off',
  size: 'small' as const,
  type: 'password' as const,
  sx: { width: 160 },
  slotProps: {
    htmlInput: {
      inputMode: 'numeric' as const,
      maxLength: PIN_MAX_LENGTH,
      autoCorrect: 'off',
      autoCapitalize: 'off',
      spellCheck: false,
    },
  },
}

const digitsOnly = (value: string) =>
  value.replace(/\D/g, '').slice(0, PIN_MAX_LENGTH)

export function AppLockViewer({ ref }: { ref?: Ref<DialogRef> }) {
  const { t } = useTranslation()
  const { verge, patchVerge } = useVerge()
  const enabled = isAppLockConfigured(verge)
  const [open, setOpen] = useState(false)
  const [currentPin, setCurrentPin] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [immediate, setImmediate] = useState(true)
  const [minutes, setMinutes] = useState(10)
  const [error, setError] = useState('')

  const reset = () => {
    const savedMinutes = verge?.app_lock_auto_lock_mins ?? 0
    setCurrentPin('')
    setPin('')
    setConfirmPin('')
    setImmediate(savedMinutes <= 0)
    setMinutes(savedMinutes > 0 ? savedMinutes : 10)
    setError('')
  }

  useImperativeHandle(ref, () => ({
    open: () => {
      reset()
      setOpen(true)
    },
    close: () => setOpen(false),
  }))

  const delayMinutes = () => (immediate ? 0 : clampAutoLockMinutes(minutes))

  const verifyCurrentPin = async () => {
    const hash = verge?.app_lock_pin_hash
    if (!enabled || !hash) return true
    if (!isValidPin(currentPin)) return false
    return hashesEqual(await hashPin(currentPin), hash)
  }

  const onSave = useLockFn(async () => {
    try {
      const nextMinutes = delayMinutes()
      if (!enabled) {
        if (!isValidPin(pin)) {
          setError(t('settings.modals.appLock.messages.pinRule'))
          return
        }
        if (pin !== confirmPin) {
          setError(t('settings.modals.appLock.messages.pinMismatch'))
          return
        }
        await patchVerge({
          enable_app_lock: true,
          app_lock_pin_hash: await hashPin(pin),
          app_lock_auto_lock_mins: nextMinutes,
        })
        setOpen(false)
        return
      }

      const changingPin = pin.length > 0 || confirmPin.length > 0
      if (changingPin || currentPin.length > 0) {
        if (!(await verifyCurrentPin())) {
          setError(t('settings.modals.appLock.messages.wrongPin'))
          return
        }
      }
      if (changingPin) {
        if (!isValidPin(pin)) {
          setError(t('settings.modals.appLock.messages.pinRule'))
          return
        }
        if (pin !== confirmPin) {
          setError(t('settings.modals.appLock.messages.pinMismatch'))
          return
        }
        await patchVerge({
          enable_app_lock: true,
          app_lock_pin_hash: await hashPin(pin),
          app_lock_auto_lock_mins: nextMinutes,
        })
      } else {
        await patchVerge({ app_lock_auto_lock_mins: nextMinutes })
      }
      setOpen(false)
    } catch (err) {
      showNotice.error(err)
    }
  })

  const onDisable = useLockFn(async () => {
    try {
      if (!(await verifyCurrentPin())) {
        setError(t('settings.modals.appLock.messages.wrongPin'))
        return
      }
      await patchVerge({
        enable_app_lock: false,
        app_lock_pin_hash: '',
      })
      setOpen(false)
    } catch (err) {
      showNotice.error(err)
    }
  })

  return (
    <BaseDialog
      open={open}
      title={t('settings.modals.appLock.title')}
      contentSx={{ width: 460 }}
      okBtn={enabled ? t('shared.actions.save') : t('shared.actions.enable')}
      cancelBtn={t('shared.actions.cancel')}
      onClose={() => setOpen(false)}
      onCancel={() => setOpen(false)}
      onOk={onSave}
    >
      <List>
        <ListItem sx={{ padding: '5px 2px' }}>
          <Typography variant="body2" color="text.secondary">
            {t('settings.modals.appLock.messages.proxyKeepsRunning')}
          </Typography>
        </ListItem>

        {enabled && (
          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText
              primary={t('settings.modals.appLock.fields.currentPin')}
            />
            <TextField
              {...pinFieldProps}
              autoFocus
              value={currentPin}
              onChange={(event) => {
                setError('')
                setCurrentPin(digitsOnly(event.target.value))
              }}
            />
          </ListItem>
        )}

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText
            primary={t(
              enabled
                ? 'settings.modals.appLock.fields.newPin'
                : 'settings.modals.appLock.fields.pin',
            )}
          />
          <TextField
            {...pinFieldProps}
            autoFocus={!enabled}
            value={pin}
            onChange={(event) => {
              setError('')
              setPin(digitsOnly(event.target.value))
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText
            primary={t(
              enabled
                ? 'settings.modals.appLock.fields.confirmNewPin'
                : 'settings.modals.appLock.fields.confirmPin',
            )}
          />
          <TextField
            {...pinFieldProps}
            value={confirmPin}
            onChange={(event) => {
              setError('')
              setConfirmPin(digitsOnly(event.target.value))
            }}
          />
        </ListItem>

        <ListItem sx={{ padding: '5px 2px' }}>
          <ListItemText
            primary={t('settings.modals.appLock.fields.behavior')}
          />
          <Select
            size="small"
            value={immediate ? 'immediate' : 'delay'}
            onChange={(event) =>
              setImmediate(event.target.value === 'immediate')
            }
            sx={{ width: 180, '> div': { py: '7.5px' } }}
          >
            <MenuItem value="immediate">
              {t('settings.modals.appLock.options.immediately')}
            </MenuItem>
            <MenuItem value="delay">
              {t('settings.modals.appLock.options.afterDelay')}
            </MenuItem>
          </Select>
        </ListItem>

        {!immediate && (
          <ListItem sx={{ padding: '5px 2px' }}>
            <ListItemText primary={t('settings.modals.appLock.fields.delay')} />
            <TextField
              autoComplete="off"
              size="small"
              type="number"
              sx={{ width: 150 }}
              value={minutes}
              onChange={(event) =>
                setMinutes(Number.parseInt(event.target.value, 10) || 1)
              }
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      {t('shared.units.minutes')}
                    </InputAdornment>
                  ),
                },
              }}
            />
          </ListItem>
        )}

        {error && (
          <ListItem sx={{ padding: '5px 2px' }}>
            <Typography variant="body2" color="error">
              {error}
            </Typography>
          </ListItem>
        )}

        <ListItem sx={{ padding: '5px 2px' }}>
          <Typography variant="body2" color="text.secondary">
            {t('settings.modals.appLock.messages.pinRule')}{' '}
            {t('settings.modals.appLock.messages.shortcut')}
          </Typography>
        </ListItem>

        {enabled && (
          <ListItem sx={{ padding: '5px 2px', gap: 1 }}>
            <Button variant="outlined" color="error" onClick={onDisable}>
              {t('settings.modals.appLock.actions.disable')}
            </Button>
            <Button
              variant="outlined"
              sx={{ marginLeft: 'auto' }}
              onClick={() => {
                setOpen(false)
                requestAppLock()
              }}
            >
              {t('settings.modals.appLock.actions.lockNow')}
            </Button>
          </ListItem>
        )}
      </List>
    </BaseDialog>
  )
}
