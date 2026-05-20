require('dotenv').config();

const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// Eén reverse proxy (nginx/Caddy/Traefik) staat voor de app, dus
// vertrouw één hop X-Forwarded-For. Nodig zodat de rate limiter het
// echte client-IP ziet i.p.v. dat van de proxy.
app.set('trust proxy', 1);

// --- Misbruikbeperking ---------------------------------------
const MAX_THEME_LENGTH = 120; // een echt muziekthema is kort
const MAX_FIELD_LENGTH = 120; // max lengte van artist/title in de output
const MAX_GENERATIONS_PER_DAY = 200; // harde bovengrens op API-kosten

// Body-grootte begrenzen zodat niemand megabytes aan invoer stuurt.
app.use(express.json({ limit: '4kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Max 15 generaties per IP per kwartier — stopt spam.
const generateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel verzoeken. Probeer het later opnieuw.' },
});

// Royaler voor preview-zoekacties: één spel = ~20 lookups.
const previewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Te veel preview-aanvragen.' },
});

// Dagelijkse teller (in memory) als laatste vangnet tegen kosten.
const dailyUsage = { day: '', count: 0 };
function withinDailyQuota() {
  const today = new Date().toISOString().slice(0, 10);
  if (dailyUsage.day !== today) {
    dailyUsage.day = today;
    dailyUsage.count = 0;
  }
  if (dailyUsage.count >= MAX_GENERATIONS_PER_DAY) return false;
  dailyUsage.count += 1;
  return true;
}

// Prompt-injectie: woorden waarmee iemand de opdracht probeert te
// kapen. Substring-matching vangt automatisch verbuigingen mee, en
// de invoer wordt eerst ontdaan van diacritische tekens.
const INJECTION_PATTERNS = [
  /ignor/, // ignore / ignored / ignorar / ignorieren / ignoré
  /neg(eer|eren)|genegeerd/, // NL negeren
  /disregard/,
  /\bprompt/, // prompt / prompts / system prompt
  /systeemprompt/,
  /in ?plaats/, // NL in plaats (van)
  /\binstead\b/,
  /(en|in) lugar/, // ES en lugar de
  /stattdessen|anstatt/, // DE
  /au lieu|a la place/, // FR
  /overrul|overrid/, // overrule / override
  /overschrijf|overschrijv/, // NL overschrijven
  /forget|vergeet|vergeten|vergis/, // EN / NL / DE vergiss
  /olvid/, // ES olvidar
  /oubli/, // FR oublier
  /\bbypass/,
  /instruct(ie|ion)|instrucc|anweisung/, // instructions in NL/EN/ES/DE
];

function detectInjection(theme) {
  const normalized = theme
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  return INJECTION_PATTERNS.some((re) => re.test(normalized));
}

const DIFFICULTY_INSTRUCTIONS = {
  makkelijk:
    'mainstream top 40 hits that casual listeners and non-fans would recognize. Chart-topping songs most people have heard even if they don\'t follow the genre.',
  normaal:
    'well-known within the genre but not mainstream pop crossovers. Music lovers and genre fans know these, casual listeners probably don\'t. Avoid obvious chart hits.',
  moeilijk:
    'underground, deep cuts and album tracks only dedicated fans would know. Avoid anything that crossed over to mainstream radio. Think critically acclaimed but commercially overlooked.',
};

function buildPrompt(theme, difficulty, difficultyInstruction) {
  return `Generate exactly 20 songs for the music quiz theme: "${theme}".
Difficulty: ${difficulty} — ${difficultyInstruction}

Respond ONLY with a valid JSON array, no markdown, no explanation.
Each item: {"artist":"...","title":"...","year":YYYY}

Rules:
- Spread across different years within the theme where possible
- No duplicates
- Strictly follow the difficulty level
- Only real, existing songs
`;
}

function parseSongs(text) {
  let raw = text.trim();
  // Strip a possible markdown code fence even though we asked not to use one.
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) raw = fence[1].trim();

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1) {
    throw new Error('Geen JSON-array gevonden in het antwoord van Claude.');
  }

  const parsed = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error('Claude gaf geen array terug.');
  }

  return parsed
    .map((s) => ({
      artist: String(s.artist || '').trim(),
      title: String(s.title || '').trim(),
      year: Number(s.year),
    }))
    .filter(
      (s) =>
        s.artist &&
        s.title &&
        // Lange velden duiden op misbruik (data-exfiltratie via de output).
        s.artist.length <= MAX_FIELD_LENGTH &&
        s.title.length <= MAX_FIELD_LENGTH &&
        Number.isFinite(s.year) &&
        s.year >= 1900 &&
        s.year <= 2100
    );
}

app.post('/api/generate-songs', generateLimiter, async (req, res) => {
  try {
    const { theme, difficulty } = req.body || {};

    if (!theme || typeof theme !== 'string' || !theme.trim()) {
      return res.status(400).json({ error: 'Thema ontbreekt.' });
    }
    const trimmedTheme = theme.trim();
    if (trimmedTheme.length > MAX_THEME_LENGTH) {
      return res.status(400).json({
        error: `Thema is te lang (max ${MAX_THEME_LENGTH} tekens).`,
      });
    }
    // Prompt-injectie blokkeren.
    if (detectInjection(trimmedTheme)) {
      return res
        .status(400)
        .json({ error: 'triest Sven... heel triest...' });
    }
    const difficultyInstruction = DIFFICULTY_INSTRUCTIONS[difficulty];
    if (!difficultyInstruction) {
      return res
        .status(400)
        .json({ error: 'Ongeldige moeilijkheidsgraad (makkelijk/normaal/moeilijk).' });
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return res
        .status(500)
        .json({ error: 'ANTHROPIC_API_KEY is niet ingesteld op de server.' });
    }
    if (!withinDailyQuota()) {
      return res.status(429).json({
        error: 'Daglimiet bereikt. Probeer het morgen opnieuw.',
      });
    }

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: buildPrompt(trimmedTheme, difficulty, difficultyInstruction),
        },
      ],
    });

    const text = message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    const songs = parseSongs(text);
    if (songs.length === 0) {
      return res
        .status(502)
        .json({ error: 'Claude gaf geen bruikbare nummers terug.' });
    }

    res.json({ songs });
  } catch (err) {
    console.error('generate-songs fout:', err);
    res.status(500).json({ error: err.message || 'Onbekende serverfout.' });
  }
});

// Zoekt een 30-seconden preview-MP3 — eerst bij iTunes, dan bij Deezer.
// Server-side om CORS-problemen op de client te vermijden.
app.get('/api/preview', previewLimiter, async (req, res) => {
  const { artist, title } = req.query;
  if (
    !artist ||
    !title ||
    typeof artist !== 'string' ||
    typeof title !== 'string'
  ) {
    return res.status(400).json({ error: 'artist en title vereist' });
  }
  const a = artist.trim().slice(0, 100);
  const t = title.trim().slice(0, 100);
  if (!a || !t) {
    return res.status(400).json({ error: 'artist of title is leeg' });
  }
  const q = encodeURIComponent(`${a} ${t}`);

  try {
    const r = await fetch(
      `https://itunes.apple.com/search?term=${q}&entity=song&limit=3`
    );
    if (r.ok) {
      const data = await r.json();
      const hit = (data.results || []).find((x) => x.previewUrl);
      if (hit) return res.json({ previewUrl: hit.previewUrl, source: 'itunes' });
    }
  } catch (_) {}

  try {
    const r = await fetch(`https://api.deezer.com/search?q=${q}&limit=5`);
    if (r.ok) {
      const data = await r.json();
      const hit = (data.data || []).find((x) => x.preview);
      if (hit) return res.json({ previewUrl: hit.preview, source: 'deezer' });
    }
  } catch (_) {}

  return res.json({ previewUrl: null });
});

// Configuratie die de frontend nodig heeft (geen secrets).
app.get('/api/config', (_req, res) => {
  res.json({
    spotifyClientId: process.env.SPOTIFY_CLIENT_ID || null,
    spotifyEnabled: Boolean(process.env.SPOTIFY_CLIENT_ID),
  });
});

app.listen(PORT, () => {
  console.log(`Hitster draait op http://localhost:${PORT}`);
});
