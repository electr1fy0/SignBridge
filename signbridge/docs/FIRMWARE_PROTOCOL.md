# Unified firmware protocol

Implemented in `firmware/SignBridge/SignBridge.ino`. The embedded page uses the
same origin as the device; USB Web Serial is no longer used by the website.

## Routes

- `GET /` returns the complete local page from flash.
- `GET /api/state` returns the latest state snapshot.
- `GET /ws` upgrades to WebSocket. State snapshots broadcast every 400 ms.
- `POST /api/command` accepts a JSON command, limited to 768 bytes.

The server runs on its own ESP32 task. HTTP callbacks validate commands and put
them in a bounded queue; `loop()` performs sensor, LCD, flash and motor work.
Only a mutex-protected state snapshot is shared across those tasks. Slow network
clients are timed out; broadcast work is coalesced to avoid an unbounded backlog.
Calibration and motion capture are sample-driven state machines.

The local Wi-Fi password controls who can join. Anyone with device network
access can view values and operate controls; there are no user accounts. Change
`AP_PASSWORD` before using it outside a trusted demonstration environment. There
is no internet-facing service or external font/CDN dependency.

## State

Snapshots include `type: "state"`, a per-boot `boot` identifier, `uptime`, device
health, calibration progress, `notice`, raw flex/delta/baseline arrays,
acceleration in m/s², gyro in degrees/second, a five-character bend pattern,
the current `env` id, the five per-finger bend triggers `bendOn`, `fullBend`
(per-finger change drawn as a full bend), `shapeMode` (`triggers` or `learned`),
`shape` (the hand shape seen right now, or empty), `shapesTrained` (recordings per shape, 0–3), `buzzer` (`off`, `low`,
`high` or `passive`), `morse` (true while Morse is playing),
`recording` (shape index being recorded, or -1), `motionMode` (`rules` or
`learned`), `motionsTrained` (recordings per motion, 0–3), `recordingMotion`
(motion index being recorded, or -1), hardware settings, the most recent 12 conversation events,
and `motion` (`swings`, `rate`, `sweep`, `turn`, `tilt`, `energy`, `distance`, `result`;
`distance` is -1 unless learned matching ran) for the last
analysed movement.

An event contains `seq`, `type` (`sign` or `reply`), `text`, `source`, `env`,
`requestId`, `lcd`, `haptic`, and `buzzer` (true when the reply was spelled in
Morse, or a Shake sounded SOS). For signs, `text` is the gesture key (`FIST`,
`THUMB`, `PINKY`, `CALL`, `WAVE`, `FLIP`, `NOD`, `SHAKE`) and `env` is the
environment it was made in; the browser maps the pair to a phrase with `gestures.js`. Clients deduplicate by boot + sequence and do not speak
initial/reconnected history again. All connected screens receive the same
recent events. Browsers keep at most 60 rendered entries in memory.

## Commands

```json
{"op":"reply","id":"browser-unique-id","text":"I'll get you water.","line1":"I'LL GET YOU","line2":"WATER.","vib":"MSG"}
```

Reply text is 1–160 UTF-8 bytes; each LCD line is printable ASCII and at most
16 characters. The browser sanitizes/wraps LCD text and displays a shortening
preview. Empty lines are allowed. Vibration codes: `ACK`, `YES`, `NO`, `MSG`,
`URGENT`. Firmware writes both LCD rows, triggers the configured driver, and
adds a `reply` event using the request ID. `lcd: false` means the display write
was unavailable/failed. It never labels queue acceptance as LCD delivery.
No sensor verifies that a motor physically moved.

Other commands:

```json
{"op":"calibrate"}
{"op":"cancel"}
{"op":"env","value":"hospital"}
{"op":"bend","values":[150,100,100,130,110]}
{"op":"bend","reset":true}
{"op":"trainShape","index":0}
{"op":"clearShapes"}
{"op":"trainMotion","index":0}
{"op":"clearMotions"}
{"op":"live","value":false}
{"op":"debug","value":true}
{"op":"settings","useFlex":true,"useMotor":false,"buzzer":"low"}
{"op":"morseTest"}
```

Environment ids are `everyday`, `hospital`, `market`, `restaurant` and
`classroom`. Bend trigger values are whole numbers from 20 to 1000, in thumb,
index, middle, ring, pinky order; a finger reads straight again below two thirds
of its trigger. Triggers persist. `trainShape` indices 0–3 are fist, thumbs up, pinky up and
call me (up to three recordings each, learned matching once each has one);
`trainMotion` indices 0–3 are wave, flip, nod and shake (up to three
recordings each, learned matching once each has one); recordings persist and learned matching starts once all four exist. Booleans and ids are validated, and settings changes are refused
while calibration is running. HTTP 202 means queued; subsequent state
and reply events report execution. Queue overflow returns 503.

Hardware settings and the environment persist; serial/debug toggles reset at boot.
Pausing serial output does not pause wireless telemetry or recognition.

## Serial

Serial Monitor runs at 115200 baud. Commands are whole lines, separated by
newline/CRLF; oversized lines are discarded. `p`, `d`, `c`, `s`, `q`, `e1..e5`, `t1..t4`, `tx`, `m1..m4`, `mx`, `b`,
`reply TEXT`, and `?` are documented in the root guide. Arbitrary reply
text is never interpreted as individual command keys.

Recognition keeps the existing diagnostic-friendly format:

```text
>>> RECOGNIZED: FIST <<<
MEANING (hospital): I AM IN PAIN.
FLEX  (T I M R P): 2410 | 2980 | 1800 | 3120 | 2875
DELTA (T I M R P): 310 | 250 | 0 | 15 | 20
BENT PATTERN: 11000
ACC: X=0.00 Y=0.00 Z=9.81
GYRO: X=0.00 Y=0.00 Z=0.00
STATUS: MPU=OK LCD=OK
```

The old proposed `~MSG` serial integration has been replaced by implemented
HTTP replies. Gesture training and its erase command were removed; recognition
uses fixed rules.
