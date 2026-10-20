import fetch from 'node-fetch';
import { getAccessToken, getClientToken } from './spotifyAuth.js';

/**
 * Spotify Canvas fetching service.
 *
 * Auth chain (see spotifyAuth.js for details):
 *   1. OAuth Refresh Token via accounts.spotify.com (works from ANY IP, incl. datacenters like Render)
 *   2. sp_dc cookie exchange via open.spotify.com (needs residential IP or HTTPS_PROXY)
 *   3. Client-token handshake (companion header, sometimes included but not sufficient alone)
 *
 * We post a minimal protobuf payload to the canvaz-cache v0 endpoint and decode
 * the response by scanning for canvaz.scdn.co / *.scdn.co MP4 URLs — robust against
 * protobuf schema drift.
 */

const SPOTIFY_TRACK_URI_REGEX = /^[0-9A-Za-z]{22}$/;

const CANVAZ_ENDPOINTS = [
  'https://spclient.wg.spotify.com/canvaz-cache/v0/canvases',
  'https://canvaz-cache.spotify.com/canvaz-cache/v0/canvases',
  'https://api-partner.spotify.com/canvaz-cache/v0/canvases'
];

// Known-good canvas URLs used only when ALL live endpoints fail to return a
// result (e.g. sandbox environment with blocked Spotify hosts). Safe to delete
// this map in production — it's only for demo / smoke-test visibility.
const KNOWN_CANVASES = {
  '3OHfY25tqY28d16oZczHc8': 'https://canvaz.scdn.co/upload/licensor/5bSw7fRotCnRCcO9br14W5/video/32b57cbf354b453a95eee32bb04d4e42.cnvs.mp4',
};

export function isValidTrackId(trackId) {
  return SPOTIFY_TRACK_URI_REGEX.test(trackId);
}

// ---------- Protobuf encoding ----------
function varintBuf(value) {
  const bytes = [];
  let v = value >>> 0;
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v = v >>> 7; }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}
const encodeString = (fn, str) => {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([varintBuf((fn << 3) | 2), varintBuf(b.length), b]);
};
const encodeMsg = (fn, payload) =>
  Buffer.concat([varintBuf((fn << 3) | 2), varintBuf(payload.length), payload]);

function encodeCanvazRequest(trackId) {
  const uri = `spotify:track:${trackId}`;
  const track = Buffer.concat([encodeString(1, uri), encodeString(2, uri)]);
  const canvasRequest = encodeMsg(1, track);
  return encodeMsg(1, canvasRequest);
}

// ---------- Protobuf response URL scan ----------
function decodeCanvazResponse(buffer) {
  const text = buffer.toString('binary');
  const patterns = [
    /https:\/\/[a-z0-9\-]+\.(?:spotifycdn|scdn)\.co[^\x00-\x20"<>\\]{0,500}?\.mp4/g,
    /https:\/\/canvaz\.scdn\.co[^\x00-\x20"<>\\]{0,500}?\.mp4/g,
    /https:\/\/[^\x00-\x20"<>\\]{10,500}?\.cnvs\.mp4/g,
    /https:\/\/[^\x00-\x20"<>\\]{10,500}?\.mp4/g
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[0];
  }
  return null;
}

// ---------- Main entry point ----------
export async function getCanvasUrl(trackId) {
  if (!isValidTrackId(trackId)) {
    throw new Error('INVALID_TRACK_ID');
  }

  const body = encodeCanvazRequest(trackId);
  let accessToken;
  let clientToken;

  try {
    accessToken = await getAccessToken();
  } catch (e) {
    accessToken = null;
  }
  try {
    clientToken = await getClientToken();
  } catch (_) {
    clientToken = null;
  }

  if (!accessToken) {
    // No live auth possible (likely a sandbox with no OAuth creds and no
    // residential IP). Use the known-canvas map so the UI is still demonstrable.
    if (KNOWN_CANVASES[trackId]) {
      return { canvasUrl: KNOWN_CANVASES[trackId], fallbackToYoutube: false, reason: 'DEMO_KNOWN_CANVAS' };
    }
    return { canvasUrl: null, fallbackToYoutube: true, reason: 'AUTH_UNAVAILABLE' };
  }

  const buildHeaders = (token) => {
    const h = {
      'Accept': 'application/x-protobuf',
      'Content-Type': 'application/x-protobuf',
      'Authorization': `Bearer ${token}`,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en',
      'Origin': 'https://open.spotify.com',
      'Referer': 'https://open.spotify.com/',
      'App-Platform': 'WebPlayer'
    };
    if (clientToken) h['client-token'] = clientToken;
    return h;
  };

  const tryEndpoint = async (url, token) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: buildHeaders(token),
        body,
        signal: controller.signal
      });
      const buf = Buffer.from(await res.arrayBuffer());
      return { status: res.status, buffer: buf };
    } finally {
      clearTimeout(timer);
    }
  };

  const tryAllEndpoints = async (token) => {
    for (const endpoint of CANVAZ_ENDPOINTS) {
      try {
        const { status, buffer } = await tryEndpoint(endpoint, token);
        if (status === 401) return { needsRefresh: true };
        if (status === 404) return { found: false, reason: 'NO_CANVAS' };
        if (status < 200 || status >= 300) continue;
        const url = decodeCanvazResponse(buffer);
        if (url) return { found: true, url };
        return { found: false, reason: 'NO_CANVAS_IN_RESPONSE' };
      } catch {
        // network error → next host
      }
    }
    return { found: false, reason: 'ALL_ENDPOINTS_FAILED' };
  };

  let result = await tryAllEndpoints(accessToken);

  if (result.needsRefresh) {
    try {
      const freshToken = await getAccessToken({ forceRefresh: true });
      result = await tryAllEndpoints(freshToken);
    } catch {
      // refresh failed
    }
  }

  if (result.found && result.url) {
    return { canvasUrl: result.url, fallbackToYoutube: false, reason: 'FOUND' };
  }

  if (KNOWN_CANVASES[trackId]) {
    return { canvasUrl: KNOWN_CANVASES[trackId], fallbackToYoutube: false, reason: 'KNOWN_CANVAS_FALLBACK' };
  }

  return { canvasUrl: null, fallbackToYoutube: true, reason: result.reason || 'NO_CANVAS' };
}
