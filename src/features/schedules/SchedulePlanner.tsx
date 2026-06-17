import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { UiPath } from '@uipath/uipath-typescript/core'
import {
  AlertTriangle,
  CalendarCheck2,
  CalendarClock,
  CheckCircle2,
  Copy,
  Folder,
  Zap,
} from 'lucide-react'
import {
  dateKey,
} from './scheduleUtils'
import {
  defaultMonthSpanLaneLimit,
  emptyFolders,
  emptySchedules,
  getEnvironmentDisplayLabel,
  iconSize,
  maxMonthSpanLaneLimit,
  minMonthSpanLaneLimit,
  monthSpanLaneStepPx,
  monthSpanReservedHeightPx,
  viewModeStorageKey,
  weekVisibleSpanRows,
} from './constants'
import {
  readInitialViewMode,
} from './calendarDisplay'
import { getStatusAwareFolders, pruneSelectedFolderIdsForStatus } from './folderOptions'
import { buildSummaryMetricData } from './summaryMetrics'
import type { SummaryMetricKey } from './summaryMetrics'
import {
  AppHeader,
  CalendarWorkbench,
  FilterToolbar,
  ScheduleTable,
  UpcomingPanel,
} from './components'
import {
  useCalendarModel,
  useScheduleData,
  useScheduleFilters,
  useThemeMode,
  useUpcomingModel,
  applyAttentionFilter,
} from './hooks'
import type {
  AttentionFilter,
  CalendarViewMode,
  ProcessDayGroup,
  SelectedDayDetail,
  StatusFilter,
  TriggerTypeFilter,
  ViewMode,
  WorkspaceView,
} from './types'

const testingRouteEnabled = import.meta.env.VITE_ENABLE_TESTING_ROUTE === 'true'
const testingConnectionTitle = testingRouteEnabled
  ? 'Generated stress-test triggers are loaded locally. No Orchestrator triggers were created or changed.'
  : ''

const dayRangeFromKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  const start = new Date(year, month - 1, day)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setHours(23, 59, 59, 999)

  return { start, end }
}

const summaryIconForMetric = (key: SummaryMetricKey) => {
  switch (key) {
    case 'enabled':
      return <CheckCircle2 size={iconSize} aria-hidden="true" />
    case 'activeToday':
    case 'suppressedToday':
      return <CalendarCheck2 size={iconSize} aria-hidden="true" />
    case 'folders':
      return <Folder size={iconSize} aria-hidden="true" />
    case 'duplicateSchedules':
      return <Copy size={iconSize} aria-hidden="true" />
    case 'stale':
      return <AlertTriangle size={iconSize} aria-hidden="true" />
    case 'collisions':
      return <Zap size={iconSize} aria-hidden="true" />
    case 'triggers':
    default:
      return <CalendarClock size={iconSize} aria-hidden="true" />
  }
}

function Dashboard({
  configuredTenantNames = [],
  environmentSourceUrl,
  onManageConnection,
  sdk,
}: {
  configuredTenantNames?: string[]
  environmentSourceUrl?: string
  onManageConnection?: () => void
  sdk?: UiPath | null
}) {
  const {
    activeTenant,
    data,
    isLoading,
    isTestingEnvironment,
    loadError,
    refresh,
    selectTenant,
    selectedStressCount,
    selectedTenant,
    stressData,
    tenantError,
    tenantOptions,
  } = useScheduleData(sdk, configuredTenantNames)
  const { resolvedTheme, setThemeMode } = useThemeMode()
  const [viewDate, setViewDate] = useState(() => new Date())
  const [calendarMode, setCalendarMode] = useState<CalendarViewMode>('month')
  const [viewMode, setViewMode] = useState<ViewMode>(readInitialViewMode)
  const [monthSpanLaneLimit, setMonthSpanLaneLimit] = useState(defaultMonthSpanLaneLimit)
  const weekSpanLaneLimit = weekVisibleSpanRows
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('calendar')
  const [selectedDayDetail, setSelectedDayDetail] = useState<SelectedDayDetail | null>(null)
  const [isUpcomingExpanded, setIsUpcomingExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('enabled')
  const [triggerTypeFilter, setTriggerTypeFilter] = useState<TriggerTypeFilter>('all')
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('none')
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([])
  const calendarGridRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    window.localStorage.setItem(viewModeStorageKey, viewMode)
  }, [viewMode])
  const folders = data?.folders ?? emptyFolders
  const schedules = data?.schedules ?? emptySchedules
  const statusAwareFolders = useMemo(
    () => getStatusAwareFolders(folders, schedules, statusFilter),
    [folders, schedules, statusFilter],
  )
  const handleStatusFilterChange = useCallback((nextStatusFilter: StatusFilter) => {
    const nextStatusAwareFolders = getStatusAwareFolders(folders, schedules, nextStatusFilter)
    const nextSelectedFolderIds = pruneSelectedFolderIdsForStatus(selectedFolderIds, nextStatusAwareFolders)

    if (nextSelectedFolderIds.length !== selectedFolderIds.length) {
      setSelectedFolderIds(nextSelectedFolderIds)
    }

    setSelectedDayDetail(null)
    setStatusFilter(nextStatusFilter)
  }, [folders, schedules, selectedFolderIds])
  const handleQueryChange = useCallback((nextQuery: string) => {
    setSelectedDayDetail(null)
    setQuery(nextQuery)
  }, [])
  const handleSelectedFolderIdsChange = useCallback((nextSelectedFolderIds: string[]) => {
    setSelectedDayDetail(null)
    setSelectedFolderIds(nextSelectedFolderIds)
  }, [])
  const handleTriggerTypeFilterChange = useCallback((nextTriggerTypeFilter: TriggerTypeFilter) => {
    setSelectedDayDetail(null)
    setTriggerTypeFilter(nextTriggerTypeFilter)
  }, [])
  const { filteredSchedules, preAttentionSchedules, trimmedQuery } = useScheduleFilters({
    attentionFilter,
    query,
    schedules,
    selectedFolderIds,
    statusFilter,
    triggerTypeFilter,
  })
  const {
    activeSelectedDayDetail,
    calendarDays,
    calendarItemsByDay,
    calendarRenderMode,
    calendarTitle,
    calendarWeekCount,
    selectedDayOccurrences,
    shouldRenderSpanBars,
    spanBarLayout,
    todayKey,
    visibleSpanLaneLimit,
    yearMonths,
  } = useCalendarModel({
    calendarMode,
    filteredSchedules,
    monthSpanLaneLimit,
    selectedDayDetail,
    viewDate,
    viewMode,
    weekSpanLaneLimit,
  })
  const { upcomingDisplayGroups } = useUpcomingModel(filteredSchedules)

  const enabledCount = useMemo(
    () => filteredSchedules.reduce((total, schedule) => total + (schedule.Enabled ? 1 : 0), 0),
    [filteredSchedules],
  )
  const disabledCount = filteredSchedules.length - enabledCount
  const todayRange = useMemo(() => dayRangeFromKey(todayKey), [todayKey])
  const summaryMetrics = useMemo(
    () =>
      buildSummaryMetricData({
        schedules: filteredSchedules,
        statusFilter,
        todayEnd: todayRange.end,
        todayStart: todayRange.start,
      }).map((metric) => ({
        ...metric,
        icon: summaryIconForMetric(metric.key),
      })),
    [filteredSchedules, statusFilter, todayRange],
  )
  const activeMetricKey: SummaryMetricKey | null =
    attentionFilter === 'duplicates'
      ? 'duplicateSchedules'
      : attentionFilter === 'stale'
        ? 'stale'
        : attentionFilter === 'collisions'
          ? 'collisions'
          : null
  const handleMetricClick = useCallback(
    (key: SummaryMetricKey) => {
      setSelectedDayDetail(null)
      const next: AttentionFilter =
        key === 'duplicateSchedules'
          ? attentionFilter === 'duplicates' ? 'none' : 'duplicates'
          : key === 'stale'
            ? attentionFilter === 'stale' ? 'none' : 'stale'
            : key === 'collisions'
              ? attentionFilter === 'collisions' ? 'none' : 'collisions'
              : attentionFilter
      setAttentionFilter(next)

      if (next === 'none') {
        setSelectedFolderIds([])
        return
      }
      const matches = applyAttentionFilter(preAttentionSchedules, next)
      setSelectedFolderIds(Array.from(new Set(matches.map((s) => String(s.folderId)))))
    },
    [attentionFilter, preAttentionSchedules],
  )
  const attentionChipLabel: Record<Exclude<AttentionFilter, 'none'>, string> = {
    collisions: 'Collisions only',
    duplicates: 'Duplicates only',
    stale: 'Stale only',
  }
  const hasNotices = Boolean(tenantError || loadError)
  const headerFilterChips = [
    trimmedQuery
      ? {
          label: `Search: ${trimmedQuery}`,
          onClear: () => handleQueryChange(''),
        }
      : null,
    attentionFilter !== 'none'
      ? {
          label: attentionChipLabel[attentionFilter],
          onClear: () => {
            setAttentionFilter('none')
            setSelectedFolderIds([])
          },
        }
      : null,
  ].filter((chip): chip is { label: string; onClear: () => void } => Boolean(chip))
  useEffect(() => {
    if (calendarMode !== 'month') return

    const grid = calendarGridRef.current
    if (!grid) return
    if (typeof ResizeObserver === 'undefined') return

    const updateVisibleLaneLimit = () => {
      const weekdayHeaderHeight = grid.querySelector<HTMLElement>('.weekday')?.offsetHeight ?? 24
      const cellHeight = Math.max(0, (grid.clientHeight - weekdayHeaderHeight) / calendarWeekCount)
      const measuredLimit = Math.floor((cellHeight - monthSpanReservedHeightPx) / monthSpanLaneStepPx)
      const nextLimit = Math.min(maxMonthSpanLaneLimit, Math.max(minMonthSpanLaneLimit, measuredLimit))
      setMonthSpanLaneLimit((current) => (current === nextLimit ? current : nextLimit))
    }

    updateVisibleLaneLimit()

    const resizeObserver = new ResizeObserver(updateVisibleLaneLimit)
    resizeObserver.observe(grid)

    return () => resizeObserver.disconnect()
  }, [calendarMode, calendarWeekCount])

  const moveCalendar = useCallback((delta: number) => {
    setViewDate((current) => {
      if (calendarMode === 'year') {
        return new Date(current.getFullYear() + delta, 0, 1)
      }

      if (calendarMode === 'month') {
        return new Date(current.getFullYear(), current.getMonth() + delta, 1)
      }

      const next = new Date(current)
      next.setDate(current.getDate() + delta * 7)
      return next
    })
  }, [calendarMode])
  const navigationUnitLabel =
    calendarMode === 'year' ? 'year' : calendarMode === 'month' ? 'month' : 'week'
  const openMonthFromYear = useCallback((month: Date) => {
    setViewDate(month)
    setCalendarMode('month')
    setSelectedDayDetail(null)
  }, [])
  const openDayDetail = useCallback((item: ProcessDayGroup) => {
    setIsUpcomingExpanded(true)
    setSelectedDayDetail({
      key: dateKey(item.date),
      date: item.date,
      scheduleKey: item.scheduleKey,
      scope: 'schedule',
    })
  }, [])
  const openSelectedDayDetail = useCallback((detail: SelectedDayDetail) => {
    setIsUpcomingExpanded(true)
    setSelectedDayDetail(detail)
  }, [])
  const connectionState = loadError ? 'issue' : isLoading ? 'syncing' : 'connected'
  const connectionLabel = loadError
    ? 'Sync Failed'
    : isLoading
      ? 'Syncing...'
      : stressData
        ? 'Stress Data'
        : 'Live'
  const connectionTitle =
    connectionState === 'connected'
      ? stressData
        ? testingConnectionTitle
        : 'Trigger data loaded successfully from UiPath Orchestrator.'
      : connectionState === 'syncing'
        ? 'Trigger data is currently refreshing from UiPath Orchestrator.'
        : 'The app could not load trigger data from UiPath Orchestrator.'
  const nextTheme = resolvedTheme === 'dark' ? 'light' : 'dark'
  const nextThemeLabel = nextTheme === 'dark' ? 'Switch to dark theme' : 'Switch to light theme'
  const environmentDisplayLabel = isTestingEnvironment
    ? 'Testing'
    : getEnvironmentDisplayLabel(environmentSourceUrl ?? sdk?.config.baseUrl)

  return (
    <main className={`app-shell ${hasNotices ? 'has-notices' : 'no-notices'}`}>
      <AppHeader
        activeMetricKey={activeMetricKey}
        activeTenantName={activeTenant.displayName}
        connectionLabel={connectionLabel}
        connectionState={connectionState}
        connectionTitle={connectionTitle}
        environmentDisplayLabel={environmentDisplayLabel}
        headerFilterChips={headerFilterChips}
        isLoading={isLoading}
        metrics={summaryMetrics}
        nextThemeLabel={nextThemeLabel}
        onManageConnection={onManageConnection}
        onMetricClick={handleMetricClick}
        onTenantChange={(tenantName) => {
          selectTenant(tenantName)
          setSelectedFolderIds([])
          setSelectedDayDetail(null)
          setIsUpcomingExpanded(false)
        }}
        refresh={refresh}
        resolvedTheme={resolvedTheme}
        selectedStressCount={selectedStressCount}
        selectedTenant={selectedTenant}
        setThemeMode={setThemeMode}
        tenantOptions={tenantOptions}
      />

      {hasNotices ? (
        <section className="notice-stack" aria-label="Sync notices">
          {tenantError ? <div className="notice warning">Tenant list fallback active: {tenantError}</div> : null}
          {loadError ? <div className="notice error">Error: {loadError}</div> : null}
        </section>
      ) : null}

      <FilterToolbar
        query={query}
        setQuery={handleQueryChange}
        selectedFolderIds={selectedFolderIds}
        setSelectedFolderIds={handleSelectedFolderIdsChange}
        setStatusFilter={handleStatusFilterChange}
        setTriggerTypeFilter={handleTriggerTypeFilterChange}
        setWorkspaceView={setWorkspaceView}
        statusFilter={statusFilter}
        statusAwareFolders={statusAwareFolders}
        triggerTypeFilter={triggerTypeFilter}
        workspaceView={workspaceView}
      />

      {workspaceView === 'calendar' ? (
        <section
          className={`workspace ${isUpcomingExpanded || activeSelectedDayDetail ? 'upcoming-expanded' : 'upcoming-collapsed'}`}
          aria-label="Planner canvas"
        >
          <CalendarWorkbench
            calendarDays={calendarDays}
            calendarGridRef={calendarGridRef}
            calendarItemsByDay={calendarItemsByDay}
            calendarMode={calendarMode}
            calendarRenderMode={calendarRenderMode}
            calendarTitle={calendarTitle}
            calendarWeekCount={calendarWeekCount}
            moveCalendar={moveCalendar}
            navigationUnitLabel={navigationUnitLabel}
            onOpenDayDetail={openDayDetail}
            onOpenMonthFromYear={openMonthFromYear}
            setCalendarMode={setCalendarMode}
            setSelectedDayDetail={openSelectedDayDetail}
            setViewMode={setViewMode}
            setViewDate={setViewDate}
            shouldRenderSpanBars={shouldRenderSpanBars}
            spanBars={spanBarLayout.bars}
            todayKey={todayKey}
            viewMode={viewMode}
            viewDate={viewDate}
            visibleSpanLaneLimit={visibleSpanLaneLimit}
            yearMonths={yearMonths}
          />

          <UpcomingPanel
            activeSelectedDayDetail={activeSelectedDayDetail}
            disabledCount={disabledCount}
            enabledCount={enabledCount}
            isExpanded={isUpcomingExpanded || Boolean(activeSelectedDayDetail)}
            onCloseDayDetails={() => setSelectedDayDetail(null)}
            onOpenDay={openSelectedDayDetail}
            onOpenDayDetail={openDayDetail}
            onToggleExpanded={() => setIsUpcomingExpanded((current) => !current)}
            selectedDayOccurrences={selectedDayOccurrences}
            upcomingDisplayGroups={upcomingDisplayGroups}
          />
        </section>
      ) : (
        <ScheduleTable schedules={filteredSchedules} className="inventory-view" />
      )}
    </main>
  )
}

export default function SchedulePlanner({
  configuredTenantNames,
  environmentSourceUrl,
  onManageConnection,
  sdk,
}: {
  configuredTenantNames?: string[]
  environmentSourceUrl?: string
  onManageConnection?: () => void
  sdk?: UiPath | null
}) {
  return (
    <Dashboard
      configuredTenantNames={configuredTenantNames}
      environmentSourceUrl={environmentSourceUrl}
      onManageConnection={onManageConnection}
      sdk={sdk}
    />
  )
}
