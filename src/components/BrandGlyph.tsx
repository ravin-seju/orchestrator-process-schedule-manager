import { useSyncExternalStore } from 'react'
import brandGlyphLight from '@/assets/uipath-glyph-32.png'
import brandGlyphDark from '@/assets/uipath-glyph-32-orange.svg'

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

export function BrandGlyph() {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, () => 'light' as const)
  const src = theme === 'dark' ? brandGlyphDark : brandGlyphLight
  return <img className="brand-mark" src={src} alt="" aria-hidden="true" />
}
