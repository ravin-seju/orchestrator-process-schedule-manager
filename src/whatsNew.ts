import type { LucideIcon } from 'lucide-react'
import { Activity, BellRing, Bot, CalendarClock, Hourglass, LogIn, Palette, ShieldCheck, Wrench } from 'lucide-react'

// A single "What's New" bullet: an icon plus a short, plain-language description.
export type WhatsNewItem = {
  icon: LucideIcon
  title: string
  description: string
}

// Bullets grouped under a bold heading (e.g. "What's new", "Fixes & hardening").
export type WhatsNewSection = {
  heading: string
  items: WhatsNewItem[]
}

// One release's notes. `version` is both the display subtitle and the trigger key.
export type WhatsNewRelease = {
  version: string
  sections: WhatsNewSection[]
}

// Single source of truth, newest-first. Prepend a new entry each release; its `version`
// becomes the app version (see APP_VERSION) — the header badge and this modal both read it.
export const CHANGELOG: WhatsNewRelease[] = [
  {
    version: '1.5',
    sections: [
      {
        heading: "What's new",
        items: [
          {
            icon: Hourglass,
            title: 'Trigger lifecycle awareness',
            description:
              'Triggers with an end date in the past or the next two weeks are flagged with an amber hourglass across the calendar and inventory, and a new Expiring metric counts exactly that set.',
          },
          {
            icon: BellRing,
            title: 'Auto-disabled triggers surfaced',
            description:
              'Orchestrator switches a trigger off once its end date passes, which hides it behind the default Enabled filter. A banner now reports how many and jumps straight to them, and their status reads "Auto-disabled" rather than a plain "Disabled".',
          },
          {
            icon: CalendarClock,
            title: 'No runs shown past an end date',
            description:
              'The calendar, upcoming panel, and the Active Today and Collisions metrics all stop projecting runs a trigger can no longer perform. End dates also render in the trigger’s own timezone.',
          },
        ],
      },
      {
        heading: 'Fixes & polish',
        items: [
          {
            icon: Wrench,
            title: 'Cleaner inventory and calendar rendering',
            description:
              'Inventory row separators line up again, and the month view’s "+N more" link is no longer clipped at shorter window heights.',
          },
        ],
      },
    ],
  },
  {
    version: '1.1',
    sections: [
      {
        heading: "What's new",
        items: [
          {
            icon: Bot,
            title: 'Machine & robot awareness',
            description:
              'Run details now show which machine and robot each trigger targets, and shared bots are summarized instead of repeated.',
          },
          {
            icon: Activity,
            title: 'Run insights in day details',
            description:
              'The day details panel surfaces runtime stats, the schedule timezone, and the assigned robot for a run at a glance.',
          },
          {
            icon: Palette,
            title: 'Folder color coding',
            description:
              'Triggers are now colored by their root folder across the calendar, upcoming panel, and inventory — no legend needed.',
          },
          {
            icon: ShieldCheck,
            title: 'Broader read access',
            description:
              'Expanded to five Orchestrator scopes (Folders, Execution, Jobs, Machines, Robots) so more live data loads out of the box.',
          },
        ],
      },
      {
        heading: 'Fixes & hardening',
        items: [
          {
            icon: LogIn,
            title: 'Sturdier sign-in',
            description:
              'A guided connection flow, a one-time scope confirmation, and clearer recovery when a UiPath sign-in does not complete.',
          },
          {
            icon: Wrench,
            title: 'Scope healing',
            description:
              'Connections saved with an older, narrower set of scopes are now healed on read, so upgraded connections are no longer stranded.',
          },
        ],
      },
    ],
  },
]

// The newest release — its notes are what the modal shows, and its version is the trigger key.
export const LATEST_RELEASE: WhatsNewRelease = CHANGELOG[0]

// The app-facing version, sourced from the newest changelog entry so the header badge and the
// What's New trigger can never drift. Independent of the Orchestrator deploy / package.json version.
export const APP_VERSION: string = LATEST_RELEASE.version

const WHATS_NEW_STORAGE_KEY = 'process-schedule-manager.whats-new.last-seen-version'

// Mirrors the SSR-safe guard in uipathConfig.ts — localStorage can throw in some contexts.
const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null

  try {
    return window.localStorage
  } catch {
    return null
  }
}

// The version the user last acknowledged, or null if they never have (new user).
export function getLastSeenVersion(): string | null {
  const storage = getStorage()
  if (!storage) return null

  try {
    return storage.getItem(WHATS_NEW_STORAGE_KEY)
  } catch {
    return null
  }
}

// Record that the user has seen a release, so its notes never reappear.
export function markVersionSeen(version: string): void {
  const storage = getStorage()
  if (!storage) return

  try {
    storage.setItem(WHATS_NEW_STORAGE_KEY, version)
  } catch {
    // Storage full or unavailable — showing the modal again next login is acceptable.
  }
}

// Show the modal whenever the latest release differs from what the user last saw.
// A null last-seen value (new user) differs from any version, so first-time users see it too.
export function shouldShowWhatsNew(): boolean {
  return getLastSeenVersion() !== LATEST_RELEASE.version
}
