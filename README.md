# 1VALET Claude Plugins

Official plugins for accessing the 1VALET platform from Claude.

## Available Plugins

### 1valet-api

Query your buildings, amenities, bookings, suites, occupants, and access control data directly from Claude using natural language.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add 1valet/1valet-claude-plugins
```

Then install the plugin:

```
/plugin install 1valet-api@1valet-plugins
```

## Setup

The plugin supports two authentication modes and picks one automatically.

### Default: sign in with your 1VALET account (recommended for Portfolio Managers)

The first time you ask Claude something that uses the skill, your browser opens to `https://id.1valetbas.com`. Sign in with the same credentials you use for the 1VALET admin portal (2FA and SSO apply). Tokens are cached locally at `~/.config/1valet-plugin/tokens.json` and refreshed silently — you won't be prompted again for about 30 days.

Nothing to configure. No files to create. Requires Node.js 14+ on your machine (already present on most dev setups).

Data you see through the skill is scoped by your real 1VALET permissions — you get the same buildings and data you can see in the portal. The first phase of this mode is **read-only**.

To sign out locally:

```bash
bash scripts/auth.sh logout
```

### Alternative: client_credentials (automation / service accounts)

If you already have a `CLIENT_ID` + `CLIENT_SECRET` from your 1VALET account manager (typically for integrators or CI jobs), create a `credentials/` folder with a `.env` file:

```
CLIENT_ID=public_api_<your-uuid>
CLIENT_SECRET=<your-secret>
```

Then, when starting a Cowork session, select the folder that contains your `credentials/` directory. When a valid `.env` is found, the skill uses it instead of the browser flow.

## Example questions

- "Show me all my buildings"
- "What are the top amenities by bookings?"
- "Create a monthly usage report for my amenities"

## Support

Contact your 1VALET account manager or email support@1valet.com.
