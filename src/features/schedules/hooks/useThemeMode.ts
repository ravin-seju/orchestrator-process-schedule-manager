import { useEffect, useMemo, useState } from 'react'
import {
  applyResolvedTheme,
  systemPrefersDark,
  type ThemeMode,
} from '@/themeMode'

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('system')
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  useEffect(() => {
    if (!window.matchMedia) return undefined

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const updateSystemTheme = () => setPrefersDark(media.matches)

    updateSystemTheme()
    media.addEventListener('change', updateSystemTheme)
    return () => media.removeEventListener('change', updateSystemTheme)
  }, [])

  const resolvedTheme = useMemo<'light' | 'dark'>(
    () => (themeMode === 'system' ? (prefersDark ? 'dark' : 'light') : themeMode),
    [prefersDark, themeMode],
  )

  useEffect(() => {
    applyResolvedTheme(resolvedTheme, themeMode)
  }, [resolvedTheme, themeMode])

  return { resolvedTheme, setThemeMode, themeMode }
}
