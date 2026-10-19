// SignBridge Main Application Controller.
// Connects Web Serial, Speech Synthesis, Two-Way Comm Relay, and UI Views.

import { parseLine } from './parser.js';
import { translate, repliesFor, replyItem, SIGNS, SKETCH_NAMES } from './signs.js';
import { formatLcd, vibFor, VIBES, makeUid, makeAckId } from './protocol.js';
import { SerialManager } from './serial.js';
import { TextToSpeechManager } from './tts.js';
import { CommChannel } from './comm.js';
import { SCENARIOS, GENERIC } from './phrases.js';

// ============================================================================
// State
// ============================================================================
const state = {
  role: localStorage.getItem('signbridge_role') || null, // 'receiver' | 'glove' | null
  theme: localStorage.getItem('signbridge_theme') || 'light',
  sketchType: null, // 'A' | 'B' | null
  messages: JSON.parse(localStorage.getItem('signbridge_messages') || '[]'),
  lastSign: null,
  liveStreaming: false,
  rawSerialLog: [],
};

// ============================================================================
// Managers Initialization
// ============================================================================
const tts = new TextToSpeechManager({
  onStateChange: (ttsState) => updateTtsUI(ttsState),
});

const serial = new SerialManager({
  onLine: (line) => handleSerialLine(line),
  onStatusChange: (status, details) => updateSerialUI(status, details),
  onError: (err) => handleSerialError(err),
});

const comm = new CommChannel({
  role: state.role || 'receiver',
  onMessage: (msg) => handleIncomingCommMessage(msg),
  onAck: (ack) => handleDeliveryAck(ack),
  onStatus: (syncState) => updateSyncUI(syncState),
});

// ============================================================================
// DOM Element Selectors
// ============================================================================
const el = {
  // Screens
  screenLogin: document.getElementById('screen-login'),
  screenReceiver: document.getElementById('screen-receiver'),
  screenGlove: document.getElementById('screen-glove'),
  modalScenarios: document.getElementById('modal-scenarios'),

  // Header
  headerRoleLabel: document.getElementById('header-role-label'),
  btnSwitchRole: document.getElementById('btn-switch-role'),
  badgeSerialStatus: document.getElementById('badge-serial-status'),
  labelSerialStatus: document.getElementById('label-serial-status'),
  badgeSyncStatus: document.getElementById('badge-sync-status'),
  labelSyncStatus: document.getElementById('label-sync-status'),
  btnMuteToggle: document.getElementById('btn-mute-toggle'),
  iconAudioOn: document.getElementById('icon-audio-on'),
  iconAudioOff: document.getElementById('icon-audio-off'),
  btnThemeToggle: document.getElementById('btn-theme-toggle'),
  audioUnlockBanner: document.getElementById('audio-unlock-banner'),
  btnUnlockAudio: document.getElementById('btn-unlock-audio'),

  // Role Cards
  btnLoginReceiver: document.getElementById('btn-login-receiver'),
  btnLoginGlove: document.getElementById('btn-login-glove'),

  // Receiver View
  recDisplayBox: document.getElementById('rec-display-box'),
  recPhrase: document.getElementById('rec-phrase'),
  recRawEvent: document.getElementById('rec-raw-event'),
  recSketchTag: document.getElementById('rec-sketch-tag'),
  recGestureDesc: document.getElementById('rec-gesture-desc'),
  recTimestamp: document.getElementById('rec-timestamp'),
  btnReplayAudio: document.getElementById('btn-replay-audio'),
  btnOpenScenarios: document.getElementById('btn-open-scenarios'),
  quickRepliesContainer: document.getElementById('quick-replies-container'),
  formCustomReply: document.getElementById('form-custom-reply'),
  inputCustomReply: document.getElementById('input-custom-reply'),
  chatHistoryReceiver: document.getElementById('chat-history-receiver'),
  btnClearChat: document.getElementById('btn-clear-chat'),

  // Diagnostics Panel
  diagnosticsToggle: document.getElementById('diagnostics-toggle'),
  diagnosticsContent: document.getElementById('diagnostics-content'),
  diagnosticsArrow: document.getElementById('diagnostics-arrow'),
  detectedSketchBadge: document.getElementById('detected-sketch-badge'),
  btnSerialConnect: document.getElementById('btn-serial-connect'),
  btnSerialDisconnect: document.getElementById('btn-serial-disconnect'),
  btnToggleLiveReadings: document.getElementById('btn-toggle-live-readings'),
  liveReadingStatusLabel: document.getElementById('live-reading-status-label'),
  sensorFlex: [0, 1, 2, 3, 4].map((i) => document.getElementById(`sensor-flex-${i}`)),
  sensorDelta: [0, 1, 2, 3, 4].map((i) => document.getElementById(`sensor-delta-${i}`)),
  diagBentPattern: document.getElementById('diag-bent-pattern'),
  diagMpuStatus: document.getElementById('diag-mpu-status'),
  diagLcdStatus: document.getElementById('diag-lcd-status'),
  diagAccel: document.getElementById('diag-accel'),
  diagGyro: document.getElementById('diag-gyro'),
  serialRawConsole: document.getElementById('serial-raw-console'),

  // Glove View
  gloveGiantMsg: document.getElementById('glove-giant-msg'),
  gloveMsgSender: document.getElementById('glove-msg-sender'),
  gloveMsgTimestamp: document.getElementById('glove-msg-timestamp'),
  gloveMsgDeliveryBadge: document.getElementById('glove-msg-delivery-badge'),
  lcdLine1: document.getElementById('lcd-line-1'),
  lcdLine2: document.getElementById('lcd-line-2'),
  lcdTruncationNote: document.getElementById('lcd-truncation-note'),
  vibeIndicatorRing: document.getElementById('vibe-indicator-ring'),
  vibeLabel: document.getElementById('vibe-label'),
  vibeMeaning: document.getElementById('vibe-meaning'),
  chatHistoryGlove: document.getElementById('chat-history-glove'),

  // Scenarios Modal
  btnCloseScenarios: document.getElementById('btn-close-scenarios'),
  inputSearchPhrases: document.getElementById('input-search-phrases'),
  scenariosContainerList: document.getElementById('scenarios-container-list'),

  // Demo Controls
  btnDemoRepeat: document.getElementById('btn-demo-repeat'),
  btnDemoNoise: document.getElementById('btn-demo-noise'),
};

// ============================================================================
// Core Feature: Sign Language to English Text & Audio Pipeline
// ============================================================================
function processRecognitionEvent(rawSign) {
  const translation = translate(rawSign);
  state.lastSign = {
    ...translation,
    raw: `>>> RECOGNIZED: ${rawSign} <<<`,
    timestamp: Date.now(),
  };

  // 1. Immediately update large prominent display
  el.recPhrase.textContent = translation.text;
  el.recPhrase.style.color = 'var(--color-text)';
  el.recRawEvent.textContent = rawSign;
  el.recTimestamp.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Update sketch and gesture notes if known
  const signInfo = SIGNS[translation.key];
  if (signInfo) {
    el.recSketchTag.textContent = signInfo.sketch === 'A' ? 'Sketch A · Finger sign' : 'Sketch B · Motion sign';
    el.recGestureDesc.textContent = signInfo.how ? `(${signInfo.how})` : '';
  } else {
    el.recSketchTag.textContent = 'Custom Gesture';
    el.recGestureDesc.textContent = '';
  }

  // 2. Speak translated phrase aloud immediately
  const spoke = tts.speak(translation.text);
  if (!spoke && !tts.isMuted() && !tts.isUnlocked()) {
    el.audioUnlockBanner.style.display = 'flex';
  }

  // 3. Generate context-aware reply buttons
  renderContextualReplies(translation.key);

  // 4. Create conversation message from Glove User
  const msg = {
    id: makeUid(),
    text: translation.text,
    fromRole: 'glove',
    toRole: 'receiver',
    timestamp: Date.now(),
    status: 'delivered_browser',
  };
  addMessage(msg);

  // 5. Broadcast to any open Glove User tab / device
  comm.sendMessage(msg);
}

// ============================================================================
// Serial Stream & Event Parser Integration
// ============================================================================
function handleSerialLine(line) {
  appendRawLog(line);

  const event = parseLine(line);
  if (!event) return;

  handleParsedEvent(event);
}

function handleParsedEvent(event) {
  switch (event.type) {
    case 'recognition':
      // OFFICIAL RECOGNITION EVENT: triggers translation and speech!
      processRecognitionEvent(event.sign);
      break;

    case 'live':
      // In-place update of sensor diagnostics (does NOT enter conversation!)
      updateDiagnosticField(event.key, event.value);
      break;

    case 'status':
      if (event.mpu) el.diagMpuStatus.textContent = event.mpu;
      if (event.lcd) el.diagLcdStatus.textContent = event.lcd;
      break;

    case 'sketch':
      state.sketchType = event.sketch;
      el.detectedSketchBadge.textContent = SKETCH_NAMES[event.sketch] || `Sketch ${event.sketch}`;
      el.detectedSketchBadge.style.color = 'var(--color-accent)';
      break;

    case 'live-toggle':
      state.liveStreaming = event.on;
      el.liveReadingStatusLabel.textContent = `Stream: ${event.on ? 'ON' : 'OFF'}`;
      el.liveReadingStatusLabel.style.color = event.on ? 'var(--color-accent)' : 'var(--color-text-subtle)';
      break;

    case 'ack':
      // Proposed hardware ACK received from ESP32 serial
      handleHardwareAck(event.id);
      break;

    case 'log':
    default:
      // Ignored diagnostic/startup line
      break;
  }
}

function updateDiagnosticField(key, value) {
  if (key === 'flex' && Array.isArray(value)) {
    value.forEach((v, i) => {
      if (el.sensorFlex[i]) el.sensorFlex[i].textContent = v;
    });
  } else if (key === 'delta' && Array.isArray(value)) {
    value.forEach((v, i) => {
      if (el.sensorDelta[i]) el.sensorDelta[i].textContent = `Δ: ${v}`;
    });
  } else if (key === 'pattern') {
    el.diagBentPattern.textContent = value;
  } else if (key === 'acc' && Array.isArray(value)) {
    el.diagAccel.textContent = `X=${value[0]} Y=${value[1]} Z=${value[2]}`;
  } else if (key === 'gyro' && Array.isArray(value)) {
    el.diagGyro.textContent = `X=${value[0]} Y=${value[1]} Z=${value[2]}`;
  }
}

function appendRawLog(line) {
  state.rawSerialLog.push(line);
  if (state.rawSerialLog.length > 80) state.rawSerialLog.shift();
  if (el.serialRawConsole) {
    el.serialRawConsole.textContent = state.rawSerialLog.join('\n');
    el.serialRawConsole.scrollTop = el.serialRawConsole.scrollHeight;
  }
}

// ============================================================================
// Two-Way Reply Flow: Receiver -> Glove User
// ============================================================================
function sendReplyToGlove(text, overrideLines) {
  if (!text || typeof text !== 'string') return;

  const lcdData = formatLcd(text, overrideLines);
  const vibCode = vibFor(text);
  const ackId = makeAckId();

  const msg = {
    id: makeUid(),
    text: text.trim(),
    fromRole: 'receiver',
    toRole: 'glove',
    timestamp: Date.now(),
    status: 'pending', // Starts as pending, becomes delivered_browser once acknowledged
    lcdLines: lcdData.lines,
    lcdTruncated: lcdData.truncated,
    vib: vibCode,
    hardwareAckId: ackId,
  };

  addMessage(msg);

  // Deliver across communication transport to Glove User interface
  comm.sendMessage(msg);

  // Clear input
  if (el.inputCustomReply) el.inputCustomReply.value = '';
}

function addMessage(msg) {
  state.messages.push(msg);
  if (state.messages.length > 100) state.messages.shift();
  localStorage.setItem('signbridge_messages', JSON.stringify(state.messages));
  renderConversation();

  // If glove screen is active, also render glove incoming announcement
  if (msg.toRole === 'glove') {
    updateGloveDisplay(msg);
  }
}

function handleIncomingCommMessage(msg) {
  // Prevent duplicate if already in local array
  if (!state.messages.some((m) => m.id === msg.id)) {
    state.messages.push(msg);
    localStorage.setItem('signbridge_messages', JSON.stringify(state.messages));
    renderConversation();

    if (msg.toRole === 'glove') {
      updateGloveDisplay(msg);
    }
  }
}

function handleDeliveryAck({ messageId, level }) {
  const target = state.messages.find((m) => m.id === messageId);
  if (target) {
    target.status = level;
    localStorage.setItem('signbridge_messages', JSON.stringify(state.messages));
    renderConversation();
  }
}

function handleHardwareAck(hardwareId) {
  const target = state.messages.find((m) => m.hardwareAckId === hardwareId);
  if (target) {
    target.status = 'acked_hardware';
    localStorage.setItem('signbridge_messages', JSON.stringify(state.messages));
    renderConversation();
    comm.notifyHardwareAck(target.id, hardwareId);
  }
}

// ============================================================================
// Glove User Dashboard Displays & LCD / Vibration Simulation
// ============================================================================
function updateGloveDisplay(msg) {
  if (!el.gloveGiantMsg) return;

  el.gloveGiantMsg.textContent = msg.text;
  el.gloveMsgSender.textContent = msg.fromRole === 'receiver' ? 'Sender: Communication Partner' : 'Sender: Glove User';
  el.gloveMsgTimestamp.textContent = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Update 16x2 LCD Simulation
  const lines = msg.lcdLines || formatLcd(msg.text).lines;
  el.lcdLine1.textContent = (lines[0] || '').padEnd(16, ' ');
  el.lcdLine2.textContent = (lines[1] || '').padEnd(16, ' ');
  el.lcdTruncationNote.style.display = msg.lcdTruncated ? 'block' : 'none';

  // Trigger Vibration Motor Simulation
  const vibInfo = VIBES[msg.vib || 'MSG'];
  if (vibInfo) {
    el.vibeLabel.textContent = `${vibInfo.label} (${msg.vib})`;
    el.vibeMeaning.textContent = vibInfo.meaning;

    // Trigger pulse visual animation
    el.vibeIndicatorRing.classList.remove('vibe-active');
    void el.vibeIndicatorRing.offsetWidth; // Trigger DOM reflow
    el.vibeIndicatorRing.classList.add('vibe-active');

    // Remove animation after pulse sequence duration
    const totalDuration = vibInfo.pattern.reduce((a, b) => a + b, 0) + 400;
    setTimeout(() => {
      el.vibeIndicatorRing.classList.remove('vibe-active');
    }, Math.min(totalDuration, 3500));
  }
}

// ============================================================================
// Contextual Replies Rendering
// ============================================================================
function renderContextualReplies(signKey) {
  const replies = repliesFor(signKey);
  el.quickRepliesContainer.innerHTML = '';

  replies.forEach((r) => {
    const item = replyItem(r);
    const btn = document.createElement('button');
    btn.className = 'reply-btn';
    btn.type = 'button';
    btn.innerHTML = `
      <span>${escapeHtml(item.text)}</span>
      <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    `;
    btn.onclick = () => sendReplyToGlove(item.text, item.lcd);
    el.quickRepliesContainer.appendChild(btn);
  });
}

// ============================================================================
// Conversation Thread Rendering
// ============================================================================
function renderConversation() {
  const renderList = (container) => {
    if (!container) return;
    container.innerHTML = '';

    if (state.messages.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; color: var(--color-text-subtle); padding: 48px 16px; display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: var(--color-surface-subtle); display: flex; align-items: center; justify-content: center; color: var(--color-text-subtle);">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
          </div>
          <div style="font-weight: 700; color: var(--color-text);">No messages in this session yet</div>
          <div style="font-size: 0.8125rem; max-width: 240px; color: var(--color-text-muted);">Signs from the ESP32 and your replies will appear here in order.</div>
        </div>
      `;
      return;
    }

    state.messages.forEach((msg) => {
      const bubble = document.createElement('div');
      bubble.className = `chat-bubble ${msg.fromRole === 'glove' ? 'from-glove' : 'from-receiver'}`;

      let statusHtml = '';
      if (msg.fromRole === 'receiver') {
        if (msg.status === 'acked_hardware') {
          statusHtml = `
            <span class="delivery-status-indicator" style="color: #6EE7B7;">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5"/><path d="M16 6l-7 7-2-2"/></svg>
              <span>Hardware ACK</span>
            </span>`;
        } else if (msg.status === 'delivered_browser') {
          statusHtml = `
            <span class="delivery-status-indicator" style="color: #E0F2FE;">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5"/></svg>
              <span>Delivered</span>
            </span>`;
        } else {
          statusHtml = `
            <span class="delivery-status-indicator" style="opacity: 0.75;">
              <svg class="icon-sm" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Pending</span>
            </span>`;
        }
      }

      const senderName = msg.fromRole === 'glove' ? 'Glove Wearer' : 'Partner';
      const timeStr = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      bubble.innerHTML = `
        <p><strong>${senderName}:</strong> ${escapeHtml(msg.text)}</p>
        <div class="bubble-meta">
          <span>${timeStr}</span>
          ${statusHtml}
        </div>
      `;
      container.appendChild(bubble);
    });

    container.scrollTop = container.scrollHeight;
  };

  renderList(el.chatHistoryReceiver);
  renderList(el.chatHistoryGlove);
}

// ============================================================================
// UI Updates & System Handlers
// ============================================================================
function updateSerialUI(status, details) {
  el.labelSerialStatus.textContent = `ESP32: ${status.charAt(0).toUpperCase() + status.slice(1)}`;

  if (status === 'connected') {
    el.badgeSerialStatus.className = 'badge-status badge-connected';
    el.btnSerialConnect.style.display = 'none';
    el.btnSerialDisconnect.style.display = 'inline-flex';
  } else if (status === 'connecting') {
    el.badgeSerialStatus.className = 'badge-status badge-warning';
  } else {
    el.badgeSerialStatus.className = 'badge-status badge-disconnected';
    el.btnSerialConnect.style.display = 'inline-flex';
    el.btnSerialDisconnect.style.display = 'none';
  }

  if (details) appendRawLog(`[Serial Status] ${details}`);
}

function handleSerialError(err) {
  appendRawLog(`[Serial Error] ${err.message}`);
}

function updateSyncUI(syncState) {
  if (syncState.serverConnected) {
    el.labelSyncStatus.textContent = 'Sync: Wi-Fi Online';
    el.badgeSyncStatus.className = 'badge-status badge-connected';
  } else {
    el.labelSyncStatus.textContent = 'Sync: Local Tab';
    el.badgeSyncStatus.className = 'badge-status badge-disconnected';
  }
}

function updateTtsUI(ttsState) {
  if (ttsState.muted) {
    el.iconAudioOn.style.display = 'none';
    el.iconAudioOff.style.display = 'block';
  } else {
    el.iconAudioOn.style.display = 'block';
    el.iconAudioOff.style.display = 'none';
  }

  if (ttsState.unlocked) {
    el.audioUnlockBanner.style.display = 'none';
  }
}

// Role switching and view routing
function setRole(newRole) {
  state.role = newRole;
  comm.setRole(newRole);

  if (newRole) {
    localStorage.setItem('signbridge_role', newRole);
    el.headerRoleLabel.textContent = newRole === 'receiver' ? 'Role: Partner' : 'Role: Glove User';
    el.screenLogin.style.display = 'none';

    if (newRole === 'receiver') {
      el.screenReceiver.style.display = 'grid';
      el.screenGlove.style.display = 'none';
    } else {
      el.screenReceiver.style.display = 'none';
      el.screenGlove.style.display = 'flex';
      // If there's an existing message, display it
      const lastPartnerMsg = [...state.messages].reverse().find((m) => m.toRole === 'glove');
      if (lastPartnerMsg) updateGloveDisplay(lastPartnerMsg);
    }
  } else {
    localStorage.removeItem('signbridge_role');
    el.screenLogin.style.display = 'block';
    el.screenReceiver.style.display = 'none';
    el.screenGlove.style.display = 'none';
  }
}

// Scenarios library renderer
function renderScenariosLibrary(filterText = '') {
  el.scenariosContainerList.innerHTML = '';
  const search = filterText.trim().toLowerCase();

  SCENARIOS.forEach((scenario) => {
    const matchingPhrases = scenario.phrases.filter(
      (p) => !search || p.text.toLowerCase().includes(search) || scenario.name.toLowerCase().includes(search)
    );

    if (matchingPhrases.length === 0) return;

    const card = document.createElement('div');
    card.className = 'scenario-card';
    card.style.marginBottom = '20px';

    let phrasesHtml = '';
    matchingPhrases.forEach((p) => {
      const isFirmwareRecognized = Boolean(p.sign);
      const badge = isFirmwareRecognized
        ? `<span class="sign-chip" style="color: var(--color-accent); font-size: 0.75rem;">Glove Firmware Gesture</span>`
        : `<span class="sign-chip" style="font-size: 0.75rem;">UI Selectable Phrase</span>`;

      phrasesHtml += `
        <li class="phrase-pill" style="cursor: pointer;" data-text="${escapeHtml(p.text)}">
          <span>${escapeHtml(p.text)}</span>
          ${badge}
        </li>
      `;
    });

    card.innerHTML = `
      <span class="scenario-badge">${escapeHtml(scenario.name)}</span>
      <ul class="phrase-list-mini">
        ${phrasesHtml}
      </ul>
    `;
    el.scenariosContainerList.appendChild(card);
  });

  // Attach click listener to phrases in modal
  el.scenariosContainerList.querySelectorAll('.phrase-pill').forEach((pill) => {
    pill.onclick = () => {
      const text = pill.getAttribute('data-text');
      el.modalScenarios.style.display = 'none';
      sendReplyToGlove(text);
    };
  });
}

// Escape helper for safe innerHTML
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
}

// ============================================================================
// Event Listeners Setup
// ============================================================================
function setupEventListeners() {
  // Navigation / Login
  el.btnLoginReceiver.onclick = () => setRole('receiver');
  el.btnLoginGlove.onclick = () => setRole('glove');
  el.btnSwitchRole.onclick = () => setRole(null);

  // Audio / Speech
  el.btnMuteToggle.onclick = () => tts.toggleMute();
  el.btnUnlockAudio.onclick = () => tts.unlock();
  el.btnReplayAudio.onclick = () => tts.replay();
  document.addEventListener('click', () => tts.unlock(), { once: true });

  // Theme Toggle
  el.btnThemeToggle.onclick = () => {
    const nextTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', nextTheme);
    localStorage.setItem('signbridge_theme', nextTheme);
  };

  // Serial Connect / Disconnect
  el.btnSerialConnect.onclick = () => serial.connect();
  el.btnSerialDisconnect.onclick = () => serial.disconnect();

  // Diagnostics panel toggle
  el.diagnosticsToggle.onclick = () => {
    const isHidden = el.diagnosticsContent.style.display === 'none';
    el.diagnosticsContent.style.display = isHidden ? 'flex' : 'none';
    if (el.diagnosticsArrow) {
      el.diagnosticsArrow.classList.toggle('expanded', isHidden);
    }
    el.diagnosticsToggle.setAttribute('aria-expanded', String(isHidden));
  };

  // Demo bar collapsible toggle
  const demoBarToggle = document.getElementById('demo-bar-toggle');
  const demoBarBody = document.getElementById('demo-bar-body');
  const demoToggleLabel = document.getElementById('demo-toggle-label');
  const demoToggleIcon = document.getElementById('demo-toggle-icon');

  if (demoBarToggle && demoBarBody) {
    demoBarToggle.onclick = () => {
      const isCurrentlyCollapsed = demoBarBody.style.display === 'none';
      demoBarBody.style.display = isCurrentlyCollapsed ? 'flex' : 'none';
      if (demoToggleLabel) demoToggleLabel.textContent = isCurrentlyCollapsed ? 'Minimize' : 'Expand';
      if (demoToggleIcon) demoToggleIcon.classList.toggle('expanded', isCurrentlyCollapsed);
      demoBarToggle.setAttribute('aria-expanded', String(isCurrentlyCollapsed));
    };
  }

  // Live readings toggle command ('p')
  el.btnToggleLiveReadings.onclick = async () => {
    try {
      await serial.send('p');
      appendRawLog("[Command Sent] 'p' (Toggle live readings)");
    } catch (err) {
      appendRawLog(`[Send Failed] ${err.message}`);
    }
  };

  // Custom Reply Form
  el.formCustomReply.onsubmit = (e) => {
    e.preventDefault();
    const val = el.inputCustomReply.value.trim();
    if (val) sendReplyToGlove(val);
  };

  // Clear conversation button
  el.btnClearChat.onclick = () => {
    if (confirm('Clear the conversation history?')) {
      state.messages = [];
      localStorage.removeItem('signbridge_messages');
      renderConversation();
    }
  };

  // Glove Send Buttons (Screen 3)
  document.querySelectorAll('.btn-glove-send').forEach((btn) => {
    btn.onclick = () => {
      const text = btn.getAttribute('data-text');
      const msg = {
        id: makeUid(),
        text,
        fromRole: 'glove',
        toRole: 'receiver',
        timestamp: Date.now(),
        status: 'delivered_browser',
      };
      addMessage(msg);
      comm.sendMessage(msg);
    };
  });

  // Scenarios Modal
  el.btnOpenScenarios.onclick = () => {
    el.modalScenarios.style.display = 'flex';
    renderScenariosLibrary();
  };
  el.btnCloseScenarios.onclick = () => {
    el.modalScenarios.style.display = 'none';
  };
  el.inputSearchPhrases.oninput = (e) => {
    renderScenariosLibrary(e.target.value);
  };

  // ==========================================================================
  // Demo Simulation Buttons
  // Feeds simulated lines into the EXACT SAME handleSerialLine() pipeline!
  // ==========================================================================
  document.querySelectorAll('.btn-sim-sign').forEach((btn) => {
    btn.onclick = () => {
      const sign = btn.getAttribute('data-sign');
      handleSerialLine(`>>> RECOGNIZED: ${sign} <<<\n`);
    };
  });

  // Repeated Sign Test
  el.btnDemoRepeat.onclick = () => {
    handleSerialLine(`>>> RECOGNIZED: OKAY <<<\n`);
    setTimeout(() => {
      handleSerialLine(`>>> RECOGNIZED: OKAY <<<\n`);
    }, 1200);
  };

  // Noise Test (RECOGNIZED: OKAY without >>> <<< delimiters should be IGNORED)
  el.btnDemoNoise.onclick = () => {
    handleSerialLine(`RECOGNIZED: OKAY\n`);
    handleSerialLine(`RECOGNIZED: NONE\n`);
    appendRawLog("[Demo Test] Sent undelimited diagnostic readings. Notice: NO speech or translation triggered!");
  };
}

// ============================================================================
// Initialization
// ============================================================================
function init() {
  // Apply saved theme
  document.documentElement.setAttribute('data-theme', state.theme);

  // Setup UI views
  setupEventListeners();
  renderContextualReplies('OKAY');
  renderConversation();

  // Route to saved role or login
  setRole(state.role);
}

// Start application
init();
