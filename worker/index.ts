import type { Env } from "./env";
import { json } from "./util";
import { userName, handleLogin, handleLogout, loginPage } from "./auth";
import { getHouse, postBatch, postLights, postPress, postPreset } from "./house";
import { getLayout, putLayout } from "./layout";

// The Worker handles /api/house, /api/press, /api/lights, /api/presets, /api/batch, /api/layout and falls through to the static assets (dist/)
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
        if (pathname === "/api/house" && req.method === "GET") return await getHouse(env, name);
        if (pathname === "/api/press" && req.method === "POST") return await postPress(req, env, name);
        if (pathname === "/api/lights" && req.method === "POST") return await postLights(req, env, name);
        if (pathname === "/api/presets" && req.method === "POST") return await postPreset(req, env, name);
        if (pathname === "/api/batch" && req.method === "POST") return await postBatch(req, env, name);
        if (pathname === "/api/layout" && req.method === "GET") return json(await getLayout(env, name));
        if (pathname === "/api/layout" && req.method === "PUT") return await putLayout(req, env, name);
        return json({ error: "not found" }, 404);
      } catch {
        return json({ error: "Something went wrong. Try again." }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
