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
| `/v1/buildings` | GET | List all your buildings |
| `/v1/buildings/{id}` | GET | Building detail |
| `/v1/buildings/{id}/suites` | GET | List suites in a building |
| `/v1/buildings/{id}/occupants` | GET | List occupants |
| `/v1/amenities` | GET | All amenities |
| `/v1/amenities/buildings/{id}` | GET | Amenities for a building |
| `/v1/amenities/buildings/{id}/bookings` | GET | Bookings (supports `from`/`to` query params) |
| `/v1/buildings/{id}/access-doors` | GET | Access doors |
| `/v1/buildings/{id}/access-cards` | GET | Access cards |
| `/v1/buildings/{id}/access-permissions` | GET | Access permissions |
| `/v1/buildings/{id}/entry-systems` | GET | Entry systems |
| `/v1/buildings/{id}/lockers` | GET | Lockers |
| `/v1/buildings/{id}/parcels` | GET | Parcels |
| `/v1/buildings/{id}/vehicles` | GET | Vehicles |
| `/v1/localities` | GET | All localities |

### Common Patterns

**Get all bookings across your buildings:**
1. `GET /v1/amenities` → get all amenities and extract unique buildingIds
2. For each building: `GET /v1/amenities/buildings/{id}/bookings`
3. Aggregate results

When pulling data that requires iterating over buildings (e.g., bookings for all buildings), use `concurrent.futures.ThreadPoolExecutor` with 15-25 workers for performance.

**List all buildings:**
1. `GET /v1/buildings`

**Get suites for a building:**
1. `GET /v1/buildings/{id}/suites`

## Security Notes

- Credentials are read from disk into memory only — never written to new files or logged
- OAuth2 tokens are stored in `/tmp/.api_token` for the session duration only
- The token file is overwritten each time a new token is acquired
- Never include credentials or tokens in conversation output
