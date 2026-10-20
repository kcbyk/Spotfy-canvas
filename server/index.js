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
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      mediaSrc: ["'self'", "*.scdn.co", "*.spotifycdn.com", "*.spotify.com", "blob:", "data:"],
      imgSrc: ["'self'", "*.scdn.co", "*.spotifycdn.com", "i.scdn.co", "data:", "blob:"],
      connectSrc: ["'self'", "*.spotify.com", "canvaz-cache.spotify.com", "www.youtube.com", "i.ytimg.com"],
      frameSrc: ["'self'", "www.youtube.com", "youtube.com", "www.youtube-nocookie.com"],
      scriptSrc: ["'self'", "https://www.youtube.com", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "data:"],
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

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
  res.json({
    status: 'ok',
    service: 'spotify-canvas-api',
    auth: {
      oauth_refresh_token: Boolean(process.env.SPOTIFY_REFRESH_TOKEN),
      sp_dc_cookie: Boolean(process.env.SPOTIFY_SP_DC),
      https_proxy: Boolean(process.env.HTTPS_PROXY || process.env.HTTP_PROXY)
    },
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🟢 Spotify Canvas API running at http://localhost:${PORT}`);
  console.log(`   Canvas endpoint:    GET /api/canvas/:trackId`);
  console.log(`   Health check:       GET /api/health`);
  console.log(`   Frontend UI:        GET /`);
  console.log(`   sp_dc configured:   ${process.env.SPOTIFY_SP_DC ? 'Yes' : 'No (using public client-token fallback)'}\n`);
});

export default app;
