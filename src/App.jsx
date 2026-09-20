import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'

const CHUNK_SIZE = 64 * 1024
const TURN_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }
const initialTransfers = []
const SOUND_FREQUENCIES = [1200, 1320, 1440, 1560, 1680, 1800, 1920, 2040, 2160, 2280]

function makeRoomCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function playTone(audio, frequency, duration = 160) {
  return new Promise((resolve) => {
    const oscillator = audio.createOscillator()
    const gain = audio.createGain()
    oscillator.frequency.value = frequency
    gain.gain.setValueAtTime(0.0001, audio.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, audio.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration / 1000 - 0.02)
    oscillator.connect(gain).connect(audio.destination)
    oscillator.start()
    oscillator.stop(audio.currentTime + duration / 1000)
    oscillator.onended = resolve
  })
}

async function emitRoomCode(code) {
  if (!window.AudioContext) return
  const audio = new AudioContext()
  await audio.resume()
  for (let repeat = 0; repeat < 2; repeat += 1) {
    for (const digit of code) {
      await playTone(audio, SOUND_FREQUENCIES[Number(digit)])
      await new Promise((resolve) => window.setTimeout(resolve, 70))
    }
    await new Promise((resolve) => window.setTimeout(resolve, 250))
  }
  await audio.close()
}

function App() {
  const [roomCode, setRoomCode] = useState('')
  const [joinCode, setJoinCode] = useState(() => new URLSearchParams(window.location.search).get('join') || '')
  const [roomMode, setRoomMode] = useState(() => new URLSearchParams(window.location.search).get('join')?.length === 6 ? 'join' : 'create')
  const [theme, setTheme] = useState(() => localStorage.getItem('flowdrop-theme') || 'light')
  const [soundWave, setSoundWave] = useState(false)
  const [activeTab, setActiveTab] = useState('share')
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('Create a room to start sharing')
  const [copied, setCopied] = useState(false)
  const [clipboard, setClipboard] = useState('Paste anything here to share it instantly...')
  const [transfers, setTransfers] = useState(initialTransfers)
  const [qrData, setQrData] = useState('')
  const [listening, setListening] = useState(false)
  const socketRef = useRef(null)
  const peerRef = useRef(null)
  const channelRef = useRef(null)
  const fileInputRef = useRef(null)
  const receivingRef = useRef(null)
  const audioRefs = useRef({ context: null, stream: null, frame: null })

  useEffect(() => () => {
    channelRef.current?.close()
    peerRef.current?.close()
    socketRef.current?.close()
    audioRefs.current.stream?.getTracks().forEach((track) => track.stop())
    if (audioRefs.current.frame) cancelAnimationFrame(audioRefs.current.frame)
    audioRefs.current.context?.close()
  }, [])

  const sendSignal = (message) => socketRef.current?.send(JSON.stringify(message))

  const waitForIce = (peer, description) => new Promise((resolve) => {
    if (peer.iceGatheringState === 'complete') return resolve(description)
    const onState = () => {
      if (peer.iceGatheringState === 'complete') {
        peer.removeEventListener('icegatheringstatechange', onState)
        resolve(peer.localDescription)
      }
    }
    peer.addEventListener('icegatheringstatechange', onState)
  })

  const setupDataChannel = (channel) => {
    channel.binaryType = 'arraybuffer'
    channel.onopen = () => { setConnected(true); setStatus('Connected directly via WebRTC') }
    channel.onclose = () => { setConnected(false); setStatus('Device disconnected') }
    channel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const message = JSON.parse(event.data)
        if (message.type === 'clipboard') setClipboard(message.text)
        if (message.type === 'file-meta') receivingRef.current = { ...message, chunks: [] }
        if (message.type === 'file-end') finishReceiving()
        return
      }
      receivingRef.current?.chunks.push(event.data)
    }
    channelRef.current = channel
  }

  const finishReceiving = () => {
    const incoming = receivingRef.current
    if (!incoming) return
    const blob = new Blob(incoming.chunks, { type: incoming.mime || 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = incoming.name
    link.click()
    URL.revokeObjectURL(url)
    setTransfers((current) => [{ name: incoming.name, size: formatBytes(incoming.size), time: 'Just now', type: extension(incoming.name), direction: 'received' }, ...current])
    receivingRef.current = null
  }

  const createPeer = (isHost) => {
    const peer = new RTCPeerConnection(TURN_CONFIG)
    peer.onconnectionstatechange = () => {
      if (['failed', 'disconnected', 'closed'].includes(peer.connectionState)) setConnected(false)
    }
    if (isHost) setupDataChannel(peer.createDataChannel('flowdrop'))
    else peer.ondatachannel = (event) => setupDataChannel(event.channel)
    peerRef.current = peer
    return peer
  }

  const connectSocket = (code, isHost) => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const localPort = window.location.port === '5173' ? ':8787' : ''
    const socket = new WebSocket(`${protocol}://${window.location.hostname}${localPort}`)
    socketRef.current = socket
    socket.onopen = async () => {
      sendSignal({ type: 'room', room: code, host: isHost })
      if (isHost) setStatus('Waiting for another device...')
    }
    socket.onmessage = async (event) => {
      const message = JSON.parse(event.data)
      if (message.type === 'peer-joined' && isHost) {
        const peer = peerRef.current || createPeer(true)
        const offer = await peer.createOffer()
        await peer.setLocalDescription(offer)
        sendSignal({ type: 'offer', description: await waitForIce(peer, peer.localDescription) })
      }
      if (message.type === 'offer' && !isHost) {
        const peer = peerRef.current || createPeer(false)
        await peer.setRemoteDescription(message.description)
        const answer = await peer.createAnswer()
        await peer.setLocalDescription(answer)
        sendSignal({ type: 'answer', description: await waitForIce(peer, peer.localDescription) })
      }
      if (message.type === 'answer' && isHost) await peerRef.current?.setRemoteDescription(message.description)
    }
    socket.onclose = () => { if (!connected) setStatus('Signaling server unavailable') }
    socket.onerror = () => setStatus('Start the signaling server to connect devices')
  }

  const createRoom = (useSoundWave = false) => {
    const code = makeRoomCode()
    setRoomCode(code)
    setSoundWave(useSoundWave)
    setRoomMode('room')
    setStatus(useSoundWave ? 'Broadcasting sound wave beacon...' : 'Creating secure room...')
    connectSocket(code, true)
    if (useSoundWave) emitRoomCode(code)
    QRCode.toDataURL(`${window.location.origin}/?join=${code}`, { width: 180, margin: 1 }, (error, url) => { if (!error) setQrData(url) })
  }

  const joinRoom = () => {
    const code = joinCode.replace(/\D/g, '').slice(0, 6)
    if (code.length !== 6) return setStatus('Enter a valid 6-digit PIN')
    setRoomCode(code)
    setRoomMode('room')
    setStatus('Joining room securely...')
    connectSocket(code, false)
  }

  const listenForRoom = async () => {
    if (!navigator.mediaDevices?.getUserMedia) return setStatus('Microphone access is not available in this browser')
    setListening(true)
    setStatus('Listening for the nearby sound-wave PIN...')
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
    } catch {
      setListening(false)
      setStatus('Microphone permission is needed to hear the PIN')
      return
    }
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 2048
    const source = context.createMediaStreamSource(stream)
    source.connect(analyser)
    const data = new Uint8Array(analyser.frequencyBinCount)
    const detected = []
    let lastDigit = null
    let stableFrames = 0
    const scan = () => {
      analyser.getByteFrequencyData(data)
      let bestIndex = 0
      for (let index = 1; index < data.length; index += 1) if (data[index] > data[bestIndex]) bestIndex = index
      const frequency = bestIndex * context.sampleRate / analyser.fftSize
      const digit = SOUND_FREQUENCIES.reduce((best, value, index) => Math.abs(value - frequency) < Math.abs(SOUND_FREQUENCIES[best] - frequency) ? index : best, 0)
      const strength = data[bestIndex]
      if (strength > 105 && Math.abs(SOUND_FREQUENCIES[digit] - frequency) < 90) {
        if (digit === lastDigit) stableFrames += 1
        else { lastDigit = digit; stableFrames = 1 }
        if (stableFrames === 2 && detected.length < 6) detected.push(String(digit))
      } else {
        lastDigit = null
        stableFrames = 0
      }
      if (detected.length === 6) {
        const code = detected.join('')
        stream.getTracks().forEach((track) => track.stop())
        context.close()
        setListening(false)
        setJoinCode(code)
        setStatus(`PIN ${code} detected. Tap Join room to connect.`)
        return
      }
      audioRefs.current.frame = requestAnimationFrame(scan)
    }
    audioRefs.current = { context, stream, frame: requestAnimationFrame(scan) }
  }

  const copyRoom = async () => {
    await navigator.clipboard?.writeText(roomCode)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  const sendClipboard = (text) => {
    setClipboard(text)
    if (channelRef.current?.readyState === 'open') channelRef.current.send(JSON.stringify({ type: 'clipboard', text }))
  }

  const sendFile = async (file) => {
    if (!file) return
    if (channelRef.current?.readyState !== 'open') return setStatus('Connect another device before sending')
    channelRef.current.send(JSON.stringify({ type: 'file-meta', name: file.name, size: file.size, mime: file.type }))
    for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) channelRef.current.send(await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer())
    channelRef.current.send(JSON.stringify({ type: 'file-end' }))
    setTransfers((current) => [{ name: file.name, size: formatBytes(file.size), time: 'Just now', type: extension(file.name), direction: 'sent' }, ...current])
  }

  const handleFiles = (event) => { const file = event.target.files?.[0]; sendFile(file); event.target.value = '' }
  const downloadFile = (file) => { const blob = new Blob([`Flowdrop transfer: ${file.name}`]); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = file.name; link.click(); URL.revokeObjectURL(url) }

  const toggleTheme = () => setTheme((current) => { const next = current === 'light' ? 'dark' : 'light'; localStorage.setItem('flowdrop-theme', next); return next })

  if (roomMode !== 'room') return <EntryScreen mode={roomMode} setMode={setRoomMode} joinCode={joinCode} setJoinCode={setJoinCode} createRoom={createRoom} joinRoom={joinRoom} listenForRoom={listenForRoom} listening={listening} status={status} theme={theme} toggleTheme={toggleTheme} />

  return <div className={`app-shell theme-${theme}`}><aside className="sidebar"><div className="brand"><span className="brand-mark">⌁</span><span>flowdrop</span></div><div className="workspace-label">WORKSPACE</div><nav><button className={activeTab === 'share' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('share')}><span>↗</span> Share files</button><button className={activeTab === 'clipboard' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('clipboard')}><span>▣</span> Clipboard</button><button className={activeTab === 'history' ? 'nav-item active' : 'nav-item'} onClick={() => setActiveTab('history')}><span>◷</span> Transfer history</button></nav><div className="sidebar-bottom"><div className="avatar">AK</div><div><strong>Anonymous device</strong><small>Private workspace</small></div></div></aside><main className="main-content"><header className="topbar"><div><span className="eyebrow">ROOM / {roomCode}</span><h1>{activeTab === 'share' ? 'Share files' : activeTab === 'clipboard' ? 'Shared clipboard' : 'Transfer history'}</h1></div><div className="topbar-actions"><span className="secure"><i /> {connected ? 'WebRTC connected' : status}</span><button className="theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? '☾' : '☀'}</button></div></header><section className={`room-banner ${soundWave ? 'sound-active' : ''}`}><div className="pulse-ring">⌁</div><div className="room-copy"><span className="eyebrow">6-DIGIT ROOM PIN {soundWave && '· SOUND WAVE'}</span><h2>{roomCode}</h2><p>{connected ? 'Devices are connected directly. Data stays peer-to-peer.' : status}</p></div>{soundWave && <div className="waveform" aria-label="Sound wave beacon active">{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--bar': `${20 + ((index * 17) % 70)}%` }} />)}</div>}<div className="room-actions"><button className="outline-button" onClick={copyRoom}>▣ {copied ? 'Copied' : 'Copy PIN'}</button>{soundWave && <button className="outline-button" onClick={() => emitRoomCode(roomCode)}>∿ Emit PIN</button>}<button className="dark-button" onClick={() => setRoomMode('join')}>Join another <span>→</span></button></div>{qrData && <img className="room-qr-image" src={qrData} alt="Scan to join this room" />}</section>{activeTab === 'share' && <><section className="transfer-grid"><div className="upload-panel"><div className="section-heading"><div><span className="eyebrow">SEND TO ROOM</span><h2>Drop files here</h2></div><span className="network-badge"><i /> Direct WebRTC</span></div><div className="dropzone" onClick={() => fileInputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); handleFiles({ target: { files: event.dataTransfer.files, value: '' } }) }}><div className="upload-icon">↑</div><strong>Drag & drop files here</strong><p>or click to browse from your device</p><small>Chunks travel directly between networks</small><input ref={fileInputRef} type="file" hidden onChange={handleFiles} /></div><div className="network-row"><span>Works across mobile networks</span><div className="network-list"><b className="airtel">airtel</b><b className="jio">Jio</b><b className="vi">vi</b></div></div></div><div className="clipboard-panel"><div className="section-heading"><div><span className="eyebrow">QUICK SHARE</span><h2>Clipboard</h2></div><span className="live-dot">● Live</span></div><textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} /><div className="clipboard-footer"><span>Syncs over data channel</span><button className="mini-button" onClick={() => navigator.clipboard?.writeText(clipboard)}>Copy <span>↗</span></button></div></div></section><TransferList transfers={transfers} onDownload={downloadFile} /></>}{activeTab === 'clipboard' && <section className="large-clipboard"><span className="eyebrow">REAL-TIME TEXT SYNC</span><h2>Anything you copy, everywhere.</h2><textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} /><button className="dark-button" onClick={() => navigator.clipboard?.writeText(clipboard)}>Copy to device →</button></section>}{activeTab === 'history' && <TransferList transfers={transfers} onDownload={downloadFile} full />}<footer><span>Flowdrop v1.0</span><span>Native WebRTC data channel · No cloud storage</span><span className="connection"><i /> {connected ? 'Connected' : 'Waiting'}</span></footer></main></div>
}

function EntryScreen({ mode, setMode, joinCode, setJoinCode, createRoom, joinRoom, listenForRoom, listening, status, theme, toggleTheme }) {
  return <main className={`entry-screen theme-${theme}`}><button className="theme-toggle entry-theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? '☾' : '☀'}</button><div className="entry-brand"><span className="brand-mark">⌁</span> flowdrop</div><div className="entry-card"><span className="eyebrow">PRIVATE PEER-TO-PEER SHARING</span><h1>{mode === 'join' ? 'Join a room' : 'Share without limits.'}</h1><p>{mode === 'join' ? 'Scan the QR code, listen for the nearby beacon, or enter the 6-digit PIN.' : 'Create a secure room. Your files travel directly between devices.'}</p>{mode === 'join' ? <><label htmlFor="room-pin">ROOM PIN</label><input id="room-pin" autoFocus inputMode="numeric" maxLength="6" placeholder="000000" value={joinCode} onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="entry-button" onClick={joinRoom}>Join room →</button><button className={`listen-button ${listening ? 'listening' : ''}`} onClick={listenForRoom}><span className="mic-icon">{listening ? '◉' : '◌'}</span>{listening ? 'Listening for sound wave...' : 'Listen for sound wave'}</button><button className="link-button" onClick={() => setMode('create')}>Create a new room</button></> : <><button className="entry-button" onClick={() => createRoom(false)}>Create room <span>→</span></button><button className="wave-button" onClick={() => createRoom(true)}><span className="wave-mini">∿</span> Create & emit sound wave</button><button className="link-button" onClick={() => setMode('join')}>I have a room PIN</button></>}<small className="entry-status">{status}</small></div><div className="entry-foot">Encrypted in transit · WebRTC direct · Works on Airtel, Jio, Vi and any network</div></main>
}

function TransferList({ transfers, onDownload, full = false }) {
  return <section className={full ? 'history-section full' : 'history-section'}><div className="section-heading"><div><span className="eyebrow">RECENT ACTIVITY</span><h2>Transfer history</h2></div></div><div className="history-table"><div className="table-head"><span>FILE</span><span>SIZE</span><span>TIME</span><span>STATUS</span><span /></div>{transfers.length === 0 && <div className="empty-history">No transfers in this room yet.</div>}{transfers.map((file, index) => <div className="table-row" key={`${file.name}-${index}`}><span className="file-name"><span className={`file-icon ${file.type}`}>{file.type.toUpperCase().slice(0, 3)}</span><strong>{file.name}</strong></span><span>{file.size}</span><span>{file.time}</span><span className="status"><i /> {file.direction === 'received' ? 'Received' : 'Sent'}</span><button className="download-button" onClick={() => onDownload(file)} aria-label={`Download ${file.name}`}>↓</button></div>)}</div></section>
}

function extension(name) { return name.split('.').pop()?.toLowerCase() || 'file' }
function formatBytes(bytes) { return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB` }

export default App
