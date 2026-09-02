# Letters to Nobody — backend

A tiny public API so letters posted on letterstonobody.net are visible to
everyone, not just the browser that wrote them.

## What it does

- `GET /api/letters` — public feed of letters (newest first). Supports
  `?mood=grief` and `?q=searchterm`, and `?limit=200`.
- `POST /api/letters` — post a new letter `{ mood, body }`. Returns the
  saved letter **and** an `ownerToken` — save that token client-side
  (e.g. localStorage); it's the only way to shred that letter later.
- `DELETE /api/letters/:id` — shred a letter. Requires the header
  `X-Owner-Token: <token>` from when it was created.
- `GET /health` — simple healthcheck.

No accounts, no login. Anyone can read every letter. Only the browser
holding the matching owner token can delete a given letter — that's what
keeps "My Letters" / "shred" working without requiring sign-in.

Letters are stored in a SQLite file (`better-sqlite3`), so there's nothing
else to provision.

## Run it locally

```bash
npm install
cp .env.example .env      # edit ALLOWED_ORIGINS if needed
npm start
```

Server listens on `http://localhost:3000` by default.

Quick test:

```bash
curl -X POST http://localhost:3000/api/letters \
  -H 'Content-Type: application/json' \
  -d '{"mood":"peace","body":"testing testing"}'

curl http://localhost:3000/api/letters
```

## Deploy (recommended: Render)

Render's free tier is enough for this — no credit card needed to start.

1. Push this folder to a GitHub repo.
2. Go to https://dashboard.render.com → **New** → **Blueprint**, point it at
   the repo. Render will read `render.yaml` and set everything up
   (a free web service + a small persistent disk for the SQLite file).
3. In the service's **Environment** settings, confirm `ALLOWED_ORIGINS`
   is set to `https://letterstonobody.net` (add more origins comma-separated
   if you test from other domains, e.g. a local dev server).
4. Deploy. Render gives you a URL like
   `https://letters-to-nobody-backend.onrender.com` — that's your `API_BASE`
   for the frontend.

Alternatives that work just as well: Railway, Fly.io, or a small VPS with
`pm2`. Any of them just needs `npm install && npm start` and a writable
disk for the `data/` folder.

Note: Render's free web services spin down after inactivity and take a
few seconds to wake up on the next request — fine for a small personal
project, just don't expect the first request after idle time to be instant.

## Notes

- Letter bodies are capped at 4000 characters.
- Posting and shredding are rate-limited (30/hour per IP) to deter spam;
  reading is limited more loosely (300/15min per IP).
- There's no profanity/abuse filter — add one (e.g. a simple wordlist or
  a moderation API) before pointing this at a large audience if that
  matters to you.
