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

Credential discovery is handled automatically by the `auth.sh` script — do not search for or read credential files directly.

## Authentication Flow

All authentication and API requests go through `scripts/auth.sh`. Never use raw curl commands with credentials or tokens. The script requires only `bash` and `curl` — no Python or other dependencies.

### Step 1: Authenticate

```bash
bash scripts/auth.sh auth [credentials_dir]
```

This discovers credentials, obtains an OAuth2 token, and stores it securely. No credentials or tokens are printed to the console.

### Step 2: Make API calls

```bash
bash scripts/auth.sh request /v1/buildings
bash scripts/auth.sh request /v1/buildings/{id}/suites
bash scripts/auth.sh request /v1/amenities/buildings/{id}/bookings?from=2026-01-01&to=2026-03-19
bash scripts/auth.sh request /v1/buildings/{id}/occupants
```

The script handles token lifecycle automatically — if the token is missing or expired, it re-authenticates before making the request. Only the API response JSON is printed to stdout.

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

When pulling data that requires iterating over buildings (e.g., bookings for all buildings), run multiple `auth.sh request` calls in parallel using background processes or xargs for performance.

**List all buildings:**
1. `GET /v1/buildings`

**Get suites for a building:**
1. `GET /v1/buildings/{id}/suites`

## Security Notes

- All credential and token handling is encapsulated in `auth.sh` — never use raw curl with credentials or tokens
- Credentials are read from disk into memory only — never written to new files or logged
- OAuth2 tokens are stored in `/tmp/.api_token` with owner-only permissions (0600)
- The token file uses JSON format with expiry tracking and is overwritten on each new token
- Error messages are sanitized — no credentials or response bodies are exposed in error output
- Never include credentials or tokens in conversation output
