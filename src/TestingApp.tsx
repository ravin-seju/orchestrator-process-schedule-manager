import { WhatsNewDialog } from './components/WhatsNewDialog'
import { SchedulePlanner } from './features/schedules'

export default function TestingApp() {
  // The dialog is mounted post-login in LiveApp, so the testing route — the one place the app can be
  // demoed without a tenant — could not show it. Mounted here too so release notes are reviewable.
  return (
    <>
      <WhatsNewDialog />
      <SchedulePlanner />
    </>
  )
}
