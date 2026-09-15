# Marigold Valley

A mobile-first, Stardew Valley–style web UI for a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent).
You chat with Hermes, and a pixel-art office shows every scheduled (cron) agent as a character:
they sit and type while their job runs, wander, drink coffee, play the arcade or nap on the
couch when idle, sleep when paused, and drop their work in the shipping bin when a run finishes.
A spotted office dog follows people around, and there are marigolds in the window boxes.
Two mice (white and black) hide in a baseboard hole and under the furniture, dash out every minute
or so, and bolt when the dog or ferret comes near. The ferret steals socks for a stash under the
couch, does war dances, hides in the shipping bin and cuddles everyone. The animals spend most of
their time resting. The wall clock, sky and HUD run on California time.

- Tap an agent to see its schedule, level and last report, run or pause it, or **customize** it:
  nickname, male or female body, hair or hat, shirt (T-shirt, stripes, hoodie, vest, shirt & tie,
  overalls), bottoms (pants, shorts, skirt), colors, glasses, or a quick-pick preset.
- Tap 🎨 to **decorate** the office: wallpaper (7), floor (4), desk/shelf wood (5), couch (5) and
  rug (4). Changes preview live and are shared by every device once saved.
- Agents earn **XP**: +50 when a skill they use is created or improved (Hermes earns it for every
  skill), +5 per finished run. Levels follow Stardew's curve (1–10).
- The chat can be minimized to a floating button; it shows a badge when Hermes replies.

## Layout

- `public/` — the whole UI (plain HTML/CSS/JS, no build step). `office.js` draws the room and
  characters on a canvas; `app.js` handles login, chat, agent cards and the customizer.
- `server.js` — zero-dependency Node server. Serves `public/`, keeps nicknames/looks/XP in
  `$DATA_DIR/valley.json` (default `/data`), and forwards a small allowlist of `/api/*` endpoints to
  Hermes WebUI (`HERMES_UPSTREAM`, default `http://hermes-webui:8787`).

## How it talks to Hermes

It reuses the Hermes WebUI backend (nesquena/hermes-webui) that already runs next to the agent:
login (`/api/auth/*`), chat (`/api/session*`, `/api/chat/start`, SSE `/api/chat/stream`),
cron jobs (`/api/crons*`) and skill usage (`/api/skills/usage`, read server-side only).
Login is the WebUI password (`HERMES_WEBUI_PASSWORD`).

`GET /api/valley/state` returns the jobs, which ones are running, each agent's nickname/look/XP,
and any XP earned since the last call. XP is worked out on the server by diffing each skill's
`patch_count` and each job's `repeat.completed` (or `last_run_at`) against what it saw last time; the
first sync only records a baseline. `POST /api/valley/agent` saves a nickname or look, and
`POST /api/valley/decor` saves the office decor (both check the Hermes login and only accept known
values; the decor also comes back from `/api/valley/state`).

Security notes:
- Only the endpoints in `API_ALLOW` (server.js) plus the two `/api/valley/*` routes are reachable.
- The WebUI skips its CSRF token check for requests without `Origin`/`Referer`. The proxy strips
  those headers, so it enforces same-origin itself: every non-GET must come from the same host
  and carry `X-Valley: 1`. The auth cookie is re-issued `SameSite=Strict` (+ `Secure` on HTTPS).
- `/api/valley/*` checks the caller's Hermes login against the WebUI before answering.
- A cron job counts as "working" if the WebUI reports it running, or its `fire_claim`/`run_claim`
  is less than 20 minutes old.

## Local development

```bash
node dev/mock-upstream.js
```

```bash
HERMES_UPSTREAM=http://127.0.0.1:8799 DATA_DIR=dev/data node server.js
```

Open http://localhost:8080, password `valley`. The mock flips "Server Watch" between working and
idle every 20 s, improves a skill every 25 s (XP), and asks for approval if your message contains `rm`.

Icons are generated with `python3 dev/make-icons.py`.

## Deploying next to Hermes in Coolify

The service lives in the Hermes stack's compose so it shares the network with `hermes-webui`:

```yaml
  hermes-valley:
    build:
      context: 'https://github.com/marigoldx3/agent-valley.git#main'
    pull_policy: build
    environment:
      - SERVICE_FQDN_HERMESVALLEY_8080
      - 'HERMES_UPSTREAM=http://hermes-webui:8787'
    volumes:
      - 'valley-data:/data'
    depends_on:
      - hermes-webui
```

Its domain is `https://hello.mrgld.tech`. To ship a change: push to `main`, then restart the stack
(the compose runs `up --build`, so it rebuilds from git). Without the `valley-data` volume,
nicknames, looks and XP reset on every redeploy.
