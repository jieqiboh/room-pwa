import type { Env } from "./env";

// The room server also runs the lights and the aircon. This list is the line that
// keeps them out of the family app: nothing else is ever sent to the room server.
export const ALLOWED_TOOLS = new Set(["shutter", "shutter_status"]);

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 10_000;

// Tailscale Funnel or the room server did not answer usefully: the PC is off,
// Tailscale or the room server is down, or the token is wrong.
export class RoomUnreachable extends Error {}
// The room server answered, but the tool failed (e.g. the RM4 did not respond).
export class ToolFailed extends Error {}

// Call one allowed tool over MCP Streamable HTTP: initialize, the initialized
// notification, then tools/call. Returns the tool's structured result.
export async function callTool<T>(
  env: Env, name: string, args: Record<string, unknown> = {},
  fetchFn: typeof fetch = fetch,
): Promise<T> {
  if (!ALLOWED_TOOLS.has(name)) throw new Error(`tool not allowed: ${name}`);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${env.ROOM_TOKEN ?? ""}`,
  };

  const post = async (body: unknown): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchFn(env.ROOM_URL, {
        method: "POST", headers, body: JSON.stringify(body),
        redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new RoomUnreachable(`fetch failed: ${(e as Error).message}`);
    }
    if (!res.ok) throw new RoomUnreachable(`room server answered ${res.status}`);
    return res;
  };

  const init = await post({
    jsonrpc: "2.0", id: 1, method: "initialize",
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "room-pwa", version: "1" } },
  });
  const initMsg = await readReply(init, 1);
  if (initMsg.error) throw new RoomUnreachable(`initialize: ${initMsg.error.message}`);
  const session = init.headers.get("mcp-session-id");
  if (session) headers["mcp-session-id"] = session;
  headers["mcp-protocol-version"] = initMsg.result?.protocolVersion ?? PROTOCOL_VERSION;

  await post({ jsonrpc: "2.0", method: "notifications/initialized" });

  const call = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } });
  const msg = await readReply(call, 2);

  // Best effort: end the session so the room server can drop it.
  if (session) fetchFn(env.ROOM_URL, { method: "DELETE", headers }).catch(() => {});

  if (msg.error) throw new ToolFailed(msg.error.message);
  const result = msg.result;
  if (result?.isError) {
    const text = (result.content ?? []).map((c: { text?: string }) => c.text ?? "").join(" ").trim();
    throw new ToolFailed(text || "tool failed");
  }
  if (!result?.structuredContent) throw new ToolFailed("no structured result");
  return result.structuredContent as T;
}

interface RpcMessage {
  id?: number;
  result?: any;
  error?: { message: string };
}

// The reply to request `id`, from either a JSON body or an SSE stream.
export async function readReply(res: Response, id: number): Promise<RpcMessage> {
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  const messages: RpcMessage[] = [];
  try {
    if (type.includes("text/event-stream")) {
      for (const line of text.split(/\r?\n/)) {
        if (line.startsWith("data:")) messages.push(JSON.parse(line.slice(5)));
      }
    } else {
      const body = JSON.parse(text);
      messages.push(...(Array.isArray(body) ? body : [body]));
    }
  } catch {
    // An error page instead of MCP.
    throw new RoomUnreachable("reply was not MCP");
  }
  const reply = messages.find((m) => m.id === id);
  if (!reply) throw new RoomUnreachable(`no reply to request ${id}`);
  return reply;
}
