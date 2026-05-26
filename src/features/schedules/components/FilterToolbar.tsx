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
import { recurrenceBucketLabels, recurrenceLegend } from '../constants'
import { buildFolderTree, type FolderTreeNode } from '../folderOptions'
import type { Folder } from '../orchestrator'
import type { StatusFilter, TriggerTypeFilter, WorkspaceView } from '../types'

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
}) {
  const folderPopoverId = useId()
  const [isFolderPickerOpen, setIsFolderPickerOpen] = useState(false)
  const [folderOptionQuery, setFolderOptionQuery] = useState('')
  const [collapsedFolderPaths, setCollapsedFolderPaths] = useState<Set<string>>(() => new Set())
  const selectedFolderIdSet = useMemo(() => new Set(selectedFolderIds), [selectedFolderIds])
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
          <button
            aria-pressed={indeterminate ? 'mixed' : checked}
            className={`folder-option-row folder-tree-row ${checked || indeterminate ? 'is-selected' : ''}`}
            onClick={() => (node.folder && !hasChildren ? toggleFolder(String(node.folder.Id)) : toggleFolderNode(node))}
            title={node.fullPath}
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
        <PopoverTrigger asChild>
          <button
            aria-controls={folderPopoverId}
            aria-expanded={isFolderPickerOpen}
            aria-haspopup="dialog"
            aria-label="Folder filter"
            className="folder-multiselect-trigger"
            title={selectedFolderLabel}
            type="button"
          >
            <span>{selectedFolderLabel}</span>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </PopoverTrigger>
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
