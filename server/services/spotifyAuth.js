import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';

/**
 * Centralized Spotify auth: tries multiple strategies in order and returns a
 * Bearer access token that can be used against spclient.wg.spotify.com (and
 * canvaz-cache endpoints).
 *
 * Strategies tried in order:
 *  1. OAuth Refresh Token (accounts.spotify.com) — works from ANY IP, including
 *     datacenters (Render, Vercel, AWS). Recommended for production.
 *  2. sp_dc cookie exchange via open.spotify.com — requires a RESIDENTIAL IP
 *     (Fastly blocks datacenter IPs with "Error 54113 URL Blocked").
 *     Falls back to HTTPS_PROXY if defined.
 *  3. Client token (clienttoken.spotify.com) — works from any IP but is NOT
 *     sufficient for canvaz-cache on its own (401 "Missing access token").
 *     Kept for future-proofing / non-canvas endpoints.
 */

let cachedAccessToken = null;
let cachedAccessTokenExpires = 0;
let cachedClientToken = null;
let cachedClientTokenExpires = 0;

function getAgent() {
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  return proxy ? new HttpsProxyAgent(proxy) : undefined;
}

function fetchOptions(extra = {}) {
  const agent = getAgent();
  return {
    ...extra,
    ...(agent ? { agent } : {}),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      ...(extra.headers || {})
    }
  };
}

/* -----------------------------------------------------------
 * Strategy 1 — OAuth Refresh Token (works in datacenters)
 * --------------------------------------------------------- */
async function getTokenViaRefreshToken() {
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const refreshToken = process.env.SPOTIFY_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  const res = await fetch('https://accounts.spotify.com/api/token', fetchOptions({
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
  }));

  if (!res.ok) return null;
  const data = await res.json();
  if (!data.access_token) return null;

  cachedAccessToken = data.access_token;
  cachedAccessTokenExpires = Date.now() + (data.expires_in || 3600) * 1000;
  return data.access_token;
}

/* -----------------------------------------------------------
 * Strategy 2 — sp_dc cookie (requires residential IP or proxy)
 * --------------------------------------------------------- */
async function getTokenViaSpDc() {
  const spDc = process.env.SPOTIFY_SP_DC;
  if (!spDc) return null;

  try {
    const res = await fetch(
      'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
      fetchOptions({
        headers: {
          'Accept': 'application/json',
          'Cookie': `sp_dc=${spDc}`,
          'Referer': 'https://open.spotify.com/'
        }
      })
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (data.accessToken) {
      cachedAccessToken = data.accessToken;
      cachedAccessTokenExpires = data.accessTokenExpirationTimestampMs || (Date.now() + 3500 * 1000);
      return data.accessToken;
    }
  } catch (_) { /* fall through */ }
  return null;
}

/* -----------------------------------------------------------
 * Client token (companion header, sometimes required)
 * --------------------------------------------------------- */
async function getClientToken() {
  if (cachedClientToken && Date.now() < cachedClientTokenExpires - 60_000) {
    return cachedClientToken;
  }

  const deviceId = generateDeviceId();
  const res = await fetch('https://clienttoken.spotify.com/v1/clienttoken', fetchOptions({
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_data: {
        client_version: '1.2.46.25.g7f169678',
        client_id: 'd8a5ed958d274c2e8ee717e6a4b0971d',
        js_sdk_data: {
          device_brand: 'unknown', device_model: 'unknown',
          os: 'windows', os_version: '10.0',
          device_id: deviceId,
          device_type: 'computer'
        }
      }
    })
  }));

  if (!res.ok) return null;
  const data = await res.json();
  const token = data?.granted_token?.token;
  const expires = (data?.granted_token?.expires_after_seconds || 3600) * 1000;
  if (!token) return null;
  cachedClientToken = token;
  cachedClientTokenExpires = Date.now() + expires;
  return token;
}

function generateDeviceId() {
  const hex = '0123456789abcdef';
  let id = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) id += '-';
    else if (i === 14) id += '4';
    else if (i === 19) id += hex[(Math.floor(Math.random() * 4) + 8)];
    else id += hex[Math.floor(Math.random() * 16)];
  }
  return id;
}

/* -----------------------------------------------------------
 * Public API
 * --------------------------------------------------------- */
export async function getAccessToken({ forceRefresh = false } = {}) {
  if (!forceRefresh && cachedAccessToken && Date.now() < cachedAccessTokenExpires - 60_000) {
    return cachedAccessToken;
  }
  // Try strategies in priority order
  const token = await getTokenViaRefreshToken() || await getTokenViaSpDc();
  if (token) return token;
  throw new Error('NO_VALID_ACCESS_TOKEN');
}

export { getClientToken, getTokenViaRefreshToken, getTokenViaSpDc };
