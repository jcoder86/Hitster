'use strict';

/* ============================================================
   AudioEngine (Feature 2)
   Speelt een song af via een verborgen YouTube iframe en valt
   automatisch terug op een iTunes-preview. Volledig onzichtbaar
   voor de speler — alleen via callbacks weet de UI wat er gebeurt.
   ============================================================ */
const AudioEngine = (() => {
  let ytPlayer = null;
  let ytReady = false;
  let started = false;
  let timeoutId = null;
  let token = 0; // invalideert verouderde afspeel-acties
  let statusCb = () => {};

  const audioEl = document.getElementById('fallback-audio');

  // Wordt globaal aangeroepen zodra de YouTube IFrame API geladen is.
  window.onYouTubeIframeAPIReady = () => {
    ytPlayer = new YT.Player('yt-player', {
      height: '180',
      width: '320',
      playerVars: { enablejsapi: 1, controls: 0, disablekb: 1, playsinline: 1 },
      events: {
        onReady: () => {
          ytReady = true;
        },
        onStateChange: onYtStateChange,
        onError: onYtError,
      },
    });
  };

  function onYtStateChange(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      started = true;
      clearTimeout(timeoutId);
      statusCb('playing');
    }
  }

  function onYtError(e) {
    // 150 / 101 = embedding geblokkeerd; 100 / 2 / 5 = niet speelbaar.
    if (!started) fallbackToItunes(currentSong, token);
  }

  let currentSong = null;

  function stopYt() {
    try {
      if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
    } catch (_) {}
  }

  function stopAudio() {
    try {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    } catch (_) {}
  }

  async function fallbackToItunes(song, forToken) {
    clearTimeout(timeoutId);
    if (forToken !== token) return;
    stopYt();
    try {
      const url =
        'https://itunes.apple.com/search?term=' +
        encodeURIComponent(song.artist + ' ' + song.title) +
        '&entity=song&limit=3';
      const res = await fetch(url);
      const data = await res.json();
      if (forToken !== token) return;

      const hit = (data.results || []).find((r) => r.previewUrl);
      if (hit) {
        audioEl.src = hit.previewUrl;
        await audioEl.play();
        if (forToken !== token) {
          stopAudio();
          return;
        }
        started = true;
        statusCb('playing');
      } else {
        statusCb('nopreview');
      }
    } catch (err) {
      if (forToken === token) statusCb('nopreview');
    }
  }

  /**
   * Start het afspelen van een song. Moet vanuit een user-gesture
   * worden aangeroepen i.v.m. autoplay-beleid.
   * @param {{artist:string,title:string,year:number}} song
   * @param {(status:'playing'|'nopreview')=>void} onStatus
   */
  function play(song, onStatus) {
    token += 1;
    const forToken = token;
    started = false;
    currentSong = song;
    statusCb = typeof onStatus === 'function' ? onStatus : () => {};

    stopAudio();
    stopYt();

    const query = song.artist + ' ' + song.title + ' official audio';

    if (ytReady && ytPlayer && ytPlayer.loadPlaylist) {
      try {
        ytPlayer.loadPlaylist({ listType: 'search', list: query });
        ytPlayer.setVolume(100);
      } catch (err) {
        fallbackToItunes(song, forToken);
        return;
      }
      // 5s zonder afspelen -> automatische fallback.
      timeoutId = setTimeout(() => {
        if (!started && forToken === token) fallbackToItunes(song, forToken);
      }, 5000);
    } else {
      // YouTube API niet beschikbaar -> direct iTunes.
      fallbackToItunes(song, forToken);
    }
  }

  /** Stopt alle audio en invalideert lopende acties. */
  function stop() {
    token += 1;
    started = false;
    clearTimeout(timeoutId);
    stopYt();
    stopAudio();
  }

  return { play, stop };
})();
