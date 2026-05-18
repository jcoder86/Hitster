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
   Feature 3 — Setup scherm
   ============================================================ */
function renderSetup() {
  AudioEngine.stop();
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
  errorBox.style.display = 'none';

  const originalLabel = startBtn.textContent;
  startBtn.disabled = true;
  startBtn.classList.add('loading');
  startBtn.innerHTML = '';
  startBtn.appendChild(h('span', { class: 'spinner' }));
  startBtn.appendChild(h('span', { text: 'NUMMERS GENEREREN…' }));

  try {
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

    state.songs = shuffle(data.songs);
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

/* renderGame / renderWin — geïmplementeerd in Feature 4 & 5 */
function renderGame() {
  clearApp();
  appRoot.appendChild(h('p', { text: 'Spelscherm volgt in Feature 4.' }));
}

document.addEventListener('DOMContentLoaded', renderSetup);

