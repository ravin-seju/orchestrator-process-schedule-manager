// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APP_VERSION,
  getLastSeenVersion,
  LATEST_RELEASE,
  markVersionSeen,
  shouldShowWhatsNew,
} from '../whatsNew'

afterEach(() => {
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe('whatsNew trigger', () => {
  it('exposes APP_VERSION as the newest release version (single source for the header badge)', () => {
    expect(APP_VERSION).toBe(LATEST_RELEASE.version)
  })

  it('shows for a new user (nothing stored)', () => {
    expect(getLastSeenVersion()).toBeNull()
    expect(shouldShowWhatsNew()).toBe(true)
  })

  it('shows when the stored version is older than the latest release', () => {
    markVersionSeen('0.0.1')
    expect(shouldShowWhatsNew()).toBe(true)
  })

  it('does not show once the latest version has been seen', () => {
    markVersionSeen(LATEST_RELEASE.version)
    expect(getLastSeenVersion()).toBe(LATEST_RELEASE.version)
    expect(shouldShowWhatsNew()).toBe(false)
  })

  it('round-trips the last-seen version through storage', () => {
    markVersionSeen('9.9.9')
    expect(getLastSeenVersion()).toBe('9.9.9')
  })

  it('degrades safely when storage throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(() => getLastSeenVersion()).not.toThrow()
    expect(getLastSeenVersion()).toBeNull()
    expect(shouldShowWhatsNew()).toBe(true)
  })
})
