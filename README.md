# SignBridge

A sign-language glove with a local Wi-Fi communication screen. One ESP32 sketch
reads five flex sensors and an MPU6500, recognizes trained gestures, updates a
16×2 LCD, and serves the website directly to a phone or computer. Replies from
the website are written to the physical LCD, with optional vibration feedback.

## Flash this file

**[firmware/SignBridge/SignBridge.ino](firmware/SignBridge/SignBridge.ino)**

That single file includes the website. No Node server, external Arduino libraries,
filesystem upload, USB browser permissions, or internet connection is needed to
use the glove after flashing.

1. Install **esp32 by Espressif Systems**, version **3.x**, in Arduino IDE's Boards Manager.
2. Open `firmware/SignBridge/SignBridge.ino` and select **ESP32 Dev Module** and your USB port.
3. Keep **Erase All Flash Before Sketch Upload disabled** to retain saved training.
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
input range. The thresholds assume bending increases ADC readings; change
`bendDirection` in the sketch if your divider is reversed. Share grounds. Use
3.3 V-compatible I²C signals or level shifting for an LCD backpack pulled to 5 V.
Drive a motor through a suitable transistor/MOSFET driver and flyback diode.

The middle sensor is **ignored initially**, preserving the previous glove's
workaround. It is still sampled and displayed. After repairing its wiring and
moving it to GPIO36, uncheck **Ignore middle sensor** under Device tools.
If using only the MPU, disable **Use flex sensors** there. Motor output starts
disabled; enable it only when the driver is connected. Hardware settings persist.

## Recognition and training

The two recognizers run together. A stable bent-finger pattern selects a finger
sign; an open hand and a fast motion selects a motion sign. Return to a still,
open hand between motions. The LCD continues showing an incoming reply for ten
seconds so a new gesture does not immediately overwrite it.

| Finger sign | Pattern: thumb, index, middle, ring, pinky |
|---|---|
| Okay | 11000 |
| Water | 10001 |
| Two | 10011 |
| Three | 00011 |
| Four | 10000 |
| Seven | 10010 |

Motion signs: **Hello, Bye, Thank you, Please, Happy, Come here, Slow down,
Finished**. These are trained movement templates, not a general sign-language
translator; similar movements can still be confused.

Under **Device tools**, choose **Train** beside a sign. Finger training gives a
three-second countdown, then checks the expected pattern for one second. Motion
training gives a countdown and a **MOVE NOW** prompt; perform the movement once
with fingers open. Repeat motion training three times per sign. Training and
calibration are cancellable and do not block the website.

New firmware imports saved finger patterns from `glove2` and motion examples
from `motion2` on its first boot. It then uses its own `signbridge` preferences.
Calibration runs at each startup; saved gesture examples survive restarts.

## Serial Monitor

Set **115200 baud** and **Newline** (or Both NL & CR). Send a command then Enter.
Live readings start ON; motion debug starts OFF.

| Command | Action |
|---|---|
| `p` | Toggle raw flex, delta, pattern, acceleration and gyro output |
| `d` | Toggle motion matching scores; lower is closer, accepted at ≤0.65 |
| `c` | Calibrate straight fingers and the still MPU |
| `s` | List training and Wi-Fi information |
| `f1` … `f6` | Train finger signs in the table's order |
| `m1` … `m8` | Train motion signs in the order listed above |
| `q` | Cancel calibration/training |
| `reply Hello` | Write a reply to the physical LCD |
| `?` | Print command help |

The website has matching calibration, training, debug and serial-log controls.
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
