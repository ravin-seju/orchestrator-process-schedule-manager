export type ThemeMode = 'system' | 'light' | 'dark'

export function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'light' || mode === 'dark') return mode
  return systemPrefersDark() ? 'dark' : 'light'
}

export function applyResolvedTheme(resolved: 'light' | 'dark', mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = resolved
  document.documentElement.dataset.themeMode = mode
}

export function bootstrapTheme(): void {
  try {
    window.localStorage.removeItem('process-schedule-manager.theme-mode')
  } catch {
    // ignore localStorage access errors
  }
  applyResolvedTheme(resolveTheme('system'), 'system')
}
