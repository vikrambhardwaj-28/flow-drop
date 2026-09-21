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

function Icon({ name, size = 20 }) {
  const icons = {
    share: <><path d="M12 3v12" /><path d="m7 8 5-5 5 5" /><path d="M5 13v6h14v-6" /></>,
    clipboard: <><rect x="6" y="5" width="12" height="15" rx="2" /><path d="M9 5V3h6v2" /><path d="M9 10h6M9 14h4" /></>,
    history: <><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 7v5l3 2" /></>,
    copy: <><rect x="9" y="9" width="10" height="10" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h3" /></>,
    wave: <><path d="M3 12h2l2.2-6 3.5 12 3-9 2.1 5H21" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
    moon: <path d="M20 15.4A8.5 8.5 0 0 1 8.6 4 8.5 8.5 0 1 0 20 15.4Z" />,
  }
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>
}

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [connected, setConnected] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('air-share-pro-theme') || 'dark')
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
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -20
    compressor.knee.value = 8
    compressor.ratio.value = 12
    compressor.attack.value = .003
    compressor.release.value = .18
    gain.gain.setValueAtTime(.78, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(.03, context.currentTime + .36)
    oscillator.connect(gain).connect(compressor).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + .37)
    await new Promise((resolve) => setTimeout(resolve, 470))
  }
  const emit = async (code) => {
    if (!window.AudioContext || !code) return
    setSoundWave(true)
    const context = new AudioContext()
    try {
      await context.resume()
      // Repeat the PIN once automatically: the receiving device accepts the first clean pass.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        for (const digit of code) await playTone(context, TONES[Number(digit)])
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 550))
      }
    } finally {
      context.close()
      setSoundWave(false)
    }
  }

  const listen = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('Microphone is not available')
    setListening(true); setStatus('Listening for the room PIN...')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } }); const context = new AudioContext(); const analyser = context.createAnalyser(); analyser.fftSize = 4096; analyser.smoothingTimeConstant = .12; context.createMediaStreamSource(stream).connect(analyser); const data = new Uint8Array(analyser.frequencyBinCount); const found = []; let last = -1; let stable = 0
      const scan = () => { analyser.getByteFrequencyData(data); const index = data.indexOf(Math.max(...data)); const frequency = index * context.sampleRate / analyser.fftSize; const digit = TONES.reduce((best, tone, i) => Math.abs(tone - frequency) < Math.abs(TONES[best] - frequency) ? i : best, 0); if (data[index] > 45 && Math.abs(TONES[digit] - frequency) < 50) { stable = digit === last ? stable + 1 : 1; last = digit; if (stable === 5 && found.length < 6) found.push(String(digit)) } else { stable = 0; last = -1 } if (found.length === 6) { const code = found.join(''); stream.getTracks().forEach((track) => track.stop()); context.close(); setListening(false); setJoinCode(code); setStatus(`PIN ${code} detected. Tap Join.`); return } audio.current.frame = requestAnimationFrame(scan) }
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
  const disconnect = () => { channel.current?.close(); peer.current?.close(); socket.current?.close(); setConnected(false); setStatus('Disconnected') }
  const toggleTheme = () => setTheme((value) => { const next = value === 'dark' ? 'light' : 'dark'; localStorage.setItem('air-share-pro-theme', next); return next })

  return <div className={`app-shell theme-${theme}`}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/air-share-logo.svg" alt="Air Share Pro logo" /><span>Air Share Pro</span></div>
      <nav>
        <button disabled={!connected} className={connected ? 'nav-item active' : 'nav-item'}><Icon name="share" /> <span>Share</span></button>
        <button disabled={!connected} className="nav-item"><Icon name="clipboard" /> <span>Clipboard</span></button>
        <button className="nav-item active"><Icon name="history" /> <span>History</span></button>
      </nav>
    </aside>
    <main className="main-content">
        <header className="topbar"><div><span className="eyebrow">AIR SHARE PRO / PRIVATE ROOM</span><h1>{connected ? 'Ready to share' : 'Connect your devices'}</h1></div><div className="topbar-actions"><span className="secure"><i /> {connected ? 'Connected' : status}</span>{connected && <button className="outline-button disconnect-button" onClick={disconnect}>Disconnect</button>}<button className="theme-toggle" onClick={toggleTheme} aria-label="Change color theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button></div></header>
      <section className={`room-banner ${soundWave ? 'sound-active' : ''}`}><div className="pulse-ring"><img src="/air-share-logo.svg" alt="" /></div><div className="room-copy"><span className="eyebrow">YOUR SECURE ROOM</span><h2>{roomCode || '------'}</h2><p>{status}</p></div>{qr && <img className="room-qr-image" src={qr} alt="Scan to join Air Share Pro room" />}<div className="room-actions"><button className="outline-button" onClick={() => navigator.clipboard?.writeText(roomCode)}><Icon name="copy" size={16} /> Copy PIN</button><button className="outline-button" onClick={() => emit(roomCode)}><Icon name="wave" size={16} /> Sound wave</button></div></section>
      {!connected && <JoinCard code={joinCode} setCode={setJoinCode} join={join} listen={listen} listening={listening} />}
      {connected && <section className="transfer-grid"><div className="upload-panel"><div className="section-heading"><div><span className="eyebrow">SEND FILE</span><h2>Drop files here</h2></div><span className="network-badge"><i /> Direct WebRTC</span></div><div className="dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); sendFile(event.dataTransfer.files[0]) }}><div className="upload-icon"><Icon name="upload" size={27} /></div><strong>Choose a file or drag it here</strong><p>Encrypted direct transfer on any network</p><input ref={fileInput} hidden type="file" onChange={(event) => { sendFile(event.target.files[0]); event.target.value = '' }} /></div></div><div className="clipboard-panel"><div className="section-heading"><div><span className="eyebrow">QUICK SHARE</span><h2>Clipboard</h2></div><span className="live-dot"><i /> Live</span></div><textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} /><small>Syncs instantly with this room</small></div></section>}
      {progress && <TransferProgress progress={progress} />}<History transfers={transfers} /><AirShareFooter />
    </main>
  </div>
}

function JoinCard({ code, setCode, join, listen, listening }) { return <section className="join-card"><div><span className="eyebrow">JOIN ANOTHER ROOM</span><h2>Enter a PIN or listen</h2><p>Use the 6-digit PIN from another Air Share Pro room.</p></div><div className="join-controls"><input aria-label="Room PIN" inputMode="numeric" maxLength="6" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="dark-button" onClick={() => join()}>Join →</button><button className={`listen-button ${listening ? 'listening' : ''}`} onClick={listen}>{listening ? 'Listening...' : '◌ Listen for sound wave'}</button></div></section> }
function TransferProgress({ progress }) { return <section className="transfer-progress"><div className="progress-top"><div><span className="eyebrow">{progress.direction.toUpperCase()}</span><strong>{progress.name}</strong></div><b>{progress.percent}%</b></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><div className="progress-meta"><span>{progress.speed}</span><span>{progress.eta}</span></div></section> }
function History({ transfers }) { return <section className="history-section"><div className="section-heading"><div><span className="eyebrow">ROOM HISTORY</span><h2>Recent transfers</h2></div></div><div className="history-table"><div className="table-head"><span>FILE</span><span>SIZE</span><span>TIME</span><span>STATUS</span></div>{transfers.length === 0 && <div className="empty-history">No files shared in this room yet.</div>}{transfers.map((file, index) => <div className="table-row" key={`${file.name}-${index}`}><span className="file-name"><span className={`file-icon ${file.type}`}>{file.type.toUpperCase().slice(0, 3)}</span><strong>{file.name}</strong></span><span>{file.size}</span><span>{file.time}</span><span className="status"><i /> {file.direction}</span></div>)}</div></section> }

function AirShareFooter() {
  return <footer className="airshare-footer"><div className="footer-brand"><img className="footer-logo" src="/air-share-logo.svg" alt="Air Share Pro logo" /><strong>Air Share Pro</strong><small>Fast, private peer-to-peer sharing.</small></div><a className="feedback-link" href="mailto:vikram.2872006@gmail.com?subject=Air%20Share%20Pro%20feedback">Feedback</a><div className="footer-links"><a href="https://www.instagram.com/vikrm_bhardwaj?igsh=OWh4ZHprbW5rNTZv" target="_blank" rel="noreferrer">Instagram</a><a href="https://www.facebook.com/share/196jZuggxg/" target="_blank" rel="noreferrer">Facebook</a><a href="https://github.com/vikrambhardwaj-28/flow-drop" target="_blank" rel="noreferrer">GitHub</a><a href="mailto:vikram.2872006@gmail.com">Email</a></div><div className="footer-credit">By Vikram Bhardwaj</div></footer>
}

export default App
