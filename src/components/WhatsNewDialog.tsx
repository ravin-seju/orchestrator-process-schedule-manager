import { useState } from 'react'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './ui/dialog'
import { LATEST_RELEASE, markVersionSeen, shouldShowWhatsNew } from '../whatsNew'

// Post-login "What's New" modal. Opens once per release (see whatsNew.ts) and marks the
// version seen on any dismissal, so it never reappears until the next release entry ships.
// Reuses the shared connection-dialog chrome so it matches the app's other modals (and picks
// up every per-design-skin override for free).
export function WhatsNewDialog() {
  // Lazy initializer: check once during the first render (localStorage is available client-side).
  const [open, setOpen] = useState(() => shouldShowWhatsNew())

  const dismiss = () => {
    markVersionSeen(LATEST_RELEASE.version)
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        // ESC, overlay click, and the X all route here — treat any close as "seen".
        if (!isOpen) dismiss()
      }}
    >
      <DialogContent
        aria-label="What's New"
        className="connection-form manage-connection-dialog whats-new-dialog"
        showClose={false}
      >
        <div className="connection-form-header">
          <div>
            <DialogTitle asChild>
              <h2>What's New</h2>
            </DialogTitle>
            <DialogDescription asChild>
              <p>Version {LATEST_RELEASE.version}</p>
            </DialogDescription>
          </div>
          <button className="icon-button" type="button" onClick={dismiss} aria-label="Close what's new">
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <div className="whats-new-body">
          {LATEST_RELEASE.sections.map((section) => (
            <section key={section.heading} className="whats-new-section">
              <h3>{section.heading}</h3>
              <ul>
                {section.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.title} className="whats-new-item">
                      <Icon className="whats-new-item-icon" size={20} aria-hidden="true" />
                      <div className="whats-new-item-copy">
                        <strong>{item.title}</strong>
                        <span>{item.description}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
