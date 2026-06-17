// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined
}

const openRadixSelect = (trigger: HTMLElement) => {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerId: 1, pointerType: 'mouse' })
}

const renderApp = async () => {
  const { default: App } = await import('../App')
  return render(<App />)
}

vi.mock('@uipath/uipath-typescript', () => ({
  getAppBase: () => '/',
}))

vi.mock('@uipath/uipath-typescript/core', () => ({
  UiPath: class MockUiPath {
    completeOAuth = vi.fn()
    getToken = () => ''
    initialize = vi.fn()
    isAuthenticated = () => false
    isInOAuthCallback = () => false
    logout = vi.fn()
  },
  UiPathError: Error,
}))

const rememberSavedConnection = () => {
  window.localStorage.setItem(
    'process-schedule-manager.oauth.custom-auth-configs',
    JSON.stringify([
      {
        externalApps: [
          {
            clientId: 'client-id',
            name: 'Customer OAuth App',
            scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'saved-connection',
        organization: 'ravinseju',
        source: 'custom',
        tenants: ['Demo'],
        urlApp: 'https://staging.uipath.com',
        urlBase: 'https://staging.api.uipath.com',
      },
    ]),
  )
  window.localStorage.setItem('process-schedule-manager.oauth.active-auth-config-id', 'saved-connection-0-0')
}

const rememberMultipleSavedConnections = () => {
  window.localStorage.setItem(
    'process-schedule-manager.oauth.custom-auth-configs',
    JSON.stringify([
      {
        externalApps: [
          {
            clientId: 'client-id',
            name: 'Customer OAuth App',
            scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'saved-connection',
        organization: 'ravinseju',
        source: 'custom',
        tenants: ['Demo'],
        urlApp: 'https://staging.uipath.com',
        urlBase: 'https://staging.api.uipath.com',
      },
      {
        externalApps: [
          {
            clientId: 'finance-client-id',
            name: 'Finance OAuth App',
            scope: 'OR.Folders.Read OR.Execution.Read OR.Jobs.Read',
            urlAppRedirect: 'http://localhost:5175',
          },
        ],
        id: 'finance-connection',
        organization: 'financeorg',
        source: 'custom',
        tenants: ['Finance', 'Payroll'],
        urlApp: 'https://cloud.uipath.com',
        urlBase: 'https://api.uipath.com',
      },
    ]),
  )
  window.localStorage.setItem('process-schedule-manager.oauth.active-auth-config-id', 'saved-connection-0-0')
}

beforeEach(() => {
  cleanup()
  vi.resetModules()
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
  vi.unstubAllEnvs()
})

describe('App auth routing', () => {
  it('does not load testing fixtures unless testing mode is explicitly enabled', async () => {
    window.history.replaceState(null, '', '/testing?stress=5')

    await renderApp()

    expect(await screen.findByText('Testing mode is unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Stress 5')).not.toBeInTheDocument()
    expect(screen.queryByText(/Missing UiPath connection/i)).not.toBeInTheDocument()
  })

  it('bypasses OAuth configuration on the testing route when internal testing mode is enabled', async () => {
    vi.stubEnv('VITE_ENABLE_TESTING_ROUTE', 'true')
    window.history.replaceState(null, '', '/testing?stress=5')

    await renderApp()

    expect(await screen.findAllByText('Stress 5')).toHaveLength(1)
    expect(screen.queryByText(/Missing UiPath connection/i)).not.toBeInTheDocument()
  })

  it('shows a customer-ready setup state when no live connection is saved', async () => {
    await renderApp()

    expect(await screen.findByText('Set up your UiPath connection')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    expect(screen.queryByText(/Demo/)).not.toBeInTheDocument()
  })

  it('uses a required setup panel instead of an editable scope field', async () => {
    await renderApp()

    fireEvent.click(await screen.findByRole('button', { name: /Add Connection/i }))

    expect(screen.getByText('Setup Instructions')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^UiPath Platform URL$/i })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /^Organization$/i })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /Tenants/i })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /^Client ID$/i })).toHaveValue('')
    expect(screen.getByText('Non-confidential External App')).toBeInTheDocument()
    expect(screen.getByText('OR.Folders.Read')).toBeInTheDocument()
    expect(screen.getByText('OR.Execution.Read')).toBeInTheDocument()
    expect(screen.getByText('OR.Jobs.Read')).toBeInTheDocument()
    expect(screen.getByText(/No client secret is required or stored/)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /^Scope$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /Connection Name/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /^Redirect URI$/i })).not.toBeInTheDocument()
  })

  it('shows a lightweight sign-in view when a connection is already saved', async () => {
    rememberSavedConnection()

    await renderApp()

    expect(await screen.findByLabelText('Saved UiPath connection')).toBeInTheDocument()
    expect(screen.getByText('ravinseju')).toBeInTheDocument()
    expect(screen.getByText('Staging')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Manage Connection' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add Connection/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Connection/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/OAuth/i)).not.toBeInTheDocument()
    expect(screen.queryByText(new RegExp(['Authentic', 'ation'].join(''), 'i'))).not.toBeInTheDocument()
  })

  it('opens the saved connection picker only when requested from saved sign-in', async () => {
    rememberSavedConnection()

    await renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Connection' }))

    expect(screen.getByText('Saved Connections')).toBeInTheDocument()
    const savedConnectionSelect = screen.getByRole('combobox', { name: 'Saved connection' })
    expect(savedConnectionSelect).toBeInTheDocument()
    expect(savedConnectionSelect).toHaveTextContent('ravinseju')
    openRadixSelect(savedConnectionSelect)
    expect(await screen.findByRole('option', { name: 'ravinseju' })).toBeInTheDocument()
    expect(screen.getByText('Staging')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add Connection/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit Connection/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide Connection' })).toBeInTheDocument()
  })

  it('lists saved connections by organization and lets the user change the active connection', async () => {
    rememberMultipleSavedConnections()

    await renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Connection' }))

    expect(screen.getByText('Saved Connections')).toBeInTheDocument()
    const savedConnectionSelect = screen.getByRole('combobox', { name: 'Saved connection' })
    openRadixSelect(savedConnectionSelect)
    expect(await screen.findByRole('option', { name: 'financeorg' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'financeorg • Cloud' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /financeorg \/ Payroll/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Active' })).toHaveClass('secondary-action', 'active-status')

    fireEvent.click(screen.getByRole('option', { name: 'financeorg' }))
    const switchButton = screen.getByRole('button', { name: 'Switch' })
    expect(switchButton).toHaveClass('secondary-action')
    expect(switchButton).not.toHaveClass('active-status')
    fireEvent.click(switchButton)

    expect(screen.getByRole('dialog', { name: 'Switch connection?' })).toBeInTheDocument()
    expect(screen.getByText(/Switching the organization will close the current UiPath connection/i)).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
    expect(screen.queryByText('New')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    expect(await screen.findByRole('button', { name: 'Active' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Saved connection' })).toHaveTextContent('financeorg')
    expect(screen.getByText('Tenants: Finance, Payroll')).toBeInTheDocument()
    expect(window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')).toBe('finance-connection-0-0')
  })

  it('deletes a selected non-active saved connection without removing the active connection', async () => {
    rememberMultipleSavedConnections()

    await renderApp()

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Connection' }))

    expect(screen.queryByRole('button', { name: 'Delete selected connection' })).not.toBeInTheDocument()

    const savedConnectionSelect = screen.getByRole('combobox', { name: 'Saved connection' })
    openRadixSelect(savedConnectionSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'financeorg' }))

    fireEvent.click(screen.getByRole('button', { name: 'Delete selected connection' }))

    expect(screen.getByRole('dialog', { name: 'Delete connection?' })).toBeInTheDocument()
    expect(screen.getByText(/This removes the saved connection from this browser/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    expect(await screen.findByRole('button', { name: 'Active' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Saved connection' })).toHaveTextContent('ravinseju')
    expect(screen.queryByRole('button', { name: 'Delete selected connection' })).not.toBeInTheDocument()

    const storedGroups = JSON.parse(window.localStorage.getItem('process-schedule-manager.oauth.custom-auth-configs') ?? '[]') as Array<{ id: string }>
    expect(storedGroups.map((group) => group.id)).toEqual(['saved-connection'])
    expect(window.localStorage.getItem('process-schedule-manager.oauth.active-auth-config-id')).toBe('saved-connection-0-0')
  })
})
