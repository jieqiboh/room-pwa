# room-pwa: plan

A small web app the family installs on their phones to open, close and stop the roller shutter. Hosted on Cloudflare (a Worker), and fine if it only works at home. Separate from agent-platform, but it reuses that project's room server on the home PC as the one thing that talks to the RM4.

Status: steps 3, 4 and 6 built and tested locally against a fake room server (Svelte + TS, D1, on workers.dev). Steps 1, 2 and 5 still to do; see README.md.

## What the family gets
- One screen: **Up**, **Stop**, **Down**, big buttons, plus "last sent: down, 21:04 by Mum".
- Installable to the home screen (iPhone: Share → Add to Home Screen; Android: Install), opens full screen like an app.
- Sign in once with their email (a one-time code, no password), stays signed in for weeks.
- Honest status: the RM4 is one-way, so the app shows the **last command sent and by whom**, never "the shutter is open". The physical remote and the Telegram bot move it too.

## The constraint that shapes everything
The shutter is reached only through the RM4 pro (`192.168.0.12`), which only answers on the home network. A Cloudflare Worker runs in Cloudflare's data centres, so it **cannot reach anything in the house by itself**. Something at home has to open a path out. The pieces already there:

- The home PC (`jieqiboh`, Ubuntu, always on) runs the room server (`servers/room` in agent-platform) on `100.76.62.36:8008`, which has the `shutter(action)` and `shutter_status()` tools, owns the RM4 session, and keeps the last-sent state that the bot's `rstatus` shows.

"Only at home" does not make it easier: the obvious shortcut, the phone's browser calling the PC directly on the home network, runs into browser rules. The app is served over HTTPS from Cloudflare, so it may not call a plain-HTTP address on the LAN (mixed content), and Chrome now asks permission or blocks public sites calling private addresses (local network access). Making that work needs a real certificate on the PC for a public name that points at a private IP, which some routers block (DNS rebinding protection). Too fragile for family use.

## Proposed architecture

```
phone (PWA) ──HTTPS──▶ Cloudflare Access ──▶ Worker ──fetch──▶ Cloudflare Tunnel ──▶ home PC
  static app,          family emails,        serves the app,     outbound-only        cloudflared
  installable          one-time code         /api/shutter,       from the PC,         ──▶ room server :8008
                                             allowlist: shutter  no open ports           ──▶ RM4 ──RF──▶ shutter
                                             tools only
```

1. **Worker** (`shutter.<domain>`): serves the PWA (HTML, manifest, service worker, icons) and a tiny API:
   - `POST /api/shutter {action: up|down|stop}` and `GET /api/shutter`.
   - It calls the room server's MCP endpoint through the tunnel with the room bearer token (a Worker secret), and **only** the `shutter` and `shutter_status` tools: the room server also controls the lights and aircon, which the family app must not reach.
   - It records who pressed what (the Access identity) in Workers KV or D1, for "last sent by Mum" and a short history.
2. **Cloudflare Access** in front of the Worker: an allow list of family emails, sign-in by one-time email code. Free for up to 50 users. Nobody else can load the app or call the API.
3. **Cloudflare Tunnel** (`cloudflared` on the PC, a systemd service): an outbound connection from the PC to Cloudflare, so no router port is opened. It publishes the room server at a hostname such as `room-tunnel.<domain>`, protected by its own Access policy that admits **only the Worker** (an Access service token the Worker sends as headers). Plus the room server's own bearer token: two locks.
4. **Room server**: unchanged, except adding the tunnel's host header to `ROOM_ALLOWED_HOSTS`. Sharing it means one owner of the RM4 session and one last-sent record across the app, Telegram and `rstatus`.

Speaking MCP from the Worker is a few JSON-RPC POSTs (`initialize`, then `tools/call`) over Streamable HTTP; about 50 lines, no SDK needed. If that proves awkward, the fallback is a 30-line REST shim on the PC in front of the room server.

"Only at home": with this design it works from anywhere the family is signed in. If you want it home-only anyway, the Worker can refuse requests not coming from the home's public IP, but home IPs change, so this needs care (open question 3).

## Decisions to make first
1. **Domain on Cloudflare.** Tunnel public hostnames and Access need a domain whose DNS is on Cloudflare. `jieqiboh.me` is on Porkbun today, and `mcp.jieqiboh.me` (the claude.ai connector, Caddy on the droplet) depends on it. Options:
   - Move `jieqiboh.me` nameservers to Cloudflare (free). Recreate `mcp` as a DNS-only (grey cloud) A record to `159.223.43.200` *before* switching, so Caddy's certificates and the claude.ai connector are unaffected. **Recommended.**
   - Buy a separate cheap domain on Cloudflare for home things. Fully independent, a few dollars a year.
   - No public tunnel hostname: Workers can reach a tunnel privately (Workers VPC). Newer; check its status and pricing before relying on it.
2. **Who gets access:** the family's email addresses.
3. **Home-only or anywhere:** anywhere is simpler and still gated by sign-in; home-only needs a stable way to recognise home.
4. **Phones:** iPhone, Android or both (affects install instructions and icon sizes, not the design).

## Security notes
- Physical device, shared house: every press is tied to a signed-in person and logged.
- Access sits in front of both the app and the tunnel; the Worker is the only client the tunnel admits.
- The Worker's allowlist is the line that keeps lights and aircon out of the family app; test it.
- Secrets (room bearer token, Access service token) live only as Worker secrets and in `~/.config/room/env` on the PC; nothing in git.
- Rate-limit presses per person in the Worker (e.g. a few per 10 seconds) so a stuck button or a toddler cannot hammer the motor.

## Build steps (each one testable on its own)
1. **Domain** on Cloudflare (decision 1), with `mcp.jieqiboh.me` verified still working.
2. **Tunnel**: install `cloudflared` on the PC, create the tunnel to `http://100.76.62.36:8008`, add the Access service-token policy. Test from the Mac with `curl` and the service token: `initialize` returns 200; without the token, Access blocks it.
3. **Worker API**: `wrangler` project; `GET/POST /api/shutter` speaking MCP through the tunnel, tool allowlist, KV log. Test with `wrangler dev` and curl; then `stop` for real (does nothing when idle).
4. **PWA**: one HTML page, manifest, icons, a minimal service worker (cache the shell only; never cache API calls). Large buttons, last-sent line, works one-handed.
5. **Access for the app**: family emails, one-time code. Test sign-in on each phone; install to the home screen.
6. **Hardening**: rate limit, error messages a non-technical user understands ("Can't reach home. Is the PC on?"), and a short note for the family on what "last sent" means.

## Cost
Cloudflare Workers, KV, Tunnel and Access (up to 50 users): free tiers cover this. Optional domain: a few dollars a year.

## Not in scope (for now)
Lights and aircon in the app, partial shutter positions, push notifications, sharing with guests.
