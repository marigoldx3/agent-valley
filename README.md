# Hermes Valley

A mobile-first, Stardew Valley–style web UI for a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent).
You chat with Hermes, and a pixel-art office shows every scheduled (cron) agent as a character:
they sit and type while their job runs, wander, drink coffee, play the arcade or nap on the
couch when idle, sleep when paused, and drop their work in the shipping bin when a run finishes.

- `public/` — the whole UI (plain HTML/CSS/JS, no build step). `office.js` draws the room and
  characters on a canvas; `app.js` handles login, chat and the agent cards.
- `server.js` — zero-dependency Node server. Serves `public/` and forwards a small allowlist of
  `/api/*` endpoints to Hermes WebUI (`HERMES_UPSTREAM`, default `http://hermes-webui:8787`).

## How it talks to Hermes

It reuses the Hermes WebUI backend (nesquena/hermes-webui) that already runs next to the agent:
login (`/api/auth/*`), chat (`/api/session*`, `/api/chat/start`, SSE `/api/chat/stream`),
and cron jobs (`/api/crons*`). Login is the WebUI password (`HERMES_WEBUI_PASSWORD`).

Security notes:
- Only the endpoints in `API_ALLOW` (server.js) are reachable through this site.
- The WebUI skips its CSRF token check for requests without `Origin`/`Referer`. The proxy strips
  those headers, so it enforces same-origin itself: every non-GET must come from the same host
  and carry `X-Valley: 1`. The auth cookie is re-issued `SameSite=Strict` (+ `Secure` on HTTPS).
- A cron job counts as "working" if the WebUI reports it running, or its `fire_claim`/`run_claim`
  is less than 20 minutes old.

## Local development

```bash
node dev/mock-upstream.js
```

```bash
HERMES_UPSTREAM=http://127.0.0.1:8799 node server.js
```

Open http://localhost:8080, password `valley`. The mock flips "Server Watch" between working and
idle every 20 s, and asks for approval if your message contains `rm`.

Icons are generated with `python3 dev/make-icons.py`.

## Deploying next to Hermes in Coolify

Add a service to the Hermes stack's compose so it shares the network with `hermes-webui`:

```yaml
  hermes-valley:
    build:
      context: https://github.com/marigoldx3/agent-valley.git#main
    pull_policy: build
    environment:
      - SERVICE_FQDN_HERMESVALLEY_8080
      - HERMES_UPSTREAM=http://hermes-webui:8787
    depends_on:
      - hermes-webui
```

Then set the domain of the `hermes-valley` service to `https://hello.mrgld.tech` and restart the stack.
