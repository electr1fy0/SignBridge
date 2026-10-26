import { SIGNS, translate, repliesFor, replyItem } from './signs.js';
import { GENERIC, SCENARIOS } from './phrases.js';
import { formatLcd, vibFor, makeUid } from './protocol.js';
import { TextToSpeechManager } from './tts.js';
import { validateState, consumeEvents, replyDelivery } from './device.js';

const $ = (id) => document.getElementById(id);
const voice = new TextToSpeechManager({ onError: (message) => feedback(message, true) });
let state = null, online = false, cursor = { boot: null, seq: 0 };
let socket = null, retryTimer = null, lastPacket = 0, retryDelay = 800, generation = 0;
let lastTranslation = '', lastKey = '', settingsDirty = false, displayedNotice = '';
const pending = new Map();
const rows = new Map();
const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const pins = [33, 35, 36, 34, 32];
const flexSigns = Object.entries(SIGNS).filter(([, sign]) => sign.sketch === 'A');
const motionSigns = Object.entries(SIGNS).filter(([, sign]) => sign.sketch === 'B');

function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').dataset.error = String(error);
}
function availability() {
  const busy = state?.job !== 0;
  $('send').disabled = !online;
  $('calibrate').disabled = !online || busy;
  $('cancel').disabled = !online || !busy;
  for (const id of ['live', 'debug']) $(id).disabled = !online;
  for (const id of ['save-settings', 'erase']) $(id).disabled = !online || busy;
  for (const button of document.querySelectorAll('[data-train]')) {
    button.disabled = !online || busy || (button.dataset.train === 'trainMotion' ? !state?.mpu || !state?.imuCalibrated : !state?.useFlex || !state?.calibrated);
  }
  for (const button of $('quick-replies').querySelectorAll('button')) button.disabled = !online;
}
function connection(connected, label) {
  online = connected;
  if ($('connection').textContent !== label) $('connection').textContent = label;
  $('connection').dataset.online = String(connected);
  $('connection-help').hidden = connected;
  availability();
}
async function command(op, fields = {}) {
  if (!online) throw new Error('Glove disconnected. Reconnect before sending.');
  const response = await fetch('/api/command', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, ...fields }), signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 160) || 'Device could not accept the command.');
  return response.json();
}
function run(op, fields) {
  return command(op, fields).catch((error) => feedback(error.message, true));
}
function renderQuickReplies(key) {
  $('quick-replies').replaceChildren();
  for (const entry of repliesFor(key)) {
    const reply = replyItem(entry);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = reply.text;
    button.disabled = !online; button.onclick = () => sendReply(reply.text, reply.lcd);
    $('quick-replies').append(button);
  }
}
function showTranslation(event) {
  const translation = translate(event.text);
  lastTranslation = translation.text; lastKey = translation.key;
  $('translation').textContent = translation.text;
  $('sign-detail').textContent = event.source === 'flex' ? 'Recognized from finger position' : 'Recognized from hand movement';
  $('replay').disabled = !voice.isSupported();
  renderQuickReplies(lastKey);
}
function addHistory(key, text, type, detail) {
  let item = rows.get(key);
  if (!item) {
    item = document.createElement('li'); item.dataset.type = type;
    const who = document.createElement('p'); who.className = 'who'; who.textContent = type === 'sign' ? 'Glove' : 'Reply';
    const message = document.createElement('p'); message.className = 'message'; message.textContent = text;
    const delivery = document.createElement('p'); delivery.className = 'delivery';
    item.append(who, message, delivery); $('history').prepend(item); rows.set(key, item);
    while (rows.size > 60) {
      const oldest = $('history').lastElementChild;
      for (const [id, row] of rows) if (row === oldest) { rows.delete(id); break; }
      oldest.remove();
    }
  }
  item.querySelector('.delivery').textContent = detail;
  $('history-empty').hidden = rows.size > 0;
  return item;
}
async function sendReply(text, override) {
  text = text.trim();
  if (!text || new TextEncoder().encode(text).length > 160) return feedback('This message is too long for the glove. Shorten it and try again.', true);
  const id = makeUid(), lcd = formatLcd(text, override);
  pending.set(id, { text, at: Date.now() });
  addHistory(id, text, 'reply', 'Sending…');
  try {
    await command('reply', { id, text, line1: lcd.lines[0], line2: lcd.lines[1], vib: vibFor(text) });
    if (pending.has(id)) {
      addHistory(id, text, 'reply', 'Accepted; waiting for the glove');
      feedback('Reply accepted. Waiting for the glove’s LCD result.');
    }
    $('reply-text').value = ''; preview();
  } catch (error) {
    // A lost HTTP response does not prove the queued command failed. A later
    // device acknowledgement can still replace this status.
    addHistory(id, text, 'reply', 'Delivery unconfirmed'); feedback(error.message, true);
  }
}
function receive(input) {
  const incoming = validateState(input);
  const restart = cursor.boot !== null && cursor.boot !== incoming.boot;
  if (restart) {
    for (const [id, reply] of pending) addHistory(id, reply.text, 'reply', 'Glove restarted; delivery unconfirmed');
    pending.clear();
  }
  if (!online) feedback('');
  state = incoming; lastPacket = Date.now(); retryDelay = 800;
  connection(true, state.job ? 'Glove connected · task in progress' : 'Glove connected');
  const accepted = consumeEvents(cursor, state); cursor = accepted.cursor;
  for (const event of accepted.events) {
    if (event.type === 'sign') {
      showTranslation(event);
      addHistory(`${state.boot}:${event.seq}`, translate(event.text).text, 'sign', event.source === 'flex' ? 'Finger sign' : 'Motion sign');
    } else {
      const key = pending.has(event.requestId) || rows.has(event.requestId) ? event.requestId : `${state.boot}:${event.seq}`;
      addHistory(key, event.text, 'reply', replyDelivery(event));
      if (pending.has(event.requestId)) { pending.delete(event.requestId); feedback(replyDelivery(event), !event.lcd); }
    }
  }
  if (accepted.audible.length && voice.isUnlocked() && !voice.isMuted()) voice.speak(translate(accepted.audible.at(-1).text).text);
  const notice = `${state.notice}${state.remaining > 0 ? ` (${state.remaining})` : ''}`;
  if (displayedNotice !== notice) { $('device-notice').textContent = notice; displayedNotice = notice; }
  $('sensor-summary').textContent = `MPU ${state.mpu ? 'connected' : 'unavailable'} · LCD ${state.lcd ? 'connected' : 'unavailable'}`;
  $('pattern').textContent = `${state.pattern}${state.ignoreMiddle ? ' · middle ignored' : ''}`;
  fingerNames.forEach((_, index) => {
    const row = $('sensor-rows').children[index];
    row.children[2].textContent = state.flex[index]; row.children[3].textContent = Math.round(state.baseline[index]); row.children[4].textContent = state.delta[index];
  });
  const axes = (values) => values.map((v, i) => `${'XYZ'[i]} ${Number(v).toFixed(2)}`).join('   ');
  $('imu-values').textContent = state.mpu ? `Acceleration (m/s²): ${axes(state.acc)}\nGyroscope (°/s): ${axes(state.gyro)}` : 'MPU unavailable. Check SDA 21, SCL 22 and sensor power.';
  for (const [id, enabled, label] of [['live', state.live, 'Serial values'], ['debug', state.debug, 'Match scores']]) {
    $(id).textContent = `${label}: ${enabled ? 'on' : 'off'}`; $(id).setAttribute('aria-pressed', String(enabled));
  }
  state.flexTraining.forEach((saved, i) => $('flex-training').children[i].querySelector('.count').textContent = saved ? 'Saved' : 'Not trained');
  state.motionTraining.forEach((count, i) => $('motion-training').children[i].querySelector('.count').textContent = `${count}/3 examples`);
  $('score-panel').hidden = !state.debug;
  $('scores').replaceChildren();
  if (state.debug) motionSigns.forEach(([key], i) => {
    const score = document.createElement('span'); score.textContent = `${translate(key).text}: ${state.scores?.[i] >= 0 ? Number(state.scores[i]).toFixed(3) : '—'}`; $('scores').append(score);
  });
  if (!settingsDirty) { $('use-flex').checked = state.useFlex; $('ignore-middle').checked = state.ignoreMiddle; $('use-motor').checked = state.useMotor; }
  availability();
}
function reconnect() {
  const token = ++generation;
  clearTimeout(retryTimer);
  if (socket) { socket.onclose = null; socket.close(); }
  connection(false, 'Connecting to glove…');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); socket = ws;
  ws.onmessage = (message) => {
    if (token !== generation) return;
    try { receive(JSON.parse(message.data)); } catch (error) { feedback(error.message, true); }
  };
  ws.onerror = () => ws.close();
  ws.onclose = () => {
    if (token !== generation) return;
    connection(false, 'Glove disconnected');
    retryTimer = setTimeout(reconnect, retryDelay); retryDelay = Math.min(8000, retryDelay * 2);
  };
  // Initial HTTP snapshot also gives an immediate, useful error on preview servers.
  fetch('/api/state', { signal: AbortSignal.timeout(5000), cache: 'no-store' })
    .then(async (response) => { if (!response.ok) throw new Error('No glove connected here. Open 192.168.4.1 after joining its Wi-Fi.'); return response.json(); })
    .then((data) => { if (token === generation) receive(data); })
    .catch((error) => { if (token === generation && !online) feedback(error.message, true); });
}
function preview() {
  const text = $('reply-text').value.trim();
  if (!text) { $('lcd-preview').textContent = 'Up to two lines on the glove’s display.'; return; }
  const lcd = formatLcd(text);
  $('lcd-preview').textContent = `${lcd.lines.filter(Boolean).join(' / ')}${lcd.truncated ? ' (shortened on LCD)' : ''}`;
}
function renderPhrases() {
  const query = $('phrase-search').value.toLowerCase();
  const selected = $('scenario').value;
  const phrases = selected === 'everyday' ? GENERIC : SCENARIOS.find((scenario) => scenario.id === selected)?.phrases || [];
  $('phrase-list').replaceChildren();
  for (const phrase of phrases.filter((phrase) => phrase.text.toLowerCase().includes(query))) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = phrase.text;
    button.onclick = () => { $('reply-text').value = phrase.text; preview(); $('reply-text').focus(); };
    $('phrase-list').append(button);
  }
}
function init() {
  fingerNames.forEach((name, index) => {
    const row = document.createElement('tr');
    for (const value of [name, pins[index], '—', '—', '—']) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
    $('sensor-rows').append(row);
  });
  for (const [list, signs, op] of [['flex-training', flexSigns, 'trainFlex'], ['motion-training', motionSigns, 'trainMotion']]) signs.forEach(([key, sign], index) => {
    const row = document.createElement('li');
    const copy = document.createElement('div'), title = document.createElement('span'), detail = document.createElement('small'), count = document.createElement('small');
    title.textContent = translate(key).text; detail.textContent = sign.pattern ? `${sign.pattern} · ${sign.how}` : sign.how;
    count.className = 'count'; count.textContent = 'Waiting for glove'; copy.append(title, detail, count);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Train'; button.dataset.train = op; button.disabled = true;
    button.onclick = () => run(op, { index }); row.append(copy, button); $(list).append(row);
  });
  for (const scenario of SCENARIOS) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.name; $('scenario').append(option); }
  renderPhrases(); renderQuickReplies('');
  $('scenario').onchange = renderPhrases; $('phrase-search').oninput = renderPhrases;
  $('reconnect').onclick = reconnect;
  $('reply-form').onsubmit = (event) => { event.preventDefault(); sendReply($('reply-text').value); };
  $('reply-text').oninput = preview;
  $('calibrate').onclick = () => run('calibrate'); $('cancel').onclick = () => run('cancel');
  $('live').onclick = () => run('live', { value: !state.live });
  $('debug').onclick = () => run('debug', { value: !state.debug });
  $('erase').onclick = () => { if (confirm('Erase all saved finger and motion training? You will need to train again.')) run('erase', { confirm: 'ERASE' }); };
  $('settings').oninput = () => { settingsDirty = true; };
  $('settings').onsubmit = async (event) => {
    event.preventDefault();
    try { await command('settings', { useFlex: $('use-flex').checked, ignoreMiddle: $('ignore-middle').checked, useMotor: $('use-motor').checked }); settingsDirty = false; }
    catch (error) { feedback(error.message, true); }
  };
  $('clear').onclick = () => { rows.clear(); $('history').replaceChildren(); $('history-empty').hidden = true; $('history-empty').textContent = 'Conversation cleared on this screen.'; $('history-empty').hidden = false; };
  $('sound').disabled = !voice.isSupported();
  $('sound').onclick = () => {
    if (!voice.isUnlocked()) { voice.unlock(); if (voice.isMuted()) voice.toggleMute(); }
    else voice.toggleMute();
    const on = !voice.isMuted(); $('sound').textContent = on ? 'Voice on' : 'Voice off'; $('sound').setAttribute('aria-pressed', String(on));
  };
  $('replay').onclick = () => { voice.unlock(); if (voice.isMuted()) voice.toggleMute(); voice.speak(lastTranslation); $('sound').textContent = 'Voice on'; $('sound').setAttribute('aria-pressed', 'true'); };
  setInterval(() => {
    if (online && Date.now() - lastPacket > 3500) { connection(false, 'Connection interrupted'); socket?.close(); }
    for (const [id, reply] of pending) if (Date.now() - reply.at > 8000) {
      addHistory(id, reply.text, 'reply', 'Delivery unconfirmed; check the glove');
      // Keep the row so a late acknowledgement still corrects its status.
      pending.delete(id);
    }
  }, 1000);
  reconnect();
}
init();
