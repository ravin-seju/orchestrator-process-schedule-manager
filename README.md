# Process Schedule Manager

A UiPath-branded, customer-owned Coded Web App for visualizing Orchestrator time-based triggers. The app gives teams a calendar-first view of upcoming process executions, advanced trigger filtering, inventory review, and guided UiPath sign-in using a customer-created non-confidential External App.

## Features

- **Calendar Workbench** — Year, Month, and Week views for time-based triggers. Click a date in Year view to drop straight into that week.
- **Layout modes** — Switch between Bars (recurring span bands) and Blocks (per-day chips) for month and week views.
- **Upcoming panel** — Next 7 days of scheduled runs in a dedicated side panel.
- **Actionable insights** — One-click filters in the header for Duplicates, Stale (no upcoming run), and Same-minute Collisions; clicking auto-narrows the folder picker to the affected folders.
- **Queue trigger awareness** — Queue-driven triggers are detected via `QueueDefinitionId` and surfaced as a distinct trigger type, with no false time-based occurrences on the calendar.
- **Guided UiPath sign-in** — Add and remember a UiPath connection in the browser, with copy-to-clipboard helpers for the External App configuration values.
- **Direct Orchestrator reads** — Uses the UiPath SDK token for browser OData calls (folders, triggers, jobs, queue definitions).
- **Advanced filtering** — Search, hierarchical multi-folder selection, trigger type (Minute / Hourly / Daily / Weekly / Monthly / Queue / Other), and Enabled / All / Disabled.
- **Trigger Inventory** — Tabular view with name, process, folder, trigger type, cron pattern, and status; folder color rail on every row.
- **UiPath brand-aligned UI** — Visual system aligned with UiPath Brand Identity Guidelines V3.0 (Robotic Orange / Agentic Teal / Deep Blue, Poppins Bold for headlines, Inter for body, Black + Neutrals dark canvas for platform content).
- **Responsive dark mode** — Loads from system theme, persists user override.

## Technology Stack

- React 19
- TypeScript 6
- Vite 8
- `@uipath/uipath-typescript`
- Tailwind CSS 4
- shadcn/Radix UI primitives
- Lucide React
- Vitest and Testing Library

## Customer Security Model

This app is intended to be deployed by each customer into their own UiPath environment as a Coded Web App.

- The browser app uses a non-confidential External App. It does not use or store a client secret.
- The app stores only saved connection metadata in `localStorage`: UiPath Platform URL, organization, tenant names, client ID, redirect URI, and fixed scopes.
- Live folders, triggers, process schedules, jobs, access tokens, and Orchestrator results are not written to `localStorage` by this app.
- The UiPath SDK manages the user sign-in session in browser session storage.
- Data visibility is bounded by the signed-in user's UiPath tenant and folder permissions.

## Brand & Theming

The visual system follows UiPath Brand Identity Guidelines V3.0:

- Headlines use **Poppins Bold** with `-0.045em` letter-spacing.
- Body text uses **Inter**.
- **Light mode** canvas: Bright White (`#FFFFFF`) with brand Neutral grays.
- **Dark mode** canvas: Black (`#000000`) with brand Neutral grays — the platform-content treatment per the brand book's §Color hierarchy ("Black is used as a backdrop for platform-related content").
- Active toggles and primary actions: **Robotic Orange** (`#FA4616`) for impact; **Agentic Teal** (`#0BA2B3`) for structure.
- Folder color-coding uses theme-aware CSS tokens (`--folder-{1..7}-accent`) with distinct light and dark values, so folder hue is visible against either canvas.

## UiPath Requirements

Customer admins should create a **non-confidential** UiPath External Application with these Orchestrator API user scopes:

```text
OR.Folders.Read OR.Execution.Read OR.Jobs.Read
```

Grant the intended users or groups Orchestrator read access to the tenants and folders they should inspect. To show triggers across all intended folders, users need folder/process/trigger/job read access across those folders.

The redirect URI must match where the app runs:

- Local development: `http://localhost:5177`
- Deployed coded app: the deployed app URL returned by `uip codedapp deploy`

Sign-in will fail until the deployed app URL is registered as a redirect URI in the customer's External App.

## Environment Configuration

The app is customer-configured at runtime through the guided Add Connection flow. Customer UiPath values are not compiled into the app bundle.

Create `.env.local` from `.env.example` if you want local defaults:

```bash
cp .env.example .env.local
```

Supported variable:

```bash
VITE_ENABLE_TESTING_ROUTE=false
```

Users enter their UiPath Platform URL, organization, tenants, and client ID in the Add Connection screen. Use `https://cloud.uipath.com` for Automation Cloud, or the customer's environment root such as `https://staging.uipath.com` for staging. The app always saves the fixed required scope internally: `OR.Folders.Read OR.Execution.Read OR.Jobs.Read`.

## Local Development

Install dependencies:

```bash
npm install
```

Start the local development server:

```bash
npm run dev
```

Open the app:

```text
http://localhost:5177
```

For local sign-in, register `http://localhost:5177` as a redirect URI in the non-confidential External App.

## Internal Testing Mode

Synthetic stress data is disabled by default in customer builds. To run internal QA with fixture data, set:

```bash
VITE_ENABLE_TESTING_ROUTE=true
```

Then open:

```text
http://localhost:5177/testing?stress=50
```

When `VITE_ENABLE_TESTING_ROUTE` is not `true`, `/testing` shows a minimal unavailable state and does not load fixture data.

## Coded Web App Deployment

Before packaging:

```bash
npm test -- --run
npm run lint
npm run build
```

Package, publish, and deploy with the UiPath CLI:

```bash
uip codedapp pack dist --name "Process Schedule Manager" --version <version>
uip codedapp publish --name "Process Schedule Manager" --version <version> --type Web
uip codedapp deploy --name "Process Schedule Manager" --version <version> --folder-key <folder-key>
```

After deployment, copy the deployed app URL and add it as a redirect URI in the customer's non-confidential External App. Then open the app, add the customer connection details, and sign in.

## Data Access Model

The app initializes `new UiPath({ baseUrl, orgName, tenantName, clientId, redirectUri, scope })` from the selected connection and uses `sdk.getToken()` for direct browser OData calls.

The SDK currently exposes Orchestrator `Processes`, but not the `ProcessSchedules` endpoint this planner needs. For parity, this app keeps a small browser OData client that returns the same frontend shapes as the earlier proxy version:

- `loadTenants(sdk)`
- `loadProcessSchedules(sdk, tenantName)`

Tenant discovery uses `/{org}/{tenant}/orchestrator_/odata/Tenants?$top=100` and falls back to the tenant names saved in the selected connection. Folder and trigger reads preserve failed-folder warnings instead of failing the whole app.

## Project Notes

- `vite.config.ts` keeps `base: './'` because UiPath Coded Web Apps are mounted under platform-managed paths.
- Runtime redirect URI derivation uses `getAppBase()` from `@uipath/uipath-typescript` so deployed app paths work.
- There is no backend proxy, client secret, access-token fallback, or UiPath CLI auth fallback in the browser app.
- Customer-facing setup should happen through the guided Add Connection flow.
