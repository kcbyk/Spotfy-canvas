import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, '..', 'data', 'canvas-database.json');
const META_PATH = path.join(__dirname, '..', 'data', 'track-meta.json');

// Synchronously load databases once at boot + watch for file changes (admin updates)
let canvasDb = {};
let metaDb = {};

function loadDb() {
  try {
    canvasDb = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch (e) {
    console.error('[canvas-db] Failed to load canvas-database.json:', e.message);
    canvasDb = {};
  }
  try {
    metaDb = JSON.parse(fs.readFileSync(META_PATH, 'utf8'));
  } catch (e) {
    metaDb = {};
  }
}
loadDb();

// Hot-reload in dev (when you edit the JSON)
fs.watchFile(DB_PATH, { interval: 1000 }, loadDb);
fs.watchFile(META_PATH, { interval: 1000 }, loadDb);

const TRACK_ID_RE = /^[0-9A-Za-z]{22}$/;

/**
 * GET /api/canvas/:trackId
 * Static CDN-mapped endpoint — no external Spotify calls.
 *
 * Success (track in database):
 *   { success: true, canvasUrl: "<mp4>", meta: { title, artist, cover, ytQuery } }
 * Not found (track not in database):
 *   { success: false, canvasUrl: null, fallbackToYoutube: true }
 * Invalid id:
 *   HTTP 400
 */
router.get('/tracks', (_req, res) => {
  // Return list of all tracks available (for catalog picker)
  const tracks = Object.entries(metaDb).map(([id, m]) => ({
    id,
    title: m.title,
    artist: m.artist,
    cover: m.cover || null,
    hasCanvas: Boolean(canvasDb[id])
  }));
  res.json({ total: tracks.length, tracks });
});

router.get('/:trackId', (req, res) => {
  const { trackId } = req.params;

  if (!TRACK_ID_RE.test(trackId)) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_TRACK_ID',
      message: 'Track ID must be a 22-character alphanumeric Spotify track ID.'
    });
  }

  const canvasUrl = canvasDb[trackId] || null;
  const meta = metaDb[trackId] || null;

  if (canvasUrl) {
    return res.json({
      success: true,
      trackId,
      trackUri: `spotify:track:${trackId}`,
      canvasUrl,
      fallbackToYoutube: false,
      meta
    });
  }

  return res.json({
    success: false,
    trackId,
    trackUri: `spotify:track:${trackId}`,
    canvasUrl: null,
    fallbackToYoutube: true,
    meta,
    reason: meta ? 'NO_CANVAS_AVAILABLE' : 'TRACK_NOT_IN_DATABASE'
  });
});

// Admin helper: POST /api/canvas/:trackId { canvasUrl } to add a new entry to the JSON
router.post('/:trackId', express_json_middleware(), (req, res) => {
  const { trackId } = req.params;
  const { canvasUrl, title, artist, cover, ytQuery } = req.body || {};

  if (!TRACK_ID_RE.test(trackId)) {
    return res.status(400).json({ success: false, error: 'INVALID_TRACK_ID' });
  }
  if (canvasUrl && typeof canvasUrl !== 'string') {
    return res.status(400).json({ success: false, error: 'INVALID_URL' });
  }

  if (canvasUrl) {
    canvasDb[trackId] = canvasUrl;
  } else {
    delete canvasDb[trackId];
  }

  if (title || artist || cover || ytQuery) {
    metaDb[trackId] = {
      ...(metaDb[trackId] || {}),
      ...(title && { title }),
      ...(artist && { artist }),
      ...(cover && { cover }),
      ...(ytQuery && { ytQuery })
    };
  } else if (!canvasUrl) {
    delete metaDb[trackId];
  }

  fs.writeFileSync(DB_PATH, JSON.stringify(canvasDb, null, 2) + '\n');
  fs.writeFileSync(META_PATH, JSON.stringify(metaDb, null, 2) + '\n');

  res.json({ success: true, trackId, canvasUrl: canvasUrl || null });
});

// Small helper to avoid circular imports with express.json() (we import router before app)
function express_json_middleware() {
  return (req, res, next) => {
    // Rely on app-level express.json(), but if not there, parse manually
    if (req.body) return next();
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { req.body = JSON.parse(data || '{}'); } catch { req.body = {}; }
      next();
    });
  };
}

export default router;
