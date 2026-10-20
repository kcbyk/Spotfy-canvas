import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import canvasRouter from './routes/canvas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Handle unhandled errors so Render sees us alive
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// --- Security & middlewares ---
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Video/CDN CSP
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "media-src 'self' blob: data: *.scdn.co *.spotifycdn.com *.spotify.com",
      "img-src 'self' data: blob: *.scdn.co *.spotifycdn.com i.scdn.co",
      "connect-src 'self'",
      "frame-src 'self' www.youtube.com youtube.com www.youtube-nocookie.com",
      "script-src 'self' www.youtube.com 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' data: fonts.gstatic.com"
    ].join('; ')
  );
  next();
});

app.use(cors({ origin: true, methods: ['GET', 'POST'] }));
app.use(express.json({ limit: '10kb' }));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate-limit
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests.' }
});

// --- API key auth ---
// Pass via header `X-API-Key: <key>` or query `?api_key=<key>`.
// If API_KEY env var is NOT set, auth is disabled (public access, for local dev).
// If set, ALL /api/* requests require it — except /api/health.
const API_KEY = process.env.API_KEY || null;
function requireApiKey(req, res, next) {
  if (!API_KEY) return next();
  // Browser-based frontend (no key header + HTML referer) still works for the UI
  const ref = req.get('referer') || req.get('origin') || '';
  const acceptsHtml = (req.get('accept') || '').includes('text/html');
  const fromOwnUi = acceptsHtml && (ref.includes(req.get('host') || '') || ref === '');
  const key = req.get('x-api-key') || req.query.api_key || '';
  if (key === API_KEY || fromOwnUi) {
    if (key === API_KEY) res.setHeader('X-Api-Key-Status', 'authenticated');
    return next();
  }
  res.setHeader('WWW-Authenticate', 'ApiKey realm="spotify-canvas"');
  return res.status(401).json({
    error: 'UNAUTHORIZED',
    message: 'Geçerli bir API key gerekli. Header\'da X-API-Key: <key> veya query\'de ?api_key=<key> olarak gönder.'
  });
}

// --- Routes ---
app.get('/api/health', (_req, res) => {
  res.set({ 'Cache-Control': 'no-store' });
  res.status(200).json({
    status: 'ok',
    service: 'spotify-canvas-static',
    mode: 'static-cdn-mapping',
    database: 'server/data/canvas-database.json',
    auth: API_KEY ? 'required' : 'disabled',
    timestamp: new Date().toISOString()
  });
});

app.use('/api/canvas', apiLimiter, requireApiKey, canvasRouter);

// Serve static frontend
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Spotify Canvas API (static CDN mode) running on port ${PORT}`);
  console.log(`   Health:        GET /api/health`);
  console.log(`   Canvas:        GET /api/canvas/:trackId`);
  console.log(`   Track catalog: GET /api/canvas/tracks`);
  console.log(`   Frontend:      GET /`);
  console.log(`   Mode:          static JSON database (no Spotify network calls)\n`);
});

export default app;
