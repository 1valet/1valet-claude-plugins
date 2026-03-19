# 1VALET Claude Plugins

Official plugins for accessing the 1VALET platform from Claude.

## Available Plugins

### 1valet-api

Query your buildings, amenities, bookings, suites, occupants, and access control data directly from Claude using natural language.

## Installation

Add this marketplace to Claude Code:

```
/plugin marketplace add 1valet/claude-plugins
```

Then install the plugin:

```
/plugin install 1valet-api@1valet-plugins
```

## Setup

1. Obtain your `CLIENT_ID` and `CLIENT_SECRET` from your 1VALET account manager.

2. Create a `credentials/` folder on your machine with a `.env` file:

   ```
   CLIENT_ID=public_api_<your-uuid>
   CLIENT_SECRET=<your-secret>
   ```

3. When starting a Cowork session, select the folder that contains your `credentials/` directory.

That's it — Claude will authenticate automatically and you can start asking questions like:

- "Show me all my buildings"
- "What are the top amenities by bookings?"
- "Create a monthly usage report for my amenities"

## Support

Contact your 1VALET account manager or email support@1valet.com.
