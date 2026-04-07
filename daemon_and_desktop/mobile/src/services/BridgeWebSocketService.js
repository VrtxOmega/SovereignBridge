/**
 * Sovereign Bridge — WebSocket Service
 * ======================================
 * Permanent connection to Bridge daemon.
 * Adapted from OmegaMobile's battle-tested WebSocketService.
 * 
 * NEVER stops reconnecting (learned from OmegaMobile gotcha).
 * PING/PONG heartbeat (8s/12s).
 * Bypass-Tunnel-Reminder header for localtunnel.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';

const STORAGE_KEY = 'bridge_connection';
const RECONNECT_BASE_DELAY = 2000;
const PING_INTERVAL = 8000;
const PONG_TIMEOUT = 12000;
const MAX_BACKOFF = 30000;

class BridgeWebSocketService {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.connected = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingInterval = null;
    this.pongTimer = null;
    this.connectionData = null;
    this.pendingMessages = [];
    this._destroyed = false;
    this._appStateListener = null;

    this._setupAppStateListener();
  }

  _setupAppStateListener() {
    this._appStateListener = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) {
          console.log('[BRIDGE-WS] App foregrounded — forcing reconnect');
          this.forceReconnect();
        }
      }
    });
  }

  async connect(connectionData) {
    this._destroyed = false;

    if (connectionData) {
      this.connectionData = connectionData;
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(connectionData));
    } else {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) this.connectionData = JSON.parse(stored);
    }

    if (!this.connectionData) {
      console.warn('[BRIDGE-WS] No connection data — defaulting to Sovereign Tunnel');
      this.connectionData = { host: 'sovereign-bridge-vrts.loca.lt', port: '' };
    }

    this._clearTimers();
    this.reconnectAttempts = 0;
    return this._connect();
  }

  async forceReconnect() {
    this._destroyed = false;
    this._clearTimers();
    this.reconnectAttempts = 0;

    if (!this.connectionData) {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) this.connectionData = JSON.parse(stored);
      else this.connectionData = { host: 'sovereign-bridge-vrts.loca.lt', port: '' };
    }

    return this._connect();
  }

  _connect() {
    if (this._destroyed) return false;

    const { host, port, url: providedUrl } = this.connectionData || {};
    if (!host && !providedUrl) {
      console.error('[BRIDGE-WS] No host or url configured');
      this._scheduleReconnect();
      return false;
    }

    const isTunnel = host && (host.includes('loca.lt') || host.includes('lhr.life'));
    const protocol = isTunnel ? 'wss://' : 'ws://';
    const targetPort = port || '5003';
    const portSuffix = !isTunnel ? `:${targetPort}` : '';
    const url = providedUrl || `${protocol}${host}${portSuffix}/ws`;

    try {
      console.log(`[BRIDGE-WS] Connecting to ${url} (attempt ${this.reconnectAttempts + 1})`);

      if (this.ws) {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        try { this.ws.close(); } catch (_) {}
      }

      this.ws = new WebSocket(url, null, {
        headers: { 'Bypass-Tunnel-Reminder': 'true' }
      });

      this.ws.onopen = () => {
        console.log('[BRIDGE-WS] Connected');
        this.connected = true;
        this.reconnectAttempts = 0;
        this._emit('connected', { host, port });
        this._startHeartbeat();

        // Register device
        this.send('REGISTER_DEVICE', {
          device_id: 'android_bridge',
          device_name: 'Android Phone',
        });

        // Request initial sync
        this.send('SYNC_REQUEST', {});

        // Flush pending
        while (this.pendingMessages.length > 0) {
          try {
            this.ws.send(this.pendingMessages.shift());
          } catch (e) {
            console.warn('[BRIDGE-WS] Failed to flush:', e.message);
          }
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);

          if (msg.type === 'PONG') {
            this._resetPongTimer();
            return;
          }

          this._emit(msg.type, msg);
          this._emit('*', msg);
        } catch (e) {
          console.error('[BRIDGE-WS] Parse error:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[BRIDGE-WS] Error:', error.message);
        this._emit('error', error);
      };

      this.ws.onclose = (event) => {
        console.log(`[BRIDGE-WS] Closed: code=${event.code}`);
        this.connected = false;
        this._stopHeartbeat();
        this._emit('disconnected', { code: event.code });

        if (!this._destroyed) {
          this._scheduleReconnect();
        }
      };

      return true;
    } catch (e) {
      console.error('[BRIDGE-WS] Connection exception:', e);
      if (!this._destroyed) this._scheduleReconnect();
      return false;
    }
  }

  // Heartbeat
  _startHeartbeat() {
    this._stopHeartbeat();
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: 'PING' }));
      }
    }, PING_INTERVAL);
    this._resetPongTimer();
  }

  _resetPongTimer() {
    clearTimeout(this.pongTimer);
    this.pongTimer = setTimeout(() => {
      console.warn('[BRIDGE-WS] PONG timeout — force-closing');
      this.connected = false;
      if (this.ws) {
        this.ws.onclose = null;
        try { this.ws.close(); } catch (_) {}
      }
      this._stopHeartbeat();
      this._emit('disconnected', { code: 'PONG_TIMEOUT' });
      this._scheduleReconnect();
    }, PONG_TIMEOUT);
  }

  _stopHeartbeat() {
    clearInterval(this.pingInterval);
    this.pingInterval = null;
    clearTimeout(this.pongTimer);
    this.pongTimer = null;
  }

  // Reconnect — NEVER stops
  _scheduleReconnect() {
    if (this._destroyed) return;
    this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1), MAX_BACKOFF);
    console.log(`[BRIDGE-WS] Reconnecting in ${delay}ms (attempt #${this.reconnectAttempts})`);
    this._clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  _clearTimers() {
    this._clearReconnectTimer();
    this._stopHeartbeat();
  }

  // Public API
  send(type, payload = {}) {
    const msg = JSON.stringify({ type, ...payload });
    if (this.connected && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      if (this.pendingMessages.length < 50) {
        this.pendingMessages.push(msg);
      }
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  _emit(event, data) {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (e) { console.error('[BRIDGE-WS] Listener error:', e); }
    });
  }

  disconnect() {
    this._destroyed = true;
    this._clearTimers();
    if (this.ws) {
      this.ws.onclose = null;
      try { this.ws.close(); } catch (_) {}
    }
    this.connected = false;
    this.pendingMessages = [];
  }

  async getSavedConnection() {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  }

  async clearSavedConnection() {
    await AsyncStorage.removeItem(STORAGE_KEY);
    this.connectionData = null;
  }

  getStatus() {
    return {
      connected: this.connected,
      reconnectAttempts: this.reconnectAttempts,
      host: this.connectionData?.host,
      port: this.connectionData?.port,
      socketState: this.ws?.readyState,
    };
  }
}

export default new BridgeWebSocketService();
