// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { measurePerformance } from '../performance'

const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

beforeEach(() => {
  debugSpy.mockClear()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

describe('performance logging flag', () => {
  it('uses the current Process Schedule Manager storage key', () => {
    window.localStorage.setItem('process-schedule-manager.perf', '1')

    const result = measurePerformance('unit check', () => 42)

    expect(result).toBe(42)
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[Process Schedule Manager] unit check:'), '')
  })

  it('keeps the legacy Process Calendar storage key as a fallback', () => {
    window.localStorage.setItem('process-calendar.perf', '1')

    measurePerformance('legacy check', () => undefined)

    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('[Process Schedule Manager] legacy check:'), '')
  })
})
