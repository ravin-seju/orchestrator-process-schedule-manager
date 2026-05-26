import type { Folder, ProcessSchedule } from './orchestrator'
import type { StatusFilter } from './types'

export interface FolderTreeNode {
  children: FolderTreeNode[]
  depth: number
  eligibleFolderIds: string[]
  folder?: Folder
  fullPath: string
  label: string
  path: string
}

function getFolderFullPath(folder: Folder) {
  return folder.FullyQualifiedName ?? folder.DisplayName ?? `Folder ${folder.Id}`
}

function getFolderPathSegments(folder: Folder) {
  const fullPath = getFolderFullPath(folder)
  const segments = fullPath
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean)

  return segments.length ? segments : [fullPath]
}

export function getStatusAwareFolders(
  folders: Folder[],
  schedules: ProcessSchedule[],
  statusFilter: StatusFilter,
) {
  const visibleFolderIds = new Set<string>()

  for (const schedule of schedules) {
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'enabled' && schedule.Enabled) ||
      (statusFilter === 'disabled' && !schedule.Enabled)

    if (matchesStatus && schedule.folderId !== undefined && schedule.folderId !== null) {
      visibleFolderIds.add(String(schedule.folderId))
    }
  }

  return folders.filter((folder) => visibleFolderIds.has(String(folder.Id)))
}

export function buildFolderTree(folders: Folder[]): FolderTreeNode[] {
  const roots: FolderTreeNode[] = []
  const nodesByPath = new Map<string, FolderTreeNode>()

  const ensureNode = (path: string, label: string, depth: number, parent?: FolderTreeNode) => {
    const existingNode = nodesByPath.get(path)
    if (existingNode) return existingNode

    const node: FolderTreeNode = {
      children: [],
      depth,
      eligibleFolderIds: [],
      fullPath: path,
      label,
      path,
    }

    nodesByPath.set(path, node)

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }

    return node
  }

  for (const folder of folders) {
    const pathSegments = getFolderPathSegments(folder)
    let currentPath = ''
    let parent: FolderTreeNode | undefined

    pathSegments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      const node = ensureNode(currentPath, segment, index, parent)

      if (index === pathSegments.length - 1) {
        node.folder = folder
        node.label = folder.DisplayName ?? segment
        node.fullPath = getFolderFullPath(folder)
      }

      parent = node
    })
  }

  const assignEligibleFolderIds = (node: FolderTreeNode): string[] => {
    const ownFolderId = node.folder ? [String(node.folder.Id)] : []
    const childFolderIds = node.children.flatMap(assignEligibleFolderIds)
    node.eligibleFolderIds = [...ownFolderId, ...childFolderIds]
    return node.eligibleFolderIds
  }

  roots.forEach(assignEligibleFolderIds)
  return roots
}

export function pruneSelectedFolderIdsForStatus(
  selectedFolderIds: string[],
  statusAwareFolders: Folder[],
) {
  if (!selectedFolderIds.length) return []

  const availableFolderIds = new Set(statusAwareFolders.map((folder) => String(folder.Id)))
  return selectedFolderIds.filter((folderId) => availableFolderIds.has(folderId))
}
