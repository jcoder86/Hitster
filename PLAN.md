# Hitster — Implementatieplan

Digitale muziekquiz: teams raden nummers en rangschikken kaartjes chronologisch op jaartal. Eerste team met X kaartjes wint.

## Bestandsstructuur

```
hitster/
├── PLAN.md             # Dit plan
├── server.js           # Express app + API endpoints
├── package.json        # Dependencies + start script
├── .env                # ANTHROPIC_API_KEY (niet committen)
├── .gitignore          # node_modules, .env
├── docker-compose.yml  # NIET aanraken — door gebruiker beheerd
├── Dockerfile          # NIET aanraken — door gebruiker beheerd
└── public/
    ├── index.html      # Volledige frontend (setup + game + win in één file)
    ├── style.css       # Alle CSS inclusief animaties
    └── app.js          # Vanilla JS spellogica
```

## Tech stack

- **Backend:** Node.js + Express
- **Frontend:** Plain HTML + vanilla JS (geen framework)
- **State:** in-memory per sessie (geen database)
- **CSS:** eigen styling, geen framework
- **API client:** `@anthropic-ai/sdk`, `dotenv`
- **Docker:** `docker-compose.yml` en `Dockerfile` worden NIET aangeraakt

## Dependencies (`package.json`)

- `express` — webserver + static files serveren
- `@anthropic-ai/sdk` — Claude API calls
- `dotenv` — laadt `ANTHROPIC_API_KEY` uit `.env`

## Features in volgorde van bouwen

### Feature 0 — Project setup
`package.json`, `.gitignore`, `git init`, basis `server.js` die `public/` serveert en op `PORT` (default 3000) draait.

### Feature 1 — Song generatie via Claude API (server-side)
Endpoint `POST /api/generate-songs`:
- Ontvangt `{ theme, difficulty }`
- Roept Claude API aan met system prompt + difficulty-instructie
- Parseert de JSON-array respons en geeft `[{ artist, title, year }]` (20 songs) terug
- API key uitsluitend server-side
- **Commit**

### Feature 2 — YouTube embed met automatische fallback
Frontend audio-engine (in `app.js`):
- YouTube IFrame API iframe met zoekterm `${artist} ${title} official audio`, `enablejsapi=1`
- Volledige overlay-div (zwart, hogere z-index) verbergt het iframe
- Fallback bij error 150/101 of 5s timeout → iTunes Search API → eerste `previewUrl` via hidden `<audio>`
- Geen preview → subtiele melding, ONTHUL-knop blijft zichtbaar
- SPEEL-knop is altijd de trigger (autoplay vereist user gesture)
- **Commit**

### Feature 3 — Setup scherm
- Thema-tekstveld + klikbare suggesties (`90s Hip-Hop`, `Nederhop`, `Top2000`)
- Moeilijkheidsknoppen MAKKELIJK/NORMAAL/MOEILIJK
- Aantal teams 2–6, bewerkbare teamnamen met gekleurde stip
- Winconditie-slider 3–15 (default 8)
- START SPEL → laadspinner → `/api/generate-songs` → spelscherm; bij fout rode foutmelding
- **Commit**

### Feature 4 — Spelscherm
- Header (logo / thema+moeilijkheid / "X over")
- Kaart met 3 staten: idle (vinyl), playing (equalizer), revealed (jaar/artiest/titel + teamknoppen + "NIEMAND — WEG")
- Teamoverzicht onderaan: stip, naam, teller, voortgangsbalk, chronologische chips
- Winconditie-check → win-scherm
- **Commit**

### Feature 5 — Win scherm
- Grote winnaarsnaam in teamkleur, ondertitel "met X kaartjes"
- Tijdlijn van gewonnen kaartjes (jaar · artiest)
- OPNIEUW → terug naar setup
- **Commit**

## API's

### Claude API (server-side, via `@anthropic-ai/sdk`)
- Model: `claude-opus-4-7` (recentste model)
- Difficulty-instructies (exacte formuleringen):
  - **makkelijk:** "mainstream top 40 hits that casual listeners and non-fans would recognize. Chart-topping songs most people have heard even if they don't follow the genre."
  - **normaal:** "well-known within the genre but not mainstream pop crossovers. Music lovers and genre fans know these, casual listeners probably don't. Avoid obvious chart hits."
  - **moeilijk:** "underground, deep cuts and album tracks only dedicated fans would know. Avoid anything that crossed over to mainstream radio. Think critically acclaimed but commercially overlooked."
- System prompt: genereert exact 20 songs als JSON-array `{"artist","title","year"}`

### YouTube IFrame API (client-side)
- Iframe met `enablejsapi=1`, zoekterm-embed; volledig overlayed zodat alleen audio hoorbaar is
- Error 150/101 of 5s timeout → fallback

### iTunes Search API (client-side fallback)
- `https://itunes.apple.com/search?term=${encodeURIComponent(artist+' '+title)}&entity=song&limit=3`
- Eerste `previewUrl` (30-sec MP3) via hidden `<audio>`

## Design

- **Fonts:** Bebas Neue (titels/knoppen/labels), Playfair Display (artiest/titel), IBM Plex Mono (data/jaren/scores)
- **Kleuren:** bg `#0c0c10`, kaart `#13131a`, accent `#f5e642`, tekst `#f2f0eb`
- **Moeilijkheid:** groen `#06d6a0`, geel `#ffd166`, rood `#ef476f`
- **Teams:** `["#ef476f","#06d6a0","#ffd166","#118ab2","#9b5de5","#f77f00"]`
- **Animaties (CSS only):** vinyl rotate 2.4s, equalizer 8 bars, kaart `fadeUp` 0.35s, start-knop `glow` 2.2s, SPEEL-knop `softPulse` 1.8s

## Opmerkingen

- Game state leeft in-memory in de browser (`app.js`) per sessie
- Geen TypeScript, geen build tooling, geen tests
- Commit na elke feature met duidelijke message
