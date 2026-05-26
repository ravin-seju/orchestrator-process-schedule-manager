const performanceFlagKey = 'process-schedule-manager.perf'
const legacyPerformanceFlagKey = 'process-calendar.perf'

const shouldLogPerformance = () => {
  if (typeof window === 'undefined') return false

  const params = new URLSearchParams(window.location.search)
  return (
    params.has('perf') ||
    window.localStorage.getItem(performanceFlagKey) === '1' ||
    window.localStorage.getItem(legacyPerformanceFlagKey) === '1'
  )
}

export const measurePerformance = <T>(label: string, task: () => T, meta?: Record<string, unknown>): T => {
  if (!shouldLogPerformance()) return task()

  const start = performance.now()
  try {
    return task()
  } finally {
    const duration = performance.now() - start
    console.debug(`[Process Schedule Manager] ${label}: ${duration.toFixed(1)}ms`, meta ?? '')
  }
}
