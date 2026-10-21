# Room Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-shutter app into a house app: a house list of devices on the room server, and per-person room pages in the PWA with one-tap cards.

**Architecture:** The room server (agent-platform, Python) reads a house list (`~/.config/room/house.json`). It serves three new tools (`house`, `press`, `lights`) from a second MCP endpoint, `/house/mcp`, guarded by its own token, `ROOM_HOUSE_TOKEN`. The bot's `/mcp` endpoint, token, tools and `ROOM_ROOMS=jq` limit stay exactly as they are. Both endpoints run in one process and share one `Rm4`. The Worker calls only the house endpoint, stores each person's room pages as one JSON document in D1, and logs every press with its device. The Svelte client renders the chosen page with layout A (all buttons visible) and has a plain editor.

**Tech Stack:** Python 3.11, `mcp` 2.3.0 (`MCPServer`), Starlette, broadlink, httpx, pytest (agent-platform). Svelte 5 + TypeScript, Cloudflare Worker, D1, vitest (room-pwa).

**Spec:** [docs/superpowers/specs/2026-10-21-room-pages-design.md](../specs/2026-10-21-room-pages-design.md)

## Global Constraints

- **Never run `git add`, `git commit` or `git push`.** JQ commits. Every task ends by stopping so JQ can review the diff.
- Make surgical changes only: no refactoring or renaming of code a task doesn't need.
- Two repos: `~/Documents/agent-platform/servers/room` (run Python with `env -u PYTHONPATH .venv/bin/python`) and `~/Documents/room-pwa`.
- The bot stays unchanged: the `/mcp` endpoint's tool list, its token (`ROOM_TOKEN`) and its `ROOM_ROOMS=jq` limit. Existing `tests/test_server.py` tests must keep passing untouched.
- Exactly one RM4. There is no per-device RM4 field.
- The JQ shutter's house id is `shutter` and the JQ aircon's is `aircon`. These equal the existing `Rm4` remote names, so the bot and the app share one last-sent record per device.
- RM4 status is never shown as real state. Copy: "Last: Off · 11:40pm by WQ".
- Device kinds are exactly `shutter`, `aircon`, `fan` and `lights`.
- The per-person rate limit is 4 presses per 10 s (`RATE_LIMIT`, `RATE_WINDOW_MS`), counted across all devices.
- Sign-in stays unchanged (typed name + `SITE_PASSWORD`).

## Review Focus

1. **The PC is off or Funnel is down.** `GET /api/house` still returns 200 with the person's layout, `reachable: false` and the "Can't reach home" message. The page shows their cards with buttons disabled and doesn't blank out. Pinned in Task 5 (`getHouse when home is unreachable`).
2. **A device was removed from house.json, or a pick was never recorded or was renamed.** The card shows "No longer available" or simply skips the stale pick. It never throws. Pinned in Task 6 (`cardView` tests).
3. **A bad house.json** (unparseable, a duplicate id, an unknown kind, an rm4 device without `codes`). The server still starts, the bot's tools still work, the bad entries are skipped and a warning is logged. Pinned in Task 1.
4. **A garbage or oversized `PUT /api/layout`** (wrong types, 1000 pages, control characters in names). The Worker answers 400 and stores nothing. Pinned in Task 4.
5. **The Hue Bridge is unreachable while the RM4 works.** `house()` still returns every RM4 device, and each lights device carries an `error` instead of the whole call failing. Pinned in Task 2.

---

### Task 1: House list loader (agent-platform)

**Files:**
- Create: `servers/room/house.py`
- Test: `servers/room/tests/test_house.py`

**Interfaces:**
- Produces:
  - `HOUSE_PATH = os.path.expanduser("~/.config/room/house.json")`
  - `RM4_KINDS = ("shutter", "aircon", "fan")`
  - `@dataclass(frozen=True) class Entry: id: str; name: str; kind: str; codes: str | None = None; hue_room: str | None = None; labels: dict[str, str] = field(default_factory=dict)`
  - `load_house(path: str = HOUSE_PATH) -> list[Entry]`: entries in file order.
  - `label(code: str) -> str`
  - `class Button(BaseModel): id: str; label: str`
  - `buttons(entry: Entry, codes: dict[str, str]) -> list[Button]`

File format (`devices` is a list, in display order):
```json
{"devices": [
  {"id": "shutter", "name": "JQ shutter", "kind": "shutter", "codes": "~/.config/hue/shutter_codes.json"},
  {"id": "aircon", "name": "JQ aircon", "kind": "aircon", "codes": "~/.config/room/aircon_codes.json",
   "labels": {"cool_26_fan4": "Cool 26 · fan 4"}},
  {"id": "jq-lights", "name": "JQ lights", "kind": "lights", "hue_room": "jq"}
]}
```

- [ ] **Step 1: Write the failing tests** in `tests/test_house.py`:
  - `test_loads_entries_in_order`: the three-entry file above loads as three `Entry`s in order. `codes` is expanded with `os.path.expanduser`, and `labels` is kept.
  - `test_missing_file_is_empty_house`: `load_house(tmp/"nope.json") == []`.
  - `test_bad_entries_are_skipped_with_warning` (uses `caplog`): the file has a duplicate id, `kind: "toaster"`, an aircon with no `codes`, lights with no `hue_room`, and an id `"Bad Id"`. Only the valid entries remain, and each skipped entry leaves a WARNING line naming it.
  - `test_unparseable_file_is_empty_house_with_warning`: the file content is `"{nope"`, the result is `[]`, and a warning is logged.
  - `test_label`: `label("cool_26_fan4") == "Cool 26 fan4"`, `label("off") == "Off"` and `label("speed_up") == "Speed up"`.
  - `test_buttons`: a shutter with codes `{"down","stop","up"}` gives ids `["up","stop","down"]`. An aircon with codes `{"off": "aa", "cool_26_fan4": "bb"}` and labels `{"cool_26_fan4": "Cool 26 · fan 4"}` gives `[Button(id="off", label="Off"), Button(id="cool_26_fan4", label="Cool 26 · fan 4")]`, in the codes file's order.
- [ ] **Step 2: Run** `env -u PYTHONPATH .venv/bin/python -m pytest -q tests/test_house.py`. Expected: FAIL (no module `house`).
- [ ] **Step 3: Implement `house.py`.**
  - An id must match `^[a-z0-9][a-z0-9-]{0,39}$`.
  - RM4 kinds need `codes`, and `lights` needs `hue_room`.
  - `label` replaces `_` with a space and capitalises the first letter.
  - In `buttons`, the shutter's order is up/stop/down (those present). Other kinds use the codes dict's order. A label comes from `entry.labels` or else from `label(code)`.
  - Log through `logging.getLogger("room")`.
- [ ] **Step 4: Run** the same command. Expected: all pass. Also run the full suite: `env -u PYTHONPATH .venv/bin/python -m pytest -q`.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 2: House tools (agent-platform)

**Files:**
- Modify: `servers/room/rm4.py` (`Rm4.status`, `UNKNOWN`)
- Modify: `servers/room/server.py` (add `build_house_server`)
- Test: `servers/room/tests/test_house_server.py`

**Interfaces:**
- Consumes: `Entry`, `RM4_KINDS`, `Button`, `buttons` (Task 1). Also `Rm4.send(remote, action) -> Sent`, `Rm4._codes(remote)`, `Hue.status() -> Status`, `Hue.set(target, on, brightness) -> Changed`, `Hue.presets() -> Presets`, `Hue.apply_preset(name) -> Changed`.
- Produces:
  - In `rm4.py`: `Rm4.status(remote)` falls back to a generic note when `remote` isn't in `UNKNOWN`: `"This is only the last command this server sent, not the device's state: the RM4 gets no reply, and the device's own remote can change it too."` Also add `def codes(self, remote) -> dict[str, str]` as the public form of `_codes`.
  - In `server.py`: `build_house_server(house: list[Entry], rm4: Rm4 | None, hue: Hue | None) -> MCPServer`, named `"house"`, with these tools:
    - `house() -> House`, where `class Device(BaseModel): id: str; name: str; kind: str; buttons: list[Button] = []; presets: list[str] = []; last_action: str | None = None; sent_at: str | None = None; on: bool | None = None; brightness: int | None = None; error: str | None = None` and `class House(BaseModel): devices: list[Device]`.
    - `press(device: str, button: str) -> Sent`, for RM4 devices only.
    - `lights(device: str, on: bool | None = None, brightness: int | None = None, preset: str | None = None) -> Changed`, for lights devices only.
  - Put `Device` and `House` in `house.py`.

- [ ] **Step 1: Write the failing tests** in `tests/test_house_server.py`. Reuse `FakeHue`/`FakeRm4` patterns from `test_server.py`: a FakeRm4 with `codes()` and `status()`, and a FakeHue whose `status()` returns rooms `jq` (two lights: on 40%, off) and `wq room` (all off), and whose `presets()` returns `night` (room `jq`) and `reading` (room `wq room`).
  - `test_house_lists_devices_with_status`: with the three Task 1 entries, `house` returns the devices in order. `shutter` has buttons up/stop/down and `last_action` from the fake status. `jq-lights` has `on is True`, `brightness == 40` (the average of the lit lights) and `presets == ["night"]`.
  - `test_press_sends_to_rm4`: `press(device="aircon", button="off")` results in `rm4.calls == [("aircon", "off")]`. Pressing a lights device returns an error result whose text contains "not an RM4 device". An unknown device returns an error result containing "no device".
  - `test_lights_targets_the_hue_room`: `lights(device="jq-lights", brightness=30)` calls `("set", "jq", None, 30, None, None)`. `lights(device="jq-lights", preset="night")` calls `("preset", "night")`. Using `preset="reading"` on `jq-lights` is an error ("not a jq preset"). Using `on` and `preset` together is an error.
  - `test_house_survives_hue_down`: FakeHue's `status()` raises `ToolError("cannot reach the Hue bridge")`. `house` still returns every device. `jq-lights.error` contains "Hue bridge", and the RM4 devices have no error.
  - `test_generic_status_note`: `Rm4.status("jq-fan")` (with a real `Rm4` and a temp codes file, as in `test_rm4.py`) returns the generic note and the choices from the file.
- [ ] **Step 2: Run** `env -u PYTHONPATH .venv/bin/python -m pytest -q tests/test_house_server.py`. Expected: FAIL.
- [ ] **Step 3: Implement.** The `house()` lights state comes from one `hue.status()` call, with rooms matched by name case-insensitively. A lights device's presets are the `hue.presets()` entries whose `room` equals its `hue_room`, case-insensitively. Tool docstrings carry the "NOT real state" wording, as the bot's tools do.
- [ ] **Step 4: Run** the full suite. Expected: all pass, including the untouched `test_server.py`.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 3: Second endpoint, wiring and the RF recorder (agent-platform)

**Files:**
- Modify: `servers/room/server.py` (`build_app`, `main`)
- Modify: `servers/room/learn_ir.py`
- Modify: `servers/room/README.md`, `servers/room/SETUP.md`, `servers/room/room.service` (comment only, no new `Environment=`; the token lives in `~/.config/room/env`)
- Test: `servers/room/tests/test_house_server.py`, `servers/room/tests/test_learn.py`

**Interfaces:**
- Consumes: `build_house_server` (Task 2), `load_house`, `RM4_KINDS` (Task 1).
- Produces:
  - `build_app(hue, token, allowed_hosts=(), rm4=None, remotes=(), house_server=None, house_token=None)`. When both house arguments are given, the house server is reachable at `/house/mcp` behind `BearerAuth(..., house_token)`, and `/mcp` behaves as today. One Starlette app runs both servers' `session_manager.run()` in its lifespan. Without house arguments, the app returns exactly what it returns today.
  - In `main()`: read `ROOM_HOUSE_TOKEN` and `ROOM_HOUSE` (default `HOUSE_PATH`). Build `Rm4(host, {**legacy_remotes, **{e.id: e.codes for e in house if e.kind in RM4_KINDS}}, state_path)`, but gate the bot's shutter and aircon tools on `legacy_remotes` only. Build a second `Hue(ip, key, presets_path, rooms=None)` for the house. Start the house endpoint only when `ROOM_HOUSE_TOKEN` is set. The startup line adds `, house N devices` or `, house off`.
  - In `learn_ir.py`: `learn(dev, rf: bool, seconds: int, sleep=time.sleep, now=time.time) -> bytes | None`, plus a `--rf` flag. RF uses `dev.sweep_frequency()`, polls `dev.check_frequency()` until true, then `dev.find_rf_packet()`, then polls `check_data()` as the IR path does. Infrared stays exactly as today.

- [ ] **Step 1: Write the failing tests.**
  - `test_house_endpoint_has_its_own_token` (TestClient, base_url `http://127.0.0.1:8008`): `POST /house/mcp` initialize returns 200 with the house token and 401 with the bot token. `POST /mcp` returns 200 with the bot token and 401 with the house token.
  - `test_bot_endpoint_unchanged_without_house`: `build_app(FakeHue(), TOKEN)` and `/house/mcp` gives 404 or 401, never 200.
  - In `tests/test_learn.py`: `test_learn_ir_returns_packet` uses a fake device whose `check_data` raises `ReadError` twice and then returns `b"\x26\x00"`. `test_learn_rf_sweeps_first`: the fake records the call order `["sweep_frequency", "check_frequency", "find_rf_packet", "check_data"]`. `test_learn_times_out` returns `None`.
- [ ] **Step 2: Run** the full suite. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `build_app`, `main` and `learn`. In the README, document `house.json` (the format from Task 1), the three house tools, `ROOM_HOUSE_TOKEN` and `ROOM_HOUSE` in the env table, and recording a new device: `learn_ir.py speed_up --codes ~/.config/room/codes/jq-fan.json` for IR, and `learn_ir.py up --rf --codes ~/.config/room/codes/wq-shutter.json` for a shutter. In SETUP.md, add generating `ROOM_HOUSE_TOKEN` into `~/.config/room/env` the same way `ROOM_TOKEN` is made.
- [ ] **Step 4: Run** the full suite. Expected: all pass.
- [ ] **Step 5: Go live on the PC.** JQ runs the `sudo` steps.
  1. Append the house token: `(umask 077; printf 'ROOM_HOUSE_TOKEN=%s\n' "$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')" >> ~/.config/room/env)`.
  2. Write `~/.config/room/house.json` with `shutter`, `aircon` and one lights device per Hue room: `jq`, `wq room`, `Doi Moi`, `Living room`, `Kitchen`, `Master Toilet`, `Common Toilet`. Use ids such as `jq-lights` and `doi-moi-lights`, and names such as "JQ lights" and "Doi Moi lights".
  3. Restart: `sudo systemctl restart room`. Then check that `journalctl -u room -n 5 --no-pager` shows `house 9 devices`.
  4. Verify with curl through Funnel (as in room-pwa SETUP.md Part B, using `ROOM_HOUSE_TOKEN`): `/house/mcp` initialize returns 200, and `tools/list` gives exactly `house`, `lights`, `press`. The old `/mcp` with `ROOM_TOKEN` still lists the bot's 8 tools.
- [ ] **Step 6: Stop for JQ to review and commit.**

### Task 4: Layouts in D1 (room-pwa)

**Files:**
- Create: `migrations/0002_room_pages.sql`, `worker/layout.ts`
- Modify: `tests/helpers.ts` (`fakeDb` applies every `migrations/*.sql` in name order), `worker/index.ts` (routes)
- Test: `tests/layout.test.ts`

**Interfaces:**
- Produces:
  - Migration:
    ```sql
    ALTER TABLE presses ADD COLUMN device TEXT NOT NULL DEFAULT 'shutter';
    CREATE INDEX IF NOT EXISTS idx_presses_device_sent_at ON presses (device, sent_at);
    CREATE TABLE IF NOT EXISTS layouts (who TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL);
    ```
  - In `worker/layout.ts`:
    - `interface Card { device: string; picks: string[] }`, `interface Page { id: string; name: string; cards: Card[] }`, `interface Layout { pages: Page[]; last: string | null }`
    - `LIMITS = { pages: 20, cards: 30, picks: 40, text: 60 }`
    - `parseLayout(body: unknown): Layout | null`: page names go through `cleanName` from `auth.ts`. Ids, devices and picks are non-empty strings of at most `LIMITS.text` characters, and page ids are unique. A `last` that isn't one of the page ids becomes `null`.
    - `getLayout(env: Env, who: string): Promise<Layout>`: `{pages: [], last: null}` when there's no row.
    - `putLayout(req: Request, env: Env, who: string, now = Date.now()): Promise<Response>`: 400 `{error: "That page setup isn't valid."}` or 200 with the saved layout.
  - Routes: `GET /api/layout` and `PUT /api/layout`.

- [ ] **Step 1: Write the failing tests** in `tests/layout.test.ts`:
  - `round-trips a layout per person`: Mum's PUT, then GET as Mum, returns it, and GET as JQ returns the empty layout.
  - `rejects bad layouts and stores nothing`, for each of: `null`, `{pages: "x"}`, 21 pages, a page with 31 cards, a duplicate page id, a page name that is only control characters, and a pick of 61 characters. Each gets 400, and a following GET is still the previous layout.
  - `cleans names and drops an unknown last`: the name `"  Living\n room "` is stored as `"Living room"`, and `last: "zzz"` is stored as `null`.
  - `migration keeps old presses as the JQ shutter`: insert a press without `device` and read it back with `device === "shutter"`.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** the migration, `layout.ts`, the routes and the `fakeDb` change.
- [ ] **Step 4: Run** `npm test && npm run check`. Expected: all pass with 0 errors.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 5: House API in the Worker (room-pwa)

**Files:**
- Create: `worker/house.ts`
- Delete: `worker/shutter.ts`, `tests/shutter.test.ts` (their behaviour moves here)
- Modify: `worker/mcp.ts` (`ALLOWED_TOOLS = new Set(["house", "press", "lights"])`, and update the comment), `worker/index.ts`, `tests/helpers.ts` (`fakeRoom` speaks the house tools), `tests/mcp.test.ts` (tool names only)
- Test: `tests/house.test.ts`

**Interfaces:**
- Consumes: `callTool`, `RoomUnreachable`, `ToolFailed` (`mcp.ts`), `getLayout` (Task 4), and the house tool shapes (Task 2).
- Produces:
  - `RATE_LIMIT = 4`, `RATE_WINDOW_MS = 10_000`, and `MESSAGES = { unreachable: "Can't reach home. Is the PC on?", toolFailed: "Home answered, but the device didn't. Try again, or use its own remote.", rateLimited: "Too many presses. Wait a few seconds and try again.", badRequest: "Unknown button." }`
  - `getHouse(env, who, fetchFn = fetch): Promise<Response>` returns `{ me, layout, reachable, error?, devices: (Device & { by: string | null })[] }`. Here `by` is the `presses.who` whose `(device, sent_at)` matches the device's `sent_at`, and `null` otherwise (a press from the bot, for example).
  - `postPress(req, env, who, fetchFn = fetch, now = Date.now())`: body `{device: string, button: string}`, returns `{ last: { action, sent_at, by } }`.
  - `postLights(req, env, who, fetchFn = fetch, now = Date.now())`: body `{device, on?, brightness?, preset?}`, returns `{ done, note }`. It is logged in `presses` with action `on`, `off`, `brightness 40` or `preset night`.
  - Routes: `GET /api/house`, `POST /api/press` and `POST /api/lights`. Remove `/api/shutter`.

- [ ] **Step 1: Write the failing tests** in `tests/house.test.ts`. Port the still-relevant cases from the old `shutter.test.ts`: sending, unknown body → 400, room down → 502 with `MESSAGES.unreachable`, tool error → 502 with `MESSAGES.toolFailed`, and failed presses logged with an error.
  - `getHouse returns layout, devices and who pressed`: Mum presses `aircon`/`off`, and JQ's `getHouse` shows the aircon with `last_action: "off"` and `by: "Mum"`.
  - `by is per device`: identical `sent_at` values on `shutter` and `aircon` don't cross-attribute.
  - `getHouse when home is unreachable`: `room.fail = "down"` gives status 200, `reachable: false`, `error: MESSAGES.unreachable`, the stored layout intact, and `devices: []`.
  - `rate limit counts across devices`: 4 presses on four devices, then a 5th within 10 s, gives 429. Another person isn't limited.
  - `lights validates and logs`: `{device: "jq-lights", brightness: 40}` reaches the fake as `lights` with those args and logs `brightness 40`. `{device: "jq-lights"}` with nothing to change gives 400.
  - `only house tools reach the room server`: after a mix of calls, every `room.calls[].name` is in `["house", "press", "lights"]`.
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run check`. Expected: all pass, and `npm run check` reports 0 errors. App.svelte still imports the old `api.ts`, so leave `api.ts` compiling until Task 6.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 6: Room page view (room-pwa)

**Files:**
- Modify: `src/lib/api.ts` (replace the shutter calls), `src/App.svelte`
- Create: `src/lib/cards.ts`, `src/DeviceCard.svelte`
- Test: `tests/cards.test.ts`

**Interfaces:**
- Consumes: the Task 5 endpoints and the Task 4 layout types (mirror them in `api.ts`; the client doesn't import from `worker/`).
- Produces:
  - In `api.ts`: `getHouse(): Promise<HouseState>`, `saveLayout(l: Layout): Promise<Layout>`, `press(device: string, button: string): Promise<{last: Last}>`, `setLights(device: string, opts: {on?: boolean; brightness?: number; preset?: string}): Promise<{done: string; note: string | null}>`, plus the existing `SignedOut`.
  - In `cards.ts`: `cardView(card: Card, device: DeviceView | undefined): { missing: boolean; buttons: Button[]; presets: string[] }`. Shutter and fan get all buttons. An aircon gets `device.buttons` filtered to `card.picks`, in device order. Lights get `device.presets` filtered to `card.picks`. Stale picks are dropped, and `missing` is `true` when the device is undefined.
  - `DeviceCard.svelte` takes props `{ card, device, busy, onpress, onlights }`. It renders the mockup A card: a title, a "Last: …" line (RM4 kinds) or "On · 40%" / "Off" (lights), and one row of buttons. The lights card has On, Off, picked presets and a brightness `<input type="range" min="1" max="100">` that sends on `change`. A missing device renders "No longer available" with no buttons.
  - `App.svelte` shows the page whose id is `layout.last` (or the first page), with a header of the page name followed by "▾" (the switcher comes in Task 7), the signed-in name with "Not X?", the error banner, and the cards. It refreshes on visibility change, as today. When there are no pages, it shows "Make your first page", which creates a page named after `me` with no cards. That button's editor comes in Task 7.
- [ ] **Step 1: Write the failing tests** in `tests/cards.test.ts`:
  - `aircon shows only picks, in device order`: picks `["off", "cool_24_fan2"]` against device buttons `[cool_24_fan2, cool_26_fan4, off]` give `[cool_24_fan2, off]`.
  - `stale picks are skipped`: picks `["gone"]` give `[]` without throwing.
  - `shutter and fan show all buttons`.
  - `lights shows picked presets`.
  - `missing device`: `cardView(card, undefined).missing === true`.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement** `cards.ts`, `api.ts`, `DeviceCard.svelte` and `App.svelte`. Keep the existing dark styles from `app.css`/`App.svelte`, and the existing copy: "This shows the last button pressed…" becomes one footer line for all cards.
- [ ] **Step 4: Run** `npm test && npm run check && npm run build`. Expected: all pass. Then manual: `npm run fake-room` (update `dev/fake-room.mjs` to answer `house`, `press` and `lights` with a few sample devices) plus `npm run worker`, then sign in. The page renders, presses update "Last:", and stopping the fake room shows the banner while the cards stay.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 7: Switcher and page editor (room-pwa)

**Files:**
- Create: `src/PageEditor.svelte`, `src/lib/layout.ts`
- Modify: `src/App.svelte`
- Test: `tests/layout-edit.test.ts`

**Interfaces:**
- Consumes: `saveLayout`, `cardView`, and the types (Task 6).
- Produces:
  - In `src/lib/layout.ts`, pure functions that return new layouts:
    - `addPage(l: Layout, name: string): { layout: Layout; id: string }`: the id is `crypto.randomUUID()`, and the new page becomes `last`.
    - `removePage(l: Layout, id: string): Layout`: `last` moves to the first remaining page, or `null`.
    - `addCard(l: Layout, pageId: string, device: DeviceView): Layout`: an aircon's picks default to all its button ids; everything else gets `[]`.
    - `moveCard(l: Layout, pageId: string, index: number, delta: -1 | 1): Layout`
    - `removeCard(l: Layout, pageId: string, index: number): Layout`
    - `togglePick(l: Layout, pageId: string, index: number, pick: string): Layout`
    - `renamePage(l: Layout, id: string, name: string): Layout`
  - The header "‹page› ▾" opens a menu: the person's pages (tap to switch, which sets `last` and saves), "＋ New page" and "Edit this page".
  - `PageEditor.svelte` takes props `{ layout, pageId, devices, onsave, oncancel }`. It shows the name input, then the cards, each with ↑, ↓ and ✕. Aircon and lights cards also show checkboxes for picks (buttons or presets). Next comes "Add device", listing house devices not already on the page and grouped by kind, then a "Delete page" button that asks a second tap ("Tap again to delete"), and finally Save and Cancel. Save calls `saveLayout`.
  - When `reachable` is false, the editor's "Add device" shows "Can't reach home, so the device list isn't available." Renaming, reordering and deleting still work.
- [ ] **Step 1: Write the failing tests** in `tests/layout-edit.test.ts`, one per function. Check that inputs aren't mutated (the original layout `toEqual` its `structuredClone` taken beforehand). Also cover `removePage` of the last page giving `{pages: [], last: null}`, `moveCard` at the edges being a no-op, and `addCard` on an aircon picking all its buttons.
- [ ] **Step 2: Run** `npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test && npm run check && npm run build`. Expected: all pass. Manual against the fake room: create "JQ" and "Living room", add devices, untick an aircon setting, reorder, switch pages, reload (it lands on the last page), and delete a page.
- [ ] **Step 5: Stop for JQ to review and commit.**

### Task 8: Ship (room-pwa)

**Files:**
- Modify: `wrangler.jsonc` (`ROOM_URL` becomes `"https://jieqiboh.tail568a82.ts.net/house/mcp"`), `SETUP.md` (Part B check and Part C secret use `ROOM_HOUSE_TOKEN` and `/house/mcp`; the "If the room token ever leaks" section names both tokens), `README.md` (what the app does now)

- [ ] **Step 1:** Make the edits above. Run `npm test && npm run check`. Expected: all pass.
- [ ] **Step 2:** Run `npm run deploy`. Expected: migration `0002_room_pages.sql` is applied remotely, and the deploy prints `https://room-pwa.jieqiboh.workers.dev`.
- [ ] **Step 3:** JQ sets the new secret (writing secrets is blocked for Claude): `sed -n 's/^ROOM_HOUSE_TOKEN=//p' ~/.config/room/env | npx wrangler secret put ROOM_TOKEN`
- [ ] **Step 4:** Verify on a phone. Sign in and make the "JQ" page with JQ shutter, JQ aircon and JQ lights. Press Stop: "Last: Stop · … by JQ". Then check the bot's `rstatus` shows the same shutter command.
- [ ] **Step 5: Stop for JQ to review and commit.**
