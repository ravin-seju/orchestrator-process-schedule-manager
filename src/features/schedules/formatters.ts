const countFormatter = new Intl.NumberFormat('en-US')

export const formatNumber = (value: number) => countFormatter.format(value)

export const formatRunCount = (value: number) => `${formatNumber(value)} run${value === 1 ? '' : 's'}`

export const formatDayCount = (value: number) => `${formatNumber(value)} day${value === 1 ? '' : 's'}`

export const upcomingGroupLabel = (date: Date) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const candidate = new Date(date)
  candidate.setHours(0, 0, 0, 0)

  if (candidate.getTime() === today.getTime()) return 'Today'
  if (candidate.getTime() === tomorrow.getTime()) return 'Tomorrow'

  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}
