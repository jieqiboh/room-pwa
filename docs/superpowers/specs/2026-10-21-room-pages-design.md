# Room pages: design

Date: 2026-10-21. Status: draft for JQ's review.

## Intent

Today room-pwa controls one thing: the roller shutter in JQ's room. The family wants one app that controls the devices around the house: shutters, aircons and fans through the BroadLink RM4 pro, and the Hue lights. Each person opens the app and lands straight on **their own room page**, which holds just the devices they care about, each with just the buttons they use. Most visits are quick, one-tap jobs: cool the room, close the shutter, dim the lights.

## Words used here

- **House list:** every controllable device in the house, kept by JQ on the home PC.
- **Room page:** a person's own page of devices, named by them, such as "JQ" or "Living room". (In conversation these were first called "presets".)
- **Settings:** the recorded signals of an RM4 device. Each aircon setting is the remote's whole state in one signal, such as `cool_26_fan4`.
- **Picks:** the settings a person chose to show as buttons on a card on their page.
- **Light presets:** the existing saved Hue scenes in `~/.config/hue/presets.json` (`night`, `full white`, `night dim`), each saved for one Hue room. These are unrelated to room pages.

## Goals

1. **House list.** The room server knows every device by name, with its kind and its recorded settings. JQ adds a device by recording its remote's buttons with a command on the PC (like `learn_ir.py` today). Recording through the app is out of scope.
2. **Device kinds:**
   - **Shutter** (RM4, radio): `up`, `stop`, `down`.
   - **Aircon** (RM4, infrared): any number of recorded settings plus `off`.
   - **Fan** (RM4, infrared): whatever buttons were recorded from that fan's remote, typically speed −, speed + and swing (plus power if the remote has one). Each press sends one signal. There is no speed level, because nothing reports one. The card shows all recorded buttons; there are no picks.
   - **Lights** (Hue): one device per Hue room: `jq`, `wq room`, `Doi Moi` (the master bedroom), `Living room`, `Kitchen`, `Master Toilet`, `Common Toilet`. Controls are on, off, brightness and that room's light presets.
3. **Room pages, one person's own.** Each person creates, renames, reorders and deletes their own room pages, and adds, removes and reorders devices on each page. Nobody sees anyone else's pages. A device can appear on any number of people's pages.
4. **Picks, per person, per card.** For an aircon, the person ticks which recorded settings appear as buttons. Example: JQ ticks `Cool 24 fan 2`, `Cool 26 fan 4` and `Off`; another person ticks `Cool 22 fan 1` and `Off`. For lights, the person ticks which of that room's light presets appear. On/off and brightness are always on the lights card. Shutter and fan cards always show all their buttons, with nothing to pick.
5. **Opening the app** shows the room page the person last used. A switcher at the top ("JQ ▾") moves between their own pages, and also leads to creating and editing pages.
6. **One-tap page layout (layout A, chosen from mockups).** Everything is on one scrolling screen. Each device is a card with its buttons always visible. One tap sends.
7. **Honest status.** Each RM4 card shows the last button sent to that device, when, and by whom ("Last: Off · 11:40pm by WQ"). Last-sent is per device and shared by everyone. It is never presented as the device's real state, since the RM4 is one-way and real remotes change things too. The lights card can show real state (on/off and brightness), because the Hue Bridge reports it.
8. **Today's devices carry over.** JQ's existing shutter (`~/.config/hue/shutter_codes.json`) and aircon (`~/.config/room/aircon_codes.json`) become "JQ shutter" and "JQ aircon" on the house list, with their recorded settings intact.

## Non-goals (for now)

- **One-tap combos** across devices, such as "Bedtime: shutter down, aircon 26, lights night". JQ wants this **next**, so the design must not make it awkward to add: a combo is a list of (device, setting) presses.
- Recording remote signals from the app.
- Schedules, timers and automations.
- Real device state for RM4 devices.
- Sharing room pages between people.
- Changing the Telegram bot. The PWA is a separate product, and the bot's behaviour stays exactly as it is today.

## Anti-goals: it fails if...

- A tap needs more than one step on the room page.
- The app claims a shutter is open, or an aircon is on, when it only knows what was last sent.
- The Telegram bot gains access to rooms beyond `jq`, or loses any of its current tools.
- Two programs drive the RM4 at once.

## Constraints

- **One RM4** (`192.168.0.12`) for the whole house. JQ decided to assume it reaches every device (everything is within about 10 m); this is untested for infrared devices outside JQ's room. Build for exactly one RM4, as the server does today: no per-device RM4 field. If a room later turns out to be out of reach, multi-RM4 support is a separate change.
- **The room server is the only thing that talks to the RM4 and the Hue Bridge.** It lives in agent-platform (`servers/room`, Python, MCP over Streamable HTTP, one asyncio lock around the RM4) and runs on the PC as the `room` systemd service on `100.76.62.36:8008`. It is reached from the Worker through Tailscale Funnel at `https://jieqiboh.tail568a82.ts.net/mcp`. Extend it; don't add a second server that drives the RM4.
- **The bot's limits stay.** Today `ROOM_ROOMS=jq` limits the server's Hue access to JQ's room for every client. The PWA needs the whole house, the bot must stay at `jq`, and both currently use the same token (`ROOM_TOKEN`). The builder chooses how to separate them, for example a second token for the PWA that unlocks house-wide tools.
- **The Worker allowlist** ([worker/mcp.ts](../../../worker/mcp.ts) `ALLOWED_TOOLS`) is the line that controls what the family app can reach. It gets the new house-wide tools and nothing else.
- **Sign-in stays as it is:** a name typed by the person plus the shared family password, with a one-year cookie ([worker/auth.ts](../../../worker/auth.ts)). Room pages belong to that typed name. Anyone who types "Mum" sees Mum's pages, which is acceptable within the family.
- **Rate limit:** keep a per-person press limit, as in [worker/shutter.ts](../../../worker/shutter.ts), now counting across all devices.
- **Stack:** Svelte + TypeScript PWA, Cloudflare Worker, D1 (`room-pwa`), deployed by `npm run deploy`. Keep it.

## Decided

| Decision | Who decided |
|---|---|
| Each person sets up their own pages on their phone | JQ |
| Pages are private to the person | JQ |
| Layout A: one screen, all buttons visible | JQ (mockup) |
| Picks per person per card (aircon settings, light presets) | JQ |
| Fan is plain buttons (speed −/+, swing), no picks | JQ |
| Fan card shows whatever buttons were recorded for that fan, not a fixed set | My call |
| Recording signals stays a PC command | JQ |
| Combos are left out now and come next | JQ |
| Bot is not part of this; it stays unchanged | JQ |
| Assume one RM4 is enough for the whole house | JQ |
| Room pages and picks stored server-side (D1) under the sign-in name, so they survive a new phone | My call |
| Extend the existing room server rather than writing a second one | My call |
| One lights device per Hue room, not per bulb | My call |
| The term "room page" (and "picks"), to avoid clashing with Hue light presets | My call, renameable |

## Left to the builder

- The house-list file format on the PC, and how recorded codes are stored per device. Must cover: id, display name, kind, and settings mapped to a code with a human label (`cool_26_fan4` → "Cool 26 · fan 4").
- The shape of the new room-server tools, for example `devices()`, `press(device, setting)`, `device_status(device)` and house-wide light tools, and how they're kept away from the bot.
- How `learn_ir.py` gains a `--device` option, or similar, and how shutter radio codes get recorded on the PC. Today they come from the Mac Hue app's `shutter.py`.
- D1 schema for room pages, cards, order and picks, plus how the existing `presses` table gains a device column. Migrate existing rows as "JQ shutter".
- The editing screens: creating a page, adding devices, ticking picks, reordering. These were not mocked up, so keep them plain and phone-first.
- Matching "by whom" on last-sent, as today: match the room server's `sent_at` against the Worker's own press log.
- Updating SETUP.md and both READMEs for the new device workflow.
