import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'

const CHUNK_SIZES = { eco: 32 * 1024, balanced: 64 * 1024, turbo: 128 * 1024 }
const ROOM_READY_TIMEOUT = 4000
// Wider tone separation and longer beeps make PIN pairing easier to hear and detect.
const TONES = [1100, 1280, 1460, 1640, 1820, 2000, 2180, 2360, 2540, 2720]
const ICE = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80', username: '388ffdcd5daa239a4e1fbe3a', credential: 'Kwa0hmbI4CX4RW9a' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '388ffdcd5daa239a4e1fbe3a', credential: 'Kwa0hmbI4CX4RW9a' },
    { urls: 'turn:global.relay.metered.ca:443', username: '388ffdcd5daa239a4e1fbe3a', credential: 'Kwa0hmbI4CX4RW9a' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '388ffdcd5daa239a4e1fbe3a', credential: 'Kwa0hmbI4CX4RW9a' },
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10,
}
const signalingUrl = import.meta.env.VITE_SIGNALING_URL || ''
const getIceConfig = () => ICE
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
  const [transferProfile, setTransferProfile] = useState('balanced')
  const socket = useRef(null)
  const peer = useRef(null)
  const channel = useRef(null)
  const receiving = useRef(null)
  const pendingCandidates = useRef([])
  const fileInput = useRef(null)
  const audio = useRef({ context: null, stream: null, frame: null })
  const roomTimer = useRef(null)
  const reconnectAttempts = useRef(0)
  const sendingControl = useRef(null)

  const signal = (message) => socket.current?.send(JSON.stringify(message))

  const finishReceive = () => {
    const file = receiving.current
    if (!file) return
    const url = URL.createObjectURL(new Blob(file.chunks, { type: file.mime || 'application/octet-stream' }))
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
    setTransfers((items) => [{ name: file.name, size: bytes(file.size), time: clock(), direction: 'Received', type: extension(file.name), url }, ...items])
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
        if (message.type === 'file-cancel') { receiving.current = null; setProgress(null); setStatus('Incoming transfer was cancelled') }
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

  const addPendingCandidates = async (connection) => {
    const candidates = pendingCandidates.current.splice(0)
    await Promise.all(candidates.map((candidate) => connection.addIceCandidate(candidate).catch(() => {})))
  }

  const makePeer = async (host) => {
    const connection = new RTCPeerConnection(await getIceConfig())
    connection.onicecandidate = (event) => event.candidate && signal({ type: 'candidate', candidate: event.candidate })
    connection.onconnectionstatechange = () => {
      if (connection.connectionState === 'connecting') setStatus('Connecting securely…')
      if (connection.connectionState === 'failed') setStatus('Connection failed. Check TURN relay configuration, then try a new room.')
    }
    if (host) setupChannel(connection.createDataChannel('air-share'))
    else connection.ondatachannel = (event) => setupChannel(event.channel)
    peer.current = connection
    return connection
  }

  const connect = (code, host) => {
    if (roomTimer.current) clearTimeout(roomTimer.current)
    socket.current?.close()
    peer.current?.close()
    channel.current = null
    peer.current = null
    pendingCandidates.current = []
    setStatus(host ? 'Creating your private room...' : 'Joining room...')
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const port = window.location.port === '5173' ? ':8787' : ''
    const endpoint = signalingUrl || `${protocol}://${window.location.hostname}${port}`
    const connection = new WebSocket(endpoint)
    socket.current = connection
    connection.onopen = () => signal({ type: 'room', room: code, host })
    connection.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'room-ready') {
        clearTimeout(roomTimer.current)
        reconnectAttempts.current = 0
        setStatus(host ? 'Room ready. Share the PIN or QR.' : 'Waiting for the other device...')
        return
      }
      if (message.type === 'peer-joined' && host) { const rtc = peer.current || await makePeer(true); const offer = await rtc.createOffer(); await rtc.setLocalDescription(offer); signal({ type: 'offer', description: rtc.localDescription }) }
      if (message.type === 'offer' && !host) { const rtc = peer.current || await makePeer(false); await rtc.setRemoteDescription(message.description); await addPendingCandidates(rtc); const answer = await rtc.createAnswer(); await rtc.setLocalDescription(answer); signal({ type: 'answer', description: rtc.localDescription }) }
      if (message.type === 'answer' && host && peer.current) { await peer.current.setRemoteDescription(message.description); await addPendingCandidates(peer.current) }
      if (message.type === 'candidate') {
        if (peer.current?.remoteDescription) await peer.current.addIceCandidate(message.candidate).catch(() => {})
        else pendingCandidates.current.push(message.candidate)
      }
    }
    connection.onerror = () => { if (socket.current === connection) setStatus('Could not reach the room server. Start npm run server, then try again.') }
    connection.onclose = (event) => {
      if (socket.current !== connection) return
      clearTimeout(roomTimer.current)
      if (event.code === 1013) setStatus('This room already has two devices. Create a new room to try again.')
      else if (event.code !== 1000) setStatus('Room server connection closed. Create a new room to retry.')
    }
    roomTimer.current = setTimeout(() => {
      if (socket.current !== connection || connection.readyState === WebSocket.CLOSED) return
      if (reconnectAttempts.current >= 2) return setStatus('Room server did not respond in 4 seconds. Please try New room.')
      reconnectAttempts.current += 1
      setStatus('Room service is slow. Retrying automatically…')
      connection.close()
      setTimeout(() => connect(code, host), 250)
    }, ROOM_READY_TIMEOUT)
  }

  const createRoom = (wave) => {
    reconnectAttempts.current = 0
    const code = makeCode()
    setRoomCode(code)
    setSoundWave(wave)
    setStatus('Creating your private room...')
    QRCode.toDataURL(`${window.location.origin}/?join=${code}`, { width: 220, margin: 1 }, (_, url) => setQr(url || ''))
    connect(code, true)
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
    return () => { clearTimeout(roomTimer.current); channel.current?.close(); peer.current?.close(); socket.current?.close(); audio.current.stream?.getTracks().forEach((track) => track.stop()); audio.current.context?.close(); if (audio.current.frame) cancelAnimationFrame(audio.current.frame) }
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
    gain.gain.exponentialRampToValueAtTime(.03, context.currentTime + .19)
    oscillator.connect(gain).connect(compressor).connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + .2)
    await new Promise((resolve) => setTimeout(resolve, 260))
  }
  const emit = async (code) => {
    if (!window.AudioContext || !code) return
    setSoundWave(true)
    const context = new AudioContext()
    try {
      await context.resume()
      // Short, distinct tones keep pairing quick while leaving a clean gap for decoding.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        for (const digit of code) await playTone(context, TONES[Number(digit)])
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 280))
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
      const scan = () => { analyser.getByteFrequencyData(data); const index = data.indexOf(Math.max(...data)); const frequency = index * context.sampleRate / analyser.fftSize; const digit = TONES.reduce((best, tone, i) => Math.abs(tone - frequency) < Math.abs(TONES[best] - frequency) ? i : best, 0); if (data[index] > 40 && Math.abs(TONES[digit] - frequency) < 60) { stable = digit === last ? stable + 1 : 1; last = digit; if (stable === 3 && found.length < 6) found.push(String(digit)) } else { stable = 0; last = -1 } if (found.length === 6) { const code = found.join(''); stream.getTracks().forEach((track) => track.stop()); context.close(); setListening(false); setJoinCode(code); setStatus(`PIN ${code} detected. Tap Join.`); return } audio.current.frame = requestAnimationFrame(scan) }
      audio.current = { context, stream, frame: requestAnimationFrame(scan) }
    } catch { setListening(false); setStatus('Allow microphone access to listen for PIN') }
  }

  const sendFile = async (file) => {
    if (!file || channel.current?.readyState !== 'open') { setStatus('Connect a device before sending'); return false }
    if (sendingControl.current) { setStatus('A transfer is already in progress'); return false }
    const chunkSize = CHUNK_SIZES[transferProfile]
    const control = { paused: false, cancelled: false, resume: null }
    sendingControl.current = control
    const started = performance.now(); setProgress({ name: file.name, percent: 0, direction: 'sending', speed: 'starting', eta: 'calculating...' }); channel.current.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type }))
    for (let offset = 0; offset < file.size; offset += chunkSize) {
      while (control.paused && !control.cancelled) await new Promise((resolve) => { control.resume = resolve })
      if (control.cancelled) break
      while (channel.current.bufferedAmount > 1024 * 1024) await new Promise((resolve) => setTimeout(resolve, 20))
      if (control.cancelled) break
      channel.current.send(await file.slice(offset, offset + chunkSize).arrayBuffer()); const sent = Math.min(offset + chunkSize, file.size); const speed = sent / Math.max((performance.now() - started) / 1000, .1); setProgress({ name: file.name, percent: Math.round(sent / file.size * 100), direction: 'sending', speed: `${bytes(speed)}/s`, eta: duration((file.size - sent) / speed), paused: false })
    }
    if (control.cancelled) { sendingControl.current = null; setProgress(null); return false }
    channel.current.send(JSON.stringify({ type: 'file-end' })); setTransfers((items) => [{ name: file.name, size: bytes(file.size), time: clock(), direction: 'Sent', type: extension(file.name), url: URL.createObjectURL(file) }, ...items]); sendingControl.current = null; setProgress(null); return true
  }

  const sendFiles = async (files) => {
    const batch = Array.from(files || []).filter(Boolean)
    if (!batch.length) return
    let completed = 0
    for (let index = 0; index < batch.length; index += 1) {
      if (batch.length > 1) setStatus(`Sending ${index + 1} of ${batch.length} files…`)
      if (!await sendFile(batch[index])) break
      completed += 1
    }
    if (batch.length > 1 && completed === batch.length && channel.current?.readyState === 'open') setStatus(`${batch.length} files sent securely`)
  }

  const toggleTransferPause = () => {
    const control = sendingControl.current
    if (!control) return
    control.paused = !control.paused
    if (!control.paused) { control.resume?.(); control.resume = null }
    setProgress((current) => current ? { ...current, paused: control.paused } : current)
    setStatus(control.paused ? 'Transfer paused' : 'Transfer resumed')
  }
  const cancelTransfer = () => {
    const control = sendingControl.current
    if (!control) return
    control.cancelled = true; control.paused = false; control.resume?.(); control.resume = null
    if (channel.current?.readyState === 'open') channel.current.send(JSON.stringify({ type: 'file-cancel' }))
    setStatus('Transfer cancelled')
  }
  const downloadTransfer = (file) => {
    if (!file.url) return
    const link = document.createElement('a'); link.href = file.url; link.download = file.name; link.click()
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
      <section className={`room-banner ${soundWave ? 'sound-active' : ''}`}><div className="pulse-ring"><img src="/air-share-logo.svg" alt="" /></div><div className="room-copy"><span className="eyebrow">YOUR SECURE ROOM</span><h2>{roomCode || '------'}</h2><p>{status}</p></div>{qr && <img className="room-qr-image" src={qr} alt="Scan to join Air Share Pro room" />}<div className="room-actions"><button className="outline-button" onClick={() => createRoom(false)}>New room</button><button className="outline-button" onClick={() => navigator.clipboard?.writeText(roomCode)}><Icon name="copy" size={16} /> Copy PIN</button><button className="outline-button" onClick={() => emit(roomCode)}><Icon name="wave" size={16} /> Sound wave</button></div></section>
      {!connected && <JoinCard code={joinCode} setCode={setJoinCode} join={join} listen={listen} listening={listening} />}
      {connected && <section className="transfer-grid"><div className="upload-panel"><div className="section-heading"><div><span className="eyebrow">SEND FILE</span><h2>Drop files here</h2></div><span className="network-badge"><i /> Direct WebRTC</span></div><div className="dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); sendFiles(event.dataTransfer.files) }}><div className="upload-icon"><Icon name="upload" size={27} /></div><strong>Choose files or drag them here</strong><p>Encrypted direct transfer on any network</p><input ref={fileInput} hidden multiple type="file" onChange={(event) => { sendFiles(event.target.files); event.target.value = '' }} /></div><TransferProfiles profile={transferProfile} setProfile={setTransferProfile} /></div><div className="clipboard-panel"><div className="section-heading"><div><span className="eyebrow">QUICK SHARE</span><h2>Clipboard</h2></div><span className="live-dot"><i /> Live</span></div><textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} /><small>Syncs instantly with this room</small></div></section>}
      {progress && <TransferProgress progress={progress} togglePause={toggleTransferPause} cancel={cancelTransfer} />}<History transfers={transfers} download={downloadTransfer} /><AirShareFooter />
    </main>
  </div>
}

function TransferProfiles({ profile, setProfile }) { return <div className="transfer-profiles"><div><span className="eyebrow">TRANSFER ENGINE</span><strong>Smart transfer profile</strong></div><div className="profile-options" role="group" aria-label="Transfer profile">{[['eco', 'Eco'], ['balanced', 'Balanced'], ['turbo', 'Turbo']].map(([value, label]) => <button key={value} className={profile === value ? 'profile-option active' : 'profile-option'} onClick={() => setProfile(value)}>{label}</button>)}</div><small>{profile === 'eco' ? 'Smaller packets for unstable connections' : profile === 'turbo' ? 'Larger packets for fast, reliable networks' : 'Optimized for most networks'}</small></div> }
function JoinCard({ code, setCode, join, listen, listening }) { return <section className="join-card"><div><span className="eyebrow">JOIN ANOTHER ROOM</span><h2>Enter a PIN or listen</h2><p>Use the 6-digit PIN from another Air Share Pro room.</p></div><div className="join-controls"><input aria-label="Room PIN" inputMode="numeric" maxLength="6" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="dark-button" onClick={() => join()}>Join →</button><button className={`listen-button ${listening ? 'listening' : ''}`} onClick={listen}>{listening ? 'Listening...' : '◌ Listen for sound wave'}</button></div></section> }
function TransferProgress({ progress, togglePause, cancel }) { return <section className="transfer-progress"><div className="progress-top"><div><span className="eyebrow">{progress.paused ? 'PAUSED' : progress.direction.toUpperCase()}</span><strong>{progress.name}</strong></div><b>{progress.percent}%</b></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><div className="progress-meta"><span>{progress.paused ? 'Waiting for resume' : progress.speed}</span><span>{progress.eta}</span></div>{progress.direction === 'sending' && <div className="transfer-controls"><button className="transfer-control pause" onClick={togglePause}>{progress.paused ? 'Resume' : 'Pause'}</button><button className="transfer-control cancel" onClick={cancel}>Cancel</button></div>}</section> }
function History({ transfers, download }) { return <section className="history-section"><div className="section-heading"><div><span className="eyebrow">ROOM HISTORY</span><h2>Recent transfers</h2></div></div><div className="history-table"><div className="table-head"><span>FILE</span><span>SIZE</span><span>TIME</span><span>STATUS</span><span>DOWNLOAD</span></div>{transfers.length === 0 && <div className="empty-history">No files shared in this room yet.</div>}{transfers.map((file, index) => <div className="table-row" key={`${file.name}-${index}`}><span className="file-name"><span className={`file-icon ${file.type}`}>{file.type.toUpperCase().slice(0, 3)}</span><strong>{file.name}</strong></span><span>{file.size}</span><span>{file.time}</span><span className="status"><i /> {file.direction}</span><button className="history-download" onClick={() => download(file)}>Download</button></div>)}</div></section> }

function AirShareFooter() {
  return <footer className="airshare-footer"><div className="footer-brand"><img className="footer-logo" src="/air-share-logo.svg" alt="Air Share Pro logo" /><strong>Air Share Pro</strong><small>Fast, private peer-to-peer sharing.</small></div><a className="feedback-link" href="mailto:vikram.2872006@gmail.com?subject=Air%20Share%20Pro%20feedback">Feedback</a><div className="footer-links"><a href="https://www.instagram.com/vikrm_bhardwaj?igsh=OWh4ZHprbW5rNTZv" target="_blank" rel="noreferrer">Instagram</a><a href="https://www.facebook.com/share/196jZuggxg/" target="_blank" rel="noreferrer">Facebook</a><a href="mailto:vikram.2872006@gmail.com">Email</a></div><div className="footer-credit">By Vikram Bhardwaj</div></footer>
}

export default App
