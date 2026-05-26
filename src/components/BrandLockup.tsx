import { useSyncExternalStore } from 'react'
import lockupLight from '@/assets/uipath-orchestrator-lockup-light.svg'
import lockupDark from '@/assets/uipath-orchestrator-lockup-dark.svg'

function subscribeTheme(notify: () => void) {
  const observer = new MutationObserver(notify)
  observer.observe(document.documentElement, {
    attributeFilter: ['data-theme'],
    attributes: true,
  })
  return () => observer.disconnect()
}

function getThemeSnapshot(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function BrandLockup() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'light' as const)
  const src = theme === 'dark' ? lockupDark : lockupLight
  return <img className="brand-lockup" src={src} alt="UiPath Orchestrator" />
}
