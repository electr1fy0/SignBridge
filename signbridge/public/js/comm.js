// Two-way communication sync layer.
// Combines BroadcastChannel (for instant same-browser multi-tab sync) with
// Server-Sent Events + HTTP POST (for real cross-device sync over Wi-Fi / LAN).
// Accurately tracks delivery states: pending -> delivered_browser -> acked_hardware.

export class CommChannel {
  #role = 'receiver'; // 'receiver' | 'glove'
  #broadcastChannel = null;
  #eventSource = null;
  #onMessageCallback = null;
  #onAckCallback = null;
  #onStatusCallback = null;
  #connectedToServer = false;

  constructor({ role, onMessage, onAck, onStatus } = {}) {
    this.#role = role || 'receiver';
    this.#onMessageCallback = onMessage || (() => {});
    this.#onAckCallback = onAck || (() => {});
    this.#onStatusCallback = onStatus || (() => {});

    this.#initBroadcastChannel();
    this.#initServerSync();
  }

  setRole(newRole) {
    this.#role = newRole;
  }

  getRole() {
    return this.#role;
  }

  isServerConnected() {
    return this.#connectedToServer;
  }

  #initBroadcastChannel() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.#broadcastChannel = new BroadcastChannel('signbridge_comm_v1');
        this.#broadcastChannel.onmessage = (event) => {
          this.#handleIncoming(event.data, 'broadcast');
        };
      } catch (err) {
        console.warn('[CommChannel] BroadcastChannel init error:', err);
      }
    }
  }

  #initServerSync() {
    // Only attempt SSE if served from an HTTP server (not file://)
    if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
      this.#notifyStatus('offline_standalone', 'Operating in standalone browser mode (BroadcastChannel active)');
      return;
    }

    try {
      this.#eventSource = new EventSource('/api/events');

      this.#eventSource.onopen = () => {
        this.#connectedToServer = true;
        this.#notifyStatus('online', 'Connected to sync relay (cross-device active)');
      };

      this.#eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          // Ignore own messages reflected from server
          if (data && data.senderClientId !== this.#getClientId()) {
            this.#handleIncoming(data, 'server');
          }
        } catch (err) {
          console.warn('[CommChannel] SSE parse error:', err);
        }
      };

      this.#eventSource.onerror = () => {
        this.#connectedToServer = false;
        this.#notifyStatus('local_only', 'Server relay unavailable; using browser BroadcastChannel');
      };
    } catch (err) {
      this.#notifyStatus('local_only', 'Using browser BroadcastChannel');
    }
  }

  #clientId = null;
  #getClientId() {
    if (!this.#clientId) {
      this.#clientId = 'client_' + Math.random().toString(36).slice(2, 9);
    }
    return this.#clientId;
  }

  #notifyStatus(state, message) {
    this.#onStatusCallback({
      state,
      message,
      serverConnected: this.#connectedToServer,
      broadcastActive: Boolean(this.#broadcastChannel),
    });
  }

  #handleIncoming(packet, source) {
    if (!packet || typeof packet !== 'object') return;

    // Handle browser-delivery ACK
    if (packet.type === 'ack_browser') {
      this.#onAckCallback({
        messageId: packet.messageId,
        level: 'delivered_browser',
        byRole: packet.byRole,
        timestamp: packet.timestamp,
      });
      return;
    }

    // Handle hardware-level ACK
    if (packet.type === 'ack_hardware') {
      this.#onAckCallback({
        messageId: packet.messageId,
        level: 'acked_hardware',
        hardwareId: packet.hardwareId,
        timestamp: packet.timestamp,
      });
      return;
    }

    // Normal message reception
    if (packet.type === 'chat_message') {
      // If we are the target recipient (e.g. Glove User received a message from Receiver),
      // immediately return a browser-delivery acknowledgment back to sender!
      if (packet.toRole === this.#role || !packet.toRole) {
        this.#sendBrowserAck(packet.id);
      }
      this.#onMessageCallback(packet);
    }
  }

  #sendBrowserAck(messageId) {
    const ack = {
      type: 'ack_browser',
      messageId,
      byRole: this.#role,
      senderClientId: this.#getClientId(),
      timestamp: Date.now(),
    };
    this.#sendRaw(ack);
  }

  /**
   * Broadcast an acknowledgment that hardware serial confirmed the message.
   */
  notifyHardwareAck(messageId, hardwareId) {
    const ack = {
      type: 'ack_hardware',
      messageId,
      hardwareId,
      senderClientId: this.#getClientId(),
      timestamp: Date.now(),
    };
    this.#sendRaw(ack);
  }

  /**
   * Send a chat message across all active channels.
   * @param {Object} message { id, text, fromRole, toRole, lcdLines, vib, timestamp, hardwareAckId }
   */
  async sendMessage(message) {
    const packet = {
      type: 'chat_message',
      ...message,
      senderClientId: this.#getClientId(),
    };
    return this.#sendRaw(packet);
  }

  async #sendRaw(data) {
    // 1. Broadcast locally for instant multi-tab sync
    if (this.#broadcastChannel) {
      try {
        this.#broadcastChannel.postMessage(data);
      } catch (e) {
        console.warn('[CommChannel] Broadcast post failed:', e);
      }
    }

    // 2. Relay via HTTP server for cross-device sync if connected
    if (this.#connectedToServer && typeof fetch !== 'undefined') {
      try {
        await fetch('/api/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
      } catch (err) {
        console.warn('[CommChannel] Server relay POST failed:', err);
      }
    }
  }

  destroy() {
    if (this.#broadcastChannel) {
      this.#broadcastChannel.close();
      this.#broadcastChannel = null;
    }
    if (this.#eventSource) {
      this.#eventSource.close();
      this.#eventSource = null;
    }
  }
}
