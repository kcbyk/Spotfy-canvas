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

// --- Security & middlewares ---
app.use(helmet({
  contentSecurityPolicy: false, // We manage CSP via a simpler custom header to avoid over-blocking on mobile
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Permissive CSP for canvas video from Spotify CDN + YouTube iframe
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "media-src 'self' blob: data: *.scdn.co *.spotifycdn.com *.spotify.com",
      "img-src 'self' data: blob: *.scdn.co *.spotifycdn.com i.scdn.co",
      "connect-src 'self' *.spotify.com accounts.spotify.com api.spotify.com canvaz-cache.spotify.com spclient.wg.spotify.com api-partner.spotify.com",
      "frame-src 'self' www.youtube.com youtube.com www.youtube-nocookie.com",
      "script-src 'self' www.youtube.com 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
      "font-src 'self' data: fonts.gstatic.com"
    ].join('; ')
  );
  next();
});

app.use(cors({
  origin: NODE_ENV === 'production' ? process.env.ALLOWED_ORIGIN?.split(',') || true : true,
  methods: ['GET'],
}));

app.use(express.json({ limit: '10kb' }));
app.use(morgan(NODE_ENV === 'production' ? 'combined' : 'dev'));

// Rate-limit the API to avoid spamming Spotify
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 req/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'RATE_LIMITED', message: 'Too many requests, please try again later.' }
});

// --- Routes ---
app.use('/api/canvas', apiLimiter, canvasRouter);

// Quick health check
app.get('/api/health', (_req, res) => {
  res.set({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.status(200).json({
    status: 'ok',
    service: 'spotify-canvas-api',
    auth: {
      oauth_refresh_token: Boolean(process.env.SPOTIFY_REFRESH_TOKEN),
      sp_dc_cookie: Boolean(process.env.SPOTIFY_SP_DC),
      https_proxy: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    },
    port: PORT,
    uptime_sec: Math.floor(process.uptime()),
    recommended_for_datacenters: 'Use SPOTIFY_CLIENT_ID + SPOTIFY_CLIENT_SECRET + SPOTIFY_REFRESH_TOKEN (accounts.spotify.com is NOT blocked).',
    timestamp: new Date().toISOString()
  });
});

// Serve static frontend (the Now Playing simulator)
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback (sends the simulator for any unknown route)
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --- Global error handler ---
app.use((err, _req, res, _next) => {
  console.error('[ERROR]', err);
  res.status(500).json({
    error: 'INTERNAL_ERROR',
    message: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// Handle unhandled errors so Render sees us alive
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Spotify Canvas API running on port ${PORT}`);
  console.log(`   URL:                 http://localhost:${PORT}`);
  console.log(`   Canvas endpoint:     GET /api/canvas/:trackId`);
  console.log(`   Health check:        GET /api/health`);
  console.log(`   Frontend UI:         GET /`);
  console.log(`   Auth methods:`, {
    oauth_refresh_token: Boolean(process.env.SPOTIFY_REFRESH_TOKEN),
    sp_dc_cookie: Boolean(process.env.SPOTIFY_SP_DC),
    https_proxy: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
  }, '\n');
});

export default app;
