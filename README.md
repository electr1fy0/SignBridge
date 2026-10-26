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
4. Upload. Keep fingers straight and the hand flat and still during startup calibration.
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

All flex inputs use ADC1 so Wi-Fi can run without the ADC2 conflict. Each flex
sensor needs its own voltage divider with an output within the ESP32's 3.3 V
input range. Bending is detected from the absolute change from the calibrated
straight-hand reading, so increases and decreases both count. Share grounds.
Use 3.3 V-compatible I²C signals or level shifting for an LCD backpack pulled to 5 V.
Drive a motor through a suitable transistor/MOSFET driver and flyback diode.

The middle sensor is **ignored initially**, preserving the previous glove's
workaround. It is still sampled and displayed. After repairing its wiring and
moving it to GPIO36, uncheck **Ignore middle sensor** under Device tools.
If using only the MPU, disable **Use flex sensors** there. Motor output starts
disabled; enable it only when the driver is connected. Hardware settings persist.

## Gestures and environments

There is no gesture training. Eight easy gestures are recognized by fixed,
deliberately permissive rules, and the environment chosen on the website
decides what each one means. The firmware sends the gesture and environment;
the LCD and website show the phrase.

| Gesture | How | Everyday | Hospital | Market | Restaurant | Classroom |
|---|---|---|---|---|---|---|
| Fist | All fingers closed | Yes. | I am in pain. | Yes, I'll buy it. | Yes, please. | Yes, I'm here. |
| Point | Index up | I have a question. | It hurts here. | How much is this? | I want this one. | I have a question. |
| Pinky up | Pinky up | Where is the washroom? | I need the washroom. | Do you have a smaller one? | Where is the washroom? | May I go to the washroom? |
| Index + pinky | Index and pinky up | I love it! | I feel better now. | Good price, deal! | The food is great! | I understand. |
| Wave | Open hand, side to side 2–3 times | Hello! | Nurse, please come. | Excuse me! | Waiter, please! | Good morning! |
| Flip | Open hand, turn palm over | Thank you. | Thank you, doctor. | Can I get a discount? | The bill, please. | Thank you, teacher. |
| Nod | Open hand, dip wrist down and back | Please repeat that. | I need water. | Can I pay by UPI? | Water, please. | Please repeat that. |
| Shake | Shake hard, any hand shape | Emergency! Please help me. | Emergency! Call a doctor. | Emergency! … | Emergency! … | Emergency! … |

- **Hand shapes** use only the index, ring and pinky sensors; thumb and middle
  are ignored. Hold the shape for about half a second with the hand fairly still.
- **Motions** use the gyroscope and accelerometer and do not depend on how the
  MPU is mounted: *shake* is hard and repeated, *flip* ends with the hand turned
  over, *wave* goes back and forth at least twice, *nod* goes out and back once.
  Start from a still hand and pause about a second between motions.
- Thresholds are constants near the top of the `sb` namespace in the sketch
  (`HOLD_MS`, `MOVE_START`, `FLIP_TILT`, `SHAKE_ENERGY`, …). The website's
  Device tools show the last motion's swings, turn, tilt change and energy.

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
| `e1` … `e5` | Switch environment: everyday, hospital, market, restaurant, classroom |
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
