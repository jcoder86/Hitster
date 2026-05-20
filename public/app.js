'use strict';

/* ============================================================
   AudioEngine
   Speelt een 30-sec preview af die het server-endpoint /api/preview
   vindt bij iTunes of Deezer. De UI hoort via callbacks of het lukt.
   ============================================================ */
const AudioEngine = (() => {
  let token = 0; // invalideert verouderde afspeel-acties
  let statusCb = () => {};
  const audioEl = document.getElementById('fallback-audio');

  function stopAudio() {
    try {
      audioEl.pause();
      audioEl.removeAttribute('src');
      audioEl.load();
    } catch (_) {}
  }

  /**
   * Start het afspelen van een song. Moet vanuit een user-gesture
   * worden aangeroepen i.v.m. autoplay-beleid.
   * @param {{artist:string,title:string,year:number}} song
   * @param {(status:'playing'|'nopreview')=>void} onStatus
   */
  async function play(song, onStatus) {
    token += 1;
    const forToken = token;
    statusCb = typeof onStatus === 'function' ? onStatus : () => {};
    stopAudio();

    try {
      const url =
        '/api/preview?artist=' +
        encodeURIComponent(song.artist) +
        '&title=' +
        encodeURIComponent(song.title);
      const res = await fetch(url);
      if (forToken !== token) return;
      const data = await res.json();
      if (forToken !== token) return;

      if (!data.previewUrl) {
        statusCb('nopreview');
        return;
      }

      audioEl.src = data.previewUrl;
      await audioEl.play();
      if (forToken !== token) {
        stopAudio();
        return;
      }
      statusCb('playing');
    } catch (_) {
      if (forToken === token) statusCb('nopreview');
    }
  }

  /** Stopt alle audio en invalideert lopende acties. */
  function stop() {
    token += 1;
    stopAudio();
  }

  return { play, stop };
})();

/* ============================================================
   App-state & helpers
   ============================================================ */
const TEAM_COLORS = [
  '#ef476f',
  '#06d6a0',
  '#ffd166',
  '#118ab2',
  '#9b5de5',
  '#f77f00',
];

const DIFFICULTIES = [
  { id: 'makkelijk', label: 'MAKKELIJK', color: '#06d6a0' },
  { id: 'normaal', label: 'NORMAAL', color: '#ffd166' },
  { id: 'moeilijk', label: 'MOEILIJK', color: '#ef476f' },
];

const SUGGESTIONS = ['90s Hip-Hop', 'Nederhop', 'Top2000'];

const state = {
  theme: '',
  difficulty: 'normaal',
  teamCount: 2,
  teamNames: ['Team 1', 'Team 2', 'Team 3', 'Team 4', 'Team 5', 'Team 6'],
  winCondition: 8,
  songs: [],
  songIndex: 0,
  cardState: 'idle',
  teams: [],
  spotifyConfig: { enabled: false, clientId: null },
  spotify: { connected: false, isPremium: false, profile: null },
};

const appRoot = document.getElementById('app');

/** Mini DOM-helper. */
function h(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v);
      } else node.setAttribute(k, v);
    }
  }
  const kids = children == null ? [] : Array.isArray(children) ? children : [children];
  for (const c of kids) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function clearApp() {
  appRoot.innerHTML = '';
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ============================================================
   Spotify-integratie
   ============================================================ */

// OAuth via PKCE — geen client secret nodig, tokens in sessionStorage.
const SpotifyAuth = (() => {
  const K = {
    access: 'sp_access_token',
    refresh: 'sp_refresh_token',
    expiresAt: 'sp_expires_at',
    verifier: 'sp_verifier',
  };

  function randStr(len) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a)
      .map((b) => ('0' + b.toString(16)).slice(-2))
      .join('')
      .slice(0, len);
  }
  async function sha256(s) {
    return await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  }
  function b64url(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  function saveTokens(d) {
    sessionStorage.setItem(K.access, d.access_token);
    if (d.refresh_token) sessionStorage.setItem(K.refresh, d.refresh_token);
    sessionStorage.setItem(K.expiresAt, String(Date.now() + d.expires_in * 1000));
  }

  function isLoggedIn() {
    return !!sessionStorage.getItem(K.access);
  }

  function logout() {
    Object.values(K).forEach((k) => sessionStorage.removeItem(k));
  }

  async function login(clientId) {
    const verifier = randStr(64);
    const challenge = b64url(await sha256(verifier));
    sessionStorage.setItem(K.verifier, verifier);
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      scope: 'streaming user-read-email user-read-private',
      redirect_uri: window.location.origin + '/',
      code_challenge_method: 'S256',
      code_challenge: challenge,
    });
    window.location.href = 'https://accounts.spotify.com/authorize?' + params;
  }

  async function handleCallback(clientId) {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return false;
    const verifier = sessionStorage.getItem(K.verifier);
    if (!verifier) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: window.location.origin + '/',
          client_id: clientId,
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      history.replaceState(null, '', window.location.pathname);
      if (data.access_token) {
        saveTokens(data);
        sessionStorage.removeItem(K.verifier);
        return true;
      }
    } catch (e) {
      console.error('Spotify callback fout:', e);
    }
    return false;
  }

  async function refresh(clientId) {
    const rt = sessionStorage.getItem(K.refresh);
    if (!rt) return null;
    const res = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: rt,
        client_id: clientId,
      }),
    });
    const data = await res.json();
    if (data.access_token) {
      saveTokens(data);
      return data.access_token;
    }
    return null;
  }

  async function getValidToken(clientId) {
    const exp = parseInt(sessionStorage.getItem(K.expiresAt) || '0', 10);
    if (Date.now() < exp - 60000) return sessionStorage.getItem(K.access);
    return await refresh(clientId);
  }

  return { login, logout, isLoggedIn, handleCallback, getValidToken };
})();

// Eenvoudige wrapper rond de Spotify Web API met automatische token-refresh.
async function spotifyApi(path, opts) {
  const token = await SpotifyAuth.getValidToken(state.spotifyConfig.clientId);
  if (!token) throw new Error('Spotify-sessie verlopen — log opnieuw in.');
  const headers = Object.assign(
    { Authorization: 'Bearer ' + token },
    (opts && opts.headers) || {}
  );
  if (opts && opts.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const url = path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path;
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  if (!res.ok && res.status !== 204) {
    const txt = await res.text().catch(() => '');
    throw new Error('Spotify ' + res.status + ': ' + txt.slice(0, 140));
  }
  return res.status === 204 ? null : await res.json();
}

// Bouwt een lijst van 20 nummers uit Spotify Search, gefilterd op
// popularity volgens de gekozen moeilijkheidsgraad.
async function generateSpotifySongList(theme, difficulty) {
  const q = encodeURIComponent(theme);
  const data = await spotifyApi('/search?q=' + q + '&type=track&limit=50&market=NL');
  let items = ((data && data.tracks && data.tracks.items) || []).filter(
    (t) => t && t.id && t.album && t.album.release_date
  );
  const seen = new Set();
  items = items.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
  if (items.length < 20) {
    throw new Error(
      'Te weinig Spotify-resultaten voor dit thema. Probeer een breder thema.'
    );
  }
  items.sort((a, b) => b.popularity - a.popularity);
  let pool;
  if (difficulty === 'makkelijk') pool = items.slice(0, 30);
  else if (difficulty === 'moeilijk') pool = items.slice(-30);
  else pool = items.slice(10, 40);
  return shuffle(pool)
    .slice(0, 20)
    .map((t) => ({
      artist: (t.artists[0] && t.artists[0].name) || 'Onbekend',
      title: t.name,
      year: parseInt(t.album.release_date.slice(0, 4), 10) || 0,
      uri: t.uri,
    }));
}

// Speelt volledige tracks via de Web Playback SDK.
const SpotifyEngine = (() => {
  let player = null;
  let deviceId = null;
  let sdkPromise = null;
  let token = 0;
  let statusCb = () => {};

  function loadSdk() {
    if (sdkPromise) return sdkPromise;
    sdkPromise = new Promise((resolve) => {
      window.onSpotifyWebPlaybackSDKReady = () => resolve();
    });
    const s = document.createElement('script');
    s.src = 'https://sdk.scdn.co/spotify-player.js';
    document.head.appendChild(s);
    return sdkPromise;
  }

  async function ensurePlayer() {
    if (player && deviceId) return;
    await loadSdk();
    player = new Spotify.Player({
      name: 'Hitster',
      getOAuthToken: (cb) =>
        SpotifyAuth.getValidToken(state.spotifyConfig.clientId).then((t) => cb(t)),
      volume: 0.8,
    });
    const ready = new Promise((resolve, reject) => {
      player.addListener('ready', (e) => {
        deviceId = e.device_id;
        resolve();
      });
      player.addListener('initialization_error', (e) =>
        reject(new Error('init: ' + e.message))
      );
      player.addListener('authentication_error', (e) =>
        reject(new Error('auth: ' + e.message))
      );
      player.addListener('account_error', (e) =>
        reject(new Error('account: ' + e.message))
      );
    });
    const ok = await player.connect();
    if (!ok) throw new Error('Spotify SDK kon niet verbinden.');
    await ready;
  }

  async function play(song, onStatus) {
    token += 1;
    const forToken = token;
    statusCb = typeof onStatus === 'function' ? onStatus : () => {};
    try {
      await ensurePlayer();
      if (forToken !== token) return;
      const access = await SpotifyAuth.getValidToken(state.spotifyConfig.clientId);
      const res = await fetch(
        'https://api.spotify.com/v1/me/player/play?device_id=' + deviceId,
        {
          method: 'PUT',
          headers: {
            Authorization: 'Bearer ' + access,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ uris: [song.uri], position_ms: 0 }),
        }
      );
      if (forToken !== token) return;
      if (!res.ok && res.status !== 204) {
        const txt = await res.text().catch(() => '');
        throw new Error('Spotify play ' + res.status + ': ' + txt.slice(0, 120));
      }
      statusCb('playing');
    } catch (err) {
      console.error('Spotify play fout:', err);
      if (forToken === token) statusCb('nopreview');
    }
  }

  async function stop() {
    token += 1;
    try {
      if (player) await player.pause();
    } catch (_) {}
  }

  return { play, stop };
})();

// Welke afspeel-engine te gebruiken op basis van Spotify-status.
function isSpotifyMode() {
  return state.spotify.connected && state.spotify.isPremium;
}

function audioPlay(song, cb) {
  if (isSpotifyMode() && song.uri) return SpotifyEngine.play(song, cb);
  return AudioEngine.play(song, cb);
}

function audioStop() {
  AudioEngine.stop();
  SpotifyEngine.stop();
}

// Reset Spotify-state en herrender setup.
function spotifyLogout() {
  SpotifyAuth.logout();
  state.spotify = { connected: false, isPremium: false, profile: null };
  renderSetup();
}

// Compact Spotify-blok in de rechterbovenhoek van het setup-scherm.
function buildSpotifyCorner() {
  if (!state.spotifyConfig.enabled) return null;

  const logo = h('img', {
    src: 'spotify.png',
    alt: 'Spotify',
    class: 'spotify-corner-logo',
  });

  // Niet ingelogd — hele widget is klikbaar -> OAuth.
  if (!state.spotify.connected) {
    return h(
      'div',
      {
        class: 'spotify-corner spotify-corner-clickable',
        role: 'button',
        tabindex: '0',
        onclick: () => SpotifyAuth.login(state.spotifyConfig.clientId),
      },
      [logo, h('span', { class: 'spotify-corner-label', text: 'LOGIN' })]
    );
  }

  const logoutBtn = h('button', {
    type: 'button',
    class: 'spotify-corner-logout',
    text: 'uitloggen',
    onclick: (e) => {
      e.stopPropagation();
      spotifyLogout();
    },
  });

  // Ingelogd zonder Premium.
  if (!state.spotify.isPremium) {
    return h('div', { class: 'spotify-corner spotify-corner-warn' }, [
      logo,
      h('span', { class: 'spotify-corner-label', text: 'PREMIUM VEREIST' }),
      logoutBtn,
    ]);
  }

  // Ingelogd én Premium.
  const name =
    (state.spotify.profile && state.spotify.profile.display_name) || 'INGELOGD';
  return h('div', { class: 'spotify-corner spotify-corner-connected' }, [
    logo,
    h('span', { class: 'spotify-corner-label', text: name.toUpperCase() }),
    logoutBtn,
  ]);
}

/* ============================================================
   Feature 3 — Setup scherm
   ============================================================ */
function renderSetup() {
  audioStop();
  clearApp();

  const themeInput = h('input', {
    type: 'text',
    class: 'theme-input',
    placeholder: 'bijv. Disco classics, Nederpop, Eurovisie…',
    value: state.theme,
  });

  const suggestionRow = h('div', { class: 'suggestions' });
  function refreshSuggestions() {
    suggestionRow.querySelectorAll('.suggestion').forEach((chip) => {
      chip.classList.toggle(
        'active',
        chip.dataset.value.toLowerCase() === state.theme.trim().toLowerCase()
      );
    });
  }
  SUGGESTIONS.forEach((sug) => {
    const chip = h('button', {
      type: 'button',
      class: 'suggestion',
      'data-value': sug,
      text: sug,
      onclick: () => {
        state.theme = sug;
        themeInput.value = sug;
        refreshSuggestions();
      },
    });
    suggestionRow.appendChild(chip);
  });
  themeInput.addEventListener('input', () => {
    state.theme = themeInput.value;
    refreshSuggestions();
  });

  // --- Moeilijkheid ---
  const diffRow = h('div', { class: 'diff-row' });
  function refreshDiff() {
    diffRow.querySelectorAll('.diff-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.id === state.difficulty);
    });
  }
  DIFFICULTIES.forEach((d) => {
    const btn = h('button', {
      type: 'button',
      class: 'diff-btn',
      'data-id': d.id,
      text: d.label,
      onclick: () => {
        state.difficulty = d.id;
        refreshDiff();
      },
    });
    btn.style.setProperty('--diff', d.color);
    diffRow.appendChild(btn);
  });

  // --- Aantal teams ---
  const countRow = h('div', { class: 'count-row' });
  const teamsBox = h('div', { class: 'team-names' });

  function renderTeamNameFields() {
    teamsBox.innerHTML = '';
    for (let i = 0; i < state.teamCount; i++) {
      const dot = h('span', { class: 'team-dot' });
      dot.style.background = TEAM_COLORS[i];
      const input = h('input', {
        type: 'text',
        class: 'team-name-input',
        value: state.teamNames[i],
        maxlength: '20',
        oninput: (e) => {
          state.teamNames[i] = e.target.value;
        },
      });
      teamsBox.appendChild(h('div', { class: 'team-name-row' }, [dot, input]));
    }
  }

  function refreshCount() {
    countRow.querySelectorAll('.count-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.n) === state.teamCount);
    });
  }
  for (let n = 2; n <= 6; n++) {
    const btn = h('button', {
      type: 'button',
      class: 'count-btn',
      'data-n': n,
      text: String(n),
      onclick: () => {
        state.teamCount = n;
        refreshCount();
        renderTeamNameFields();
      },
    });
    countRow.appendChild(btn);
  }

  // --- Winconditie ---
  const winValue = h('span', { class: 'win-value', text: String(state.winCondition) });
  const winSlider = h('input', {
    type: 'range',
    class: 'win-slider',
    min: '3',
    max: '15',
    value: String(state.winCondition),
    oninput: (e) => {
      state.winCondition = Number(e.target.value);
      winValue.textContent = String(state.winCondition);
    },
  });

  // --- Start ---
  const errorBox = h('div', { class: 'error-box', style: 'display:none' });
  const startBtn = h('button', {
    type: 'button',
    class: 'start-btn',
    text: 'START SPEL',
  });

  const screen = h('div', { class: 'setup-screen' }, [
    h('h1', { class: 'brand', text: 'HITSTER' }),
    h('p', { class: 'tagline', text: 'De muziekquiz — raad het jaar, win de kaartjes' }),

    h('div', { class: 'panel' }, [
      h('label', { class: 'field-label', text: 'THEMA' }),
      themeInput,
      suggestionRow,

      h('label', { class: 'field-label', text: 'MOEILIJKHEID' }),
      diffRow,

      h('label', { class: 'field-label', text: 'AANTAL TEAMS' }),
      countRow,

      h('label', { class: 'field-label', text: 'TEAMNAMEN' }),
      teamsBox,

      h('label', { class: 'field-label' }, [
        'WINCONDITIE — ',
        winValue,
        ' KAARTJES',
      ]),
      winSlider,

      errorBox,
      startBtn,
    ]),
  ]);

  appRoot.appendChild(screen);
  const corner = buildSpotifyCorner();
  if (corner) appRoot.appendChild(corner);
  refreshSuggestions();
  refreshDiff();
  refreshCount();
  renderTeamNameFields();

  startBtn.addEventListener('click', () => startGame(startBtn, errorBox));
}

function showError(box, message) {
  box.textContent = message;
  box.style.display = 'block';
}

async function startGame(startBtn, errorBox) {
  const theme = state.theme.trim();
  if (!theme) {
    showError(errorBox, 'Vul eerst een thema in.');
    return;
  }
  if (state.spotify.connected && !state.spotify.isPremium) {
    showError(errorBox, 'Spotify Premium is vereist om vanaf 0 af te spelen.');
    return;
  }
  errorBox.style.display = 'none';

  const originalLabel = startBtn.textContent;
  startBtn.disabled = true;
  startBtn.classList.add('loading');
  startBtn.innerHTML = '';
  startBtn.appendChild(h('span', { class: 'spinner' }));
  startBtn.appendChild(h('span', { text: 'NUMMERS GENEREREN…' }));

  try {
    let songs;
    if (isSpotifyMode()) {
      // Lijst komt rechtstreeks uit Spotify Search.
      songs = await generateSpotifySongList(theme, state.difficulty);
    } else {
      const res = await fetch('/api/generate-songs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme, difficulty: state.difficulty }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Onbekende fout bij het genereren.');
      }
      if (!Array.isArray(data.songs) || data.songs.length === 0) {
        throw new Error('Er zijn geen nummers ontvangen.');
      }
      songs = data.songs;
    }

    state.songs = shuffle(songs);
    state.songIndex = 0;
    state.cardState = 'idle';
    initTeams();
    renderGame();
  } catch (err) {
    showError(errorBox, err.message || 'Er ging iets mis.');
    startBtn.disabled = false;
    startBtn.classList.remove('loading');
    startBtn.textContent = originalLabel;
  }
}

function initTeams() {
  state.teams = [];
  for (let i = 0; i < state.teamCount; i++) {
    state.teams.push({
      name: (state.teamNames[i] || `Team ${i + 1}`).trim() || `Team ${i + 1}`,
      color: TEAM_COLORS[i],
      cards: [],
    });
  }
}

/* ============================================================
   Feature 4 — Spelscherm
   ============================================================ */

// Per equalizer-bar een eigen keyframe met willekeurige hoogtes,
// duration en delay (eenmalig geïnjecteerd).
const EQ_BARS = (() => {
  const bars = [];
  let css = '';
  for (let i = 0; i < 8; i++) {
    const minH = 6 + Math.floor(Math.random() * 8);
    const maxH = 42 + Math.floor(Math.random() * 19);
    const dur = (0.65 + Math.random() * 0.35).toFixed(2);
    const delay = (Math.random() * 0.7).toFixed(2);
    css += `@keyframes eqbar${i}{0%,100%{height:${minH}px}50%{height:${maxH}px}}`;
    bars.push({ name: `eqbar${i}`, dur, delay });
  }
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);
  return bars;
})();

function currentSong() {
  return state.songs[state.songIndex] || null;
}

function buildHeader() {
  const remaining = state.songs.length - state.songIndex;
  const diff = DIFFICULTIES.find((d) => d.id === state.difficulty);
  return h('header', { class: 'game-header' }, [
    h('div', { class: 'logo', text: 'HITSTER' }),
    h('div', { class: 'game-meta' }, [
      h('span', { class: 'meta-theme', text: state.theme.trim() }),
      h('span', { class: 'meta-sep', text: ' · ' }),
      h('span', { class: 'meta-diff', text: diff ? diff.label : state.difficulty }),
    ]),
    h('div', { class: 'remaining', text: `${remaining} over` }),
  ]);
}

function buildEqualizer() {
  const eq = h('div', { class: 'equalizer' });
  EQ_BARS.forEach((b) => {
    const bar = h('div', { class: 'eq-bar' });
    bar.style.animation = `${b.name} ${b.dur}s ease-in-out infinite`;
    bar.style.animationDelay = `-${b.delay}s`;
    eq.appendChild(bar);
  });
  return eq;
}

function buildCard() {
  const song = currentSong();

  if (state.cardState === 'idle') {
    return h('div', { class: 'card card-idle fadeup' }, [
      h('div', { class: 'vinyl' }, [h('div', { class: 'vinyl-label' })]),
      h('p', { class: 'card-text', text: 'KLAAR VOOR HET VOLGENDE NUMMER?' }),
      h('button', {
        class: 'play-btn',
        type: 'button',
        text: '▶ SPEEL',
        onclick: playSong,
      }),
    ]);
  }

  if (state.cardState === 'playing') {
    return h('div', { class: 'card card-playing fadeup' }, [
      buildEqualizer(),
      h('p', { class: 'card-text', text: '♪ NU SPELEND...' }),
      h('button', {
        class: 'reveal-btn',
        type: 'button',
        text: 'ONTHUL ANTWOORD',
        onclick: revealAnswer,
      }),
      h('p', { class: 'nopreview-msg', id: 'nopreview-msg', text: 'geen preview beschikbaar' }),
    ]);
  }

  // revealed
  const teamPick = h('div', { class: 'team-pick' });
  state.teams.forEach((team, i) => {
    const btn = h('button', {
      class: 'pick-btn',
      type: 'button',
      text: team.name,
      onclick: () => assignCard(i),
    });
    btn.style.setProperty('--tc', team.color);
    teamPick.appendChild(btn);
  });

  return h('div', { class: 'card card-revealed fadeup' }, [
    h('div', { class: 'reveal-year', text: String(song.year) }),
    h('div', { class: 'reveal-artist', text: song.artist }),
    h('div', { class: 'reveal-title', text: song.title }),
    h('div', { class: 'divider' }),
    h('p', { class: 'card-text', text: 'WIE KRIJGT DIT KAARTJE?' }),
    teamPick,
    h('button', {
      class: 'discard-btn',
      type: 'button',
      text: 'NIEMAND — WEG',
      onclick: () => assignCard(null),
    }),
  ]);
}

function buildTeamOverview() {
  const wrap = h('div', { class: 'team-overview' });
  state.teams.forEach((team) => {
    const sorted = team.cards.slice().sort((a, b) => a.year - b.year);
    const pct = Math.min(100, (team.cards.length / state.winCondition) * 100);

    const dot = h('span', { class: 'team-dot' });
    dot.style.background = team.color;

    const fill = h('div', { class: 'progress-fill' });
    fill.style.width = pct + '%';
    fill.style.background = team.color;

    const chips = h('div', { class: 'chips' });
    sorted.forEach((card) => {
      const chip = h('span', { class: 'chip', text: String(card.year) });
      chip.style.borderColor = team.color;
      chip.style.color = team.color;
      chips.appendChild(chip);
    });

    const strip = h('div', { class: 'team-strip' }, [
      h('div', { class: 'team-strip-head' }, [
        dot,
        h('span', { class: 'team-strip-name', text: team.name }),
        h('span', {
          class: 'team-strip-count',
          text: `${team.cards.length} / ${state.winCondition}`,
        }),
      ]),
      h('div', { class: 'progress' }, [fill]),
      chips,
    ]);
    wrap.appendChild(strip);
  });
  return wrap;
}

function renderGame() {
  clearApp();

  // Geen nummers meer over — speelbare ronde voorbij.
  if (state.songIndex >= state.songs.length) {
    appRoot.appendChild(
      h('div', { class: 'game-screen' }, [
        buildHeader(),
        h('div', { class: 'card-area' }, [
          h('div', { class: 'card card-idle' }, [
            h('p', { class: 'card-text', text: 'ALLE NUMMERS GESPEELD' }),
            h('p', { class: 'subtle', text: 'Geen kaartjes meer om te verdelen.' }),
            h('button', {
              class: 'play-btn',
              type: 'button',
              text: 'NIEUW SPEL',
              onclick: renderSetup,
            }),
          ]),
        ]),
        buildTeamOverview(),
      ])
    );
    return;
  }

  appRoot.appendChild(
    h('div', { class: 'game-screen' }, [
      buildHeader(),
      h('div', { class: 'card-area' }, [buildCard()]),
      buildTeamOverview(),
    ])
  );
}

function playSong() {
  const song = currentSong();
  if (!song) return;
  state.cardState = 'playing';
  renderGame();

  // Aangeroepen binnen de click-gesture zodat autoplay is toegestaan.
  audioPlay(song, (status) => {
    if (status === 'nopreview') {
      const msg = document.getElementById('nopreview-msg');
      if (msg) msg.classList.add('visible');
    }
  });
}

function revealAnswer() {
  audioStop();
  state.cardState = 'revealed';
  renderGame();
}

function assignCard(teamIndex) {
  const song = currentSong();
  if (!song) return;

  if (teamIndex != null) {
    const team = state.teams[teamIndex];
    team.cards.push({ year: song.year, artist: song.artist, title: song.title });
    if (team.cards.length >= state.winCondition) {
      state.songIndex += 1;
      renderWin(team);
      return;
    }
  }

  state.songIndex += 1;
  state.cardState = 'idle';
  renderGame();
}

/* ============================================================
   Feature 5 — Win scherm
   ============================================================ */
function renderWin(team) {
  audioStop();
  clearApp();

  const winName = h('h1', { class: 'win-name', text: team.name });
  winName.style.color = team.color;
  winName.style.setProperty('--glow-color', team.color);

  const timeline = h('div', { class: 'win-timeline' });
  team.cards
    .slice()
    .sort((a, b) => a.year - b.year)
    .forEach((card) => {
      const row = h('div', { class: 'win-card-row' }, [
        h('span', { class: 'win-card-year', text: String(card.year) }),
        h('span', { class: 'win-card-sep', text: '·' }),
        h('span', { class: 'win-card-artist', text: card.artist }),
      ]);
      row.style.color = team.color;
      timeline.appendChild(row);
    });

  const screen = h('div', { class: 'win-screen' }, [
    h('p', { class: 'win-eyebrow', text: 'WINNAAR' }),
    winName,
    h('p', {
      class: 'win-subtitle',
      text: `met ${team.cards.length} ${team.cards.length === 1 ? 'kaartje' : 'kaartjes'}`,
    }),
    timeline,
    h('button', {
      class: 'restart-btn',
      type: 'button',
      text: 'OPNIEUW',
      onclick: renderSetup,
    }),
  ]);

  appRoot.appendChild(screen);
}

/* ============================================================
   Bootstrap
   ============================================================ */
async function bootstrap() {
  // 1. Server-config (Spotify-client-ID indien geconfigureerd).
  try {
    const cfg = await fetch('/api/config').then((r) => r.json());
    state.spotifyConfig = {
      enabled: !!cfg.spotifyEnabled,
      clientId: cfg.spotifyClientId || null,
    };
  } catch (_) {
    // Zonder config draait alles gewoon op de preview-modus.
  }

  // 2. Spotify OAuth-callback (?code=...) afhandelen vóór het rendert.
  if (
    state.spotifyConfig.enabled &&
    new URLSearchParams(window.location.search).has('code')
  ) {
    await SpotifyAuth.handleCallback(state.spotifyConfig.clientId);
  }

  // 3. Bestaande sessie? Haal profiel op om Premium-status te checken.
  if (state.spotifyConfig.enabled && SpotifyAuth.isLoggedIn()) {
    try {
      const profile = await spotifyApi('/me');
      state.spotify = {
        connected: true,
        isPremium: profile && profile.product === 'premium',
        profile,
      };
    } catch (_) {
      SpotifyAuth.logout();
    }
  }

  renderSetup();
}

document.addEventListener('DOMContentLoaded', bootstrap);

