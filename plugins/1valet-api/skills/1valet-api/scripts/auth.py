#!/usr/bin/env python3
"""
1VALET API Authentication Helper

Usage:
    python3 auth.py [credentials_dir]

If credentials_dir is omitted, the script auto-discovers credentials by:
  1. Checking the ONEVALET_CREDENTIALS_DIR environment variable
  2. Scanning mounted directories for a credentials/ folder with a .env file

Outputs the access token to stdout on success.
Prints status info to stderr.
"""

import sys
import os
import glob
import json
import urllib.request
import urllib.parse

# Constants
TOKEN_URL = "https://id.1valetbas.com/connect/token"
SCOPES = "public_api public_api.common_data.read public_api.portfolio_manager.read"
API_BASE = "https://api.1valet.com"


def load_env(filepath):
    """Parse a .env file into a dict, ignoring comments and blank lines."""
    config = {}
    with open(filepath, "r") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                config[key.strip()] = value.strip()
    return config


def get_token(client_id, client_secret):
    """Request an OAuth2 client_credentials token."""
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
        "scope": SCOPES,
    }).encode("utf-8")

    req = urllib.request.Request(
        TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )

    with urllib.request.urlopen(req) as resp:
        body = json.loads(resp.read().decode("utf-8"))

    if "access_token" not in body:
        raise RuntimeError(f"Token request failed: {json.dumps(body)}")

    return body["access_token"], body.get("expires_in", 3600)


def find_credentials_dir():
    """Auto-discover the credentials directory."""
    # Priority 1: Environment variable
    env_dir = os.environ.get("ONEVALET_CREDENTIALS_DIR")
    if env_dir and os.path.isdir(env_dir):
        print(f"Using credentials from env var: {env_dir}", file=sys.stderr)
        return env_dir

    # Priority 2: Scan mounted directories
    patterns = [
        "/sessions/*/mnt/*/credentials/.env",
        "/sessions/*/mnt/credentials/.env",
    ]
    for pattern in patterns:
        matches = glob.glob(pattern)
        if matches:
            creds_dir = os.path.dirname(matches[0])
            print(f"Auto-discovered credentials at: {creds_dir}", file=sys.stderr)
            return creds_dir

    return None


def main():
    creds_dir = None

    if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]):
        creds_dir = sys.argv[1]

    if not creds_dir:
        creds_dir = find_credentials_dir()
        if not creds_dir:
            print("Error: Could not find credentials directory.", file=sys.stderr)
            print("Options:", file=sys.stderr)
            print("  1. Set ONEVALET_CREDENTIALS_DIR environment variable", file=sys.stderr)
            print("  2. Mount a folder containing a credentials/ directory", file=sys.stderr)
            print("  3. Pass the path: python3 auth.py /path/to/credentials", file=sys.stderr)
            sys.exit(1)

    env_file = os.path.join(creds_dir, ".env")

    if not os.path.exists(env_file):
        print(f"Error: .env file not found at: {env_file}", file=sys.stderr)
        print("Create a .env file with your CLIENT_ID and CLIENT_SECRET.", file=sys.stderr)
        sys.exit(1)

    # Load credentials
    config = load_env(env_file)
    required = ["CLIENT_ID", "CLIENT_SECRET"]
    missing = [k for k in required if k not in config]
    if missing:
        print(f"Error: Missing in {env_file}: {', '.join(missing)}", file=sys.stderr)
        print("Each .env file needs: CLIENT_ID=... and CLIENT_SECRET=...", file=sys.stderr)
        sys.exit(1)

    # Get token
    try:
        token, expires_in = get_token(config["CLIENT_ID"], config["CLIENT_SECRET"])
    except Exception as e:
        print(f"Error getting token: {e}", file=sys.stderr)
        sys.exit(1)

    # Save token for session use
    with open("/tmp/.api_token", "w") as f:
        f.write(token)

    # Output
    print(token)
    print(f"Token acquired, expires in {expires_in}s", file=sys.stderr)


if __name__ == "__main__":
    main()
