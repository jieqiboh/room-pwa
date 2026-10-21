import type { Env } from "./env";
import { json } from "./util";
import { userName, handleLogin, handleLogout, loginPage } from "./auth";
import { getShutter, postShutter } from "./shutter";

// The Worker handles /api/shutter and falls through to the static assets (dist/)
// for everything else. A shared-password gate fronts everything, so nothing
// reaches the room server without a signed-in person.
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);

    if (pathname === "/__login" && req.method === "POST") return handleLogin(req, env);
    if (pathname === "/__logout") return handleLogout();

    const name = await userName(req, env);
    if (!name) {
      // An API caller wants a status it can branch on, not a page of HTML.
      if (pathname.startsWith("/api/")) return json({ error: "signed out" }, 401);
      // The login page uses the icons and manifest, so those stay public.
      if (pathname.startsWith("/icons/") || pathname === "/manifest.webmanifest") return env.ASSETS.fetch(req);
      return loginPage();
    }

    if (pathname.startsWith("/api/")) {
      try {
        if (pathname === "/api/shutter" && req.method === "GET") return await getShutter(env, name);
        if (pathname === "/api/shutter" && req.method === "POST") return await postShutter(req, env, name);
        return json({ error: "not found" }, 404);
      } catch {
        return json({ error: "Something went wrong. Try again." }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
