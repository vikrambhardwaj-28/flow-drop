import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { WebSocketServer } from 'ws'

const rooms = new Map()
const port = Number(process.env.PORT || 8787)
const publicDir = path.resolve('dist')
const sourcePublicDir = path.resolve('public')
const localKey = path.resolve('certs/localhost-key.pem')
const localCert = path.resolve('certs/localhost.pem')
const contentTypes = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
}

const serveApp = (request, response) => {
  const requestedPath = request.url === '/' ? '/index.html' : request.url.split('?')[0]
  const staticPath = (directory) => {
    const filePath = path.resolve(directory, `.${requestedPath}`)
    return filePath.startsWith(`${directory}${path.sep}`) ? filePath : null
  }
  const fallback = path.join(publicDir, 'index.html')
  const safePath = [publicDir, sourcePublicDir]
    .map(staticPath)
    .find((filePath) => filePath && fs.existsSync(filePath)) || fallback
  fs.readFile(safePath, (error, content) => {
    if (error) return fs.readFile(fallback, (fallbackError, fallbackContent) => {
      if (fallbackError) return response.writeHead(404).end('Build not found. Run npm run build first.')
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(fallbackContent)
    })
    const type = contentTypes[path.extname(safePath)] || 'application/octet-stream'
    response.writeHead(200, { 'Content-Type': type }).end(content)
  })
}
const appServer = fs.existsSync(localKey) && fs.existsSync(localCert)
  ? https.createServer({ key: fs.readFileSync(localKey), cert: fs.readFileSync(localCert) }, serveApp)
  : http.createServer(serveApp)
const server = new WebSocketServer({ server: appServer })

server.on('connection', (socket) => {
  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString())
    if (message.type === 'room') {
      socket.room = message.room
      socket.isHost = message.host
      const peers = rooms.get(message.room) || []
      if (peers.length >= 2) return socket.close(1013, 'Room full')
      peers.push(socket)
      rooms.set(message.room, peers)
      if (peers.length === 2) peers[0].send(JSON.stringify({ type: 'peer-joined' }))
      return
    }
    const peers = rooms.get(socket.room) || []
    peers.filter((peer) => peer !== socket && peer.readyState === 1).forEach((peer) => peer.send(raw.toString()))
  })
  socket.on('close', () => {
    const peers = rooms.get(socket.room) || []
    const remaining = peers.filter((peer) => peer !== socket)
    if (remaining.length) rooms.set(socket.room, remaining)
    else rooms.delete(socket.room)
  })
})

appServer.listen(port, () => console.log(`Air Share Pro server listening on ${appServer instanceof https.Server ? 'https' : 'http'}://localhost:${port}`))
