import { GESTURES, ENVIRONMENTS, DEFAULT_REPLIES, environment, meaning, replyItem } from './gestures.js';
import { GENERIC, SCENARIOS } from './phrases.js';
import { formatLcd, vibFor, makeUid } from './protocol.js';
import { TextToSpeechManager } from './tts.js';
import { validateState, consumeEvents, replyDelivery } from './device.js';

const $ = (id) => document.getElementById(id);
const voice = new TextToSpeechManager({ onError: (message) => feedback(message, true) });
let state = null, online = false, cursor = { boot: null, seq: 0 };
let socket = null, retryTimer = null, lastPacket = 0, retryDelay = 800, generation = 0;
let lastTranslation = '', settingsDirty = false, bendDirty = false, displayedNotice = '', shownEnv = null, flashTimer = null, requestedEnv = null;
const pending = new Map();
const rows = new Map();
const fingerNames = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const pins = [33, 35, 36, 34, 32];
const BEND_SCALE = 600; // change shown at the right end of each bend bar
const UNUSED_FINGERS = [1, 2]; // index and middle: no gesture depends on them

function feedback(text, error = false) {
  $('feedback').textContent = text;
  $('feedback').dataset.error = String(error);
}
function availability() {
  const busy = state?.job !== 0;
  $('send').disabled = !online;
  $('calibrate').disabled = $('recalibrate').disabled = !online || busy;
  $('save-bend').disabled = !online || !bendDirty;
  $('reset-bend').disabled = !online;
  $('clear-shapes').disabled = !online || busy || !state?.shapesTrained?.some(Boolean);
  for (const button of $('shape-rows').querySelectorAll('button')) button.disabled = !online || busy || !state?.calibrated || !state?.useFlex;
  $('clear-motions').disabled = !online || busy || !state?.motionsTrained?.some(Boolean);
  for (const button of $('motion-rows').querySelectorAll('button')) button.disabled = !online || busy || !state?.mpu || !state?.imuCalibrated;
  $('cancel').disabled = !online || !busy;
  for (const id of ['live', 'debug']) $(id).disabled = !online;
  $('save-settings').disabled = !online || busy;
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
function renderQuickReplies(replies) {
  $('quick-replies').replaceChildren();
  for (const entry of replies) {
    const reply = replyItem(entry);
    const button = document.createElement('button'); button.type = 'button'; button.textContent = reply.text;
    button.disabled = !online; button.onclick = () => sendReply(reply.text, reply.lcd);
    $('quick-replies').append(button);
  }
}
function showTranslation(event) {
  const translation = meaning(event.text, event.env);
  lastTranslation = translation.text;
  $('translation').textContent = translation.text;
  $('translation').dataset.urgent = String(translation.urgent);
  $('sign-detail').textContent = `${translation.gesture} · ${translation.env} · ${event.source === 'flex' ? 'hand shape' : 'motion'}`;
  $('replay').disabled = !voice.isSupported();
  renderQuickReplies(translation.replies);
  const card = $('gesture-guide').querySelector(`[data-gesture="${translation.key}"]`);
  for (const item of $('gesture-guide').children) item.dataset.active = String(item === card);
  clearTimeout(flashTimer); flashTimer = setTimeout(() => { for (const item of $('gesture-guide').children) item.dataset.active = 'false'; }, 2500);
}
function renderEnvironment(envId) {
  if (shownEnv === envId) return;
  shownEnv = envId;
  const env = environment(envId);
  for (const button of $('environments').children) button.setAttribute('aria-checked', String(button.dataset.env === env.id));
  $('guide-env').textContent = env.name;
  for (const item of $('gesture-guide').children) item.querySelector('.meaning').textContent = env.phrases[item.dataset.gesture].text;
  if ([...$('scenario').options].some((option) => option.value === env.id)) { $('scenario').value = env.id; renderPhrases(); }
}
function bendLabel(element, change, trigger) {
  const strong = document.createElement('strong'); strong.textContent = trigger;
  element.replaceChildren(`${change} / `, strong);
}
function renderHand() {
  const ready = state.useFlex && state.calibrated;
  const bendOf = (i) => (ready ? Math.min(1, Math.max(0, state.delta[i] / state.fullBend[i])) : 0);
  for (const finger of $('hand').querySelectorAll('.finger')) {
    // Unused fingers follow the ring finger so a fist never shows them standing up.
    const i = Number(finger.dataset.finger), bend = bendOf(UNUSED_FINGERS.includes(i) ? 3 : i);
    finger.style.transform = `scaleY(${1 - 0.4 * bend})`;
    // Learned mode colours by the finger's own recorded range, since weak sensors never reach a trigger.
    finger.dataset.bent = String(ready && (state.shapeMode === 'learned' ? bend >= 0.6 : state.pattern[i] === '1'));
    const chip = $('finger-chips').children[i];
    chip.dataset.bent = finger.dataset.bent;
    finger.dataset.unused = chip.dataset.unused = String(UNUSED_FINGERS.includes(i));
  }
  const shape = ready && state.shape ? state.shape : null, learned = state.shapeMode === 'learned';
  $('hand-shape').textContent = state.job ? (state.recording >= 0 || state.recordingMotion >= 0 ? 'Recording…' : 'Calibrating…') : !state.useFlex ? 'Flex off' : !state.calibrated ? 'Not calibrated' : shape ? GESTURES[shape]?.name ?? shape : learned || /^.000/.test(state.pattern) ? 'Open hand' : 'No shape';
  const recorded = state.shapesTrained.filter(Boolean).length;
  $('shape-mode').textContent = learned ? 'Matching your recorded shapes' : `Using bend triggers · ${recorded} of 4 shapes recorded`;
  [...$('motion-rows').children].forEach((row, i) => {
    const status = row.querySelector('.state'), count = state.motionsTrained[i];
    status.textContent = state.recordingMotion === i ? 'Recording…' : `${count} of 3 recorded`;
    status.dataset.done = String(count > 0);
    row.querySelector('button').textContent = count >= 3 ? 'Replace oldest' : 'Record';
  });
  [...$('shape-rows').children].forEach((row, i) => {
    const status = row.querySelector('.state');
    status.textContent = state.recording === i ? 'Recording…' : state.shapesTrained[i] ? 'Recorded' : 'Not recorded';
    status.dataset.done = String(Boolean(state.shapesTrained[i]));
    row.querySelector('button').textContent = state.shapesTrained[i] ? 'Record again' : 'Record';
  });
  $('hand-shape').dataset.shape = String(Boolean(shape));
  [...$('bend-rows').children].forEach((row, i) => {
    const live = row.querySelector('.bend-live'), input = row.querySelector('input');
    if (!bendDirty) input.value = state.bendOn[i];
    live.style.width = `${Math.min(100, (state.delta[i] / BEND_SCALE) * 100)}%`;
    live.dataset.bent = String(state.pattern[i] === '1');
    bendLabel(row.querySelector('.bend-value'), state.delta[i], input.value);
  });
  const speed = state.mpu ? Math.hypot(...state.gyro) : 0;
  $('speed').textContent = state.mpu ? `${Math.round(speed)}°/s` : 'MPU unavailable';
  $('speed-fill').style.width = `${Math.min(100, speed / 3)}%`;
  $('speed-fill').dataset.moving = String(speed > 90);
  const motion = state.motion;
  const motionSource = state.motionMode === 'learned' ? 'your recordings' : 'built-in rules';
  if (!motion?.energy) $('motion-summary').textContent = `Motions use ${motionSource}.`;
  else $('motion-summary').textContent = motion.result ? `Last motion: ${GESTURES[motion.result]?.name ?? motion.result} · ${motionSource}` : `Last motion not recognized (${motionSource}). Try a bigger, cleaner movement.`;
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
      const translation = meaning(event.text, event.env);
      addHistory(`${state.boot}:${event.seq}`, translation.text, 'sign', `${translation.gesture} · ${translation.env}`);
    } else {
      const key = pending.has(event.requestId) || rows.has(event.requestId) ? event.requestId : `${state.boot}:${event.seq}`;
      addHistory(key, event.text, 'reply', replyDelivery(event));
      if (pending.has(event.requestId)) { pending.delete(event.requestId); feedback(replyDelivery(event), !event.lcd); }
    }
  }
  if (accepted.audible.length && voice.isUnlocked() && !voice.isMuted()) { const last = accepted.audible.at(-1); voice.speak(meaning(last.text, last.env).text); }
  const notice = `${state.notice}${state.remaining > 0 ? ` (${state.remaining})` : ''}`;
  if (displayedNotice !== notice) { $('device-notice').textContent = notice; displayedNotice = notice; }
  $('sensor-summary').textContent = `MPU ${state.mpu ? 'connected' : 'unavailable'} · LCD ${state.lcd ? 'connected' : 'unavailable'}`;
  $('pattern').textContent = state.pattern;
  fingerNames.forEach((_, index) => {
    const row = $('sensor-rows').children[index];
    row.children[2].textContent = state.flex[index]; row.children[3].textContent = Math.round(state.baseline[index]); row.children[4].textContent = state.delta[index];
  });
  const axes = (values) => values.map((v, i) => `${'XYZ'[i]} ${Number(v).toFixed(2)}`).join('   ');
  $('imu-values').textContent = state.mpu ? `Acceleration (m/s²): ${axes(state.acc)}\nGyroscope (°/s): ${axes(state.gyro)}` : 'MPU unavailable. Check SDA 21, SCL 22 and sensor power.';
  const motion = state.motion;
  $('motion-values').textContent = motion && (motion.swings || motion.energy) ? `Last motion: ${motion.result ? GESTURES[motion.result]?.name ?? motion.result : 'not recognized'}\nSwings ${motion.swings} (${Number(motion.rate ?? 0).toFixed(1)}/s) · turn ${Math.round(motion.turn)}° · tilt change ${Math.round(motion.tilt)}° · energy ${Math.round(motion.energy)}°/s${motion.distance >= 0 ? ` · match distance ${Number(motion.distance).toFixed(2)} (limit 0.50)` : ''}` : 'No motion analysed yet.';
  // Ignore a snapshot taken before the glove applied a just-clicked environment.
  const waiting = requestedEnv && state.env !== requestedEnv.id && Date.now() - requestedEnv.at < 2000;
  if (!waiting) { requestedEnv = null; renderEnvironment(state.env); }
  renderHand();
  for (const [id, enabled, label] of [['live', state.live, 'Serial values'], ['debug', state.debug, 'Serial motion details']]) {
    $(id).textContent = `${label}: ${enabled ? 'on' : 'off'}`; $(id).setAttribute('aria-pressed', String(enabled));
  }
  if (!settingsDirty) { $('use-flex').checked = state.useFlex; $('use-motor').checked = state.useMotor; }
  availability();
}
function reconnect() {
  const token = ++generation;
  clearTimeout(retryTimer);
  if (socket) { socket.onclose = null; socket.close(); }
  connection(false, 'Connecting…');
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
  for (const env of ENVIRONMENTS) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = env.name;
    button.dataset.env = env.id; button.setAttribute('role', 'radio'); button.setAttribute('aria-checked', 'false');
    // Switch the page immediately; the glove follows when connected and its state wins.
    button.onclick = () => { renderEnvironment(env.id); if (online) { requestedEnv = { id: env.id, at: Date.now() }; run('env', { value: env.id }); } };
    $('environments').append(button);
  }
  Object.entries(GESTURES).filter(([, gesture]) => gesture.kind === 'shape').forEach(([key, gesture], index) => {
    const row = document.createElement('li'), copy = document.createElement('div'), title = document.createElement('span');
    const how = document.createElement('small'), status = document.createElement('span'), button = document.createElement('button');
    title.textContent = gesture.name; how.textContent = gesture.how; status.className = 'state'; status.textContent = 'Waiting for glove';
    button.type = 'button'; button.textContent = 'Record'; button.disabled = true; button.onclick = () => run('trainShape', { index });
    copy.append(title, how); row.dataset.shape = key; row.append(copy, status, button); $('shape-rows').append(row);
  });
  Object.entries(GESTURES).filter(([, gesture]) => gesture.kind === 'motion').forEach(([key, gesture], index) => {
    const row = document.createElement('li'), copy = document.createElement('div'), title = document.createElement('span');
    const how = document.createElement('small'), status = document.createElement('span'), button = document.createElement('button');
    title.textContent = gesture.name; how.textContent = gesture.how; status.className = 'state'; status.textContent = 'Waiting for glove';
    button.type = 'button'; button.textContent = 'Record'; button.disabled = true; button.onclick = () => run('trainMotion', { index });
    copy.append(title, how); row.dataset.motion = key; row.append(copy, status, button); $('motion-rows').append(row);
  });
  for (const name of fingerNames) {
    const chip = document.createElement('li'); chip.textContent = name; $('finger-chips').append(chip);
    const row = document.createElement('li'), label = document.createElement('span'), track = document.createElement('div');
    const live = document.createElement('span'), input = document.createElement('input'), value = document.createElement('span');
    label.textContent = name; track.className = 'bend-track'; live.className = 'bend-live'; value.className = 'bend-value';
    Object.assign(input, { type: 'range', min: 20, max: BEND_SCALE, step: 5, value: 100 });
    input.setAttribute('aria-label', `${name} bend trigger`);
    input.oninput = () => { bendDirty = true; bendLabel(value, state?.delta[fingerNames.indexOf(name)] ?? '—', input.value); availability(); };
    track.append(live, input); row.append(label, track, value); $('bend-rows').append(row);
    row.dataset.unused = String(UNUSED_FINGERS.includes(fingerNames.indexOf(name)));
  }
  for (const [key, gesture] of Object.entries(GESTURES)) {
    const item = document.createElement('li'); item.dataset.gesture = key; item.dataset.kind = gesture.kind;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = gesture.name;
    const said = document.createElement('span'); said.className = 'meaning';
    const how = document.createElement('small'); how.textContent = gesture.how;
    item.append(name, said, how); $('gesture-guide').append(item);
  }
  for (const scenario of SCENARIOS) { const option = document.createElement('option'); option.value = scenario.id; option.textContent = scenario.name; $('scenario').append(option); }
  renderPhrases(); renderQuickReplies(DEFAULT_REPLIES); renderEnvironment('everyday');
  $('scenario').onchange = renderPhrases; $('phrase-search').oninput = renderPhrases;
  $('reconnect').onclick = reconnect;
  $('reply-form').onsubmit = (event) => { event.preventDefault(); sendReply($('reply-text').value); };
  $('reply-text').oninput = preview;
  $('calibrate').onclick = $('recalibrate').onclick = () => run('calibrate');
  $('clear-motions').onclick = () => { if (confirm('Clear all recorded motions? Motions will use the built-in rules again.')) run('clearMotions'); };
  $('clear-shapes').onclick = () => { if (confirm('Clear all recorded hand shapes? Hand shapes will use the bend triggers again.')) run('clearShapes'); };
  $('save-bend').onclick = async () => {
    try { await command('bend', { values: [...$('bend-rows').querySelectorAll('input')].map((input) => Number(input.value)) }); bendDirty = false; availability(); }
    catch (error) { feedback(error.message, true); }
  };
  $('reset-bend').onclick = async () => {
    try { await command('bend', { reset: true }); bendDirty = false; availability(); }
    catch (error) { feedback(error.message, true); }
  }; $('cancel').onclick = () => run('cancel');
  $('live').onclick = () => run('live', { value: !state.live });
  $('debug').onclick = () => run('debug', { value: !state.debug });
  $('settings').oninput = () => { settingsDirty = true; };
  $('settings').onsubmit = async (event) => {
    event.preventDefault();
    try { await command('settings', { useFlex: $('use-flex').checked, useMotor: $('use-motor').checked }); settingsDirty = false; }
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
