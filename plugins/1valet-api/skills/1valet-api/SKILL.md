---
name: 1valet-api
description: |
  Connect to the 1VALET Public API to query your buildings, amenities, bookings, suites, occupants, and access control data. Use this skill whenever the user asks about their buildings, amenities, bookings, suites, occupants, access doors/cards, or wants reports and analysis from the 1VALET platform. This skill handles OAuth2 authentication automatically using locally stored credentials.
---

# 1VALET API Skill

This skill provides authenticated access to the 1VALET Public API for your organization's buildings and data.

## Setup

Before using this skill, you need a credentials file containing the CLIENT_ID and CLIENT_SECRET provided by 1VALET.

Create a file called `.env` inside a `credentials/` folder anywhere on your machine:

```
credentials/
└── .env
```

The `.env` file contains just two lines:

```
CLIENT_ID=public_api_<your-uuid>
CLIENT_SECRET=<your-secret>
```

Then, when you start a Cowork session, select the folder that contains your `credentials/` directory (e.g., your Documents folder). The skill will find it automatically.

Alternatively, set the `ONEVALET_CREDENTIALS_DIR` environment variable to point directly at your `credentials/` folder.

## Locating Credentials

The skill finds your `.env` file using this priority:

1. **Environment variable `ONEVALET_CREDENTIALS_DIR`** — if set, use that path directly
2. **The mounted workspace** — scan the mounted directory for a `credentials/` subfolder containing a `.env` file
3. **Ask the user** — if neither of the above works, use `request_cowork_directory` to ask the user to select their credentials folder

To search for credentials in the mounted workspace, run:
```bash
find /sessions/*/mnt -maxdepth 3 -name ".env" -path "*/credentials/*" 2>/dev/null | head -1
```
If that returns a result, use the parent directory as the credentials dir. If not, prompt the user.

## Authentication Flow

### Step 1: Find and load credentials

Follow the priority order above to locate the credentials directory. Read the `.env` file and parse the CLIENT_ID and CLIENT_SECRET values.

### Step 2: Get an OAuth2 token

Use these constants:
- **Token URL**: `https://id.1valetbas.com/connect/token`
- **Scopes**: `public_api public_api.common_data.read public_api.portfolio_manager.read`

```bash
curl -s -X POST "https://id.1valetbas.com/connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=$CLIENT_ID" \
  -d "client_secret=$CLIENT_SECRET" \
  -d "scope=public_api public_api.common_data.read public_api.portfolio_manager.read"
```

Parse the JSON response to extract `access_token`. Tokens are valid for 3600 seconds (1 hour).

### Step 3: Make API calls

```bash
curl -s "https://api.1valet.com/v1/<endpoint>" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/json"
```

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
| `/v1/webhooks` | GET/POST | Manage webhooks |

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

When pulling data that requires iterating over buildings (e.g., bookings for all buildings), use `concurrent.futures.ThreadPoolExecutor` with 15-25 workers for performance.

**List all buildings (basic):**
1. `GET /v1/buildings`

**Get suites for a building:**
1. `GET /v1/buildings/{id}/suites`

## Security Notes

- Credentials are read from disk into memory only — never written to new files or logged
- OAuth2 tokens are stored in `/tmp/.api_token` for the session duration only
- The token file is overwritten each time a new token is acquired
- Never include credentials or tokens in conversation output
