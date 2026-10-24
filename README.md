# room-pwa

Room pages: each person makes their own page of device cards (shutters, aircon, fans and Hue lights), with one tap per button, as a phone app the family installs. See [PLAN.md](PLAN.md) for the design.

```
phone ──▶ Worker (shared password) ──▶ Tailscale Funnel (bearer token) ──▶ room server :8008 ──▶ RM4
```

- `worker/`: the API. `/api/house`, `/api/press` and `/api/lights` call the room server's house endpoint (`/house/mcp`) over MCP ([worker/mcp.ts](worker/mcp.ts)), one stateless `tools/call` per request, with the house token. Each person's pages are stored in D1, each press is logged with who sent it, and a person can press 4 times per 10 s at most.
- `src/`: the Svelte page, with a page menu and an editor for choosing which devices go on a page. `vite-plugin-pwa` makes it installable and caches the shell (page, scripts, styles, icons), never `/api`; the app draws the last house it saw at once and refreshes it in the background.
- `dev/fake-room.mjs`: a stand-in room server for local runs.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars            # password "dev", points at the fake room server
npx wrangler d1 migrations apply room-pwa --local
npm run fake-room                         # terminal 1 (FAIL=rm4 to simulate a dead RM4)
npm run worker                            # terminal 2: build + wrangler dev on :8787
npm run dev                               # optional: Vite with hot reload, proxies /api to :8787
npm test                                  # allowlist, rate limits, attribution, password gate
```

## Setup

See [SETUP.md](SETUP.md) for the full step-by-step instructions (Funnel, deploy, phones).

## For the family

The buttons send the same signal as the wall remote. Each card shows the last button pressed and who pressed it, not whether the shutter is open or the aircon is on: the wall remote and the Telegram bot work the devices too, and nothing reports their real state. If the app says "Can't reach home", the PC at home is off or offline. Use the wall remote.
