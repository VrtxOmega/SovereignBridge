<div align="center">
  <img src="https://upload.wikimedia.org/wikipedia/commons/4/42/Omega_uc_lc.svg" width="120" style="opacity: 0.8;" />
  <h1 align="center">SOVEREIGN BRIDGE</h1>
  <p align="center">
    <strong>Absolute E2EE Zero-Cloud Data Synchronization</strong>
  </p>
</div>

Sovereign Bridge isn't just an app; it is an uncompromised philosophical architecture for total data sovereignty. 

We live in an era where copying a string of text from your phone to your PC forces it to traverse 5,000 miles across public infrastructure, passing through multiple data brokers, telemetry nodes, and third-party servers. Sovereign Bridge rejects this paradigm completely. 

**Zero Cloud. Zero Third-Parties. Absolute Control.**

## How It Works

Sovereign Bridge utilizes a hardened Tri-Node Architecture:
1. **The Daemon (`bridge_daemon.py`):** An asynchronous Python WebSockets relay running strictly locally on your PC.
2. **The Desktop Dashboard (`App.jsx`):** A VERITAS-branded React UI for reviewing captured timeline elements.
3. **The Mobile Application (`React Native`):** The Android bridge hooked directly into your OS's native "Share" Intents and Clipboard.

Data traverses directly from device to device. Tunneling (like `localtunnel` or `ngrok`) is strictly used as an internet passthrough—not a storage node.

## Cryptographic Guarantees (Phase 4 AES-256 E2EE)

All JSON payloads are cryptographically shredded and encrypted **before** they leave your device's memory. 

- The cryptographic engine leverages a `STATIC_SECRET` pre-shared key (PSK) generated via `CryptoJS.SHA256` and PyCryptodome.
- We utilize `AES.MODE_CBC` with `Pkcs7` block padding, enforcing randomized 16-byte initialization vectors (`IV`) per transmission.
- Because the secret is hardcoded directly into the raw source, there is **zero handshake**. Man-in-the-Middle (MITM) attacks are mathematically eliminated because the connection never negotiates a key exchange.

> [!CAUTION]
> You **MUST** change the `STATIC_SECRET` in all three source files (`BridgeWebSocketService.js`, `App.jsx`, and `bridge_daemon.py`) before compilation.

## Features

- **Autonomous Clipboard Gating:** Selectively toggle real-time bidirectional clipboard sync directly from the Desktop hardware interface.
- **Native Android Send Intents:** Beam any file, photo, text, or URL straight to your PC natively via standard OS "Share" sheets. 
- **Native Desktop Notifications:** Bind OS-level Windows `winotify` toast overlays for incoming transfers.
- **OCR Text Extraction:** Direct embedded image-to-text integration for receipts, code, and documents.
- **Dropzone Staging:** Drag and drop PC files into the bridge to manifest them onto your phone instantly. 

## Installation

### 1. Boot The Daemon
```bash
cd daemon_and_desktop
pip install -r requirements.txt
python bridge_daemon.py
```

### 2. Ignite The Dashboard
```bash
cd daemon_and_desktop/desktop
npm install
npm run dev
```

### 3. Deploy The Android Sandbox
Open `mobile_app/src/services/BridgeWebSocketService.js` and specify your PC's IP or proxy tunnel.
```bash
cd mobile_app
npm install
npm run android
```

<div align="center">
  <p><i>Examina omnia, venerare nihil, pro te cogita</i></p>
</div>
