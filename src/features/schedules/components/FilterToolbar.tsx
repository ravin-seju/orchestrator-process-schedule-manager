import type { CSSProperties } from 'react'
import { useId, useMemo, useState } from 'react'
import { Check, ChevronDown, Minus, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { pickerSearchThreshold, recurrenceBucketLabels, recurrenceLegend } from '../constants'
import { buildFolderTree, type FolderTreeNode } from '../folderOptions'
import type { Folder } from '../orchestrator'
import type { MachineOption, StatusFilter, TriggerTypeFilter, WorkspaceView } from '../types'

const folderLabel = (folder: Folder) =>
  folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`

export function FilterToolbar({
  query,
  setQuery,
  selectedFolderIds,
  setSelectedFolderIds,
  setStatusFilter,
  setTriggerTypeFilter,
  setWorkspaceView,
  statusFilter,
  statusAwareFolders,
  triggerTypeFilter,
  workspaceView,
  machines,
  selectedMachineIds,
  setSelectedMachineIds,
  robotOptions,
  selectedRobotIds,
  setSelectedRobotIds,
}: {
  query: string
  setQuery: (value: string) => void
  selectedFolderIds: string[]
  setSelectedFolderIds: (value: string[]) => void
  setStatusFilter: (value: StatusFilter) => void
  setTriggerTypeFilter: (value: TriggerTypeFilter) => void
  setWorkspaceView: (value: WorkspaceView) => void
  statusFilter: StatusFilter
  statusAwareFolders: Folder[]
  triggerTypeFilter: TriggerTypeFilter
  workspaceView: WorkspaceView
  machines?: MachineOption[]
  selectedMachineIds?: number[]
  setSelectedMachineIds?: (ids: number[]) => void
  robotOptions?: { id: number; name: string }[]
  selectedRobotIds?: number[]
  setSelectedRobotIds?: (ids: number[]) => void
}) {
  const folderPopoverId = useId()
  const machinePopoverId = useId()
  const robotPopoverId = useId()
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [isMachinePickerOpen, setIsMachinePickerOpen] = useState(false)
  const [isRobotPickerOpen, setIsRobotPickerOpen] = useState(false)
  const [folderOptionQuery, setFolderOptionQuery] = useState('')
  const [machineOptionQuery, setMachineOptionQuery] = useState('')
  const [robotOptionQuery, setRobotOptionQuery] = useState('')
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(() => new Set())
  const selectedFolderIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds])
  const selectedMachineIdSet = useMemo(() => new Set(selectedMachineIds ?? []), [selectedMachineIds])
  const selectedRobotIdSet = useMemo(() => new Set(selectedRobotIds ?? []), [selectedRobotIds])

  const normalizedMachineQuery = machineOptionQuery.trim().toLowerCase()
  const filteredMachines = useMemo(() => {
    const list = machines ?? []
    return normalizedMachineQuery
      ? list.filter((machine) => machine.name.toLowerCase().includes(normalizedMachineQuery))
      : list
  }, [normalizedMachineQuery, machines])
  const normalizedRobotQuery = robotOptionQuery.trim().toLowerCase()
  const filteredRobots = useMemo(
    () =>
      normalizedRobotQuery
        ? (robotOptions ?? []).filter((robot) => robot.name.toLowerCase().includes(normalizedRobotQuery))
        : robotOptions ?? [],
    [normalizedRobotQuery, robotOptions],
  )

  const selectedMachineLabel = useMemo(() => {
    if (!selectedMachineIds?.length) return 'All machines'
    if (selectedMachineIds.length > 1) return `${selectedMachineIds.length} machines`
    const m = machines?.find((x) => x.id === selectedMachineIds[0])
    return m ? m.name : '1 machine'
  }, [selectedMachineIds, machines])

  const selectedRobotLabel = useMemo(() => {
    if (!selectedRobotIds?.length) return 'All robots'
    if (selectedRobotIds.length > 1) return `${selectedRobotIds.length} robots`
    const r = robotOptions?.find((x) => x.id === selectedRobotIds[0])
    return r ? r.name : '1 robot'
  }, [selectedRobotIds, robotOptions])

  const toggleMachine = (id: number) => {
    if (!setSelectedMachineIds) return
    setSelectedMachineIds(
      selectedMachineIdSet.has(id)
        ? (selectedMachineIds ?? []).filter((x) => x !== id)
        : [...(selectedMachineIds ?? []), id],
    )
  }

  const toggleRobot = (id: number) => {
    if (!setSelectedRobotIds) return
    setSelectedRobotIds(
      selectedRobotIdSet.has(id)
        ? (selectedRobotIds ?? []).filter((x) => x !== id)
        : [...(selectedRobotIds ?? []), id],
    )
  }

  const handleMachinePickerOpenChange = (isOpen: boolean) => {
    setIsMachinePickerOpen(isOpen)
    if (!isOpen) setMachineOptionQuery('')
  }
  const handleRobotPickerOpenChange = (isOpen: boolean) => {
    setIsRobotPickerOpen(isOpen)
    if (!isOpen) setRobotOptionQuery('')
  }

  const normalizedFolderOptionQuery = folderOptionQuery.trim().toLowerCase()
  const filteredFolderOptions = useMemo(
    () =>
      normalizedFolderOptionQuery
        ? statusAwareFolders.filter((folder) => folderLabel(folder).toLowerCase().includes(normalizedFolderOptionQuery))
        : statusAwareFolders,
    [normalizedFolderOptionQuery, statusAwareFolders],
  )
  const folderTree = useMemo(() => buildFolderTree(filteredFolderOptions), [filteredFolderOptions])
  const isFolderSearchActive = Boolean(normalizedFolderOptionQuery)
  const selectedFolderLabel = useMemo(() => {
    if (!selectedFolderIds.length) return 'All folders'
    if (selectedFolderIds.length > 1) return `${selectedFolderIds.length} folders`

    const selectedFolder = statusAwareFolders.find((folder) => String(folder.Id) === selectedFolderIds[0])
    return selectedFolder ? folderLabel(selectedFolder) : '1 folder'
  }, [selectedFolderIds, statusAwareFolders])
  const toggleFolder = (folderId: string) => {
    setSelectedFolderIds(
      selectedFolderIdSet.has(folderId)
        ? selectedFolderIds.filter((selectedFolderId) => selectedFolderId !== folderId)
        : [...selectedFolderIds, folderId],
    )
  }
  const toggleFolderNode = (node: FolderTreeNode) => {
    const descendantIds = node.eligibleFolderIds
    if (!descendantIds.length) return

    const selectedDescendantCount = descendantIds.filter((folderId) => selectedFolderIdSet.has(folderId)).length
    const shouldClearDescendants = selectedDescendantCount === descendantIds.length
    const nextSelectedFolderIds = shouldClearDescendants
      ? selectedFolderIds.filter((folderId) => !descendantIds.includes(folderId))
      : Array.from(new Set([...selectedFolderIds, ...descendantIds]))

    setSelectedFolderIds(nextSelectedFolderIds)
  }
  const toggleFolderCollapsed = (nodePath: string) => {
    setCollapsedFolderPaths((currentCollapsedPaths) => {
      const nextCollapsedPaths = new Set(currentCollapsedPaths)

      if (nextCollapsedPaths.has(nodePath)) {
        nextCollapsedPaths.delete(nodePath)
      } else {
        nextCollapsedPaths.add(nodePath)
      }

      return nextCollapsedPaths
    })
  }
  const handleFolderPickerOpenChange = (isOpen: boolean) => {
    setIsFolderPickerOpen(isOpen)
    if (!isOpen) setFolderOptionQuery('')
  }
  const renderFolderNode = (node: FolderTreeNode) => {
    const selectedDescendantCount = node.eligibleFolderIds.filter((folderId) => selectedFolderIdSet.has(folderId)).length
    const checked = node.eligibleFolderIds.length > 0 && selectedDescendantCount === node.eligibleFolderIds.length
    const indeterminate = selectedDescendantCount > 0 && selectedDescendantCount < node.eligibleFolderIds.length
    const isExpanded = isFolderSearchActive || !collapsedFolderPaths.has(node.path)
    const hasChildren = node.children.length > 0

    return (
      <div className="folder-tree-node" key={node.path}>
        <div
          className="folder-tree-item"
          style={{ '--folder-depth': node.depth } as CSSProperties}
        >
          {hasChildren ? (
            <button
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${node.label}`}
              className="folder-tree-toggle"
              onClick={() => toggleFolderCollapsed(node.path)}
              type="button"
            >
              <ChevronDown size={13} strokeWidth={1.9} aria-hidden="true" />
            </button>
          ) : (
            <span className="folder-tree-toggle-spacer" aria-hidden="true" />
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                aria-pressed={indeterminate ? 'mixed' : checked}
                className={`folder-option-row folder-tree-row ${checked || indeterminate ? 'is-selected' : ''}`}
                onClick={() => (node.folder && !hasChildren ? toggleFolder(String(node.folder.Id)) : toggleFolderNode(node))}
                type="button"
              >
                <span
                  className={`folder-option-check ${checked ? 'is-checked' : ''} ${indeterminate ? 'is-indeterminate' : ''}`}
                  aria-hidden="true"
                >
                  {indeterminate ? <Minus size={10} strokeWidth={2.5} /> : <Check size={11} strokeWidth={2.3} />}
                </span>
                <span>{node.label}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent>{node.fullPath}</TooltipContent>
          </Tooltip>
        </div>
        {hasChildren && isExpanded ? (
          <div className="folder-tree-children">
            {node.children.map(renderFolderNode)}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <section className="control-band" aria-label="Filters">
      <label className="search-control">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search triggers"
        />
      </label>
      <Popover open={isFolderPickerOpen} onOpenChange={handleFolderPickerOpenChange}>
        <Tooltip>
          <PopoverTrigger asChild>
            <TooltipTrigger asChild>
              <button
                aria-controls={folderPopoverId}
                aria-expanded={isFolderPickerOpen}
                aria-haspopup="dialog"
                aria-label="Folder filter"
                className="folder-multiselect-trigger"
                type="button"
              >
                <span>{selectedFolderLabel}</span>
                <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </TooltipTrigger>
          </PopoverTrigger>
          <TooltipContent>{selectedFolderLabel}</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" className="folder-multiselect-content" id={folderPopoverId}>
          <div className="folder-multiselect-search">
            <Input
              aria-label="Search folder options"
              value={folderOptionQuery}
              onChange={(event) => setFolderOptionQuery(event.target.value)}
              placeholder="Search folders"
            />
          </div>
          <button
            aria-pressed={selectedFolderIds.length === 0}
            className={`folder-option-row ${selectedFolderIds.length === 0 ? 'is-selected' : ''}`}
            onClick={() => setSelectedFolderIds([])}
            type="button"
          >
            <span className={`folder-option-check ${selectedFolderIds.length === 0 ? 'is-checked' : ''}`} aria-hidden="true">
              <Check size={11} strokeWidth={2.3} />
            </span>
            <span>All folders</span>
          </button>
          <div className="folder-option-list">
            {folderTree.length ? (
              folderTree.map(renderFolderNode)
            ) : (
              <p className="folder-option-empty">No folders match this search.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
      {machines !== undefined && setSelectedMachineIds !== undefined ? (
        <Popover open={isMachinePickerOpen} onOpenChange={handleMachinePickerOpenChange}>
          <Tooltip>
            <PopoverTrigger asChild>
              <TooltipTrigger asChild>
                <button
                  aria-controls={machinePopoverId}
                  aria-expanded={isMachinePickerOpen}
                  aria-haspopup="dialog"
                  aria-label="Machine filter"
                  className="folder-multiselect-trigger"
                  type="button"
                >
                  <span>{selectedMachineLabel}</span>
                  <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </TooltipTrigger>
            </PopoverTrigger>
            <TooltipContent>{selectedMachineLabel}</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="folder-multiselect-content" id={machinePopoverId}>
            {(machines?.length ?? 0) > pickerSearchThreshold ? (
              <div className="folder-multiselect-search">
                <Input
                  aria-label="Search machine options"
                  value={machineOptionQuery}
                  onChange={(event) => setMachineOptionQuery(event.target.value)}
                  placeholder="Search machines"
                />
              </div>
            ) : null}
            <button
              aria-pressed={!selectedMachineIds?.length}
              className={`folder-option-row ${!selectedMachineIds?.length ? 'is-selected' : ''}`}
              onClick={() => setSelectedMachineIds([])}
              type="button"
            >
              <span className={`folder-option-check ${!selectedMachineIds?.length ? 'is-checked' : ''}`} aria-hidden="true">
                <Check size={11} strokeWidth={2.3} />
              </span>
              <span>All machines</span>
            </button>
            <div className="folder-option-list">
              {filteredMachines.map((machine) => {
                const checked = selectedMachineIdSet.has(machine.id)
                return (
                  <button
                    aria-pressed={checked}
                    className={`folder-option-row ${checked ? 'is-selected' : ''}`}
                    key={machine.id}
                    onClick={() => toggleMachine(machine.id)}
                    type="button"
                  >
                    <span className={`folder-option-check ${checked ? 'is-checked' : ''}`} aria-hidden="true">
                      <Check size={11} strokeWidth={2.3} />
                    </span>
                    <span className="machine-option-name">{machine.name}</span>
                  </button>
                )
              })}
              {filteredMachines.length === 0 ? (
                <p className="folder-option-empty">
                  {normalizedMachineQuery ? 'No machines match this search.' : 'No machines available.'}
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      {robotOptions !== undefined && setSelectedRobotIds !== undefined ? (
        <Popover open={isRobotPickerOpen} onOpenChange={handleRobotPickerOpenChange}>
          <Tooltip>
            <PopoverTrigger asChild>
              <TooltipTrigger asChild>
                <button
                  aria-controls={robotPopoverId}
                  aria-expanded={isRobotPickerOpen}
                  aria-haspopup="dialog"
                  aria-label="Robot filter"
                  className="folder-multiselect-trigger"
                  type="button"
                >
                  <span>{selectedRobotLabel}</span>
                  <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
                </button>
              </TooltipTrigger>
            </PopoverTrigger>
            <TooltipContent>{selectedRobotLabel}</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="folder-multiselect-content" id={robotPopoverId}>
            {(robotOptions ?? []).length > pickerSearchThreshold ? (
              <div className="folder-multiselect-search">
                <Input
                  aria-label="Search robot options"
                  value={robotOptionQuery}
                  onChange={(event) => setRobotOptionQuery(event.target.value)}
                  placeholder="Search robots"
                />
              </div>
            ) : null}
            <button
              aria-pressed={!selectedRobotIds?.length}
              className={`folder-option-row ${!selectedRobotIds?.length ? 'is-selected' : ''}`}
              onClick={() => setSelectedRobotIds([])}
              type="button"
            >
              <span className={`folder-option-check ${!selectedRobotIds?.length ? 'is-checked' : ''}`} aria-hidden="true">
                <Check size={11} strokeWidth={2.3} />
              </span>
              <span>All robots</span>
            </button>
            <div className="folder-option-list">
              {filteredRobots.map((robot) => {
                const checked = selectedRobotIdSet.has(robot.id)
                return (
                  <button
                    aria-pressed={checked}
                    className={`folder-option-row ${checked ? 'is-selected' : ''}`}
                    key={robot.id}
                    onClick={() => toggleRobot(robot.id)}
                    type="button"
                  >
                    <span className={`folder-option-check ${checked ? 'is-checked' : ''}`} aria-hidden="true">
                      <Check size={11} strokeWidth={2.3} />
                    </span>
                    <span>{robot.name}</span>
                  </button>
                )
              })}
              {filteredRobots.length === 0 ? (
                <p className="folder-option-empty">
                  {normalizedRobotQuery ? 'No robots match this search.' : 'No robots available.'}
                </p>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
      <Select
        value={triggerTypeFilter}
        onValueChange={(value) => setTriggerTypeFilter(value as TriggerTypeFilter)}
      >
        <SelectTrigger aria-label="Trigger type">
          <SelectValue placeholder="All trigger types" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All trigger types</SelectItem>
          {recurrenceLegend.map((bucket) => (
            <SelectItem key={bucket} value={bucket}>
              {recurrenceBucketLabels[bucket]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup
        aria-label="Trigger status"
        className="segmented-control"
        onValueChange={(value) => {
          if (value) setStatusFilter(value as StatusFilter)
        }}
        type="single"
        value={statusFilter}
      >
        {(['enabled', 'all', 'disabled'] as StatusFilter[]).map((status) => (
          <ToggleGroupItem
            aria-label={`${status[0].toUpperCase() + status.slice(1)} triggers`}
            key={status}
            value={status}
          >
            {status[0].toUpperCase() + status.slice(1)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ToggleGroup
        aria-label="Workspace view"
        className="view-switcher"
        onValueChange={(value) => {
          if (value) setWorkspaceView(value as WorkspaceView)
        }}
        type="single"
        value={workspaceView}
      >
        {(['calendar', 'inventory'] as WorkspaceView[]).map((view) => (
          <ToggleGroupItem key={view} value={view}>
            {view === 'calendar' ? 'Calendar' : 'Inventory'}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </section>
  )
}
