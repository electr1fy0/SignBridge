# SignBridge

A sign-language glove with a local Wi-Fi communication screen. One ESP32 sketch
reads five flex sensors and an MPU6500, recognizes eight simple gestures whose
meaning depends on the chosen environment, updates a
16×2 LCD, and serves the website directly to a phone or computer. Replies from
the website are written to the physical LCD, with optional vibration feedback.

## Flash this file

**[firmware/SignBridge/SignBridge.ino](firmware/SignBridge/SignBridge.ino)**

That single file includes the website. No Node server, external Arduino libraries,
filesystem upload, USB browser permissions, or internet connection is needed to
use the glove after flashing.

1. Install **esp32 by Espressif Systems**, version **3.x**, in Arduino IDE's Boards Manager.
2. Open `firmware/SignBridge/SignBridge.ino` and select **ESP32 Dev Module** and your USB port.
3. Keep **Erase All Flash Before Sketch Upload disabled** to retain settings.
4. Upload. Keep fingers straight and the hand flat, palm down and still during startup calibration.
5. Join Wi-Fi **SignBridge**, password **signbridge**.
6. Open **http://192.168.4.1** in a normal browser tab. If the phone warns that this Wi-Fi has no internet, stay connected.
7. Tap **Enable voice** for spoken translations. Speech is produced by the phone/computer; offline speech depends on its installed voices.

USB can be disconnected after upload when the ESP32 has another suitable power
source. Up to four Wi-Fi devices can join the access point. The local page uses
WebSockets for live data and HTTP commands for replies and controls.

## Wiring

This pin map targets the **classic ESP32**, not C3/S2/S3 boards.

| Component | ESP32 GPIO |
|---|---|
| Thumb flex divider output | 33 |
| Index flex divider output | 35 |
| **Middle flex divider output** | **36 — move it from the old GPIO25 connection** |
| Ring flex divider output | 34 |
| Pinky flex divider output | 32 |
| MPU6500 SDA / SCL | 21 / 22 |
| LCD backpack SDA / SCL | 18 / 19 |
| Optional vibration motor driver control | 26 |
| Optional 3-pin buzzer module signal (S / I/O) | 27 |

All flex inputs use ADC1 so Wi-Fi can run without the ADC2 conflict. Each flex
sensor needs its own voltage divider with an output within the ESP32's 3.3 V
input range. Bending is detected from the absolute change from the calibrated
straight-hand reading, so increases and decreases both count. Share grounds.
Use 3.3 V-compatible I²C signals or level shifting for an LCD backpack pulled to 5 V.
Drive a motor through a suitable transistor/MOSFET driver and flyback diode.

The middle sensor is sampled and displayed but never used for recognition,
so its wiring does not affect gestures. If using only the MPU, disable **Use flex sensors** there. Motor output starts
disabled; enable it only when the driver is connected. Hardware settings persist.

**Buzzer (Morse code).** Wire a 3-pin buzzer module's VCC to 3.3 V (or 5 V if its
signal input accepts 3.3 V logic), GND to GND and the signal pin to GPIO27, then
pick its type under Device tools → Connected hardware (it applies immediately):
most active modules beep when the signal is LOW (the default), some when it is
HIGH, and passive buzzers need a tone. A constant hiss or tone means the type is
wrong, the pin was left floating ("Not connected" with a module wired), or the
module runs from 5 V so 3.3 V never switches it fully off.
**Test buzzer (SOS)** (or `b` over serial) checks it. Each reply from the website
is spelled in Morse code as it appears on the LCD (90 ms per dot; letters,
digits and . , ? ' ! -), and the Shake (emergency) gesture beeps SOS twice.

## Gestures and environments

Twelve easy gestures (six hand shapes, four motions and two palm-up combos) are recognized by deliberately permissive rules (both hand
shapes and motions can instead be learned from your own recordings, below). No
gesture depends on the index or middle sensors. The environment chosen on the website
decides what each one means. The firmware sends the gesture and environment;
the LCD and website show the phrase.

| Gesture | How | Everyday | Hospital | Market | Restaurant | Classroom |
|---|---|---|---|---|---|---|
| Fist | All fingers closed | Yes. | I am in pain. | Yes, I'll buy it. | Yes, please. | Yes, I'm here. |
| Thumbs up | Fist, thumb up | Sounds good! | I feel better now. | Good price, deal! | The food is great! | I understand. |
| Pinky up | Fist, pinky out | Where is the washroom? | I need the washroom. | Do you have a smaller one? | Where is the washroom? | May I go to the washroom? |
| Call me | Thumb and pinky out (🤙) | Please call me. | Please call my family. | Can I pay by UPI? | Can I order now? | I have a question. |
| Flat hand | Fingers straight, thumb tucked | Please wait. | I need to rest. | Just looking, thanks. | That's enough, thanks. | Please slow down. |
| Three | Thumb holds pinky down, three fingers up | What is your name? | I feel dizzy. | Three of these, please. | Table for three. | What is the homework? |
| Wave | Open hand, side to side 2–3 times | Hello! | Nurse, please come. | Excuse me! | Waiter, please! | Good morning! |
| Flip | Open hand, turn palm over | Thank you. | Thank you, doctor. | Can I get a discount? | The bill, please. | Thank you, teacher. |
| Nod | Open hand, dip wrist down and back | Please repeat that. | I need water. | How much is this? | Water, please. | Please repeat that. |
| Shake | Small fast jiggle, any hand shape | Emergency! Please help me. | Emergency! Call a doctor. | Emergency! … | Emergency! … | Emergency! … |
| Fist, palm up (combo) | Make a fist while turning the palm up, hold | Here you go. | Here is my prescription. | Here is the money. | I'll pay now. | Here is my homework. |
| Pinky, palm up (combo) | Pinky up with the palm turned up, hold | I promise. | I'll take my medicine. | I'll come back later. | I'll come back again. | I'll finish it tomorrow. |

- **Hand shapes** use only the thumb, ring and pinky sensors; index and middle
  readings are still shown in Device tools but never used. Ring closed: thumb and
  pinky in or out pick fist, thumbs up, pinky up or call me. Ring open with the
  thumb tucked: flat hand (pinky out) or three (thumb holding the pinky down).
  Hold the shape for about half a second with the hand fairly still.
- **Combos** are a closed shape (fist or pinky up) held with the palm turned up,
  at least 130° from the palm-down calibration pose. The palm is checked when the
  shape fires, so a combo replaces its plain shape instead of following it, and
  turning a closed hand never counts as a flip. A shape still held when a motion
  ends belongs to that motion and fires again only after it changes.
- **Motions** use the gyroscope and accelerometer and do not depend on how the
  MPU is mounted. Each movement is measured from a still hand until the hand is
  still again, then classified by traits that do not overlap:
  - *Shake*: 4+ small sweeps (35° or less each) at 3+ per second, a quick jiggle
    like shaking water off. Waves are told apart by their big sweeps, even when fast.
  - *Flip*: the hand ends turned over (70°+ change in gravity direction), no bounce back.
  - *Wave*: 2+ big side-to-side sweeps.
  - *Nod*: exactly one out-and-back.

  Small bounces below 35% of the movement's peak speed are not counted, so a nod's
  rebound does not turn it into a wave. Hold still for a moment between motions.
- **Learned motions** (Device tools → Learn motions, or `m1`…`m4` over serial)
  replace these rules once every motion has at least one recording. Press Record,
  hold still, and do the motion once when the glove shows MOVE NOW; up to three
  recordings per motion are kept. Each movement is described by which axes moved,
  how far each turned, swing count, speed and sweep size, energy and end tilt, and takes the
  nearest recording's motion if its distance is at most `MOTION_LIMIT` (0.5);
  anything further is ignored. Motion details show this distance for tuning.
  **Clear motion recordings** (`mx`) returns to the built-in rules.
- **Calibration** runs at every startup and records the straight-hand flex
  readings and the still gyro bias. Re-run it (**Recalibrate** on the Live hand
  card, or `c` over serial) after putting the glove on again.
- **Learned hand shapes** (Device tools → Learn hand shapes, or `t1`…`t4` over
  serial) suit weak sensors. Record each shape up to three times:
  3-second countdown, then 2 seconds of holding it. Once fist, thumbs up,
  pinky up and call me have recordings, the glove picks whichever recording (or the straight calibrated
  hand) is closest to the
  last 400 ms of thumb, ring and pinky readings. Each finger is weighted by how steady it was, so a
  sensor that changes only a little but consistently still separates shapes.
  Recordings are saved and survive recalibration; **Clear recordings** (`tx`)
  goes back to bend triggers.
- **Bend triggers** are set per finger under Device tools → Bend triggers: each
  finger's live bend is shown against a draggable trigger. They are saved on the
  glove. Motion thresholds are constants near the top of the `sb` namespace
  (`HOLD_MS`, `MOVE_START`, `FLIP_TILT`, `SHAKE_ENERGY`, …); Device tools show the
  last motion's swings, turn, tilt change and energy.

Phrases are edited in `signbridge/public/js/gestures.js`; `npm run embed`
regenerates the firmware's LCD table from it. The environment persists across restarts.

## Serial Monitor

Set **115200 baud** and **Newline** (or Both NL & CR). Send a command then Enter.
Live readings start ON; motion details start OFF.

| Command | Action |
|---|---|
| `p` | Toggle raw flex, delta, pattern, acceleration and gyro output |
| `d` | Toggle motion details (swings, turn, tilt, energy and result) |
| `c` | Calibrate straight fingers and the still MPU |
| `s` | Show the environment, gesture meanings and Wi-Fi information |
| `b` | Test the buzzer: plays SOS in Morse |
| `e1` … `e5` | Switch environment: everyday, hospital, market, restaurant, classroom |
| `t1` … `t6` | Record fist, thumbs up, pinky up, call me, flat hand, three for learned shapes |
| `tx` | Clear recorded shapes and use bend triggers again |
| `m1` … `m4` | Record wave, flip, nod, shake for learned motions |
| `mx` | Clear recorded motions and use the built-in rules again |
| `q` | Cancel calibration |
| `reply Hello` | Write a reply to the physical LCD |
| `?` | Print command help |

The website has matching environment, calibration, debug and serial-log controls.
Wireless sensor values remain available when serial logging is paused. The
conversation reports LCD delivery only after the firmware actually writes the
reply; a missing LCD is reported as unavailable. Vibration acknowledgement means
the configured driver was triggered, not that motor movement was measured.

## Editing the website

The maintained source is in `signbridge/public/`. To regenerate the copy embedded
in the flashable `.ino` after editing it:

```sh
cd signbridge
npm run embed
npm test
npm run check:embed
```

No npm dependencies are required. Optional desktop preview:

```sh
npm start
# http://localhost:3050 — shows disconnected unless a real glove is proxied
```

For development with a glove connected over Wi-Fi:

```sh
SIGNBRIDGE_DEVICE=http://192.168.4.1 npm start
```

The preview proxies HTTP and WebSocket traffic to that device. Normal use should
open the glove's own page. Optional existing Wi-Fi credentials can be set in
`WIFI_SSID` / `WIFI_PASSWORD` near the top of the sketch; its access point remains
available and the network IP appears in `/api/state` and the Serial Monitor.

Legacy independent USB sketches are under `firmware/legacy/` for reference.
Only `firmware/SignBridge/SignBridge.ino` is the maintained combined firmware.
Protocol details: [signbridge/docs/FIRMWARE_PROTOCOL.md](signbridge/docs/FIRMWARE_PROTOCOL.md).
