import type { Folder, LoadSchedulesResult, ProcessSchedule, TenantInfo } from './orchestrator'
import type { RuntimeStats, StressScheduleCount } from './types'

export const stressScheduleCounts = [5, 10, 50, 100] as const
export const defaultStressScheduleCount: StressScheduleCount = 5
type StressBucket = 'minute' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'other'

export const stressTenantName = (count: StressScheduleCount) => `stress-${count}`

export const parseStressTenantName = (tenantName: string): StressScheduleCount | null => {
  const match = /^stress-(\d+)$/.exec(tenantName)
  const count = match ? Number(match[1]) : NaN

  return stressScheduleCounts.includes(count as StressScheduleCount)
    ? (count as StressScheduleCount)
    : null
}

export const stressTenantInfos: TenantInfo[] = stressScheduleCounts.map((count) => ({
  name: stressTenantName(count),
  displayName: `Stress ${count}`,
  source: 'configured',
}))

const stressFolders: Folder[] = [
  { Id: 8101, DisplayName: 'Shared', FullyQualifiedName: 'Shared' },
  { Id: 8102, DisplayName: 'Finance Ops', FullyQualifiedName: 'Finance Ops' },
  { Id: 8103, DisplayName: 'Onboarding', FullyQualifiedName: 'Finance Ops/Onboarding' },
  { Id: 8104, DisplayName: 'Customer Ops', FullyQualifiedName: 'Customer Ops' },
  { Id: 8105, DisplayName: 'Patching', FullyQualifiedName: 'IT Operations/Patching' },
  { Id: 8106, DisplayName: 'Platform Services', FullyQualifiedName: 'Platform Services' },
]

const processNameByBucket: Record<StressBucket, string[]> = {
  minute: ['Queue Pulse', 'Webhook Sweep', 'SLA Monitor'],
  hourly: ['Download File', 'Inbox Sync', 'Health Check', 'Data Refresh'],
  daily: ['Process A', 'Ledger Export', 'Case Intake', 'Morning Dispatch'],
  weekly: ['Process C', 'Compliance Review', 'Factory Utilization', 'Archive Packager'],
  monthly: ['Month-End Close', 'License Reconciliation', 'Report Publisher'],
  other: ['One-Time Backfill', 'Ad Hoc Repair', 'Migration Checkpoint'],
}

const weekdayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const cronWeekdays = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

export const parseStressScheduleCount = (search: string): StressScheduleCount | null => {
  const rawCount = new URLSearchParams(search).get('stress')
  const count = rawCount ? Number(rawCount) : NaN

  return stressScheduleCounts.includes(count as StressScheduleCount)
    ? (count as StressScheduleCount)
    : null
}

const buildBucketSequence = (count: number) => {
  const minuteCount = count >= 5 ? (count >= 100 ? 2 : 1) : 0
  const hourlyCount = Math.max(1, Math.round(count * 0.1))
  const weeklyCount = Math.max(1, Math.round(count * 0.18))
  const monthlyCount = Math.max(1, Math.round(count * 0.08))
  const otherCount = count >= 10 ? Math.max(1, Math.round(count * 0.04)) : 0
  const dailyCount = Math.max(
    0,
    count - minuteCount - hourlyCount - weeklyCount - monthlyCount - otherCount,
  )
  const buckets: StressBucket[] = []

  for (const [bucket, bucketCount] of [
    ['minute', minuteCount],
    ['hourly', hourlyCount],
    ['daily', dailyCount],
    ['weekly', weeklyCount],
    ['monthly', monthlyCount],
    ['other', otherCount],
  ] as Array<[StressBucket, number]>) {
    for (let index = 0; index < bucketCount; index += 1) buckets.push(bucket)
  }

  return buckets.sort((left, right) => {
    const order: StressBucket[] = ['hourly', 'daily', 'weekly', 'monthly', 'minute', 'other']
    return order.indexOf(left) - order.indexOf(right)
  })
}

const formatTime = (hour: number, minute: number) => {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const normalizedHour = hour % 12 || 12

  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${suffix}`
}

const nextRelativeOccurrence = (index: number, hour: number, minute: number) => {
  const date = new Date()
  date.setDate(date.getDate() + (index % 7))
  date.setHours(hour, minute, 0, 0)

  if (date < new Date()) {
    date.setDate(date.getDate() + 1)
  }

  return date.toISOString()
}

const cronDetails = (type: number, bucket: StressBucket, hour: number, minute: number, weekday?: string) =>
  JSON.stringify({
    type,
    [bucket === 'minute' ? 'minutely' : bucket]: {
      atHour: hour,
      atMinute: minute,
      weekdays: weekday ? [{ id: weekday }] : undefined,
    },
  })

const buildScheduleTiming = (bucket: StressBucket, index: number) => {
  const hour = 6 + (index % 12)
  const minute = [0, 15, 30, 45][index % 4]
  const weekdayIndex = (index % 5) + 1
  const monthDay = (index % 28) + 1

  switch (bucket) {
    case 'minute':
      return {
        cron: '0 * * 1/1 * ?',
        details: cronDetails(0, bucket, hour, 1),
        summary: 'Every minute',
        next: nextRelativeOccurrence(index, hour, minute),
      }
    case 'hourly':
      return {
        cron: '0 0 * 1/1 * ?',
        details: cronDetails(1, bucket, hour, 0),
        summary: 'Every hour',
        next: nextRelativeOccurrence(index, hour, 0),
      }
    case 'daily':
      return {
        cron: `0 ${minute} ${hour} 1/1 * ?`,
        details: cronDetails(2, bucket, hour, minute),
        summary: `At ${formatTime(hour, minute)}`,
        next: nextRelativeOccurrence(index, hour, minute),
      }
    case 'weekly':
      return {
        cron: `0 ${minute} ${hour} ? * ${cronWeekdays[weekdayIndex]}`,
        details: cronDetails(3, bucket, hour, minute, cronWeekdays[weekdayIndex]),
        summary: `At ${formatTime(hour, minute)}, only on ${weekdayNames[weekdayIndex]}`,
        next: nextRelativeOccurrence(index, hour, minute),
      }
    case 'monthly':
      return {
        cron: `0 ${minute} ${hour} ${monthDay} * ?`,
        details: cronDetails(4, bucket, hour, minute),
        summary: `At ${formatTime(hour, minute)}, day ${monthDay} of every month`,
        next: nextRelativeOccurrence(index, hour, minute),
      }
    case 'other':
      return {
        cron: 'one-time',
        details: JSON.stringify({ type: 5 }),
        summary: `One-time at ${formatTime(hour, minute)}`,
        next: nextRelativeOccurrence(index, hour, minute),
      }
  }
}

// A few generated schedules get a StopProcessDate — one bucket already past (expired), one within
// EXPIRING_SOON_DAYS (expiring-soon), one far out (ending) — so /testing?stress=50 shows a mix.
const stopProcessDateForIndex = (index: number): string | null => {
  const mod = index % 20
  if (mod === 0) return new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
  if (mod === 5) return new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
  if (mod === 10) return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  return null
}

type MachineRobotEntry = Required<ProcessSchedule>['MachineRobots'][number]

const stressMachinePool: MachineRobotEntry[] = [
  { MachineId: 501, MachineName: 'ROBOT-VM-01', RobotId: 201, RobotUserName: 'Bot.Alpha', SessionId: 901, SessionName: 'ROBOT-VM-01' },
  { MachineId: 502, MachineName: 'ROBOT-VM-02', RobotId: 202, RobotUserName: 'Bot.Beta', SessionId: 902, SessionName: 'ROBOT-VM-02' },
  { MachineId: 503, MachineName: 'ROBOT-VM-03', RobotId: 203, RobotUserName: 'Bot.Gamma', SessionId: 903, SessionName: 'ROBOT-VM-03' },
  { MachineId: 504, MachineName: 'ROBOT-VM-04', RobotId: 204, RobotUserName: 'Bot.Delta', SessionId: 904, SessionName: 'ROBOT-VM-04' },
]

// Jobs-derived runtime maps for the testing route — mirror what useJobRuntimes returns live.
// Machine key = the pool MachineId (501-504); the schedule→machine assignment mirrors
// buildProcessSchedule / showcaseScheduleBase so the picker, metrics, and columns populate.
export const stressMachineNames = new Map<number, string>(
  stressMachinePool.map((m) => [m.MachineId as number, m.MachineName as string]),
)
export const stressRobotNames = new Map<number, string>(
  stressMachinePool.map((m) => [m.RobotId as number, m.RobotUserName as string]),
)
const stressMachineKeysForIndex = (index: number): number[] => {
  const primary = 501 + (index % stressMachinePool.length)
  return index % 5 === 0 && index > 0
    ? [primary, 501 + ((index + 1) % stressMachinePool.length)]
    : [primary]
}
export const stressScheduleMachineIds: Map<number, number[]> = (() => {
  const map = new Map<number, number[]>()
  for (let i = 0; i < 200; i += 1) map.set(90000 + i, stressMachineKeysForIndex(i))
  for (const id of [95001, 95002, 95003, 95004, 95005]) {
    map.set(id, [501 + (id % stressMachinePool.length)])
  }
  return map
})()
export const stressReleaseMachineIds = new Map<number, number[]>()

const buildStressRuntimeStats = (): Map<number, RuntimeStats> => {
  const stats = new Map<number, RuntimeStats>()
  // Every even-indexed generated schedule gets stats; odd → fallback ("No recent run history")
  for (let i = 0; i < 200; i += 2) {
    const isShort = (i / 2) % 2 === 0
    stats.set(90000 + i, {
      medianSec: isShort ? 180 : 1500,
      p90Sec: isShort ? 240 : 2100,
      sampleSize: isShort ? 15 : 8,
    })
  }
  // Showcase schedules
  stats.set(95001, { medianSec: 90, p90Sec: 150, sampleSize: 22 })
  stats.set(95002, { medianSec: 3600, p90Sec: 4500, sampleSize: 5 })
  stats.set(95004, { medianSec: 720, p90Sec: 960, sampleSize: 12 })
  stats.set(95005, { medianSec: 720, p90Sec: 960, sampleSize: 12 })
  return stats
}

export const stressRuntimeStats = buildStressRuntimeStats()

const buildProcessSchedule = (
  bucket: StressBucket,
  index: number,
  folder: Folder,
): ProcessSchedule => {
  const timing = buildScheduleTiming(bucket, index)
  const names = processNameByBucket[bucket]
  const baseName = names[index % names.length]
  const displayNumber = String(index + 1).padStart(3, '0')
  const processSlug = `${folder.DisplayName ?? 'Folder'} ${baseName}`.replace(/\s+/g, '')
  const primaryMachine = stressMachinePool[index % stressMachinePool.length]
  const machineRobots: MachineRobotEntry[] =
    index % 5 === 0 && index > 0
      ? [primaryMachine, stressMachinePool[(index + 1) % stressMachinePool.length]]
      : [primaryMachine]
  const stopProcessDate = stopProcessDateForIndex(index)
  // Mirror Orchestrator: it disables a trigger once its stop date passes, so the already-past
  // bucket ships disabled. Without this no fixture reproduces the auto-disabled case at all.
  const isExpiredBucket = stopProcessDate !== null && index % 20 === 0

  return {
    Id: 90000 + index,
    Name: `${baseName} ${displayNumber}`,
    Enabled: !isExpiredBucket,
    ReleaseId: 70000 + index,
    ReleaseKey: `stress-release-${displayNumber}`,
    ReleaseName: `${processSlug}.Main.xaml`,
    PackageName: `${processSlug}.Package`,
    StartProcessCron: timing.cron,
    StartProcessCronDetails: timing.details,
    StartProcessCronSummary: timing.summary,
    StartProcessNextOccurrence: timing.next,
    TimeZoneId: 'Central Standard Time',
    TimeZoneIana: 'America/Chicago',
    StopProcessDate: stopProcessDate,
    StopStrategy: stopProcessDate ? (index % 2 === 0 ? 'SoftStop' : 'Kill') : null,
    folderId: folder.Id,
    folderName: folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`,
    MachineRobots: machineRobots,
  }
}

export const createStressScheduleData = (count: StressScheduleCount): LoadSchedulesResult => {
  const tenant: TenantInfo = {
    name: stressTenantName(count),
    displayName: `Stress ${count}`,
    source: 'configured',
  }
  const showcase = buildShowcaseSchedules()
  const generatedCount = Math.max(0, count - showcase.length)
  const generated = generatedCount === 0
    ? []
    : buildBucketSequence(generatedCount)
        .map((bucket, index) => buildProcessSchedule(bucket, index, stressFolders[index % stressFolders.length]))
        .slice(0, generatedCount)

  return {
    tenant,
    folders: stressFolders,
    schedules: [...showcase, ...generated],
  }
}

const folderById = (id: number): Folder =>
  stressFolders.find((folder) => folder.Id === id) ?? stressFolders[0]

const showcaseScheduleBase = (
  override: Partial<ProcessSchedule> & Pick<ProcessSchedule, 'Id' | 'Name' | 'folderId'>,
): ProcessSchedule => {
  const folder = folderById(override.folderId)
  return {
    Enabled: true,
    ReleaseId: override.Id + 100,
    ReleaseKey: `stress-showcase-${override.Id}`,
    ReleaseName: `${override.Name.replace(/\s+/g, '')}.Main.xaml`,
    PackageName: `${override.Name.replace(/\s+/g, '')}.Package`,
    StartProcessCron: '0 0 9 1/1 * ?',
    StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 9, atMinute: 0 } }),
    StartProcessCronSummary: 'At 09:00 AM',
    StartProcessNextOccurrence: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    TimeZoneId: 'Central Standard Time',
    TimeZoneIana: 'America/Chicago',
    folderName: folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`,
    MachineRobots: [stressMachinePool[override.Id % stressMachinePool.length]],
    ...override,
  }
}

const buildShowcaseSchedules = (): ProcessSchedule[] => {
  const stalePast = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString()

  return [
    showcaseScheduleBase({
      Id: 95001,
      Name: 'Customer Intake Queue',
      folderId: 8104,
      QueueDefinitionId: 5001,
      StartProcessCron: '0 0/5 * 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 1, hourly: { atHour: 0, atMinute: 0 } }),
      StartProcessCronSummary: 'Every 5 minutes (polling)',
    }),
    showcaseScheduleBase({
      Id: 95002,
      Name: 'Legacy Backfill One-Off',
      folderId: 8101,
      StartProcessCron: 'one-time',
      StartProcessCronDetails: JSON.stringify({ type: 5 }),
      StartProcessCronSummary: 'One-time at 09:00 AM',
      StartProcessNextOccurrence: stalePast,
    }),
    showcaseScheduleBase({
      Id: 95003,
      Name: 'Suspended Nightly Report',
      folderId: 8106,
      Enabled: false,
      StartProcessCron: '0 0 22 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 22, atMinute: 0 } }),
      StartProcessCronSummary: 'At 10:00 PM',
    }),
    showcaseScheduleBase({
      Id: 95004,
      Name: 'Finance Month-End Snapshot',
      folderId: 8102,
      ReleaseId: 75001,
      ReleaseKey: 'stress-showcase-dup',
      StartProcessCron: '0 30 14 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 14, atMinute: 30 } }),
      StartProcessCronSummary: 'At 02:30 PM',
      MachineRobots: [stressMachinePool[0]],
    }),
    showcaseScheduleBase({
      Id: 95005,
      Name: 'Finance Month-End Snapshot',
      folderId: 8102,
      ReleaseId: 75001,
      ReleaseKey: 'stress-showcase-dup',
      StartProcessCron: '0 30 14 1/1 * ?',
      StartProcessCronDetails: JSON.stringify({ type: 2, daily: { atHour: 14, atMinute: 30 } }),
      StartProcessCronSummary: 'At 02:30 PM',
      MachineRobots: [stressMachinePool[0]],
    }),
  ]
}
