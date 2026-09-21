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

STUN alone cannot connect every Jio, Airtel, BSNL, or VI pairing: some carrier NATs block direct WebRTC paths. Configure a TURN service for a reliable relay fallback, especially in production. Add these build-time variables in the deployment environment:

```bash
VITE_SIGNALING_URL=wss://signal.your-domain.example
VITE_TURN_URLS=turn:turn.your-domain.example:3478?transport=udp,turn:turn.your-domain.example:3478?transport=tcp,turns:turn.your-domain.example:443?transport=tcp
VITE_TURN_USERNAME=replace-with-short-lived-username
VITE_TURN_CREDENTIAL=replace-with-short-lived-credential
```

Use a TURN provider or a coturn server with TLS on port 443. The app first attempts a direct connection, then automatically relays through TURN when mobile networks cannot establish a direct path. Do not put permanent TURN credentials in a public client build; generate time-limited credentials from the signaling backend for production.
