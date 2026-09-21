import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'

const CHUNK_SIZE = 64 * 1024
// Wider tone separation and longer beeps make PIN pairing easier to hear and detect.
const TONES = [1100, 1280, 1460, 1640, 1820, 2000, 2180, 2360, 2540, 2720]
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const makeCode = () => String(Math.floor(100000 + Math.random() * 900000))
const extension = (name) => name.split('.').pop()?.toLowerCase() || 'file'
const bytes = (size) => size < 1048576 ? `${Math.max(1, Math.round(size / 1024))} KB` : `${(size / 1048576).toFixed(1)} MB`
const clock = () => new Intl.DateTimeFormat([], { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date())
const duration = (seconds) => !Number.isFinite(seconds) || seconds <= 0 ? 'done' : seconds < 60 ? `${Math.ceil(seconds)}s left` : `${Math.floor(seconds / 60)}m left`

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connected, setConnected] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('flowdrop-theme') || 'dark')
  const [soundWave, setSoundWave] = useState(false)
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState('Creating a private room...')
  const [qr, setQr] = useState('')
  const [clipboard, setClipboard] = useState('Share a message with the connected device...')
  const [transfers, setTransfers] = useState([])
  const [progress, setProgress] = useState(null)
  const socket = useRef(null)
  const peer = useRef(null)
  const channel = useRef(null)
  const receiving = useRef(null)
  const fileInput = useRef(null)
  const audio = useRef({ context: null, stream: null, frame: null })

  const signal = (message) => socket.current?.send(JSON.stringify(message))

  const finishReceive = () => {
    const file = receiving.current
    if (!file) return
    const url = URL.createObjectURL(new Blob(file.chunks, { type: file.mime || 'application/octet-stream' }))
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url)
    setTransfers((items) => [{ name: file.name, size: bytes(file.size), time: clock(), direction: 'Received', type: extension(file.name) }, ...items])
    receiving.current = null; setProgress(null)
  }

  const setupChannel = (dataChannel) => {
    dataChannel.binaryType = 'arraybuffer'
    dataChannel.onopen = () => { setConnected(true); setStatus('Connected directly via WebRTC') }
    dataChannel.onclose = () => { setConnected(false); setStatus('Device disconnected') }
    dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        if (message.type === 'clipboard') setClipboard(message.text)
        if (message.type === 'file-meta') { receiving.current = { ...message, chunks: [], received: 0, started: performance.now() }; setProgress({ name: message.name, percent: 0, direction: 'receiving', speed: 'starting', eta: 'calculating...' }) }
        if (message.type === 'file-end') finishReceive()
        return
      }
      const file = receiving.current
      if (!file) return
      file.chunks.push(event.data); file.received += event.data.byteLength
      const speed = file.received / Math.max((performance.now() - file.started) / 1000, .1)
      setProgress({ name: file.name, percent: Math.min(99, Math.round(file.received / file.size * 100)), direction: 'receiving', speed: `${bytes(speed)}/s`, eta: duration((file.size - file.received) / speed) })
    }
    channel.current = dataChannel
  }

  const makePeer = (host) => {
    const turn = import.meta.env.VITE_TURN_URL ? [{ urls: import.meta.env.VITE_TURN_URL, username: import.meta.env.VITE_TURN_USERNAME, credential: import.meta.env.VITE_TURN_CREDENTIAL }] : []
    const connection = new RTCPeerConnection({ iceServers: [...ICE.iceServers, ...turn] })
    connection.onicecandidate = (event) => event.candidate && signal({ type: 'candidate', candidate: event.candidate })
    if (host) setupChannel(connection.createDataChannel('air-share'))
    else connection.ondatachannel = (event) => setupChannel(event.channel)
    peer.current = connection
    return connection
  }

  const connect = (code, host) => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const port = window.location.port === '5173' ? ':8787' : ''
    const connection = new WebSocket(`${protocol}://${window.location.hostname}${port}`)
    socket.current = connection
    connection.onopen = () => { signal({ type: 'room', room: code, host }); if (host) setStatus('Room ready. Share the PIN or QR.') }
    connection.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'peer-joined' && host) { const rtc = peer.current || makePeer(true); const offer = await rtc.createOffer(); await rtc.setLocalDescription(offer); signal({ type: 'offer', description: rtc.localDescription }) }
      if (message.type === 'offer' && !host) { const rtc = peer.current || makePeer(false); await rtc.setRemoteDescription(message.description); const answer = await rtc.createAnswer(); await rtc.setLocalDescription(answer); signal({ type: 'answer', description: rtc.localDescription }) }
      if (message.type === 'answer' && host) await peer.current?.setRemoteDescription(message.description)
      if (message.type === 'candidate' && peer.current) await peer.current.addIceCandidate(message.candidate).catch(() => {})
    }
    connection.onerror = () => setStatus('Signaling server unavailable')
  }

  const createRoom = (wave) => {
    const code = makeCode(); setRoomCode(code); setSoundWave(wave); setStatus('Room ready. Share the PIN or QR.'); connect(code, true)
    QRCode.toDataURL(`${window.location.origin}/?join=${code}`, { width: 220, margin: 1 }, (_, url) => setQr(url || ''))
    if (wave) emit(code)
  }

  const join = (code = joinCode) => {
    const clean = code.replace(/\D/g, '').slice(0, 6)
    if (clean.length !== 6) return setStatus('Enter a valid 6-digit PIN')
    setRoomCode(clean); setJoinCode(clean); setStatus('Joining room...'); connect(clean, false)
  }

  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('join')
    if (code?.length === 6) join(code)
    else createRoom(false)
    return () => { channel.current?.close(); peer.current?.close(); socket.current?.close(); audio.current.stream?.getTracks().forEach((track) => track.stop()); audio.current.context?.close(); if (audio.current.frame) cancelAnimationFrame(audio.current.frame) }
  }, [])

  const playTone = async (context, frequency) => {
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(.42, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(.01, context.currentTime + .28)
    oscillator.connect(gain).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + .29)
    await new Promise((resolve) => setTimeout(resolve, 370))
  }
  const emit = async (code) => {
    if (!window.AudioContext || !code) return
    setSoundWave(true)
    const context = new AudioContext()
    try {
      await context.resume()
      for (const digit of code) await playTone(context, TONES[Number(digit)])
    } finally {
      context.close()
      setSoundWave(false)
    }
  }

  const listen = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('Microphone is not available')
    setListening(true); setStatus('Listening for the room PIN...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 2048; context.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); const found = []; let last = -1; let stable = 0
      const scan = () => { analyser.getByteFrequencyData(data); const index = data.indexOf(Math.max(...data)); const frequency = index * context.sampleRate / analyser.fftSize; const digit = TONES.reduce((best, tone, i) => Math.abs(tone - frequency) < Math.abs(TONES[best] - frequency) ? i : best, 0); if (data[index] > 80 && Math.abs(TONES[digit] - frequency) < 70) { stable = digit === last ? stable + 1 : 1; last = digit; if (stable === 3 && found.length < 6) found.push(String(digit)) } else { stable = 0; last = -1 } if (found.length === 6) { const code = found.join(''); stream.getTracks().forEach((track) => track.stop()); context.close(); setListening(false); setJoinCode(code); setStatus(`PIN ${code} detected. Tap Join.`); return } audio.current.frame = requestAnimationFrame(scan) }
      audio.current = { context, stream, frame: requestAnimationFrame(scan) }
    } catch { setListening(false); setStatus('Allow microphone access to listen for PIN') }
  }

  const sendFile = async (file) => {
    if (!file || channel.current?.readyState !== 'open') return setStatus('Connect a device before sending')
    const started = performance.now(); setProgress({ name: file.name, percent: 0, direction: 'sending', speed: 'starting', eta: 'calculating...' }); channel.current.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type }))
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) { while (channel.current.bufferedAmount > 1024 * 1024) await new Promise((resolve) => setTimeout(resolve, 20)); channel.current.send(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer()); const sent = Math.min(offset + CHUNK_SIZE, file.size); const speed = sent / Math.max((performance.now() - started) / 1000, .1); setProgress({ name: file.name, percent: Math.round(sent / file.size * 100), direction: 'sending', speed: `${bytes(speed)}/s`, eta: duration((file.size - sent) / speed) }) }
    channel.current.send(JSON.stringify({ type: 'file-end' })); setTransfers((items) => [{ name: file.name, size: bytes(file.size), time: clock(), direction: 'Sent', type: extension(file.name) }, ...items]); setProgress(null)
  }

  const sendClipboard = (text) => { setClipboard(text); if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify({ type: 'clipboard', text })) }
  const toggleTheme = () => setTheme((value) => { const next = value === 'dark' ? 'light' : 'dark'; localStorage.setItem('flowdrop-theme', next); return next })

  return <div className={`app-shell theme-${theme}`}><aside className="sidebar"><div className="brand"><img className="brand-logo" src="/air-share-logo.svg" alt="Air Share logo" /><span>Air Share</span></div><nav><button disabled={!connected} className={connected ? 'nav-item active' : 'nav-item'}><span>↗</span> Share</button><button disabled={!connected} className="nav-item"><span>▣</span> Clipboard</button><button className="nav-item active"><span>◷</span> History</button></nav></aside><main className="main-content"><header className="topbar"><div><span className="eyebrow">AIR SHARE / ROOM</span><h1>{connected ? 'Ready to share' : 'Connect two devices'}</h1></div><div className="topbar-actions"><span className="secure"><i /> {connected ? 'Connected' : status}</span><button className="theme-toggle" onClick={toggleTheme} aria-label="Change color theme">{theme === 'dark' ? '☀' : '☾'}</button></div></header><section className={`room-banner ${soundWave ? 'sound-active' : ''}`}><div className="pulse-ring"><img src="/air-share-logo.svg" alt="" /></div><div className="room-copy"><span className="eyebrow">SHARE THIS ROOM</span><h2>{roomCode || '------'}</h2><p>{status}</p></div>{qr && <img className="room-qr-image" src={qr} alt="Scan to join Air Share room" />}<div className="room-actions"><button className="outline-button" onClick={() => navigator.clipboard?.writeText(roomCode)}>▣ Copy PIN</button><button className="outline-button" onClick={() => emit(roomCode)}>∿ Emit sound wave</button></div></section>{!connected && <JoinCard code={joinCode} setCode={setJoinCode} join={join} listen={listen} listening={listening} />}{connected && <section className="transfer-grid"><div className="upload-panel"><div className="section-heading"><div><span className="eyebrow">SEND FILE</span><h2>Drop files here</h2></div><span className="network-badge"><i /> Direct WebRTC</span></div><div className="dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); sendFile(event.dataTransfer.files[0]) }}><div className="upload-icon">↑</div><strong>Choose a file or drag it here</strong><p>Fast direct transfer on any network</p><input ref={fileInput} hidden type="file" onChange={(event) => { sendFile(event.target.files[0]); event.target.value = '' }} /></div></div><div className="clipboard-panel"><div className="section-heading"><div><span className="eyebrow">QUICK SHARE</span><h2>Clipboard</h2></div><span className="live-dot">● Live</span></div><textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} /><small>Syncs instantly with this room</small></div></section>}{progress && <TransferProgress progress={progress} />}<History transfers={transfers} /><AirShareFooter /></main></div>
}

function JoinCard({ code, setCode, join, listen, listening }) { return <section className="join-card"><div><span className="eyebrow">JOIN ANOTHER ROOM</span><h2>Enter a PIN or listen</h2><p>Use the 6-digit PIN from another Air Share room.</p></div><div className="join-controls"><input aria-label="Room PIN" inputMode="numeric" maxLength="6" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="dark-button" onClick={() => join()}>Join →</button><button className={`listen-button ${listening ? 'listening' : ''}`} onClick={listen}>{listening ? 'Listening...' : '◌ Listen for sound wave'}</button></div></section> }
function TransferProgress({ progress }) { return <section className="transfer-progress"><div className="progress-top"><div><span className="eyebrow">{progress.direction.toUpperCase()}</span><strong>{progress.name}</strong></div><b>{progress.percent}%</b></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><div className="progress-meta"><span>{progress.speed}</span><span>{progress.eta}</span></div></section> }
function History({ transfers }) { return <section className="history-section"><div className="section-heading"><div><span className="eyebrow">ROOM HISTORY</span><h2>Recent transfers</h2></div></div><div className="history-table"><div className="table-head"><span>FILE</span><span>SIZE</span><span>TIME</span><span>STATUS</span></div>{transfers.length === 0 && <div className="empty-history">No files shared in this room yet.</div>}{transfers.map((file, index) => <div className="table-row" key={`${file.name}-${index}`}><span className="file-name"><span className={`file-icon ${file.type}`}>{file.type.toUpperCase().slice(0, 3)}</span><strong>{file.name}</strong></span><span>{file.size}</span><span>{file.time}</span><span className="status"><i /> {file.direction}</span></div>)}</div></section> }

function AirShareFooter() {
  return <footer className="airshare-footer"><div className="footer-brand"><img className="footer-logo" src="/air-share-logo.svg?v=8" alt="Air Share logo" /><strong>Air Share</strong><small>Fast, private peer-to-peer sharing.</small></div><a className="feedback-link" href="mailto:vikram.2872006@gmail.com?subject=Air%20Share%20feedback">Feedback</a><div className="footer-links"><a href="https://www.instagram.com/vikrm_bhardwaj?igsh=OWh4ZHprbW5rNTZv" target="_blank" rel="noreferrer">Instagram</a><a href="https://www.facebook.com/share/196jZuggxg/" target="_blank" rel="noreferrer">Facebook</a><a href="https://github.com/vikrambhardwaj-28/flow-drop" target="_blank" rel="noreferrer">GitHub</a><a href="mailto:vikram.2872006@gmail.com">Email</a></div><div className="footer-credit">By Vikram Bhardwaj</div></footer>
}

export default App
