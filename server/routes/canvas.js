import { Router } from 'express';
import { getCanvasUrl, isValidTrackId } from '../services/spotifyCanvas.js';

const router = Router();

/**
 * GET /api/canvas/:trackId
 *
 * Returns JSON:
 *   - On success (canvas exists):
 *       { trackId, canvasUrl: "<mp4-url>", fallbackToYoutube: false }
 *   - When canvas doesn't exist:
 *       { trackId, canvasUrl: null,   fallbackToYoutube: true }
 *   - On errors: appropriate HTTP status + { error, message }
 */
router.get('/:trackId', async (req, res, next) => {
  const { trackId } = req.params;

  if (!isValidTrackId(trackId)) {
    return res.status(400).json({
      error: 'INVALID_TRACK_ID',
      message: 'Track ID must be a 22-character alphanumeric Spotify track ID (e.g. 4cOdK2wGLETKBW3PvgPWqT).'
    });
  }

  try {
    const { canvasUrl, fallbackToYoutube, reason } = await getCanvasUrl(trackId);

    return res.json({
      trackId,
      trackUri: `spotify:track:${trackId}`,
      canvasUrl,
      fallbackToYoutube,
      reason
    });
  } catch (err) {
    // Differentiate known failure modes
    if (err.message === 'INVALID_TRACK_ID') {
      return res.status(400).json({ error: 'INVALID_TRACK_ID', message: err.message });
    }
    if (err.message.startsWith('AUTH_FAILED')) {
      return res.status(503).json({
        error: 'AUTH_FAILED',
        message: 'Could not authenticate with Spotify Canvas service. Please configure SPOTIFY_SP_DC.'
      });
    }
    return res.status(500).json({
      error: 'CANVAS_FETCH_FAILED',
      message: err.message
    });
  }
});

export default router;
