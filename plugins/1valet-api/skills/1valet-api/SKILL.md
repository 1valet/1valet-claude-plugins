---
name: 1valet-api
description: |
  Connect to the 1VALET Public API to query your buildings, amenities, bookings, suites, occupants, and access control data. Use this skill whenever the user asks about their buildings, amenities, bookings, suites, occupants, access doors/cards, or wants reports and analysis from the 1VALET platform. Sign-in is handled automatically — by default Claude opens a browser for the user to sign in to 1VALET once; client_credentials via a `.env` file is still supported for automation and service accounts.
---

# 1VALET API Skill

This skill provides authenticated access to the 1VALET Public API for your organization's buildings and data.

## Authentication modes

The skill supports two modes and picks one automatically at runtime.

### Default: user-delegated sign-in (browser + PKCE)

The first time you run the skill, Claude opens your default browser to `https://id.1valetbas.com` so you can sign in with your real 1VALET account — the same credentials you use for the 1VALET admin portal, with 2FA and SSO applied. After you consent, the browser redirects to a short-lived local listener, a token is cached on your machine, and subsequent requests are silent.

- OAuth2 **Authorization Code** flow with **PKCE** (RFC 7636) — no client secret on disk.
- IDS client id: `ClaudePluginUserDelegated` (you don't need to configure this).
- Scopes: `openid profile offline_access public_api.user.portfolio_manager.read public_api.user.common_data.read` — **read-only** in phase 1. Write endpoints require the client_credentials mode below.
- Data returned is scoped by your real `BasUser` permissions (`CustomerAdministrator` or `BasUserToBuilding`), so you only see buildings you already have access to in the portal.
- Tokens are cached at `~/.config/1valet-plugin/tokens.json` (directory `0700`, file `0600`). The refresh token rotates silently.
- When your assignments change in the portal, the next token refresh will reflect them; deactivated users lose access at the next refresh.

**If the browser does not open automatically**, the script prints the sign-in URL to the terminal — copy it into any browser signed in to your 1VALET account.

**To sign out locally**, run:

```bash
bash scripts/auth.sh logout
```

That deletes the cached tokens; the next request will prompt you to sign in again.

### Fallback: client_credentials (automation / service accounts)

For integrators, CI jobs, or users who prefer a long-lived credential, the existing `.env` flow is unchanged.

Create a `credentials/` folder anywhere on your machine with a `.env` file containing two lines:

```
CLIENT_ID=public_api_<your-uuid>
CLIENT_SECRET=<your-secret>
```

Then either select that folder when starting a Cowork session, or set `ONEVALET_CREDENTIALS_DIR` to point directly at it.

### Which mode does the skill use?

`auth.sh` resolves the mode on every call:

1. If a `credentials/.env` is found (via `ONEVALET_CREDENTIALS_DIR`, the current working directory, or a mounted folder) **and** it contains both `CLIENT_ID` and `CLIENT_SECRET` → **client_credentials** (backward compatible).
2. Otherwise → **user-delegated** (browser sign-in via `oauth.js`).

Credential and token handling is fully encapsulated in `scripts/auth.sh` and `scripts/oauth.js`. Never read credential files directly or call `curl` with credentials yourself.

## Usage

### Step 1: Authenticate (first time only)

```bash
bash scripts/auth.sh auth
```

- User-delegated mode: opens the browser and caches tokens. No prompts on subsequent runs until the refresh token expires (30 days sliding).
- Client_credentials mode: acquires a token and caches it in `/tmp/.api_token`.

You can pass an explicit credentials directory to force client_credentials:

```bash
bash scripts/auth.sh auth /path/to/credentials
```

### Step 2: Make API calls

```bash
bash scripts/auth.sh request /v1/buildings
bash scripts/auth.sh request /v1/buildings/{id}/suites
bash scripts/auth.sh request /v1/amenities/buildings/{id}/bookings?from=2026-01-01&to=2026-03-19
bash scripts/auth.sh request /v1/buildings/{id}/occupants
```

The script handles token lifecycle automatically — if no valid token exists it re-authenticates (silently in user-delegated mode when a refresh token is present). Only the API response JSON is printed to stdout.

## API Reference

Base URL: `https://api.1valet.com`

### Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/buildings` | GET | List all your buildings (basic fields) |
| `/v1/buildings/{id}` | GET | Single building (basic fields) |
| `/v1/buildings/details` | GET | **Detailed list** — paginated, filterable, with capabilities, billing, contracts, coordinates |
| `/v1/buildings/{id}/details` | GET | **Detailed single building** — capabilities, billing, contracts, coordinates |
| `/v1/buildings/{id}/suites` | GET | List suites in a building |
| `/v1/buildings/{id}/occupants` | GET | List occupants |
| `/v1/amenities` | GET | All amenities |
| `/v1/amenities/buildings/{id}` | GET | Amenities for a building |
| `/v1/amenities/buildings/{id}/bookings` | GET | Bookings (supports `from`/`to` query params) |
| `/v1/amenities/customers/{id}` | GET | Amenities by customer |
| `/v1/buildings/{id}/access-doors` | GET | Access doors |
| `/v1/buildings/{id}/access-cards` | GET | Access cards |
| `/v1/buildings/{id}/access-permissions` | GET | Access permissions |
| `/v1/buildings/{id}/entry-systems` | GET | Entry systems |
| `/v1/buildings/{id}/lockers` | GET | Lockers |
| `/v1/buildings/{id}/parcels` | GET | Parcels |
| `/v1/buildings/{id}/vehicles` | GET | Vehicles |
| `/v1/localities` | GET | All localities |
| `/v1/webhooks` | GET/POST | Manage webhooks (client_credentials only) |

> **Phase 1 user-delegated scope:** only the building and amenity read endpoints are available when signed in via the browser. Access control, parking, write endpoints, and webhook management still require client_credentials.

### Building Details Endpoints (New in v1.1)

These endpoints return significantly richer data than the basic `/v1/buildings` endpoints, including enabled capabilities, billing contract terms, billable suite counts, geographic coordinates, and lifecycle dates.

#### `GET /v1/buildings/details` — Filtered & paginated list

Query parameters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter by status: `Live`, `PreLaunch`, `Construction`, `Suspended`, `ForceDelete`, `Decommissioned` |
| `category` | string | Filter by category: `Rental` or `Condo` |
| `size` | string | Filter by billable suite count bucket: `Small` (<50), `Medium` (50–149), `Large` (150–299), `ExtraLarge` (300+) |
| `excludeSalesCenters` | bool | When `true`, sales/demo centres are excluded. Default `false` |
| `customerId` | uuid | Restrict results to a specific customer |
| `capabilities` | string | Return only buildings that have ALL of the specified capabilities enabled |
| `createdDateFrom` / `createdDateTo` | date | Filter by building creation date range (UTC) |
| `liveDateFrom` / `liveDateTo` | date | Filter by go-live date range (UTC) |
| `latitude` / `longitude` / `distanceMeters` | number | Geo-distance filter — must provide all three together |
| `hasActiveContract` | bool | `true` = only buildings with active contract; `false` = without |
| `contractExpiringInMonths` | int | Buildings whose contract expires within N months |
| `contractSaleChannel` | string | Filter by contract sale channel |

#### `GET /v1/buildings/{id}/details` — Single building detail

Returns the same rich fields as the list endpoint, for a single building by ID.

#### Response fields (both endpoints)

Beyond the standard building fields, the detail endpoints add:

| Field | Type | Description |
|-------|------|-------------|
| `customerId` | uuid | Customer that owns this building — useful for grouping |
| `isSalesCenter` | bool | `true` = sales/demo center (exclude from portfolio metrics) |
| `latitude` / `longitude` | double | Geographic coordinates for mapping and distance queries |
| `enabledCapabilities` | string[] | Active 1VALET modules on this building |
| `requiresManualApprovalForResidents` | bool | Whether new move-ins need manual staff approval |
| `currency` | string | Billing currency: `CAD` or `USD` |
| `billableSuiteCount` | int | Suite count driving monthly per-suite billing |
| `contract.startDate` | date | Billing contract start date |
| `contract.endDate` | date | Contract end date (null for month-to-month) |
| `contract.isMonthToMonth` | bool | Open-ended vs. fixed-term contract |
| `contract.monthlyChargePerSuiteInCents` | int | Per-suite charge in cents (÷ 100 for dollars) |
| `contract.monthlyChargePerBuildingInCents` | int | Flat monthly building charge in cents |
| `contract.includesCpiAdjustment` | bool | Whether annual CPI adjustments apply |
| `contract.fixedYearlyAdjustmentPercent` | double | Fixed yearly % adjustment (when CPI is off) |
| `contract.saleChannel` | string | Contract sale channel |

#### Available Capabilities

`AccessControl`, `SecurityCameras`, `InSuiteAccess`, `Crm`, `Lockers`, `Thermostats`, `ProximityKeys`, `Docbox`, `RemoteUnlock`, `AmenityBooking`, `AccessCards`, `LicensePlateRecognition`, `GuestParking`, `UhfReaders`, `ResidentServices`, `MaintenanceRequests`, `Dashboards`, `DoorSensors`, `LedgerServices`, `IncidentReports`, `Store`, `SuiteInspections`, `PaymentProcessing`, `Offers`, `BudgetManagement`, `StatusCertificates`, `LeaseRenewals`, `EvCharging`, `Events`, `ServiceProviders`, `Marketplace`

### Common Patterns

**Get full portfolio overview with capabilities and billing:**
1. `GET /v1/buildings/details?excludeSalesCenters=true` → rich detail for all buildings in one call

**Find buildings with expiring contracts:**
1. `GET /v1/buildings/details?contractExpiringInMonths=6`

**Get buildings near a location:**
1. `GET /v1/buildings/details?latitude=43.65&longitude=-79.38&distanceMeters=50000`

**Get all bookings across your buildings:**
1. `GET /v1/amenities` → get all amenities and extract unique buildingIds
2. For each building: `GET /v1/amenities/buildings/{id}/bookings`
3. Aggregate results

When pulling data that requires iterating over buildings (e.g., bookings for all buildings), run multiple `auth.sh request` calls in parallel using background processes or xargs for performance.

**List all buildings (basic):**
1. `GET /v1/buildings`

**Get suites for a building:**
1. `GET /v1/buildings/{id}/suites`

## Troubleshooting

- **Browser did not open**: the sign-in URL is printed to the terminal — copy it into any browser. If you use a non-default port (corporate firewall), set `ONEVALET_OAUTH_PORT` and ensure that port is registered on the IDS client.
- **"Node.js not found"**: user-delegated mode requires Node.js 14+ on `PATH`. Either install Node, or provide a `credentials/.env` to use client_credentials mode.
- **"Token exchange failed"**: usually means the IDS client has not been seeded yet on the environment you're hitting, or your 1VALET account does not have permissions. Check with your 1VALET admin.
- **"Forbidden" on a specific building**: your user account doesn't have a permission for that building. Phase 1 user-delegated mode is read-only; write calls will also return 403.

## Security Notes

- All credential and token handling is encapsulated in `scripts/auth.sh` and `scripts/oauth.js` — never use raw curl with credentials or tokens.
- Client_credentials: credentials are read from disk into memory only — never written to new files or logged. Tokens cached at `/tmp/.api_token` (0600), JSON with expiry.
- User-delegated: no client secret on the machine. Tokens cached at `~/.config/1valet-plugin/tokens.json` (directory 0700, file 0600). PKCE `S256` prevents authorization code interception.
- Error messages are sanitized — no credentials, tokens, or raw response bodies are exposed.
- Never include credentials or tokens in conversation output.
