'use strict';

/* ============================================================
   AudioEngine (Feature 2)
   Speelt een song af via een verborgen YouTube iframe en valt
   automatisch terug op een iTunes-preview. Volledig onzichtbaar
   voor de speler — alleen via callbacks weet de UI wat er gebeurt.
   ============================================================ */
const AudioEngine = (() => {
  let ytPlayer = null;
  let ytApiReady = false; // IFrame API-script geladen
  let ytPlayerReady = false; // player-instance klaar voor gebruik
  let started = false;
  let timeoutId = null;
  let token = 0; // invalideert verouderde afspeel-acties
  let statusCb = () => {};
  let currentSong = null;
  let ytApiRequested = false;

  const audioEl = document.getElementById('fallback-audio');

  // Wordt globaal aangeroepen zodra de YouTube IFrame API geladen is.
  // De player zelf (en dus het iframe) wordt pas bij de eerste play()
  // aangemaakt, zodat de overige schermen geen iframe bevatten.
  window.onYouTubeIframeAPIReady = () => {
    ytApiReady = true;
    if (currentSong && !started) createPlayer();
  };

  // Laadt de IFrame API pas wanneer er voor het eerst muziek speelt.
  function ensureYtApi() {
    if (ytApiRequested) return;
    ytApiRequested = true;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  }

  function createPlayer() {
    if (ytPlayer || !ytApiReady) return;
    ytPlayer = new YT.Player('yt-player', {
      height: '180',
      width: '320',
      playerVars: { enablejsapi: 1, controls: 0, disablekb: 1, playsinline: 1 },
      events: {
        onReady: () => {
          ytPlayerReady = true;
          if (currentSong && !started) startYt(currentSong, token);
        },
        onStateChange: onYtStateChange,
        onError: onYtError,
      },
    });
  }

  function startYt(song, forToken) {
    if (forToken !== token) return;
    const query = song.artist + ' ' + song.title + ' official audio';
    try {
      ytPlayer.loadPlaylist({ listType: 'search', list: query });
      ytPlayer.setVolume(100);
    } catch (err) {
      fallbackToItunes(song, forToken);
    }
  }

  function onYtStateChange(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      started = true;
      clearTimeout(timeoutId);
      statusCb('playing');
    }
  }

  function onYtError() {
    // 150 / 101 = embedding geblokkeerd; 100 / 2 / 5 = niet speelbaar.
    if (!started) fallbackToItunes(currentSong, token);
  }

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

    // 5s zonder afspelen (incl. trage YT-init) -> automatische fallback.
    timeoutId = setTimeout(() => {
      if (!started && forToken === token) fallbackToItunes(song, forToken);
    }, 5000);

    if (ytPlayer && ytPlayerReady) {
      startYt(song, forToken);
    } else if (ytApiReady) {
      // Maakt het iframe aan; onReady start daarna het afspelen.
      createPlayer();
    } else {
      // IFrame API nog niet geladen — laad hem; onYouTubeIframeAPIReady
      // pikt de wachtende song op zodra het script binnen is.
      ensureYtApi();
    }
  }

  /** Stopt alle audio en invalideert lopende acties. */
  function stop() {
    token += 1;
    started = false;
    currentSong = null;
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
  AudioEngine.play(song, (status) => {
    if (status === 'nopreview') {
      const msg = document.getElementById('nopreview-msg');
      if (msg) msg.classList.add('visible');
    }
  });
}

function revealAnswer() {
  AudioEngine.stop();
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
  AudioEngine.stop();
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

document.addEventListener('DOMContentLoaded', renderSetup);

