require('dotenv').config();

const path = require('path');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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
    .filter((s) => s.artist && s.title && Number.isFinite(s.year));
}

app.post('/api/generate-songs', async (req, res) => {
  try {
    const { theme, difficulty } = req.body || {};

    if (!theme || typeof theme !== 'string' || !theme.trim()) {
      return res.status(400).json({ error: 'Thema ontbreekt.' });
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

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const message = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: buildPrompt(theme.trim(), difficulty, difficultyInstruction),
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

app.listen(PORT, () => {
  console.log(`Hitster draait op http://localhost:${PORT}`);
});
