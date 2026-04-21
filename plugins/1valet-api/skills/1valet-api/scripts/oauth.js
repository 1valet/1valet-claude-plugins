#!/usr/bin/env node
/*
 * 1VALET Public API — OAuth2 Authorization Code + PKCE helper.
 *
 * Usage:
 *   node oauth.js            Print a valid access token to stdout (uses cache / refresh / browser flow).
 *   node oauth.js --force    Ignore cached access token, force a new auth (refresh token still honored).
 *   node oauth.js --logout   Delete the token cache and exit.
 *
 * Runtime: Node >= 14. Uses ONLY Node built-ins — no npm dependencies. The plugin ships as-is.
 */

'use strict';

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL, URLSearchParams } = require('url');

const AUTHORITY = 'https://id.1valetbas.com';
const AUTHORIZE_URL = `${AUTHORITY}/connect/authorize`;
const TOKEN_URL = `${AUTHORITY}/connect/token`;
const CLIENT_ID = 'ClaudePluginUserDelegated';
const SCOPES = [
    'openid',
    'profile',
    'offline_access',
    'role',
    'public_api.user.portfolio_manager.read',
    'public_api.user.common_data.read',
].join(' ');

// IDS (Duende 7.4.3) does not accept wildcard ports on RedirectUris, so
// the ClaudePluginUserDelegated client registers a fixed range of loopback
// redirect URIs. The plugin must bind one of these ports.
const REDIRECT_PORT_START = 51000;
const REDIRECT_PORT_END = 51010;

const CACHE_DIR = path.join(os.homedir(), '.config', '1valet-plugin');
const CACHE_FILE = path.join(CACHE_DIR, 'tokens.json');
const EXPIRY_BUFFER_SECONDS = 60;
const BROWSER_TIMEOUT_MS = 5 * 60 * 1000;

function logErr(msg) {
    process.stderr.write(`${msg}\n`);
}

function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function ensureCacheDir() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    } else {
        try {
            fs.chmodSync(CACHE_DIR, 0o700);
        } catch (_) {
            // chmod is a no-op on Windows; ignore.
        }
    }
}

function readCache() {
    try {
        if (!fs.existsSync(CACHE_FILE)) return null;
        const raw = fs.readFileSync(CACHE_FILE, 'utf8');
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return data;
    } catch (_) {
        return null;
    }
}

function writeCache(tokens) {
    ensureCacheDir();
    const payload = JSON.stringify(tokens, null, 2);
    // Write then chmod; on Windows chmod is a no-op but write still succeeds.
    fs.writeFileSync(CACHE_FILE, payload, { mode: 0o600 });
    try {
        fs.chmodSync(CACHE_FILE, 0o600);
    } catch (_) {
        /* Windows */
    }
}

function deleteCache() {
    try {
        if (fs.existsSync(CACHE_FILE)) fs.unlinkSync(CACHE_FILE);
    } catch (err) {
        logErr(`Warning: failed to delete token cache: ${err.message}`);
    }
}

function nowSeconds() {
    return Math.floor(Date.now() / 1000);
}

function accessTokenStillValid(cache) {
    if (!cache || !cache.access_token || !cache.expires_at) return false;
    return cache.expires_at - EXPIRY_BUFFER_SECONDS > nowSeconds();
}

function postForm(url, form) {
    return new Promise((resolve, reject) => {
        const body = new URLSearchParams(form).toString();
        const parsed = new URL(url);
        const options = {
            method: 'POST',
            hostname: parsed.hostname,
            port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
            path: `${parsed.pathname}${parsed.search}`,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
                Accept: 'application/json',
            },
        };
        const lib = parsed.protocol === 'https:' ? https : http;
        const req = lib.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsedBody;
                try {
                    parsedBody = text ? JSON.parse(text) : {};
                } catch (_) {
                    parsedBody = { raw: text };
                }
                resolve({ statusCode: res.statusCode || 0, body: parsedBody });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function storeTokens(tokenResponse, fallbackRefresh) {
    const expiresIn = Number(tokenResponse.expires_in) || 3600;
    const tokens = {
        access_token: tokenResponse.access_token,
        refresh_token: tokenResponse.refresh_token || fallbackRefresh || null,
        expires_at: nowSeconds() + expiresIn,
        token_type: tokenResponse.token_type || 'Bearer',
        scope: tokenResponse.scope || SCOPES,
    };
    writeCache(tokens);
    return tokens;
}

async function refreshAccessToken(refreshToken) {
    const { statusCode, body } = await postForm(TOKEN_URL, {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: CLIENT_ID,
    });
    if (statusCode < 200 || statusCode >= 300 || !body.access_token) {
        const errMsg = body && (body.error_description || body.error) ? `: ${body.error_description || body.error}` : '';
        throw new Error(`Refresh token exchange failed (HTTP ${statusCode})${errMsg}`);
    }
    return storeTokens(body, refreshToken);
}

function openBrowser(url) {
    let cmd;
    let args;
    const platform = process.platform;
    if (platform === 'win32') {
        // `start` is a cmd.exe builtin. The empty "" is the window title placeholder.
        cmd = 'cmd.exe';
        args = ['/c', 'start', '""', url];
    } else if (platform === 'darwin') {
        cmd = 'open';
        args = [url];
    } else {
        cmd = 'xdg-open';
        args = [url];
    }
    try {
        const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
        child.on('error', (err) => {
            logErr(`Warning: failed to open browser automatically: ${err.message}`);
            logErr(`Open this URL manually:\n${url}`);
        });
        child.unref();
    } catch (err) {
        logErr(`Warning: failed to spawn browser: ${err.message}`);
        logErr(`Open this URL manually:\n${url}`);
    }
}

function successPage() {
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Sign-in complete</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1b1b1b;padding:2rem 3rem;border-radius:8px;border:1px solid #333;max-width:28rem;text-align:center}.card h1{margin:0 0 0.5rem;font-size:1.25rem}.card p{margin:0;color:#aaa}</style>
</head>
<body><div class="card"><h1>Signed in to 1VALET</h1><p>You can close this tab and return to Claude.</p></div></body></html>`;
}

function errorPage(message) {
    const safe = String(message).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;padding:2rem"><h1>Sign-in failed</h1><p>${safe}</p></body></html>`;
}

async function runAuthCodeFlow() {
    const codeVerifier = base64url(crypto.randomBytes(64));
    const codeChallenge = base64url(crypto.createHash('sha256').update(codeVerifier).digest());
    const state = base64url(crypto.randomBytes(32));

    const { server, port } = await startLoopbackServer();
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorizeParams = new URLSearchParams({
        client_id: CLIENT_ID,
        response_type: 'code',
        scope: SCOPES,
        redirect_uri: redirectUri,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        state,
    });
    const authorizeUrl = `${AUTHORIZE_URL}?${authorizeParams.toString()}`;

    logErr(`Opening browser to sign in (port ${port})...`);
    logErr(`If the browser does not open, visit:\n${authorizeUrl}`);
    openBrowser(authorizeUrl);

    let code;
    try {
        code = await awaitCallback(server, state);
    } finally {
        // awaitCallback closes the server; this is belt-and-suspenders.
        try { server.close(); } catch (_) { /* already closed */ }
    }

    const { statusCode, body } = await postForm(TOKEN_URL, {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: CLIENT_ID,
        code_verifier: codeVerifier,
    });
    if (statusCode < 200 || statusCode >= 300 || !body.access_token) {
        const errMsg = body && (body.error_description || body.error) ? `: ${body.error_description || body.error}` : '';
        throw new Error(`Token exchange failed (HTTP ${statusCode})${errMsg}`);
    }
    return storeTokens(body);
}

function tryListen(port) {
    return new Promise((resolve) => {
        const server = http.createServer();
        const onError = (err) => {
            server.removeListener('listening', onListening);
            resolve({ server: null, port: null, error: err });
        };
        const onListening = () => {
            server.removeListener('error', onError);
            resolve({ server, port: server.address().port, error: null });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, '127.0.0.1');
    });
}

function buildCandidatePorts() {
    // IDS registers a fixed range of RedirectUris (http://127.0.0.1:51000..51010/callback).
    // Any port outside that range makes IDS return invalid_redirect_uri, so we must bind
    // within it. If ONEVALET_OAUTH_PORT is set, try it first; if it's outside the range,
    // fail fast rather than silently ignoring it.
    const raw = process.env.ONEVALET_OAUTH_PORT;
    const candidates = [];
    if (raw !== undefined && raw !== '') {
        const preferred = Number.parseInt(raw, 10);
        if (!Number.isInteger(preferred) || preferred < REDIRECT_PORT_START || preferred > REDIRECT_PORT_END) {
            throw new Error(
                `ONEVALET_OAUTH_PORT=${raw} is outside the registered range ${REDIRECT_PORT_START}-${REDIRECT_PORT_END}. ` +
                    `Re-register the port on the IDS client or pick a value in range.`
            );
        }
        candidates.push(preferred);
    }
    for (let port = REDIRECT_PORT_START; port <= REDIRECT_PORT_END; port++) {
        if (!candidates.includes(port)) candidates.push(port);
    }
    return candidates;
}

async function startLoopbackServer() {
    const candidates = buildCandidatePorts();
    const failures = [];
    for (const port of candidates) {
        const result = await tryListen(port);
        if (result.server) {
            return { server: result.server, port: result.port };
        }
        failures.push(`${port}: ${result.error && result.error.code ? result.error.code : 'unknown'}`);
    }
    throw new Error(
        `All loopback ports ${REDIRECT_PORT_START}-${REDIRECT_PORT_END} are in use. ` +
            `Close the other app using one of them, or set ONEVALET_OAUTH_PORT to a specific free port in that range. ` +
            `Details: ${failures.join(', ')}`
    );
}

function awaitCallback(server, expectedState) {
    return new Promise((resolve, reject) => {
        let finished = false;
        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            try { server.close(); } catch (_) { /* ignore */ }
            reject(new Error(`Timed out waiting for browser callback after ${BROWSER_TIMEOUT_MS / 1000}s.`));
        }, BROWSER_TIMEOUT_MS);

        server.on('request', (req, res) => {
            let reqUrl;
            try {
                reqUrl = new URL(req.url, 'http://127.0.0.1');
            } catch (_) {
                res.writeHead(400, { 'Content-Type': 'text/plain' });
                res.end('Bad request');
                return;
            }
            if (reqUrl.pathname !== '/callback') {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end('Not found');
                return;
            }
            const params = reqUrl.searchParams;
            const error = params.get('error');
            const code = params.get('code');
            const state = params.get('state');

            const finishWith = (err, successCode) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                setImmediate(() => {
                    server.close(() => {
                        if (err) reject(err);
                        else resolve(successCode);
                    });
                });
            };

            if (error) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(errorPage(`IDS returned error: ${error}`));
                finishWith(new Error(`Authorization error: ${error}`));
                return;
            }
            if (!code || !state) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(errorPage('Missing code or state in callback.'));
                finishWith(new Error('Missing code or state in callback.'));
                return;
            }
            if (state !== expectedState) {
                res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(errorPage('State mismatch — possible CSRF. Abort.'));
                finishWith(new Error('State mismatch in callback.'));
                return;
            }

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(successPage());
            finishWith(null, code);
        });
    });
}

function parseArgs(argv) {
    const flags = { force: false, logout: false };
    for (const arg of argv.slice(2)) {
        if (arg === '--force') flags.force = true;
        else if (arg === '--logout') flags.logout = true;
        else if (arg === '--help' || arg === '-h') flags.help = true;
        else {
            logErr(`Unknown argument: ${arg}`);
            process.exit(2);
        }
    }
    return flags;
}

function printHelp() {
    process.stdout.write(
        `1VALET OAuth2 (Auth Code + PKCE) helper\n` +
            `\n` +
            `Usage:\n` +
            `  node oauth.js            Print a valid access token (uses cache/refresh/browser flow).\n` +
            `  node oauth.js --force    Ignore cached access token; re-auth (refresh still used if present).\n` +
            `  node oauth.js --logout   Delete the token cache and exit.\n`
    );
}

async function main() {
    const flags = parseArgs(process.argv);

    if (flags.help) {
        printHelp();
        return;
    }

    if (flags.logout) {
        deleteCache();
        logErr('Token cache cleared.');
        return;
    }

    const cache = readCache();

    if (!flags.force && accessTokenStillValid(cache)) {
        process.stdout.write(cache.access_token);
        return;
    }

    if (cache && cache.refresh_token) {
        try {
            const tokens = await refreshAccessToken(cache.refresh_token);
            process.stdout.write(tokens.access_token);
            return;
        } catch (err) {
            logErr(`Refresh failed, falling back to browser sign-in: ${err.message}`);
            // Invalidate stale refresh token so we don't loop.
            deleteCache();
        }
    }

    const tokens = await runAuthCodeFlow();
    process.stdout.write(tokens.access_token);
}

main().catch((err) => {
    logErr(`Error: ${err.message}`);
    process.exit(1);
});
