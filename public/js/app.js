/* ===========================================================
   Spotify Canvas — Now Playing Client
   Handles: Canvas fetch, video playback, YouTube fallback,
            cover toggle, progress, play/pause
   =========================================================== */

(() => {
  'use strict';

  // --- Elements ---
  const phone         = document.getElementById('phone');
  const canvasLayer   = document.getElementById('canvasLayer');
  const canvasVideo   = document.getElementById('canvasVideo');
  const canvasLoading = document.getElementById('canvasLoading');
  const youtubeLayer  = document.getElementById('youtubeLayer');
  const youtubeWrapper= document.getElementById('youtubeWrapper');
  const coverLayer    = document.getElementById('coverLayer');
  const coverArt      = document.getElementById('coverArt');

  const trackTitle    = document.getElementById('trackTitle');
  const trackArtist   = document.getElementById('trackArtist');
  const toggleBtn     = document.getElementById('canvasToggle');
  const toggleText    = document.getElementById('toggleText');
  const playBtn       = document.getElementById('playBtn');
  const playIcon      = document.getElementById('playIcon');
  const pauseIcon     = document.getElementById('pauseIcon');
  const heartBtn      = document.getElementById('heartBtn');
  const progressBar   = document.getElementById('progressBar');
  const progressFill  = document.getElementById('progressFill');
  const progressThumb = document.getElementById('progressThumb');
  const currentTimeEl = document.getElementById('currentTime');
  const totalTimeEl   = document.getElementById('totalTime');
  const toast         = document.getElementById('toast');

  const trackInput    = document.getElementById('trackInput');
  const loadBtn       = document.getElementById('loadBtn');
  const presetSelect  = document.getElementById('presetSelect');
  const apiInfo       = document.getElementById('apiInfo');

  // --- State ---
  const state = {
    trackId: null,
    canvasUrl: null,
    mode: 'canvas',   // 'canvas' | 'cover'
    youtubeActive: false,
    isPlaying: false,
    isLiked: false,
    // Faux-progress state (since we are not playing actual audio)
    duration: 218000, // ms
    progress: 0,
    progressTimer: null,
    trackMeta: null,
  };

  // --- Demo track catalog (used to display info without requiring Spotify API metadata) ---
  const DEMO_TRACKS = {
    '3OHfY25tqY28d16oZczHc8': { title: 'Kill Bill',        artist: 'SZA',            cover: 'https://i.scdn.co/image/ab67616d0000b2736bcd89aae9a00d557b7e843f', ytQuery: 'SZA Kill Bill Official Audio' },
    '4cOdK2wGLETKBW3PvgPWqT': { title: 'Blinding Lights',  artist: 'The Weeknd',     cover: 'https://i.scdn.co/image/ab67616d0000b2738863bc11d2aa12b54f5aeb43', ytQuery: 'The Weeknd Blinding Lights Official Video' },
    '0VjIjW4GlUZAMYd2vXMi3b': { title: 'Shape of You',     artist: 'Ed Sheeran',     cover: 'https://i.scdn.co/image/ab67616d0000b273ba5db46f4b838ef6027e6f96', ytQuery: 'Ed Sheeran Shape of You' },
    DEFAULT: { title: 'Unknown Track', artist: 'Spotify Canvas', cover: '', ytQuery: null }
  };

  // ----------------------------------------------------------------
  // TOAST
  // ----------------------------------------------------------------
  let toastTimer = null;
  function showToast(msg, ms = 2200) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), ms);
  }

  // ----------------------------------------------------------------
  // API: Fetch canvas from backend
  // ----------------------------------------------------------------
  async function fetchCanvas(trackId) {
    const res = await fetch(`/api/canvas/${encodeURIComponent(trackId)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `HTTP_${res.status}`);
    }
    return res.json();
  }

  // ----------------------------------------------------------------
  // Layer management
  // ----------------------------------------------------------------
  function setMode(mode) {
    state.mode = mode;
    phone.classList.remove('canvas-mode', 'cover-mode', 'youtube-mode');
    if (state.youtubeActive) {
      phone.classList.add('youtube-mode');
      youtubeLayer.classList.add('active');
    } else {
      youtubeLayer.classList.remove('active');
      phone.classList.add(mode === 'cover' ? 'cover-mode' : 'canvas-mode');
    }
    coverLayer.classList.toggle('active', mode === 'cover' && !state.youtubeActive);
    toggleText.textContent = mode === 'cover' ? 'Plak' : 'Canvas';
  }

  function showLoading(show) {
    canvasLoading.classList.toggle('show', show);
  }

  // ----------------------------------------------------------------
  // Canvas video handling
  // ----------------------------------------------------------------
  function loadCanvasVideo(url) {
    state.youtubeActive = false;
    youtubeLayer.classList.remove('active');
    youtubeWrapper.innerHTML = '';

    return new Promise((resolve, reject) => {
      canvasVideo.src = url;
      canvasVideo.load();

      const onCanPlay = () => {
        cleanup();
        showLoading(false);
        setMode(state.mode);
        if (state.isPlaying) canvasVideo.play().catch(()=>{});
        resolve();
      };
      const onError = () => {
        cleanup();
        reject(new Error('VIDEO_LOAD_ERROR'));
      };
      const cleanup = () => {
        canvasVideo.removeEventListener('canplay', onCanPlay);
        canvasVideo.removeEventListener('error', onError);
      };
      canvasVideo.addEventListener('canplay', onCanPlay, { once: true });
      canvasVideo.addEventListener('error', onError, { once: true });
    });
  }

  // ----------------------------------------------------------------
  // YouTube fallback
  // ----------------------------------------------------------------
  function loadYoutubeFallback(query) {
    state.youtubeActive = true;
    coverLayer.classList.remove('active');
    youtubeLayer.classList.add('active');
    phone.classList.add('youtube-mode');
    phone.classList.remove('canvas-mode', 'cover-mode');

    const q = encodeURIComponent(query || `${state.trackMeta?.title || 'music'} ${state.trackMeta?.artist || ''}`);
    // YouTube embed with search-list, autoplay, muted (for autoplay policy), loop, no controls
    const iframe = document.createElement('iframe');
    iframe.src = `https://www.youtube.com/embed?listType=search&list=${q}&autoplay=1&mute=1&loop=1&controls=0&modestbranding=1&playsinline=1&rel=0&showinfo=0&iv_load_policy=3&disablekb=1&enablejsapi=0`;
    iframe.allow = 'autoplay; encrypted-media; fullscreen';
    iframe.setAttribute('loading', 'eager');
    iframe.referrerPolicy = 'no-referrer';
    youtubeWrapper.innerHTML = '';
    youtubeWrapper.appendChild(iframe);

    showToast('Canvas bulunamadı · YouTube fallback aktif');
  }

  // ----------------------------------------------------------------
  // Cover art
  // ----------------------------------------------------------------
  function loadCoverArt(coverUrl) {
    if (coverUrl) {
      coverArt.src = coverUrl;
    } else {
      // Generate a colorful gradient placeholder
      coverArt.src = generateGradientDataUrl(state.trackId || 'spotify');
    }
  }

  function generateGradientDataUrl(seed) {
    // Deterministic gradient from seed
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = ((hash << 5) - hash) + seed.charCodeAt(i), hash |= 0;
    const hue1 = Math.abs(hash % 360);
    const hue2 = (hue1 + 40 + (Math.abs(hash >> 3) % 80)) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="hsl(${hue1},65%,35%)"/><stop offset="100%" stop-color="hsl(${hue2},70%,15%)"/></linearGradient></defs><rect width="400" height="400" fill="url(#g)"/><g fill="rgba(255,255,255,0.07)" transform="translate(200,200)"><circle r="130"/><circle r="90" fill="rgba(0,0,0,0.2)"/><circle r="25" fill="#111"/></g></svg>`;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
  }

  // ----------------------------------------------------------------
  // Main load flow
  // ----------------------------------------------------------------
  async function loadTrack(trackId) {
    if (!trackId || !/^[0-9A-Za-z]{22}$/.test(trackId)) {
      showToast('Geçersiz Track ID (22 karakter olmalı)');
      return;
    }

    state.trackId = trackId;
    state.trackMeta = DEMO_TRACKS[trackId] || DEMO_TRACKS.DEFAULT;
    state.progress = 0;
    state.isPlaying = false;
    updatePlayButton();

    trackTitle.textContent = state.trackMeta.title;
    trackArtist.textContent = state.trackMeta.artist;
    loadCoverArt(state.trackMeta.cover);
    totalTimeEl.textContent = formatTime(state.duration);
    currentTimeEl.textContent = formatTime(0);
    progressFill.style.width = '0%';
    progressThumb.style.left = '0%';

    showLoading(true);
    canvasVideo.style.opacity = '0';
    apiInfo.textContent = 'Canvas yükleniyor…';

    let result;
    try {
      result = await fetchCanvas(trackId);
      apiInfo.textContent = result.canvasUrl ? '✓ Canvas' : '✗ Canvas yok';
    } catch (err) {
      console.error('Canvas fetch error:', err);
      showToast('Canvas alınamadı, YouTube\'a geçiliyor');
      apiInfo.textContent = '✗ Hata';
      result = { canvasUrl: null, fallbackToYoutube: true };
    }

    if (result.canvasUrl) {
      state.canvasUrl = result.canvasUrl;
      try {
        await loadCanvasVideo(result.canvasUrl);
        canvasVideo.style.opacity = '1';
        setMode('canvas');
        showToast('Canvas yüklendi');
      } catch (e) {
        console.warn('Canvas video load failed, falling back to YouTube:', e);
        loadYoutubeFallback(state.trackMeta.ytQuery);
      }
    } else {
      state.canvasUrl = null;
      // Canvas yok — YouTube fallback
      loadYoutubeFallback(state.trackMeta.ytQuery || `${state.trackMeta.title} ${state.trackMeta.artist}`);
      // Also set mode to 'canvas' so the toggle still flips between cover and (youtube-as-canvas)
      setMode('canvas');
    }

    showLoading(false);
  }

  // ----------------------------------------------------------------
  // Play/Pause (faux audio, but controls canvas video)
  // ----------------------------------------------------------------
  function togglePlay() {
    state.isPlaying = !state.isPlaying;
    updatePlayButton();
    phone.classList.toggle('playing', state.isPlaying);

    if (state.isPlaying) {
      if (!state.youtubeActive && canvasVideo.src) {
        canvasVideo.play().catch(()=>{});
      }
      startProgressTimer();
    } else {
      if (!state.youtubeActive) canvasVideo.pause();
      stopProgressTimer();
    }
  }

  function updatePlayButton() {
    playIcon.style.display = state.isPlaying ? 'none' : 'block';
    pauseIcon.style.display = state.isPlaying ? 'block' : 'none';
  }

  function startProgressTimer() {
    stopProgressTimer();
    state.progressTimer = setInterval(() => {
      state.progress += 200;
      if (state.progress >= state.duration) state.progress = 0;
      updateProgress();
    }, 200);
  }
  function stopProgressTimer() {
    if (state.progressTimer) {
      clearInterval(state.progressTimer);
      state.progressTimer = null;
    }
  }
  function updateProgress() {
    const pct = (state.progress / state.duration) * 100;
    progressFill.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
    currentTimeEl.textContent = formatTime(state.progress);
  }
  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  // ----------------------------------------------------------------
  // Progress bar seeking
  // ----------------------------------------------------------------
  progressBar.addEventListener('click', (e) => {
    const rect = progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    state.progress = pct * state.duration;
    updateProgress();
  });

  // ----------------------------------------------------------------
  // Toggle canvas / cover
  // ----------------------------------------------------------------
  toggleBtn.addEventListener('click', () => {
    setMode(state.mode === 'canvas' ? 'cover' : 'canvas');
  });

  // ----------------------------------------------------------------
  // Play button
  // ----------------------------------------------------------------
  playBtn.addEventListener('click', togglePlay);

  // ----------------------------------------------------------------
  // Heart toggle
  // ----------------------------------------------------------------
  heartBtn.addEventListener('click', () => {
    state.isLiked = !state.isLiked;
    heartBtn.classList.toggle('liked', state.isLiked);
    if (state.isLiked) {
      heartBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
      showToast('Favorilere eklendi');
    } else {
      heartBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>';
    }
  });

  // ----------------------------------------------------------------
  // Track switching (demo bar)
  // ----------------------------------------------------------------
  loadBtn.addEventListener('click', () => {
    loadTrack(trackInput.value.trim());
  });
  trackInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadTrack(trackInput.value.trim());
  });
  presetSelect.addEventListener('change', () => {
    trackInput.value = presetSelect.value;
    loadTrack(presetSelect.value);
  });

  // ----------------------------------------------------------------
  // Canvas video loop & sync with play state
  // ----------------------------------------------------------------
  canvasVideo.addEventListener('play', () => {
    // Keep canvas looping (already has loop attr but belt+suspenders)
  });
  canvasVideo.addEventListener('ended', () => {
    canvasVideo.currentTime = 0;
    canvasVideo.play().catch(()=>{});
  });
  // Prevent canvas video from controlling overall state (muted, loops)
  canvasVideo.addEventListener('click', () => { /* let clicks pass through to UI */ });

  // Tap on canvas layer toggles play/pause (Spotify-like behavior)
  canvasLayer.addEventListener('click', (e) => {
    // Only toggle if click is on the video itself (not on overlay buttons)
    if (e.target === canvasVideo) {
      togglePlay();
    }
  });

  // ----------------------------------------------------------------
  // Initialize
  // ----------------------------------------------------------------
  setMode('canvas');
  loadCoverArt(null); // placeholder until track loads
  loadTrack(trackInput.value.trim() || '3OHfY25tqY28d16oZczHc8');

})();
