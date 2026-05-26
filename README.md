# Process Schedule Manager

A browser-only schedule viewer for UiPath Orchestrator. It surfaces upcoming runs on a calendar, exposes filters for stale and colliding triggers, and runs entirely in the browser — no backend, no stored secrets.

## Features

- **Calendar Workbench** — Year, Month, and Week views for time-based triggers. Click a date in Year view to drop straight into that week.
- **Layout modes** — Switch between Bars (recurring span bands) and Blocks (per-day chips) for month and week views.
- **Upcoming panel** — Next 7 days of scheduled runs in a dedicated side panel.
- **Actionable insights** — One-click filters in the header for Duplicates, Stale (no upcoming run), and Same-minute Collisions; clicking auto-narrows the folder picker to the affected folders.
- **Queue trigger awareness** — Queue-driven triggers are detected via `QueueDefinitionId` and surfaced as a distinct trigger type, with no false time-based occurrences on the calendar.
- **Guided sign-in** — Add and remember a connection in the browser, with copy-to-clipboard helpers for the External App configuration values.
- **Direct Orchestrator reads** — Uses the SDK token for browser OData calls (folders, triggers, jobs, queue definitions).
- **Advanced filtering** — Search, hierarchical multi-folder selection, trigger type (Minute / Hourly / Daily / Weekly / Monthly / Queue / Other), and Enabled / All / Disabled.
- **Trigger Inventory** — Tabular view with name, process, folder, trigger type, cron pattern, and status; folder color rail on every row.
- **Responsive dark mode** — Loads from system theme.

## Prerequisites

Create a **non-confidential** External Application in your UiPath organization with these Orchestrator API user scopes:

```text
OR.Folders.Read OR.Execution.Read OR.Jobs.Read
```

Grant the intended users or groups Orchestrator read access to the tenants and folders they should inspect. To show triggers across all intended folders, users need folder/process/trigger/job read access across those folders.

The redirect URI must match where the app runs:

- Local development: `http://localhost:5177`
- Deployed coded app: the deployed app URL returned by `uip codedapp deploy`

Sign-in will fail until the deployed app URL is registered as a redirect URI in your External App.

## Setup

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

Open the app at `http://localhost:5177`. Register that URL as a redirect URI in your non-confidential External App for local sign-in.

Connection values (Platform URL, organization, tenants, client ID) are entered through the in-app Add Connection flow at runtime — they are not compiled into the bundle. Use `https://cloud.uipath.com` for Automation Cloud, or your environment root such as `https://staging.uipath.com` for staging.

If you want a local default for the testing route, copy `.env.example` to `.env.local`:

```bash
cp .env.example .env.local
```

Supported variable:

```bash
VITE_ENABLE_TESTING_ROUTE=false
```

## Security & data model

- The browser app uses a non-confidential External App. It does not use or store a client secret.
- The app stores only saved connection metadata in `localStorage`: Platform URL, organization, tenant names, client ID, redirect URI, and fixed scopes.
- Live folders, triggers, process schedules, jobs, access tokens, and Orchestrator results are not written to `localStorage` by this app.
- The SDK manages the user sign-in session in browser session storage.
- Data visibility is bounded by the signed-in user's tenant and folder permissions.

## Deployment

Package, publish, and deploy with the UiPath CLI:

```bash
uip codedapp pack dist --name "Process Schedule Manager" --version <version>
uip codedapp publish --name "Process Schedule Manager" --version <version> --type Web
uip codedapp deploy --name "Process Schedule Manager" --version <version> --folder-key <folder-key>
```

After deployment, copy the deployed app URL and add it as a redirect URI in your non-confidential External App. Then open the app, add your connection details, and sign in.

## Optional: testing mode

Synthetic stress data is disabled by default. To run with fixture data, start the dev server with `VITE_ENABLE_TESTING_ROUTE=true` and open `http://localhost:5177/testing?stress=50`. When the variable is unset, `/testing` shows a minimal unavailable state and does not load fixtures.
