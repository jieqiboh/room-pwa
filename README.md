# room-pwa

Up / Stop / Down for the roller shutter, as a phone app the family installs. See [PLAN.md](PLAN.md) for the design.

```
phone ──▶ Worker (shared password) ──▶ Tailscale Funnel (bearer token) ──▶ room server :8008 ──▶ RM4
```

- `worker/`: the API. `GET/POST /api/shutter` call the room server over MCP ([worker/mcp.ts](worker/mcp.ts)), which only lets `shutter` and `shutter_status` through. Each press is logged in D1 with who sent it, and a person can press 4 times per 10 s at most.
- `src/`: the Svelte page. `vite-plugin-pwa` makes it installable and caches only scripts, styles and icons, never `/api`.
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

The buttons send the same signal as the wall remote. "Last sent" shows the last button pressed and who pressed it, not whether the shutter is open: the wall remote and the Telegram bot move it too, and nothing reports where it actually is. If the app says "Can't reach home", the PC at home is off or offline. Use the wall remote.
