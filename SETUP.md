# room-pwa: setup

Everything needed to take room-pwa from this repo to the family's phones, in order. Each part ends with a check; don't move on until it passes.

```
phone ──▶ Worker (shared password) ──▶ Tailscale Funnel (bearer token) ──▶ room server :8008 ──▶ RM4
          Part C                       Part A + B                          Part B
```

The Worker runs in Cloudflare's data centres and can't reach the house on its own. Tailscale Funnel gives the room server on the home PC a public HTTPS address (`https://<pc>.<tailnet>.ts.net`) that the Worker calls. No domain, port forwarding or DNS changes are needed.

**Security:** the Funnel address is public, and the room server's bearer token is its only lock. That token is a long random secret, but anyone holding it could reach the whole room server, including the lights and the aircon, not only the shutter. Keep it only on the PC, in the Worker's secrets and in the bot's config. The Worker itself only ever calls the shutter tools.

Placeholders used below:
- `<you>@<pc>`: how you ssh to the home PC (Ubuntu, `jieqiboh`)
- `<pc>.<tailnet>.ts.net`: the PC's Tailscale name (Part A)
- `<subdomain>`: your workers.dev subdomain (Part C)

## Part A: Turn on Funnel for the PC

1. Open the Tailscale admin console (login.tailscale.com/admin) → **DNS**. Make sure **MagicDNS** and **HTTPS Certificates** are both enabled.
2. On the PC, find its full Tailscale name:
   ```sh
   tailscale status --self --peers=false
   tailscale status --json | grep -m1 '"DNSName"'
   ```
   It looks like `jieqiboh.tail1234.ts.net` (ignore the trailing dot). This is `<pc>.<tailnet>.ts.net` below.
3. Allow Funnel for the PC. The easiest way is to run step 1 of Part B: if Funnel isn't allowed yet, the command prints a link. Open it and click to approve, which adds the `funnel` attribute to your tailnet's access policy.

## Part B: Publish the room server

1. On the PC, publish the room server and keep it running in the background, including after reboots:
   ```sh
   sudo tailscale funnel --bg http://100.76.62.36:8008
   tailscale funnel status
   ```
   `status` should show `https://<pc>.<tailnet>.ts.net (Funnel on)` proxying to `http://100.76.62.36:8008`.

   If your Tailscale version refuses a non-localhost target, stop here. The room server listens only on `100.76.62.36`, so it would also need to listen on `127.0.0.1`, which is a small change in agent-platform.
2. Let the room server accept the Funnel hostname:
   ```sh
   sudo systemctl edit room
   ```
   Add these lines in the editor, then save:
   ```ini
   [Service]
   Environment=ROOM_ALLOWED_HOSTS=100.76.62.36:8008,<pc>.<tailnet>.ts.net
   ```
   Then restart and check the log:
   ```sh
   sudo systemctl restart room
   journalctl -u room -n 5 --no-pager     # should say "shutter on"
   ```
   Optionally, make the same change in `servers/room/room.service` in agent-platform so the repo matches the PC.

**Check** from the Mac, with Tailscale **off** on the Mac (so you go through the public internet like the Worker does). The first command loads the room token from the PC into this shell without printing it, so run it while Tailscale is still on:
```sh
export ROOM_TOKEN=$(ssh <you>@<pc> 'sed -n "s/^ROOM_TOKEN=//p" ~/.config/room/env')
# now turn Tailscale off on the Mac, then:

# Should print HTTP 200 and an "initialize" result:
curl -s -i https://<pc>.<tailnet>.ts.net/mcp \
  -H "Authorization: Bearer $ROOM_TOKEN" -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' | head -20

# Without the token it should be refused (401):
curl -s -o /dev/null -w '%{http_code}\n' https://<pc>.<tailnet>.ts.net/mcp
```
A brand-new Funnel name can take a few minutes to appear in public DNS. If `curl` can't resolve the name, wait and retry. If the first command returns 421 or "Invalid Host header", step 2 hasn't taken effect yet.

## Part C: Deploy the Worker (on the Mac)

1. Log in and create the database:
   ```sh
   cd ~/Documents/room-pwa
   npm install
   npx wrangler login
   npx wrangler d1 create room-pwa
   ```
2. Edit [wrangler.jsonc](wrangler.jsonc):
   - `database_id`: the ID that `d1 create` printed.
   - `ROOM_URL`: `"https://<pc>.<tailnet>.ts.net/mcp"`.
3. Deploy. This builds the app, applies the D1 migration and deploys the Worker:
   ```sh
   npm run deploy
   ```
   If wrangler asks you to register a workers.dev subdomain, pick one. Note the URL it prints: `https://room-pwa.<subdomain>.workers.dev`.
4. Add the secrets. Pick a family password that's long but easy to type on a phone, such as three random words. The room token is piped straight from the PC so it never appears on screen:
   ```sh
   npx wrangler secret put SITE_PASSWORD                # type the family password
   ssh <you>@<pc> 'sed -n "s/^ROOM_TOKEN=//p" ~/.config/room/env' | npx wrangler secret put ROOM_TOKEN
   ```

**Check:** open `https://room-pwa.<subdomain>.workers.dev` on the Mac. You should see the Shutter sign-in page.

## Part D: Test for real and install on phones

1. On your phone, open `https://room-pwa.<subdomain>.workers.dev`, type your name (for example `JQ`) and the family password. You should see "Last sent: …" or "Nothing sent yet."
2. Press **Stop** (safe when the shutter isn't moving). The line should say "by JQ", and Telegram's `rstatus` should show the same command.
3. Press **Up** or **Down** once and watch the shutter move.
4. Add it to the home screen:
   - iPhone: in **Safari**, Share → **Add to Home Screen**.
   - Android: in Chrome, menu → **Install app**.
5. Repeat steps 1 and 4 on each family member's phone, with each person typing their own name. They stay signed in for a year. Tell them: "It shows the last button pressed, not whether the shutter is open. The wall remote and the Telegram bot move it too. If it says 'Can't reach home', the PC is off; use the wall remote."

## Adding someone, or locking someone out

- **Adding someone:** give them the link and the password.
- **Locking someone out** (or after the password leaks): set a new password. This signs everyone out, so everyone signs in again with the new one.
  ```sh
  npx wrangler secret put SITE_PASSWORD
  ```
- **Someone on the wrong name:** tap "Not Mum?" in the app's top-right corner and sign in again.

## If the room token ever leaks

Make a new one on the PC, restart the room server, then give it to both the Worker and the Telegram bot. Repeat step 7 of agent-platform's `servers/room/SETUP.md` for the bot.
```sh
ssh <you>@<pc> '(umask 077; sed -i "s/^ROOM_TOKEN=.*/ROOM_TOKEN=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")/" ~/.config/room/env) && sudo systemctl restart room'
ssh <you>@<pc> 'sed -n "s/^ROOM_TOKEN=//p" ~/.config/room/env' | npx wrangler secret put ROOM_TOKEN
```

To take the room server off the internet entirely: `sudo tailscale funnel --https=443 off` on the PC.

## Troubleshooting

| Symptom | Where to look |
|---|---|
| App says "Can't reach home" | Run `npx wrangler tail` while pressing a button to see the exact error. On the PC: `tailscale funnel status` and `systemctl status room`. |
| "Home answered, but the shutter remote didn't" | The RM4 at `192.168.0.12` isn't answering: check its power and Wi-Fi. `journalctl -u room -n 50 --no-pager` on the PC. |
| Sign-in page keeps coming back | `SITE_PASSWORD` secret not set (`npx wrangler secret list`), or the phone blocks cookies. |
| "Too many wrong passwords" | 10 wrong tries from one network in 15 minutes. Wait 15 minutes. |
| Part B check returns 421 / Invalid Host header | `ROOM_ALLOWED_HOSTS` drop-in not applied: `systemctl cat room` should show it, then restart. |
| Part B check returns 401 with the token | Wrong `ROOM_TOKEN`. |
| Part B check can't connect | Funnel off (`tailscale funnel status`), or the name isn't in public DNS yet. |

## Where the secrets live

| Secret | Stored in |
|---|---|
| Family password | The Worker secret `SITE_PASSWORD`, and your password manager |
| Room bearer token | `~/.config/room/env` on the PC, the Worker secret `ROOM_TOKEN`, and the Telegram bot's config |

None of these go in git.
