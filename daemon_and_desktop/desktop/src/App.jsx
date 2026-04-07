import React, { useState, useEffect, useRef } from 'react';
import CryptoJS from 'crypto-js';
import './index.css';

const STATIC_SECRET = CryptoJS.SHA256("YOUR_SECURE_PASSPHRASE_HERE"); // TODO: Change this before deployment

function encryptPayload(dict) {
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(JSON.stringify(dict), STATIC_SECRET, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return CryptoJS.enc.Base64.stringify(iv) + ':' + encrypted.toString();
}

function decryptPayload(str) {
  const parts = str.split(':');
  if (parts.length !== 2) return JSON.parse(str);
  const iv = CryptoJS.enc.Base64.parse(parts[0]);
  const decrypted = CryptoJS.AES.decrypt(parts[1], STATIC_SECRET, { iv: iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 });
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}

// A simple WebSockets service modeled after the mobile app 
class PCWebSocket {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.connected = false;
  }
  
  connect() {
    // Connect to local python daemon
    this.ws = new WebSocket('ws://127.0.0.1:5003/ws');
    
    this.ws.onopen = () => {
      this.connected = true;
      this.emit('connected', true);
      this.ws.send(encryptPayload({ type: 'REGISTER_DEVICE', device_id: 'pc_desktop', device_name: 'PC Desktop' }));
    };
    
    this.ws.onmessage = (event) => {
      try {
        const msg = decryptPayload(event.data);
        this.emit(msg.type, msg);
        this.emit('*', msg);
      } catch (e) {
        console.error(e);
      }
    };
    
    this.ws.onclose = () => {
      this.connected = false;
      this.emit('disconnected', false);
      setTimeout(() => this.connect(), 3000);
    };
  }

  send(type, payload = {}) {
    if (this.ws && this.connected) {
      this.ws.send(encryptPayload({ type, ...payload }));
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.listeners.get(event).delete(callback);
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(cb => cb(data));
    }
  }
}

const ws = new PCWebSocket();

// Components
const VeritasHeader = ({ title, subtitle, connected }) => (
  <div className="veritas-header">
    <div className="veritas-header-top">
      <div className="veritas-header-title">{title}</div>
      <div 
        className="veritas-header-status-dot" 
        style={{ backgroundColor: connected ? 'var(--green)' : 'var(--red)', boxShadow: connected ? '0 0 10px var(--green)' : 'none' }} 
      />
    </div>
    <div className="veritas-header-subtitle">{subtitle}</div>
  </div>
);

const CaptureScreen = () => {
  const [captures, setCaptures] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [textInput, setTextInput] = useState('');
  const [autoSync, setAutoSync] = useState(false);

  useEffect(() => {
    // Send SYNC_REQUEST when mounted
    ws.send('SYNC_REQUEST');
    
    const unsub = ws.on('SYNC_STATE', (msg) => {
      // Typically bridge gives us items in the history or we can just listen to PHOTO_RECEIVED etc
      if (msg.notes) {
        // Just as an example
      }
    });
    
    // Deduplicate by msg.id or msg.capture_id or timestamp
    const addCapture = (msg) => {
      setCaptures(prev => {
        const uniqueId = msg.capture_id || msg.id || msg.timestamp;
        if (prev.some(c => (c.capture_id || c.id || c.timestamp) === uniqueId)) {
          return prev;
        }
        return [msg, ...prev];
      });
    };

    const unsub2 = ws.on('PHOTO_RECEIVED', addCapture);
    const unsub3 = ws.on('CLIPBOARD_IMAGE', addCapture);
    const unsub4 = ws.on('FILE_RECEIVED', addCapture);
    
    return () => { unsub(); unsub2(); unsub3(); unsub4(); };
  }, []);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    
    // Convert dropped files to base64 and send
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const reader = new FileReader();
      reader.onload = (ev) => {
        const base64 = ev.target.result.split(',')[1];
        ws.send('PHOTO_CAPTURE', { 
          filename: file.name,
          data: base64
        });
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSendText = () => {
    if (!textInput.trim()) return;
    ws.send('CLIPBOARD_UPDATE', { content: textInput, format: 'text' });
    setTextInput('');
  };

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column' }}>
      <div 
        className={`dropzone ${isDragging ? 'active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div style={{ fontSize: 24, marginBottom: 8 }}>📁</div>
        <div>DROP FILE TO SEND TO PHONE</div>
      </div>
      
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <input 
          type="text" 
          placeholder="Paste or type text to beam to phone..." 
          value={textInput} 
          onChange={e => setTextInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSendText()}
          style={{ flex: 1 }}
        />
        <button className="btn-primary" onClick={handleSendText}>SEND</button>
      </div>
      
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button 
          onClick={() => {
            const nextSync = !autoSync;
            setAutoSync(nextSync);
            ws.send('SET_AUTO_SYNC', { enabled: nextSync });
          }}
          className={autoSync ? 'btn-primary' : 'btn-secondary'}
          style={{ padding: '6px 12px', fontSize: '10px', transition: 'all 0.2s', borderColor: autoSync ? 'var(--gold)' : 'var(--border)' }}
        >
          {autoSync ? 'AUTO-SYNC: ON' : 'AUTO-SYNC: OFF'}
        </button>
      </div>
      
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {captures.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', marginTop: 40, fontFamily: 'var(--font-mono)' }}>
            NO CAPTURES YET
          </div>
        )}
        {captures.map((cap, i) => {
          const imgUrl = cap.capture_id 
            ? `http://127.0.0.1:5003/api/download/${cap.capture_id}` 
            : `data:image/jpeg;base64,${cap.thumbnail_b64 || cap.data_b64}`;
            
          const handleDownloadPC = async (e) => {
            e.preventDefault();
            try {
              const resp = await fetch(imgUrl);
              const blob = await resp.blob();
              const blobUrl = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = blobUrl;
              a.download = cap.filename || 'bridge_capture';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(blobUrl);
            } catch (err) {
              console.error('Failed to download payload natively', err);
            }
          };

          return (
          <div key={i} style={{ backgroundColor: 'var(--obsidian-light)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, alignItems: 'center' }}>
              <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: 2 }}>{new Date(cap.timestamp).toLocaleString()}</div>
              {cap.format === 'image' || cap.thumbnail_b64 || cap.data_b64 || cap.type === 'photo' ? (
                 <button onClick={handleDownloadPC} className="btn-primary" style={{ padding: '4px 8px', fontSize: 10, cursor: 'pointer' }}>SAVE TO PC</button>
              ) : null}
            </div>
            {cap.format === 'image' || cap.thumbnail_b64 || cap.data_b64 || cap.type === 'photo' ? (
              <img src={imgUrl} style={{ width: '100%', borderRadius: 4 }} alt="capture" />
            ) : (
              <div style={{ color: 'var(--text-dim)' }}>File: {cap.filename || 'Unknown'}</div>
            )}
            {cap.text && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>{cap.text}</div>}
          </div>
        )})}
      </div>
    </div>
  );
};

const NotesScreen = () => {
  const [text, setText] = useState('');
  
  useEffect(() => {
    ws.send('SYNC_REQUEST');
    
    const unsub = ws.on('NOTE_UPDATE', (msg) => {
      setText(msg.content);
    });
    
    // Catch-all state sync
    const unsub2 = ws.on('SYNC_STATE', (msg) => {
      if (msg.notes) {
        setText(msg.notes.content);
      }
    });

    return () => { unsub(); unsub2(); };
  }, []);

  const handleUpdate = () => {
    ws.send('NOTE_UPDATE', { content: text });
  };

  return (
    <div className="screen" style={{ display: 'flex', flexDirection: 'column' }}>
      <textarea 
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Type a note... (press Update Note to sync)"
        style={{ flex: 1, resize: 'none', marginBottom: '16px' }}
      />
      <button className="btn-primary" onClick={handleUpdate}>UPDATE NOTE</button>
    </div>
  );
};

const HistoryScreen = () => {
  return (
    <div className="screen">
      <div style={{ textAlign: 'center', color: 'var(--text-faint)', marginTop: 40, fontFamily: 'var(--font-mono)' }}>
        HISTORY VIEWER
      </div>
    </div>
  );
};

export default function App() {
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState('capture');

  useEffect(() => {
    ws.connect();
    
    const u1 = ws.on('connected', () => setConnected(true));
    const u2 = ws.on('disconnected', () => setConnected(false));
    
    return () => { u1(); u2(); };
  }, []);

  const renderTab = () => {
    switch (tab) {
      case 'capture': return <CaptureScreen />;
      case 'notes': return <NotesScreen />;
      case 'history': return <HistoryScreen />;
      default: return <CaptureScreen />;
    }
  };

  return (
    <div className="app-container">
      <VeritasHeader 
        title="SOVEREIGN BRIDGE" 
        subtitle={tab.toUpperCase()}
        connected={connected}
      />
      
      <div className="watermark-container">
        <div className="veritas-omega-watermark">Ω</div>
      </div>
      
      {renderTab()}
      
      <div className="tab-bar">
        <button className={`tab-btn ${tab === 'capture' ? 'active' : ''}`} onClick={() => setTab('capture')}>
          <div className="tab-icon">📷</div>
          CAPTURE
        </button>
        <button className={`tab-btn ${tab === 'notes' ? 'active' : ''}`} onClick={() => setTab('notes')}>
          <div className="tab-icon">📝</div>
          NOTES
        </button>
        <button className={`tab-btn ${tab === 'history' ? 'active' : ''}`} onClick={() => setTab('history')}>
          <div className="tab-icon">🕒</div>
          HISTORY
        </button>
      </div>
    </div>
  );
}
