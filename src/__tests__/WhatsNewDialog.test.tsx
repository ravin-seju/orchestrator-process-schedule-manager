// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { WhatsNewDialog } from '../components/WhatsNewDialog'
import { getLastSeenVersion, LATEST_RELEASE, markVersionSeen } from '../whatsNew'

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('WhatsNewDialog', () => {
  it('opens for an unseen version and renders the latest release notes', () => {
    render(<WhatsNewDialog />)
    expect(screen.getByRole('heading', { name: "What's New" })).toBeInTheDocument()
    expect(screen.getByText(`Version ${LATEST_RELEASE.version}`)).toBeInTheDocument()
    // A seeded item from the changelog renders.
    expect(screen.getByText('Machine & robot awareness')).toBeInTheDocument()
  })

  it('marks the version seen and closes when the close button is clicked', () => {
    render(<WhatsNewDialog />)
    fireEvent.click(screen.getByRole('button', { name: "Close what's new" }))
    expect(getLastSeenVersion()).toBe(LATEST_RELEASE.version)
    expect(screen.queryByRole('heading', { name: "What's New" })).not.toBeInTheDocument()
  })

  it('stays closed when the latest version has already been seen', () => {
    markVersionSeen(LATEST_RELEASE.version)
    render(<WhatsNewDialog />)
    expect(screen.queryByRole('heading', { name: "What's New" })).not.toBeInTheDocument()
  })
})
