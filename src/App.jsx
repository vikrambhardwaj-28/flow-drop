import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import './App.css'

const CHUNK_SIZES = { eco: 32 * 1024, balanced: 64 * 1024, turbo: 128 * 1024 }
const ROOM_READY_TIMEOUT = 4000
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
    screen: <><rect width="20" height="14" x="2" y="3" rx="2" /><line x1="8" x2="16" y1="21" y2="21" /><line x1="12" x2="12" y1="17" y2="21" /></>,
    screenOff: <><path d="M1 1l22 22" /><path d="M4 4H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 .8-.4" /><path d="M8 21h8" /><path d="M12 17v4" /><path d="M9 4h12a1 1 0 0 1 1 1v10a1 1 0 0 1-.2.6" /></>,
    maximize: <><polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" /><line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" /></>,
    volume: <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /></>,
    volumeX: <><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></>,
    pip: <><rect width="18" height="13" x="3" y="6" rx="2" /><rect width="7" height="5" x="12" y="12" rx="1" fill="currentColor" fillOpacity="0.3" /></>,
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

  // Screen sharing state
  const [localScreenStream, setLocalScreenStream] = useState(null)
  const [remoteScreenStream, setRemoteScreenStream] = useState(null)

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

  const isHostRef = useRef(false)
  const makingOffer = useRef(false)
  const localStreamRef = useRef(null)
  const remoteStreamRef = useRef(null)
  const screenSenders = useRef([])

  const signal = (message) => socket.current?.send(JSON.stringify(message))

  const finishReceive = () => {
    const file = receiving.current
    if (!file) return
    const url = URL.createObjectURL(new Blob(file.chunks, { type: file.mime || 'application/octet-stream' }))
    const link = document.createElement('a'); link.href = url; link.download = file.name; link.click()
    setTransfers((items) => [{ name: file.name, size: bytes(file.size), time: clock(), direction: 'Received', type: extension(file.name), url }, ...items])
    receiving.current = null; setProgress(null)
  }

  const refreshRemoteStream = () => {
    if (!peer.current) return
    const activeVideoTracks = peer.current.getReceivers()
      .map((r) => r.track)
      .filter((t) => t && t.kind === 'video' && t.readyState === 'live')

    if (activeVideoTracks.length > 0) {
      const activeTracks = peer.current.getReceivers()
        .map((r) => r.track)
        .filter((t) => t && t.readyState === 'live')
      const stream = new MediaStream(activeTracks)
      remoteStreamRef.current = stream
      setRemoteScreenStream(stream)
    }
  }

  const renegotiate = async () => {
    const rtc = peer.current
    if (!rtc) return
    try {
      makingOffer.current = true
      const offer = await rtc.createOffer()
      if (rtc.signalingState !== 'stable') return
      await rtc.setLocalDescription(offer)
      signal({ type: 'offer', description: rtc.localDescription })
    } catch (err) {
      console.error('Renegotiation failed:', err)
    } finally {
      makingOffer.current = false
    }
  }

  const startScreenShare = async () => {
    if (!connected || !peer.current) {
      setStatus('Devices must be connected before sharing screen')
      return
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      alert('Screen sharing is not supported by your browser or operating system.')
      return
    }
    try {
      let stream
      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: true,
        })
      } catch {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
        })
      }

      localStreamRef.current = stream
      setLocalScreenStream(stream)
      setStatus('Sharing your screen...')

      const senders = []
      stream.getTracks().forEach((track) => {
        const sender = peer.current.addTrack(track, stream)
        senders.push(sender)
        track.onended = () => {
          stopScreenShare(true)
        }
      })
      screenSenders.current = senders

      signal({ type: 'screen-start' })
      if (channel.current?.readyState === 'open') {
        try { channel.current.send(JSON.stringify({ type: 'screen-start' })) } catch {}
      }

      await renegotiate()
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'AbortError') return
      console.error('Error starting screen share:', err)
      setStatus(`Could not start screen share: ${err.message || err.name}`)
    }
  }

  const stopScreenShare = async (notify = true) => {
    if (screenSenders.current.length > 0 && peer.current) {
      screenSenders.current.forEach((sender) => {
        try {
          peer.current.removeTrack(sender)
        } catch {}
      })
      screenSenders.current = []
    }

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop())
      localStreamRef.current = null
    }
    setLocalScreenStream(null)

    if (notify) {
      signal({ type: 'screen-stop' })
      if (channel.current?.readyState === 'open') {
        try { channel.current.send(JSON.stringify({ type: 'screen-stop' })) } catch {}
      }
      await renegotiate()
      setStatus('Stopped sharing screen')
    }
  }

  const setupChannel = (dataChannel) => {
    dataChannel.binaryType = 'arraybuffer'
    dataChannel.onopen = () => { setConnected(true); setStatus('Connected directly via WebRTC') }
    dataChannel.onclose = () => {
      setConnected(false)
      stopScreenShare(false)
      setStatus('Device disconnected')
    }
    dataChannel.onmessage = (event) => {
      if (typeof event.data === 'string') {
        let message
        try {
          message = JSON.parse(event.data)
        } catch {
          return
        }
        if (message.type === 'clipboard') setClipboard(message.text)
        if (message.type === 'file-meta') { receiving.current = { ...message, chunks: [], received: 0, started: performance.now() }; setProgress({ name: message.name, percent: 0, direction: 'receiving', speed: 'starting', eta: 'calculating...' }) }
        if (message.type === 'file-end') finishReceive()
        if (message.type === 'file-cancel') { receiving.current = null; setProgress(null); setStatus('Incoming transfer was cancelled') }
        if (message.type === 'screen-stop') {
          if (remoteStreamRef.current) {
            remoteStreamRef.current.getTracks().forEach((track) => track.stop())
            remoteStreamRef.current = null
          }
          setRemoteScreenStream(null)
          setStatus('Remote user stopped sharing screen')
        }
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
      if (connection.connectionState === 'disconnected' || connection.connectionState === 'closed') {
        setConnected(false)
        stopScreenShare(false)
      }
    }

    connection.ontrack = (event) => {
      const incomingStream = event.streams && event.streams[0] ? event.streams[0] : new MediaStream([event.track])
      remoteStreamRef.current = incomingStream
      setRemoteScreenStream(incomingStream)

      event.track.onended = () => {
        const current = remoteStreamRef.current
        if (!current || !current.getVideoTracks().some((t) => t.readyState === 'live')) {
          if (remoteStreamRef.current) {
            remoteStreamRef.current.getTracks().forEach((t) => t.stop())
            remoteStreamRef.current = null
          }
          setRemoteScreenStream(null)
        }
      }
    }

    if (host) setupChannel(connection.createDataChannel('air-share'))
    else connection.ondatachannel = (event) => setupChannel(event.channel)
    peer.current = connection
    return connection
  }

  const connect = (code, host) => {
    isHostRef.current = host
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
      let message
      try {
        message = JSON.parse(event.data)
      } catch {
        return
      }

      if (message.type === 'room-ready') {
        clearTimeout(roomTimer.current)
        reconnectAttempts.current = 0
        setStatus(host ? 'Room ready. Share the PIN or QR.' : 'Waiting for the other device...')
        return
      }

      if (message.type === 'peer-joined' && host) {
        const rtc = peer.current || await makePeer(true)
        try {
          makingOffer.current = true
          const offer = await rtc.createOffer()
          await rtc.setLocalDescription(offer)
          signal({ type: 'offer', description: rtc.localDescription })
        } catch (err) {
          console.error('Initial offer error:', err)
        } finally {
          makingOffer.current = false
        }
        return
      }

      if (message.type === 'offer' || (message.type === 'description' && message.description?.type === 'offer')) {
        const desc = message.description || message
        const rtc = peer.current || await makePeer(false)

        const isPolite = !isHostRef.current
        const offerCollision = makingOffer.current || rtc.signalingState !== 'stable'

        if (offerCollision) {
          if (!isPolite) {
            console.log('Host (impolite) ignoring offer collision')
            return
          }
          console.log('Guest (polite) rolling back offer')
          try {
            await rtc.setLocalDescription({ type: 'rollback' })
          } catch {}
        }

        try {
          await rtc.setRemoteDescription(desc)
          await addPendingCandidates(rtc)
          const answer = await rtc.createAnswer()
          await rtc.setLocalDescription(answer)
          signal({ type: 'answer', description: rtc.localDescription })
          refreshRemoteStream()
        } catch (err) {
          console.error('Failed to handle offer:', err)
        }
        return
      }

      if (message.type === 'answer' || (message.type === 'description' && message.description?.type === 'answer')) {
        const desc = message.description || message
        if (peer.current && peer.current.signalingState === 'have-local-offer') {
          try {
            await peer.current.setRemoteDescription(desc)
            await addPendingCandidates(peer.current)
            refreshRemoteStream()
          } catch (err) {
            console.error('Failed to handle answer:', err)
          }
        }
        return
      }

      if (message.type === 'candidate') {
        if (peer.current?.remoteDescription) {
          await peer.current.addIceCandidate(message.candidate).catch(() => {})
        } else {
          pendingCandidates.current.push(message.candidate)
        }
        return
      }

      if (message.type === 'screen-start') {
        setStatus('Remote user started sharing screen')
        refreshRemoteStream()
        return
      }

      if (message.type === 'screen-stop') {
        if (remoteStreamRef.current) {
          remoteStreamRef.current.getTracks().forEach((track) => track.stop())
          remoteStreamRef.current = null
        }
        setRemoteScreenStream(null)
        setStatus('Remote user stopped sharing screen')
        return
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
      for (let attempt = 0; attempt < 2; attempt += 1) {
        for (const digit of code) await playTone(context, TONES[Number(digit)])
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 280))
      }
    } finally {
      context.close()
      setSoundWave(false)
    }
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
    return () => {
      clearTimeout(roomTimer.current)
      stopScreenShare(false)
      if (remoteStreamRef.current) {
        remoteStreamRef.current.getTracks().forEach((track) => track.stop())
        remoteStreamRef.current = null
      }
      channel.current?.close()
      peer.current?.close()
      socket.current?.close()
      audio.current.stream?.getTracks().forEach((track) => track.stop())
      audio.current.context?.close()
      if (audio.current.frame) cancelAnimationFrame(audio.current.frame)
    }
  }, [])

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

  const disconnect = () => {
    stopScreenShare(false)
    if (remoteStreamRef.current) {
      remoteStreamRef.current.getTracks().forEach((track) => track.stop())
      remoteStreamRef.current = null
    }
    setRemoteScreenStream(null)
    channel.current?.close()
    peer.current?.close()
    socket.current?.close()
    setConnected(false)
    setStatus('Disconnected')
  }

  const toggleTheme = () => setTheme((value) => { const next = value === 'dark' ? 'light' : 'dark'; localStorage.setItem('air-share-pro-theme', next); return next })

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  return <div className={`app-shell theme-${theme}`}>
    <aside className="sidebar">
      <div className="brand"><img className="brand-logo" src="/air-share-logo.svg" alt="Air Share Pro logo" /><span>Air Share Pro</span></div>
      <nav>
        <button disabled={!connected} className={connected ? 'nav-item active' : 'nav-item'} onClick={() => scrollTo('transfer-section')}><Icon name="share" /> <span>Files</span></button>
        <button disabled={!connected} className="nav-item" onClick={() => scrollTo('screenshare-section')}>
          <Icon name="screen" /> <span>Screen Share</span>
          {(localScreenStream || remoteScreenStream) && <span className="nav-live-dot" />}
        </button>
        <button disabled={!connected} className="nav-item" onClick={() => scrollTo('clipboard-section')}><Icon name="clipboard" /> <span>Clipboard</span></button>
        <button className="nav-item" onClick={() => scrollTo('history-section')}><Icon name="history" /> <span>History</span></button>
      </nav>
    </aside>
    <main className="main-content">
      <header className="topbar">
        <div><span className="eyebrow">AIR SHARE PRO / PRIVATE ROOM</span><h1>{connected ? 'Ready to share' : 'Connect your devices'}</h1></div>
        <div className="topbar-actions">
          <span className="secure"><i /> {connected ? 'Connected' : status}</span>
          {connected && (
            <>
              {!localScreenStream ? (
                <button className="outline-button screenshare-top-btn" onClick={startScreenShare} title="Share your screen with the connected device">
                  <Icon name="screen" size={16} /> <span>Share Screen</span>
                </button>
              ) : (
                <button className="outline-button screenshare-top-btn active-sharing" onClick={() => stopScreenShare(true)} title="Stop sharing your screen">
                  <Icon name="screenOff" size={16} /> <span>Stop Sharing</span>
                </button>
              )}
              <button className="outline-button disconnect-button" onClick={disconnect}>Disconnect</button>
            </>
          )}
          <button className="theme-toggle" onClick={toggleTheme} aria-label="Change color theme"><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        </div>
      </header>

      <section className={`room-banner ${soundWave ? 'sound-active' : ''}`}><div className="pulse-ring"><img src="/air-share-logo.svg" alt="" /></div><div className="room-copy"><span className="eyebrow">YOUR SECURE ROOM</span><h2>{roomCode || '------'}</h2><p>{status}</p></div>{qr && <img className="room-qr-image" src={qr} alt="Scan to join Air Share Pro room" />}<div className="room-actions"><button className="outline-button" onClick={() => createRoom(false)}>New room</button><button className="outline-button" onClick={() => navigator.clipboard?.writeText(roomCode)}><Icon name="copy" size={16} /> Copy PIN</button><button className="outline-button" onClick={() => emit(roomCode)}><Icon name="wave" size={16} /> Sound wave</button></div></section>

      {!connected && <JoinCard code={joinCode} setCode={setJoinCode} join={join} listen={listen} listening={listening} />}

      {connected && (
        <div id="screenshare-section">
          {(!localScreenStream && !remoteScreenStream) ? (
            <ScreenShareBanner onStart={startScreenShare} />
          ) : (
            <ScreenShareStage
              localStream={localScreenStream}
              remoteStream={remoteScreenStream}
              onStartLocal={startScreenShare}
              onStopLocal={() => stopScreenShare(true)}
            />
          )}
        </div>
      )}

      {connected && (
        <section className="transfer-grid" id="transfer-section">
          <div className="upload-panel">
            <div className="section-heading"><div><span className="eyebrow">SEND FILE</span><h2>Drop files here</h2></div><span className="network-badge"><i /> Direct WebRTC</span></div>
            <div className="dropzone" id="file-dropzone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); sendFiles(event.dataTransfer.files) }}>
              <div className="upload-icon"><Icon name="upload" size={27} /></div>
              <strong>Choose files or drag them here</strong>
              <p>Encrypted direct transfer on any network</p>
              <input ref={fileInput} hidden multiple type="file" onChange={(event) => { sendFiles(event.target.files); event.target.value = '' }} />
            </div>
            <TransferProfiles profile={transferProfile} setProfile={setTransferProfile} />
          </div>
          <div className="clipboard-panel" id="clipboard-section">
            <div className="section-heading"><div><span className="eyebrow">QUICK SHARE</span><h2>Clipboard</h2></div><span className="live-dot"><i /> Live</span></div>
            <textarea value={clipboard} onChange={(event) => sendClipboard(event.target.value)} />
            <small>Syncs instantly with this room</small>
          </div>
        </section>
      )}

      {progress && <TransferProgress progress={progress} togglePause={toggleTransferPause} cancel={cancelTransfer} />}
      <div id="history-section"><History transfers={transfers} download={downloadTransfer} /></div>
      <AirShareFooter />
    </main>
  </div>
}

function ScreenShareBanner({ onStart }) {
  return (
    <section className="screenshare-promo-card">
      <div className="promo-text">
        <span className="eyebrow">REAL-TIME P2P SCREEN SHARE</span>
        <h2>Screen Sharing</h2>
        <p>Share your screen, an application window, or browser tab with the connected device in real-time. Both users can also share screens simultaneously.</p>
      </div>
      <div className="promo-actions">
        <button className="start-screenshare-main-btn" onClick={onStart}>
          <Icon name="screen" size={18} />
          <span>Start Screen Share</span>
        </button>
      </div>
    </section>
  )
}

function ScreenShareStage({ localStream, remoteStream, onStartLocal, onStopLocal }) {
  const isBothSharing = Boolean(localStream && remoteStream)

  return (
    <section className="screenshare-stage">
      <div className="section-heading">
        <div>
          <span className="eyebrow">P2P SCREEN SHARE</span>
          <h2>{isBothSharing ? 'Dual Screen Share (Both Active)' : remoteStream ? 'Remote Screen Broadcast' : 'Your Screen Broadcast'}</h2>
        </div>
        <div className="screenshare-status-badges">
          {remoteStream && <span className="live-broadcast-pill"><i /> Remote Live</span>}
          {localStream && <span className="live-broadcast-pill local"><i /> You Sharing</span>}
        </div>
      </div>

      <div className={`screenshare-viewport-grid ${isBothSharing ? 'dual-view' : 'single-view'}`}>
        {remoteStream && (
          <RemoteScreenCard stream={remoteStream} isBothSharing={isBothSharing} />
        )}
        {localStream && (
          <LocalScreenCard stream={localStream} onStop={onStopLocal} isBothSharing={isBothSharing} />
        )}
      </div>

      {!localStream && remoteStream && (
        <div className="screenshare-dual-prompt">
          <span>Both users can share screens simultaneously! Want to share your screen too?</span>
          <button className="outline-button" onClick={onStartLocal}>
            <Icon name="screen" size={16} /> Share My Screen
          </button>
        </div>
      )}
    </section>
  )
}

function RemoteScreenCard({ stream, isBothSharing }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const [muted, setMuted] = useState(false)
  const [hasAudio, setHasAudio] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
      setHasAudio(stream.getAudioTracks().length > 0)
      const playPromise = videoRef.current.play()
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          if (videoRef.current) {
            videoRef.current.muted = true
            setMuted(true)
            videoRef.current.play().catch(() => {})
          }
        })
      }
    }
  }, [stream])

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setMuted(videoRef.current.muted)
    }
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }

  const togglePip = async () => {
    if (!videoRef.current) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture()
      }
    } catch (e) {
      console.warn('PiP error:', e)
    }
  }

  return (
    <div className={`screenshare-card remote-card ${isBothSharing ? 'dual' : 'solo'}`} ref={containerRef}>
      <div className="card-topbar">
        <div className="card-title">
          <span className="live-tag"><i /> Remote Screen</span>
          {hasAudio && <span className="audio-tag">Audio</span>}
        </div>
        <div className="card-controls">
          {hasAudio && (
            <button className="control-btn" onClick={toggleMute} title={muted ? 'Unmute' : 'Mute'}>
              <Icon name={muted ? 'volumeX' : 'volume'} size={16} />
            </button>
          )}
          {document.pictureInPictureEnabled && (
            <button className="control-btn" onClick={togglePip} title="Picture-in-Picture">
              <Icon name="pip" size={16} />
            </button>
          )}
          <button className="control-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            <Icon name="maximize" size={16} />
          </button>
        </div>
      </div>
      <div className="video-viewport">
        <video ref={videoRef} autoPlay playsInline muted={muted} />
      </div>
    </div>
  )
}

function LocalScreenCard({ stream, onStop, isBothSharing }) {
  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.().catch(() => {})
      setIsFullscreen(true)
    } else {
      document.exitFullscreen?.().catch(() => {})
      setIsFullscreen(false)
    }
  }

  return (
    <div className={`screenshare-card local-card ${isBothSharing ? 'dual' : 'solo'}`} ref={containerRef}>
      <div className="card-topbar">
        <div className="card-title">
          <span className="live-tag local"><i /> Your Screen (Sharing)</span>
        </div>
        <div className="card-controls">
          <button className="control-btn" onClick={toggleFullscreen} title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}>
            <Icon name="maximize" size={16} />
          </button>
          <button className="stop-btn" onClick={onStop} title="Stop sharing screen">
            <Icon name="screenOff" size={15} /> <span>Stop Sharing</span>
          </button>
        </div>
      </div>
      <div className="video-viewport">
        <video ref={videoRef} autoPlay playsInline muted />
      </div>
    </div>
  )
}

function TransferProfiles({ profile, setProfile }) { return <div className="transfer-profiles"><div><span className="eyebrow">TRANSFER ENGINE</span><strong>Smart transfer profile</strong></div><div className="profile-options" role="group" aria-label="Transfer profile">{[['eco', 'Eco'], ['balanced', 'Balanced'], ['turbo', 'Turbo']].map(([value, label]) => <button key={value} className={profile === value ? 'profile-option active' : 'profile-option'} onClick={() => setProfile(value)}>{label}</button>)}</div><small>{profile === 'eco' ? 'Smaller packets for unstable connections' : profile === 'turbo' ? 'Larger packets for fast, reliable networks' : 'Optimized for most networks'}</small></div> }
function JoinCard({ code, setCode, join, listen, listening }) { return <section className="join-card"><div><span className="eyebrow">JOIN ANOTHER ROOM</span><h2>Enter a PIN or listen</h2><p>Use the 6-digit PIN from another Air Share Pro room.</p></div><div className="join-controls"><input aria-label="Room PIN" inputMode="numeric" maxLength="6" placeholder="000000" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /><button className="dark-button" onClick={() => join()}>Join →</button><button className={`listen-button ${listening ? 'listening' : ''}`} onClick={listen}>{listening ? 'Listening...' : '◌ Listen for sound wave'}</button></div></section> }
function TransferProgress({ progress, togglePause, cancel }) { return <section className="transfer-progress"><div className="progress-top"><div><span className="eyebrow">{progress.paused ? 'PAUSED' : progress.direction.toUpperCase()}</span><strong>{progress.name}</strong></div><b>{progress.percent}%</b></div><div className="progress-track"><i style={{ width: `${progress.percent}%` }} /></div><div className="progress-meta"><span>{progress.paused ? 'Waiting for resume' : progress.speed}</span><span>{progress.eta}</span></div>{progress.direction === 'sending' && <div className="transfer-controls"><button className="transfer-control pause" onClick={togglePause}>{progress.paused ? 'Resume' : 'Pause'}</button><button className="transfer-control cancel" onClick={cancel}>Cancel</button></div>}</section> }
function History({ transfers, download }) { return <section className="history-section"><div className="section-heading"><div><span className="eyebrow">ROOM HISTORY</span><h2>Recent transfers</h2></div></div><div className="history-table"><div className="table-head"><span>FILE</span><span>SIZE</span><span>TIME</span><span>STATUS</span><span>DOWNLOAD</span></div>{transfers.length === 0 && <div className="empty-history">No files shared in this room yet.</div>}{transfers.map((file, index) => <div className="table-row" key={`${file.name}-${index}`}><span className="file-name"><span className={`file-icon ${file.type}`}>{file.type.toUpperCase().slice(0, 3)}</span><strong>{file.name}</strong></span><span>{file.size}</span><span>{file.time}</span><span className="status"><i /> {file.direction}</span><button className="history-download" onClick={() => download(file)}>Download</button></div>)}</div></section> }

function AirShareFooter() {
  return <footer className="airshare-footer"><div className="footer-brand"><img className="footer-logo" src="/air-share-logo.svg" alt="Air Share Pro logo" /><strong>Air Share Pro</strong><small>Fast, private peer-to-peer sharing.</small></div><a className="feedback-link" href="mailto:vikram.2872006@gmail.com?subject=Air%20Share%20Pro%20feedback">Feedback</a><div className="footer-links"><a href="https://www.instagram.com/vikrm_bhardwaj?igsh=OWh4ZHprbW5rNTZv" target="_blank" rel="noreferrer">Instagram</a><a href="https://www.facebook.com/share/196jZuggxg/" target="_blank" rel="noreferrer">Facebook</a><a href="mailto:vikram.2872006@gmail.com">Email</a></div><div className="footer-credit">By Vikram Bhardwaj</div></footer>
}

export default App
