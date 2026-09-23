import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'

const rooms = new Map()
const MAX_ROOM_DEVICES = 6
const port = Number(process.env.PORT || 8787)
const publicDir = path.resolve('dist')
const sourcePublicDir = path.resolve('public')
const localKey = path.resolve('certs/localhost-key.pem')
const localCert = path.resolve('certs/localhost.pem')
const turnUrls = (process.env.TURN_URLS || '').split(',').map((url) => url.trim()).filter(Boolean)
const turnSharedSecret = process.env.TURN_SHARED_SECRET || ''
const turnCredentialTtl = Math.min(Math.max(Number(process.env.TURN_TTL_SECONDS || 3600), 300), 86400)
const contentTypes = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }
const send = (socket, payload) => socket.readyState === 1 && socket.send(JSON.stringify(payload))
const id = () => `DEV-${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const list = (room) => room.map((socket) => ({ id: socket.deviceId, host: socket.isHost }))
const state = (room) => room.forEach((socket) => send(socket, { type: 'room-state', devices: list(room) }))

const serveApp = (request, response) => {
  if (request.url?.split('?')[0] === '/.well-known/air-share/ice') {
    response.setHeader('Access-Control-Allow-Origin', '*'); response.setHeader('Cache-Control', 'no-store')
    if (!turnUrls.length || !turnSharedSecret) return response.writeHead(503, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'TURN relay is not configured' }))
    const username = `${Math.floor(Date.now() / 1000) + turnCredentialTtl}:air-share`
    const credential = crypto.createHmac('sha1', turnSharedSecret).update(username).digest('base64')
    return response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }, { urls: turnUrls, username, credential }] }))
  }
  const requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  const staticPath = (directory) => { const filePath = path.resolve(directory, `.${requestedPath}`); return filePath.startsWith(`${directory}${path.sep}`) ? filePath : null }
  const fallback = path.join(publicDir, 'index.html')
  const safePath = [publicDir, sourcePublicDir].map(staticPath).find((filePath) => filePath && fs.existsSync(filePath)) || fallback
  fs.readFile(safePath, (error, content) => {
    if (error) return fs.readFile(fallback, (fallbackError, fallbackContent) => fallbackError ? response.writeHead(404).end('Build not found. Run npm run build first.') : response.writeHead(200, { 'Content-Type': 'text/html' }).end(fallbackContent))
    response.writeHead(200, { 'Content-Type': contentTypes[path.extname(safePath)] || 'application/octet-stream' }).end(content)
  })
}
const appServer = fs.existsSync(localKey) && fs.existsSync(localCert) ? https.createServer({ key: fs.readFileSync(localKey), cert: fs.readFileSync(localCert) }, serveApp) : http.createServer(serveApp)
const server = new WebSocketServer({ server: appServer })

server.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message; try { message = JSON.parse(raw.toString()) } catch { return socket.close(1003, 'Invalid message') }
    if (message.type === 'room') {
      if (socket.room || !/^\d{6}$/.test(message.room || '')) return socket.close(1008, 'Invalid room')
      const room = rooms.get(message.room) || []
      if (room.length >= MAX_ROOM_DEVICES) return socket.close(1013, 'Room full')
      socket.room = message.room; socket.isHost = message.host === true; socket.deviceId = id(); room.push(socket); rooms.set(socket.room, room)
      send(socket, { type: 'room-ready', room: socket.room, deviceId: socket.deviceId, devices: list(room) })
      room.filter((peer) => peer !== socket).forEach((peer) => send(peer, { type: 'peer-joined', peerId: socket.deviceId }))
      state(room); return
    }
    if (!socket.room || !['offer', 'answer', 'candidate'].includes(message.type) || typeof message.target !== 'string') return
    const target = (rooms.get(socket.room) || []).find((peer) => peer.deviceId === message.target)
    if (target) send(target, { ...message, from: socket.deviceId })
  })
  socket.on('close', () => {
    const room = rooms.get(socket.room) || []
    const remaining = room.filter((peer) => peer !== socket)
    if (remaining.length) { rooms.set(socket.room, remaining); state(remaining) } else rooms.delete(socket.room)
  })
})
appServer.listen(port, () => console.log(`Air Share Pro server listening on ${appServer instanceof https.Server ? 'https' : 'http'}://localhost:${port}`))
