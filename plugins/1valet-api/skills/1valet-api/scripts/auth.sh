#!/usr/bin/env bash
#
# 1VALET API Authentication & Request Helper
#
# Usage:
#   bash auth.sh auth [credentials_dir]
#       Authenticate and store the token securely. No token is printed.
#
#   bash auth.sh request <endpoint> [--method GET|POST|PUT|DELETE] [--data '{"key":"value"}']
#       Make an authenticated API request. Prints only the JSON response.
#       Auto-authenticates if no valid token exists.
#
# If credentials_dir is omitted, the script auto-discovers credentials by:
#   1. Checking the ONEVALET_CREDENTIALS_DIR environment variable
#   2. Scanning mounted directories for a credentials/ folder with a .env file

set -euo pipefail

# Constants
TOKEN_URL="https://id.1valetbas.com/connect/token"
SCOPES="public_api public_api.common_data.read public_api.portfolio_manager.read"
API_BASE="https://api.1valet.com"
TOKEN_FILE="/tmp/.api_token"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OAUTH_JS="${SCRIPT_DIR}/oauth.js"

# Temp file for curl responses (cleaned up on exit)
TMPFILE=""
cleanup() {
    if [[ -n "$TMPFILE" && -f "$TMPFILE" ]]; then
        rm -f "$TMPFILE"
    fi
}
trap cleanup EXIT

make_tmpfile() {
    TMPFILE="$(mktemp /tmp/.1valet_resp.XXXXXX)"
}

# --- JSON extraction (no jq/python dependency) ---

# Extract a string value from a flat JSON object by key.
# Works for the simple/predictable JSON returned by OAuth and API errors.
json_extract() {
    local json="$1" key="$2"
    # Match "key":"value" or "key": "value"
    echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed "s/\"${key}\"[[:space:]]*:[[:space:]]*\"//;s/\"$//"
}

# Extract a numeric value from a flat JSON object by key.
json_extract_num() {
    local json="$1" key="$2"
    echo "$json" | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*[0-9]*" | head -1 | sed "s/\"${key}\"[[:space:]]*:[[:space:]]*//"
}

# --- Credential discovery ---

find_credentials_dir() {
    # Priority 1: credentials/.env relative to the current working directory
    if [[ -f "${PWD}/credentials/.env" ]]; then
        echo "Using credentials from project: ${PWD}/credentials" >&2
        echo "${PWD}/credentials"
        return 0
    fi

    # Priority 2: Environment variable
    if [[ -n "${ONEVALET_CREDENTIALS_DIR:-}" && -d "${ONEVALET_CREDENTIALS_DIR}" ]]; then
        echo "Using credentials from env var: ${ONEVALET_CREDENTIALS_DIR}" >&2
        echo "${ONEVALET_CREDENTIALS_DIR}"
        return 0
    fi

    # Priority 3: Scan mounted directories (Cowork/container environments)
    local match
    for pattern in "/sessions/*/mnt/*/credentials/.env" "/sessions/*/mnt/credentials/.env"; do
        match="$(compgen -G "$pattern" 2>/dev/null | head -1 || true)"
        if [[ -n "$match" ]]; then
            local creds_dir
            creds_dir="$(dirname "$match")"
            echo "Auto-discovered credentials at: ${creds_dir}" >&2
            echo "${creds_dir}"
            return 0
        fi
    done

    return 1
}

load_credentials() {
    local creds_dir="${1:-}"

    if [[ -z "$creds_dir" ]]; then
        creds_dir="$(find_credentials_dir)" || {
            echo "Error: Could not find credentials directory." >&2
            echo "Options:" >&2
            echo "  1. Set ONEVALET_CREDENTIALS_DIR environment variable" >&2
            echo "  2. Mount a folder containing a credentials/ directory" >&2
            echo "  3. Pass the path: bash auth.sh auth /path/to/credentials" >&2
            exit 1
        }
    fi

    local env_file="${creds_dir}/.env"
    if [[ ! -f "$env_file" ]]; then
        echo "Error: .env file not found at: ${env_file}" >&2
        echo "Create a .env file with your CLIENT_ID and CLIENT_SECRET." >&2
        exit 1
    fi

    # Source .env in a subshell-safe way — only export CLIENT_ID and CLIENT_SECRET
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        if [[ -z "$line" || "$line" == \#* ]]; then
            continue
        fi
        if [[ "$line" == *"="* ]]; then
            key="${line%%=*}"
            value="${line#*=}"
            key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            case "$key" in
                CLIENT_ID) _CLIENT_ID="$value" ;;
                CLIENT_SECRET) _CLIENT_SECRET="$value" ;;
            esac
        fi
    done < "$env_file"

    if [[ -z "${_CLIENT_ID:-}" ]]; then
        echo "Error: CLIENT_ID not found in ${env_file}" >&2
        exit 1
    fi
    if [[ -z "${_CLIENT_SECRET:-}" ]]; then
        echo "Error: CLIENT_SECRET not found in ${env_file}" >&2
        exit 1
    fi
}

# Non-fatal variant of load_credentials used by auto-detection. Populates
# _CLIENT_ID / _CLIENT_SECRET and returns 0 on success. Returns 1 if no
# .env can be located or if either variable is missing/blank — the caller
# is expected to fall back to user-delegated (oauth.js).
try_load_client_credentials() {
    local creds_dir="${1:-}"

    if [[ -z "$creds_dir" ]]; then
        creds_dir="$(find_credentials_dir 2>/dev/null)" || return 1
    fi

    local env_file="${creds_dir}/.env"
    [[ -f "$env_file" ]] || return 1

    local line key value cid="" csecret=""
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        if [[ -z "$line" || "$line" == \#* ]]; then
            continue
        fi
        if [[ "$line" == *"="* ]]; then
            key="${line%%=*}"
            value="${line#*=}"
            key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
            case "$key" in
                CLIENT_ID) cid="$value" ;;
                CLIENT_SECRET) csecret="$value" ;;
            esac
        fi
    done < "$env_file"

    [[ -n "$cid" && -n "$csecret" ]] || return 1

    _CLIENT_ID="$cid"
    _CLIENT_SECRET="$csecret"
    return 0
}

# --- Token management ---

get_token() {
    local client_id="$1" client_secret="$2"

    make_tmpfile
    local http_code
    http_code="$(curl -s -w "%{http_code}" -o "$TMPFILE" \
        -X POST "$TOKEN_URL" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "grant_type=client_credentials" \
        -d "client_id=${client_id}" \
        -d "client_secret=${client_secret}" \
        -d "scope=${SCOPES}")"

    if [[ "$http_code" -lt 200 || "$http_code" -ge 300 ]]; then
        echo "Error: Authentication failed (HTTP ${http_code}). Check your CLIENT_ID and CLIENT_SECRET." >&2
        rm -f "$TMPFILE"
        exit 1
    fi

    local response
    response="$(cat "$TMPFILE")"
    rm -f "$TMPFILE"

    local access_token expires_in
    access_token="$(json_extract "$response" "access_token")"
    expires_in="$(json_extract_num "$response" "expires_in")"

    if [[ -z "$access_token" ]]; then
        echo "Error: Authentication failed. Token response was invalid." >&2
        exit 1
    fi

    if [[ -z "$expires_in" ]]; then
        expires_in=3600
    fi

    # Save token with restricted permissions
    local expires_at
    expires_at=$(( $(date +%s) + expires_in ))

    (umask 077; echo "${access_token}|${expires_at}" > "$TOKEN_FILE")

    echo "Token acquired, expires in ${expires_in}s" >&2
}

load_saved_token() {
    if [[ ! -f "$TOKEN_FILE" ]]; then
        return 1
    fi

    local content
    content="$(cat "$TOKEN_FILE")"

    local saved_token expires_at
    saved_token="${content%%|*}"
    expires_at="${content##*|}"

    if [[ -z "$saved_token" || -z "$expires_at" ]]; then
        return 1
    fi

    local now
    now="$(date +%s)"
    # 60-second buffer before expiry
    if [[ "$now" -ge $(( expires_at - 60 )) ]]; then
        return 1
    fi

    echo "$saved_token"
    return 0
}

# --- User-delegated (Authorization Code + PKCE) via oauth.js ---
#
# oauth.js manages its own token cache at ~/.config/1valet-plugin/tokens.json,
# so this function delegates to it unconditionally — the JS helper decides
# whether to use the cached access token, refresh, or launch the browser.

get_user_delegated_token() {
    if [[ ! -f "$OAUTH_JS" ]]; then
        echo "Error: oauth.js not found at ${OAUTH_JS}." >&2
        echo "The plugin install may be incomplete — reinstall via /plugin install 1valet-api@1valet-plugins." >&2
        exit 1
    fi

    if ! command -v node >/dev/null 2>&1; then
        echo "Error: Node.js is required for user-delegated sign-in but was not found on PATH." >&2
        echo "Install Node.js (>=14) or provide CLIENT_ID/CLIENT_SECRET via a credentials/.env file for client_credentials mode." >&2
        exit 1
    fi

    local token
    token="$(node "$OAUTH_JS")" || {
        echo "Error: User-delegated sign-in failed." >&2
        exit 1
    }
    if [[ -z "$token" ]]; then
        echo "Error: oauth.js returned an empty token." >&2
        exit 1
    fi
    echo "$token"
}

# Determine which auth mode to use. If the caller supplied a creds_dir or
# one can be auto-discovered AND it contains both CLIENT_ID and CLIENT_SECRET,
# we stay on the existing client_credentials path. Otherwise fall back to
# user-delegated. Sets _AUTH_MODE to "client_credentials" or "user_delegated".
resolve_auth_mode() {
    local creds_dir="${1:-}"
    if try_load_client_credentials "$creds_dir"; then
        _AUTH_MODE="client_credentials"
    else
        _AUTH_MODE="user_delegated"
    fi
}

# --- Auth command ---

cmd_auth() {
    local creds_dir="${1:-}"
    resolve_auth_mode "$creds_dir"
    if [[ "$_AUTH_MODE" == "client_credentials" ]]; then
        get_token "$_CLIENT_ID" "$_CLIENT_SECRET"
    else
        # User-delegated caches inside oauth.js; just prime it.
        get_user_delegated_token >/dev/null
        echo "Signed in (user-delegated)." >&2
    fi
}

# --- Ensure valid token ---

ensure_token() {
    local creds_dir="${1:-}"
    local token

    resolve_auth_mode "$creds_dir"

    if [[ "$_AUTH_MODE" == "user_delegated" ]]; then
        # oauth.js owns its own cache — no need to consult /tmp/.api_token.
        token="$(get_user_delegated_token)"
        echo "$token"
        return 0
    fi

    token="$(load_saved_token 2>/dev/null)" && {
        echo "$token"
        return 0
    }

    echo "No valid token found, authenticating..." >&2
    get_token "$_CLIENT_ID" "$_CLIENT_SECRET"

    token="$(load_saved_token)" || {
        echo "Error: Failed to obtain a valid token." >&2
        exit 1
    }
    echo "$token"
}

# --- Request command ---

cmd_request() {
    local endpoint="" method="GET" data="" creds_dir=""

    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --method) method="${2:-GET}"; shift 2 ;;
            --data) data="${2:-}"; shift 2 ;;
            --credentials-dir) creds_dir="${2:-}"; shift 2 ;;
            -*) echo "Error: Unknown option: $1" >&2; exit 1 ;;
            *)
                if [[ -z "$endpoint" ]]; then
                    endpoint="$1"
                else
                    echo "Error: Unexpected argument: $1" >&2
                    exit 1
                fi
                shift ;;
        esac
    done

    if [[ -z "$endpoint" ]]; then
        echo "Error: Endpoint is required. Example: bash auth.sh request /v1/buildings" >&2
        exit 1
    fi

    local token
    token="$(ensure_token "$creds_dir")"

    local url="${API_BASE}${endpoint}"
    local curl_args=(-s -X "$method" "$url" -H "Authorization: Bearer ${token}" -H "Accept: application/json")

    if [[ -n "$data" ]]; then
        curl_args+=(-H "Content-Type: application/json" -d "$data")
    fi

    make_tmpfile
    local http_code
    http_code="$(curl -w "%{http_code}" -o "$TMPFILE" "${curl_args[@]}")"

    local response
    response="$(cat "$TMPFILE")"
    rm -f "$TMPFILE"

    if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
        echo "$response"
    else
        # Extract safe error message if possible
        local msg
        msg="$(json_extract "$response" "message")"
        if [[ -z "$msg" ]]; then
            msg="$(json_extract "$response" "title")"
        fi
        if [[ -z "$msg" ]]; then
            msg="HTTP ${http_code}"
        fi
        echo "{\"error\": true, \"status\": ${http_code}, \"message\": \"${msg}\"}"
        exit 1
    fi
}

# --- Main ---

cmd_logout() {
    # Clear user-delegated tokens (if any). The client_credentials cache at
    # /tmp/.api_token is short-lived (1h) and ephemeral, but remove it too
    # for symmetry so "logout" really means "drop every cached token".
    if [[ -f "$OAUTH_JS" ]] && command -v node >/dev/null 2>&1; then
        node "$OAUTH_JS" --logout >&2 || true
    fi
    if [[ -f "$TOKEN_FILE" ]]; then
        rm -f "$TOKEN_FILE"
        echo "Removed client_credentials token cache." >&2
    fi
}

main() {
    local command="${1:-}"

    case "$command" in
        auth)
            shift
            cmd_auth "${1:-}"
            ;;
        request)
            shift
            cmd_request "$@"
            ;;
        logout)
            cmd_logout
            ;;
        "")
            # Backward compat: no subcommand defaults to auth
            cmd_auth ""
            ;;
        *)
            # If first arg is a directory, treat as: auth <dir>
            if [[ -d "$command" ]]; then
                cmd_auth "$command"
            else
                echo "Usage:" >&2
                echo "  bash auth.sh auth [credentials_dir]" >&2
                echo "  bash auth.sh request <endpoint> [--method GET] [--data '{}']" >&2
                echo "  bash auth.sh logout" >&2
                exit 1
            fi
            ;;
    esac
}

main "$@"
