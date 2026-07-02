# Process Schedule Manager

A browser-only schedule viewer for UiPath Orchestrator. It surfaces upcoming runs on a calendar, exposes filters for stale and colliding triggers, and runs entirely in the browser — no backend, no stored secrets.

## Features

- **Calendar Workbench** — Year, Month, and Week views for time-based triggers. Click a date in Year view to drop straight into that week.
- **Layout modes** — Switch between Bars (recurring span bands) and Blocks (per-day chips) for month and week views.
- **Upcoming panel** — Next 7 days of scheduled runs in a dedicated side panel.
- **Run insights** — The day detail panel shows each run's timezone, runtime statistics (median and p90 duration over recent runs), the resolved robots, and the machines it ran on (large dynamic pools collapse to "N machines").
- **Machine & robot awareness** — Filter schedules by the machine they actually run on (inferred from job history) and by assigned robot, with search-enabled pickers; selecting machines or folders narrows the related pickers. Distinct machine and robot counts appear as header metric tiles.
- **Actionable insights** — One-click filters in the header for Duplicates, Stale (no upcoming run), and Same-minute Collisions; clicking auto-narrows the folder picker to the affected folders.
- **Queue trigger awareness** — Queue-driven triggers are detected via `QueueDefinitionId` and surfaced as a distinct trigger type, with no false time-based occurrences on the calendar.
- **Advanced filtering** — Search, hierarchical multi-folder selection, machine and robot, trigger type (Minute / Hourly / Daily / Weekly / Monthly / Queue / Other), and Enabled / All / Disabled.
- **Trigger Inventory** — Tabular view with name, process, folder, machine, robot, trigger type, cron pattern, and status; folder color rail on every row.
- **Hardened sign-in** — Add and remember a connection with copy-to-clipboard helpers for the External App values; a one-time per-connection scope-confirmation card, and a recovery page if Orchestrator rejects the requested scopes.
- **Direct Orchestrator reads** — Uses the SDK token for browser OData calls (folders, triggers, jobs, queue definitions, and 30-day job history for runtime stats and machine inference).
- **Responsive dark mode** — Loads from system theme.

## Prerequisites

Create a **non-confidential** External Application in your UiPath organization with these Orchestrator API user scopes:

```text
OR.Folders.Read OR.Execution.Read OR.Jobs.Read OR.Machines.Read OR.Robots.Read
```

All five scopes are required. The app blocks sign-in until the External App grants every scope, and shows a recovery page if Orchestrator rejects any of them.

### Orchestrator roles

**App users** (view-only, recommended for most users) — create a custom folder-level role with View access on:

- Apps
- Triggers
- Subfolders
- Jobs
- Processes

Assign this role on each folder the user should see. No default UiPath role covers this exact read-only set. Machine and robot details are derived from job history (`Jobs`) and trigger configuration (`Triggers`), so the permissions above already cover them — no separate machine or robot role is needed.

**App deployers and schedule admins** — assign the `Folder Administrator` default role on the target folder, plus `Allow to Be Folder Administrator` at tenant level. This grants the `Apps.Create`/`Apps.Edit` permissions required by the deploy CLI, and full trigger management for users who also create or edit schedules.

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

### UiPath CLI (for deployment)

Deploying to Orchestrator (see [Deployment](#deployment)) uses the **UiPath CLI (`uip`)**. Install it globally with npm (requires Node.js) — see the [`@uipath/cli` package](https://www.npmjs.com/package/@uipath/cli) for full details:

```bash
npm install -g @uipath/cli
uip --version
```

Then log in and select the tenant you want to deploy to. Either log in interactively and pick the tenant from a list:

```bash
uip login --interactive
```

…or target a specific organization and tenant non-interactively:

```bash
uip login --organization <org-name> --tenant <tenant-name>
```

Confirm the active session (organization and tenant) before deploying:

```bash
uip login status
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

The `--folder-key` is the target folder's **Key (GUID)**, not its display name. Look it up by folder path and read the `Key` field from the output:

```bash
uip or folders get "Shared/My Folder" --output json
```

Copy the `"Key"` value into `<folder-key>` in the deploy command above (replace `Shared/My Folder` with your target folder path).

The account running these commands must have the `Folder Administrator` role on the target folder. See [Orchestrator roles](#orchestrator-roles) in Prerequisites.

After deployment, copy the deployed app URL and add it as a redirect URI in your non-confidential External App. Then open the app, add your connection details, and sign in.

## Optional: testing mode

Synthetic stress data is disabled by default. To run with fixture data, start the dev server with `VITE_ENABLE_TESTING_ROUTE=true` and open `http://localhost:5177/testing?stress=50`. When the variable is unset, `/testing` shows a minimal unavailable state and does not load fixtures.
