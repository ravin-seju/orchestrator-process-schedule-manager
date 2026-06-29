import { describe, expect, it } from 'vitest'
import { aggregateRuntimes } from '@/features/jobs/orchestrator'

describe('aggregateRuntimes', () => {
  it('returns an empty map for empty input', () => {
    expect(aggregateRuntimes([]).size).toBe(0)
  })

  it('skips rows with null scheduleId', () => {
    const result = aggregateRuntimes([{ scheduleId: null, durationSec: 60 }])
    expect(result.size).toBe(0)
  })

  it('computes median and p90 for a known distribution', () => {
    // Durations: [120, 130, 135, 140, 145, 150, 155, 160, 165, 1200]
    // sorted: same; n=10, median = avg(145, 150) = 147.5; p90 = sorted[8] = 165
    const rows = [120, 130, 135, 140, 145, 150, 155, 160, 165, 1200].map((d) => ({
      scheduleId: 1,
      durationSec: d,
    }))
    const result = aggregateRuntimes(rows)
    const stats = result.get(1)
    expect(stats).toBeDefined()
    expect(stats!.medianSec).toBeCloseTo(147.5)
    expect(stats!.p90Sec).toBe(165)
    expect(stats!.sampleSize).toBe(10)
  })

  it('computes median correctly for odd-length arrays', () => {
    const rows = [10, 20, 30].map((d) => ({ scheduleId: 2, releaseKey: null, durationSec: d }))
    const stats = aggregateRuntimes(rows).get(2)
    expect(stats!.medianSec).toBe(20)
    expect(stats!.p90Sec).toBe(30)
    expect(stats!.sampleSize).toBe(3)
  })

  it('groups rows by scheduleId independently', () => {
    const rows = [
      { scheduleId: 1, releaseKey: null, durationSec: 100 },
      { scheduleId: 2, releaseKey: null, durationSec: 200 },
      { scheduleId: 1, releaseKey: null, durationSec: 300 },
    ]
    const result = aggregateRuntimes(rows)
    expect(result.get(1)!.medianSec).toBe(200)
    expect(result.get(2)!.medianSec).toBe(200)
  })

  it('handles a single-sample schedule', () => {
    const rows = [{ scheduleId: 5, releaseKey: 'x', durationSec: 90 }]
    const stats = aggregateRuntimes(rows).get(5)
    expect(stats!.medianSec).toBe(90)
    expect(stats!.p90Sec).toBe(90)
    expect(stats!.sampleSize).toBe(1)
  })
})
