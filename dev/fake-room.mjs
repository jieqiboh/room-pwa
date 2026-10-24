// A stand-in for the room server's MCP endpoint, for `wrangler dev` without the
// Funnel or the RM4. Stateless like the house endpoint: tools/call needs no session.
//   ROOM_TOKEN=dev node dev/fake-room.mjs          # all good
//   FAIL=rm4 ROOM_TOKEN=dev node dev/fake-room.mjs  # the RM4 does not answer
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const TOKEN = process.env.ROOM_TOKEN ?? 'dev'
const PORT = Number(process.env.PORT ?? 8008)
let last = { last_action: null, sent_at: null }
const calls = []
const btn = (id, label) => ({ id, label })
const devices = [
  { id: 'shutter', name: 'Shutter', kind: 'shutter', buttons: [btn('down', 'Down'), btn('stop', 'Stop'), btn('up', 'Up')], presets: [] },
  { id: 'aircon', name: 'Aircon', kind: 'aircon', buttons: [btn('cool_24_fan2', 'Cool 24'), btn('cool_26_fan4', 'Cool 26'), btn('off', 'Off')], presets: [] },
  { id: 'fan', name: 'Fan', kind: 'fan', buttons: [btn('power', 'Power'), btn('speed', 'Speed')], presets: [] },
  { id: 'jq-lights', name: "JQ's lights", kind: 'lights', buttons: [], presets: ['warm', 'cool', 'night'] },
].map((d) => ({ ...d, last_action: null, sent_at: null, on: d.kind === 'lights' ? false : null, brightness: d.kind === 'lights' ? 50 : null, error: null }))

const sse = (res, msg, headers = {}) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', ...headers })
  res.end(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)
}
const result = (structuredContent) => ({
  content: [{ type: 'text', text: JSON.stringify(structuredContent) }], structuredContent, isError: false,
})

// The press and lights fakes: change the device, or return why not.
function press(args) {
  const d = devices.find((x) => x.id === args.device)
  if (!d || !d.buttons.some((b) => b.id === args.button)) return 'unknown device or button'
  d.last_action = args.button
  d.sent_at = new Date().toISOString().replace(/\.\d+Z$/, '+00:00')
  return null
}

function lights(args) {
  const d = devices.find((x) => x.id === args.device && x.kind === 'lights')
  if (!d) return 'unknown lights'
  if (args.on !== undefined) d.on = args.on
  if (args.brightness !== undefined) { d.brightness = args.brightness; d.on = true }
  if (args.preset !== undefined) { d.on = true; d.brightness = 70 }
  return null
}

createServer(async (req, res) => {
  if (req.url === '/calls') return res.end(JSON.stringify(calls))
  if (req.url !== '/mcp') return res.writeHead(404).end()
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return res.writeHead(401).end('unauthorized')
  if (req.method === 'DELETE') return res.writeHead(200).end()

  let body = ''
  for await (const chunk of req) body += chunk
  const msg = JSON.parse(body)

  if (msg.method === 'initialize') {
    return sse(res, {
      jsonrpc: '2.0', id: msg.id,
      result: { protocolVersion: msg.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'room', version: 'fake' } },
    }, { 'mcp-session-id': randomUUID() })
  }
  if (!msg.id) return res.writeHead(202).end()
  if (msg.method !== 'tools/call') return sse(res, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'method not found' } })

  const { name, arguments: args } = msg.params
  calls.push(name)
  console.log('tools/call', name, args)
  if (name === 'batch') {
    // Each command through the press or lights fake below, as the room server runs them.
    const results = args.commands.map(({ button, times, ...c }) => {
      const err = button !== undefined ? press({ ...c, button }) : lights(c)
      return { device: c.device, ok: !err, error: err ?? null }
    })
    return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ results }) })
  }
  if (name === 'house') {
    if (process.env.FAIL === 'rm4') {
      return sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'RM4 did not respond' }], isError: true } })
    }
    return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ devices }) })
  }
  if (name === 'press') {
    const err = press(args)
    if (err) return sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: err }], isError: true } })
    const d = devices.find((x) => x.id === args.device)
    return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ action: d.last_action, sent_at: d.sent_at }) })
  }
  if (name === 'lights') {
    const err = lights(args)
    if (err) return sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: err }], isError: true } })
    return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ target: args.device, done: true, note: 'fake' }) })
  }
  if (name === 'shutter_status') return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ ...last, note: 'fake', choices: ['down', 'stop', 'up'] }) })
  if (name === 'shutter') {
    if (process.env.FAIL === 'rm4') {
      return sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'RM4 did not respond' }], isError: true } })
    }
    const sent_at = new Date().toISOString().replace(/\.\d+Z$/, '+00:00')
    last = { last_action: args.action, sent_at }
    return sse(res, { jsonrpc: '2.0', id: msg.id, result: result({ action: args.action, sent_at }) })
  }
  sse(res, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `this fake has no ${name}` }], isError: true } })
}).listen(PORT, () => console.log(`fake room server on http://127.0.0.1:${PORT}/mcp`))
