# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

# Air Share Pro

## HTTPS local testing

The microphone sound-wave flow needs a secure browser context. Start both processes:

```bash
npm run server
npm run dev -- --host 0.0.0.0
```

Open the app at:

- `https://localhost:5173/` on this Mac
- `https://192.168.1.5:5173/` on another device connected to the same Wi-Fi

The local certificate is self-signed. On the first visit, choose **Advanced** and **Proceed** (or accept the certificate warning in the browser). Then allow microphone access. The signaling server also runs securely at `wss://localhost:8787`.

The LAN address can change with the network. Find the current address with:

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

## Reliable cross-network connections

College/enterprise firewalls can block UDP and STUN completely. A public TURN relay with TLS over TCP port 443 is required for those networks; no browser-only change can bypass that firewall safely.

This app now issues short-lived coturn REST credentials at `/.well-known/air-share/ice`. Configure these **server-side** environment variables where `npm run server` runs:

```bash
TURN_URLS=turn:turn.your-domain.example:3478?transport=udp,turn:turn.your-domain.example:3478?transport=tcp,turns:turn.your-domain.example:443?transport=tcp
TURN_SHARED_SECRET=use-a-long-random-secret
TURN_TTL_SECONDS=3600
```

Configure coturn with the same secret and a valid TLS certificate:

```ini
use-auth-secret
static-auth-secret=use-a-long-random-secret
realm=turn.your-domain.example
listening-port=3478
tls-listening-port=443
cert=/etc/letsencrypt/live/turn.your-domain.example/fullchain.pem
pkey=/etc/letsencrypt/live/turn.your-domain.example/privkey.pem
```

Also publish UDP/TCP 3478, TCP 443, and coturn's relay UDP port range in the TURN server firewall. Set `VITE_SIGNALING_URL=wss://signal.your-domain.example` when the frontend is hosted separately; set `VITE_ICE_CONFIG_URL=https://signal.your-domain.example/.well-known/air-share/ice` only if its ICE endpoint is on a different URL.

The app continues to use direct peer-to-peer traffic on LAN and normal mobile networks, then automatically uses TURN TCP/TLS when direct ICE fails. TURN credentials are no longer embedded in the client bundle.
