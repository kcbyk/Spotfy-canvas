#!/usr/bin/env node
/**
 * ============================================================================
 *  BULK CANVAS SCRAPER
 *  Lokalde çaliştirarak Spotify çalma listelerindeki tüm şarkıların orijinal
 *  Canvas (.mp4) videolarını ve meta verilerini toplar, canvas-database.json
 *  ve track-meta.json dosyalarına anlık olarak yazar.
 *
 *  GEREKSİNİMLER:
 *    - Lokal bilgisayarda çalışmalı (residential IP → WAF engeli olmaz)
 *    - .env dosyasında SPOTIFY_SP_DC tanımlı olmalı
 *      (open.spotify.com'da oturum aç → DevTools → Cookies → sp_dc)
 *
 *  ÇALIŞTIRMA:
 *    node scripts/bulk-canvas-scraper.mjs
 *    node scripts/bulk-canvas-scraper.mjs https://open.spotify.com/playlist/37i9dQZEVXbMDoHDwVN2tF
 *    SPOTIFY_SP_DC=xxxxxx node scripts/bulk-canvas-scraper.mjs
 * ============================================================================
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fetch from 'node-fetch';

// ---------- Paths ----------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'server', 'data', 'canvas-database.json');
const META_PATH = path.join(ROOT, 'server', 'data', 'track-meta.json');

// ---------- Config ----------
const SP_DC = process.env.SPOTIFY_SP_DC;
const DELAY_MIN = 500;   // ms
const DELAY_MAX = 1000;  // ms
const CONCURRENCY = 1;   // Paralel istek sayısı (1 = seri, güvenli)

// Default playlistler: Top 50 Global, Top 50 Turkey, Viral 50 Global, Today's Top Hits, Pop Rising
const DEFAULT_PLAYLISTS = [
  '37i9dQZEVXbMDoHDwVN2tF', // Top 50 Global
  '37i9dQZEVXbIVYVBNw9D5K', // Top 50 Turkey
  '37i9dQZEVXbLiRSasKsNU9', // Viral 50 Global
  '37i9dQZF1DXcBWIGoYBM5M', // Today's Top Hits
  '37i9dQZF1DWUa8ZRTfalHk', // Pop Rising
];

// ---------- ANSI renkler ----------
const C = {
  reset:  '\x1b[0m',
  dim:    '\x1b[2m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  blue:   '\x1b[34m',
  cyan:   '\x1b[36m',
  mag:    '\x1b[35m',
  gray:   '\x1b[90m',
};
const log = {
  info:  (m)    => console.log(`${C.blue}[INFO]${C.reset}    ${m}`),
  ok:    (m)    => console.log(`${C.green}[SUCCESS]${C.reset} ${m}`),
  skip:  (m)    => console.log(`${C.gray}[SKIP]${C.reset}     ${m}`),
  no:    (m)    => console.log(`${C.yellow}[NO_CANVAS]${C.reset} ${m}`),
  warn:  (m)    => console.log(`${C.yellow}[WARN]${C.reset}    ${m}`),
  err:   (m)    => console.log(`${C.red}[ERROR]${C.reset}   ${m}`),
  prog:  (m)    => console.log(`${C.mag}[PROGRESS]${C.reset} ${m}`),
  head:  (m)    => console.log(`\n${C.bold}${C.cyan}${m}${C.reset}\n${'─'.repeat(60)}`),
};

// ---------- Utilities ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const randDelay = () => DELAY_MIN + Math.random() * (DELAY_MAX - DELAY_MIN);
const extractId = (input) => {
  if (!input) return null;
  // Accept full URLs or plain IDs
  const m = input.match(/([a-zA-Z0-9]{22})/);
  return m ? m[1] : null;
};
function truncate(s, n = 45) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---------- Database I/O ----------
function loadDb() {
  let db = {}, meta = {};
  try { db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch { db = {}; }
  try { meta = JSON.parse(fs.readFileSync(META_PATH, 'utf8')); } catch { meta = {}; }
  return { db, meta };
}
function saveDbAtomically(db, meta) {
  // Atomic write: write to .tmp then rename (prevents corruption on crash)
  fs.writeFileSync(DB_PATH + '.tmp', JSON.stringify(db, null, 2) + '\n');
  fs.writeFileSync(META_PATH + '.tmp', JSON.stringify(meta, null, 2) + '\n');
  fs.renameSync(DB_PATH + '.tmp', DB_PATH);
  fs.renameSync(META_PATH + '.tmp', META_PATH);
}

// ---------- Spotify auth ----------
let accessToken = null;
let clientToken = null;
let tokenExpires = 0;

async function getAccessToken() {
  if (accessToken && Date.now() < tokenExpires - 60_000) return accessToken;
  if (!SP_DC) throw new Error('SPOTIFY_SP_DC env variable gerekli. .env dosyasina ekle.');

  const res = await fetch(
    'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
    {
      headers: {
        'Cookie': `sp_dc=${SP_DC}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    }
  );
  if (!res.ok) throw new Error(`get_access_token failed: HTTP ${res.status} (IP bloke olabilir mi?)`);
  const data = await res.json();
  if (!data.accessToken) throw new Error('accessToken yok: ' + JSON.stringify(data));
  accessToken = data.accessToken;
  tokenExpires = data.accessTokenExpirationTimestampMs || (Date.now() + 3500 * 1000);
  return accessToken;
}

async function getClientToken() {
  if (clientToken) return clientToken;
  const hex = '0123456789abcdef';
  const deviceId = Array.from({length: 36}, (_, i) =>
    [8,13,18,23].includes(i) ? '-' : i === 14 ? '4' : hex[Math.floor(Math.random() * 16)]
  ).join('');
  const res = await fetch('https://clienttoken.spotify.com/v1/clienttoken', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_data: {
        client_version: '1.2.46.25.g7f169678',
        client_id: 'd8a5ed958d274c2e8ee717e6a4b0971d',
        js_sdk_data: { device_brand: 'unknown', device_model: 'unknown', os: 'windows',
          os_version: '10.0', device_id: deviceId, device_type: 'computer' }
      }
    })
  });
  if (!res.ok) return null;
  const data = await res.json();
  clientToken = data?.granted_token?.token || null;
  return clientToken;
}

// ---------- Protobuf enc/dec ----------
function v(n) { const b=[]; let x=n>>>0; while(x>0x7f){b.push((x&0x7f)|0x80);x>>>=7;} b.push(x&0x7f); return Buffer.from(b); }
const encStr = (f, s) => { const b=Buffer.from(s,'utf8'); return Buffer.concat([v((f<<3)|2),v(b.length),b]); };
const encMsg = (f, p) => Buffer.concat([v((f<<3)|2),v(p.length),p]);
function encodeCanvasRequest(trackId) {
  const uri = `spotify:track:${trackId}`;
  return encMsg(1, encMsg(1, Buffer.concat([encStr(1, uri), encStr(2, uri)])));
}
function decodeCanvasUrl(buf) {
  const text = buf.toString('binary');
  const patterns = [
    /https:\/\/canvaz\.scdn\.co[^\x00-\x20"<>\\]{0,500}?\.cnvs\.mp4/g,
    /https:\/\/[a-z0-9\-.]+\.(?:scdn|spotifycdn)\.co[^\x00-\x20"<>\\]{0,500}?\.mp4/g
  ];
  for (const p of patterns) { const m = p.exec(text); if (m) return m[0]; }
  return null;
}

// ---------- Spotify API calls ----------
async function spotifyFetch(url, opts = {}) {
  const token = await getAccessToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en',
    'App-Platform': 'WebPlayer',
    ...(opts.headers || {})
  };
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 429) {
    const retryAfter = parseInt(res.headers.get('retry-after') || '5', 10) * 1000;
    log.warn(`Rate limited — ${retryAfter/1000}s bekleniyor...`);
    await sleep(retryAfter);
    return spotifyFetch(url, opts);
  }
  return res;
}

async function fetchPlaylistTracks(playlistId) {
  const tracks = [];
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/tracks?limit=100&fields=items(track(id,name,artists(name),album(images(url)))),total,next`;
  let page = 0;
  while (url) {
    const res = await spotifyFetch(url);
    if (!res.ok) { log.err(`Playlist ${playlistId} yüklenemedi: HTTP ${res.status}`); break; }
    const data = await res.json();
    for (const it of (data.items || [])) {
      const t = it.track;
      if (t && t.id) {
        tracks.push({
          id: t.id,
          title: t.name,
          artist: (t.artists || []).map(a => a.name).join(', '),
          cover: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url || null,
        });
      }
    }
    page++;
    url = data.next;
    if (url) await sleep(randDelay());
  }
  return tracks;
}

async function fetchCanvasForTrack(trackId) {
  const token = await getAccessToken();
  const ct = await getClientToken();
  const body = encodeCanvasRequest(trackId);

  const endpoints = [
    'https://spclient.wg.spotify.com/canvaz-cache/v0/canvases',
    'https://canvaz-cache.spotify.com/canvaz-cache/v0/canvases',
    'https://api-partner.spotify.com/canvaz-cache/v0/canvases',
  ];

  for (const ep of endpoints) {
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 8000);
      const headers = {
        'Content-Type': 'application/x-protobuf',
        'Accept': 'application/x-protobuf',
        'Authorization': `Bearer ${token}`,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Origin': 'https://open.spotify.com',
        'Referer': 'https://open.spotify.com/',
      };
      if (ct) headers['client-token'] = ct;
      const res = await fetch(ep, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(t);
      if (res.status === 401) {
        // Refresh token and retry once
        accessToken = null;
        return fetchCanvasForTrack(trackId);
      }
      if (res.status === 404) return null;
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const url = decodeCanvasUrl(buf);
      if (url) return url;
    } catch { /* network error → next endpoint */ }
  }
  return null;
}

// ---------- Main ----------
async function main() {
  if (!SP_DC) {
    log.err('SPOTIFY_SP_DC tanımlı değil!');
    log.info('1) https://open.spotify.com adresine git ve oturum aç');
    log.info('2) DevTools → Application → Cookies → sp_dc değerini kopyala');
    log.info('3) .env dosyasına şu satırı ekle: SPOTIFY_SP_DC=degerin');
    process.exit(1);
  }

  // Playlist listesi: CLI argümanları veya default
  const args = process.argv.slice(2);
  const playlistIds = (args.length ? args : DEFAULT_PLAYLISTS).map(extractId).filter(Boolean);
  if (!playlistIds.length) { log.err('Hiç playlist ID verilmedi.'); process.exit(1); }

  log.head('🎨 BULK CANVAS SCRAPER BAŞLATILIYOR');
  log.info(`Playlist sayısı: ${playlistIds.length}`);
  log.info(`Auth kontrol ediliyor...`);
  try { await getAccessToken(); log.ok('Access token alındı'); }
  catch (e) { log.err(e.message); process.exit(1); }

  // Load existing DB
  let { db, meta } = loadDb();
  log.info(`Mevcut veritabanı: ${Object.keys(db).length} canvas, ${Object.keys(meta).length} meta girişi`);

  // 1) Collect all tracks from all playlists
  log.head('📥 AŞAMA 1 — Playlistlerden şarkılar toplanıyor');
  const allTracks = new Map(); // dedupe by id
  for (const pid of playlistIds) {
    log.info(`Playlist ${pid} çekiliyor...`);
    try {
      const tracks = await fetchPlaylistTracks(pid);
      for (const t of tracks) {
        if (!allTracks.has(t.id)) allTracks.set(t.id, t);
      }
      log.ok(`${tracks.length} şarkı yüklendi (toplam benzersiz: ${allTracks.size})`);
    } catch (e) {
      log.err(`Playlist ${pid} hatası: ${e.message}`);
    }
    await sleep(randDelay());
  }
  const tracks = Array.from(allTracks.values());
  log.info(`Toplam işlenecek benzersiz şarkı: ${tracks.length}`);

  // 2) Fetch canvas for each new track
  log.head('🔍 AŞAMA 2 — Canvas\'lar çekiliyor');
  let done = 0, added = 0, skipped = 0, noCanvas = 0, errors = 0;
  const total = tracks.length;
  const startTs = Date.now();

  for (const t of tracks) {
    done++;
    const pct = ((done / total) * 100).toFixed(0);
    const ytQuery = `${t.title} ${t.artist}`;

    if (db[t.id]) {
      skipped++;
      // Still update meta if missing
      if (!meta[t.id] || !meta[t.id].cover) {
        meta[t.id] = { title: t.title, artist: t.artist, cover: t.cover, ytQuery };
      }
      log.skip(`${truncate(t.title)} — ${truncate(t.artist)}`);
      await sleep(100); // micro delay to avoid tight loop
      continue;
    }

    try {
      const canvasUrl = await fetchCanvasForTrack(t.id);
      if (canvasUrl) {
        db[t.id] = canvasUrl;
        meta[t.id] = { title: t.title, artist: t.artist, cover: t.cover, ytQuery };
        added++;
        log.ok(`${truncate(t.title)} — ${truncate(t.artist)}`);
        // Save immediately on each success so progress never lost
        saveDbAtomically(db, meta);
      } else {
        noCanvas++;
        meta[t.id] = { title: t.title, artist: t.artist, cover: t.cover, ytQuery };
        log.no(`${truncate(t.title)} — ${truncate(t.artist)}`);
        saveDbAtomically(db, meta);
      }
    } catch (e) {
      errors++;
      log.err(`${truncate(t.title)}: ${e.message}`);
    }

    if (done % 10 === 0 || done === total) {
      const elapsed = ((Date.now() - startTs) / 1000).toFixed(0);
      const remaining = done > 0 ? Math.round(elapsed * (total - done) / done) : 0;
      log.prog(`${done}/${total} tamamlandı (%${pct}) · +${added} canvas · ${noCanvas} boş · ${skipped} skip · ${errors} hata · ${elapsed}s geçti · ~${remaining}s kaldı`);
    }

    await sleep(randDelay());
  }

  // Final save
  saveDbAtomically(db, meta);

  log.head('✅ TAMAMLANDI');
  log.ok(`Toplam taranan:    ${total}`);
  log.ok(`Yeni bulunan:      ${added} canvas`);
  log.ok(`Canvas'ı olmayan:  ${noCanvas}`);
  log.ok(`Zaten kayıtlı:     ${skipped}`);
  log.ok(`Hata:              ${errors}`);
  log.info(`Veritabanı:  ${Object.keys(db).length} canvas → ${DB_PATH}`);
  log.info(`Meta verisi: ${Object.keys(meta).length} şarkı → ${META_PATH}`);
}

main().catch(e => { console.error(C.red + '[FATAL]', e, C.reset); process.exit(1); });
