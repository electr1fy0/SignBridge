// Web Serial API manager for Chrome / Edge (115200 baud).
// Manages streams, decoding, line buffering, error recovery, and safe port closure.
import { LineBuffer } from './parser.js';

export class SerialManager {
  #port = null;
  #reader = null;
  #writer = null;
  #lineBuffer = new LineBuffer();
  #keepReading = false;
  #onLineCallback = null;
  #onStatusCallback = null;
  #onErrorCallback = null;
  #status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected' | 'disconnecting'
  #portInfo = null;

  constructor({ onLine, onStatusChange, onError } = {}) {
    this.#onLineCallback = onLine || (() => {});
    this.#onStatusCallback = onStatusChange || (() => {});
    this.#onErrorCallback = onError || (() => {});

    // Listen for OS device disconnection
    if (this.isSupported()) {
      navigator.serial.addEventListener('disconnect', (event) => {
        if (event.target === this.#port) {
          this.#setStatus('disconnected', 'ESP32 was physically disconnected from USB');
          this.#cleanup();
        }
      });
    }
  }

  isSupported() {
    return 'serial' in navigator;
  }

  getStatus() {
    return this.#status;
  }

  getPortInfo() {
    return this.#portInfo;
  }

  #setStatus(status, details = '') {
    this.#status = status;
    this.#onStatusCallback(status, details);
  }

  /** Request port and open connection at 115200 baud. */
  async connect() {
    if (!this.isSupported()) {
      const msg = 'Web Serial API is not supported in this browser. Please use desktop Google Chrome or Microsoft Edge.';
      this.#onErrorCallback(new Error(msg));
      throw new Error(msg);
    }

    if (this.#status === 'connected' || this.#status === 'connecting') {
      return;
    }

    this.#setStatus('connecting', 'Waiting for USB port selection...');
    this.#lineBuffer.reset();

    try {
      // Must be triggered by a direct user gesture
      this.#port = await navigator.serial.requestPort();
      this.#portInfo = this.#port.getInfo ? this.#port.getInfo() : null;

      await this.#port.open({ baudRate: 115200 });

      this.#keepReading = true;
      this.#setStatus('connected', 'Connected at 115200 baud');

      // Start asynchronous read loop
      this.#readLoop();
    } catch (err) {
      this.#cleanup();
      this.#setStatus('disconnected', err.name === 'NotFoundError' ? 'Port selection cancelled' : `Connection error: ${err.message}`);
      this.#onErrorCallback(err);
      throw err;
    }
  }

  async #readLoop() {
    while (this.#port && this.#port.readable && this.#keepReading) {
      try {
        const textDecoder = new TextDecoderStream();
        const readableClosed = this.#port.readable.pipeTo(textDecoder.writable);
        this.#reader = textDecoder.readable.getReader();

        while (this.#keepReading) {
          const { value, done } = await this.#reader.read();
          if (done) break;
          if (value) {
            const lines = this.#lineBuffer.push(value);
            for (const line of lines) {
              this.#onLineCallback(line);
            }
          }
        }
      } catch (err) {
        if (this.#keepReading) {
          console.warn('[SerialManager] Read error:', err);
          this.#onErrorCallback(err);
        }
        break;
      } finally {
        if (this.#reader) {
          try {
            await this.#reader.cancel();
          } catch {
            // Ignore cancel errors during teardown
          }
          try {
            this.#reader.releaseLock();
          } catch {
            // Ignore lock release errors
          }
          this.#reader = null;
        }
      }
    }

    if (this.#status === 'connected') {
      this.#setStatus('disconnected', 'Serial connection closed');
    }
    this.#cleanup();
  }

  /** Write a raw string command to the ESP32. */
  async send(data) {
    if (!this.#port || !this.#port.writable || this.#status !== 'connected') {
      throw new Error('Serial port is not connected');
    }

    const encoder = new TextEncoder();
    const bytes = encoder.encode(data);
    const writer = this.#port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  /** Cleanly disconnect, release locks, and close port. */
  async disconnect() {
    if (this.#status === 'disconnected') return;

    this.#setStatus('disconnecting', 'Closing port...');
    this.#keepReading = false;

    if (this.#reader) {
      try {
        await this.#reader.cancel();
      } catch {
        // Ignore
      }
      try {
        this.#reader.releaseLock();
      } catch {
        // Ignore
      }
      this.#reader = null;
    }

    if (this.#port) {
      try {
        await this.#port.close();
      } catch (err) {
        console.warn('[SerialManager] Close error:', err);
      }
    }

    this.#cleanup();
    this.#setStatus('disconnected', 'Disconnected');
  }

  #cleanup() {
    this.#port = null;
    this.#reader = null;
    this.#writer = null;
    this.#portInfo = null;
    this.#lineBuffer.reset();
  }
}
