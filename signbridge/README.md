# SignBridge · IoT Sign Language Communication System

A responsive, accessible two-way assistive communication web application for the **ESP32 Sign Language Glove** project.

Enables seamless two-way dialogue between:
1. **The Glove User**: Wears the sensor glove; receives incoming partner messages displayed prominently on screen, formatted for a 16x2 LCD, and mapped to distinct haptic vibration pulses.
2. **The Communication Partner**: Connects to the ESP32 via USB Web Serial (115200 baud); reads translated gestures as large English text; hears them spoken aloud automatically using the Web Speech API; and sends 1-click contextual replies.

---

## 1. Quick Start

### Prerequisites
- Node.js 18+ (tested on Node.js v24)
- Google Chrome or Microsoft Edge (desktop) for Web Serial USB communication

### Run the Application
Open a terminal in the `signbridge/` directory:

```bash
cd signbridge

# 1. Run the test suite (18 unit tests covering all required behaviors)
npm test

# 2. Start the local server
npm start
```

Then open your browser at:
```text
http://localhost:3050
```

*Note: If testing cross-device on a smartphone or second laptop, connect both devices to the same Wi-Fi and open `http://<your-computer-ip>:3050`.*

---

## 2. Connecting the ESP32 Glove (Chrome / Edge)

1. Connect the ESP32 board to your computer via USB.
2. Open **SignBridge** in Google Chrome or Microsoft Edge.
3. Choose **Communication Partner** role (or expand the **Hardware Connection & Sensor Diagnostics** panel).
4. Click **Connect ESP32 (USB)**.
5. In the browser permission popup, select your ESP32's COM port (e.g., `Silicon Labs CP210x` or `CH340`) and click **Connect**.
6. The status badge will switch to **ESP32: Connected at 115200 baud**.

---

## 3. Recognition Event Protocol & Noise Distinction

The ESP32 communicates in plain text over serial. To ensure zero false triggers or audio pollution:

### Official Recognition Event (Triggers Translation & Speech):
```text
>>> RECOGNIZED: OKAY <<<
>>> RECOGNIZED: WATER <<<
>>> RECOGNIZED: HELLO <<<
```
The line parser requires **both** `>>>` and `<<<` delimiters. When detected, the application:
1. Normalizes the sign name (e.g. `OKAY` -> `Okay`).
2. Displays the translation in large prominent text.
3. Automatically speaks the English phrase aloud (`window.speechSynthesis`).
4. Generates contextual quick reply buttons.
5. Appends the event to the conversation log.

### Diagnostic Output (Suppressed from Audio & Conversation):
Lines output by Sketch A's live diagnostic stream:
```text
RECOGNIZED: OKAY
RECOGNIZED: NONE
FLEX  (T I M R P): 2410 | 2980 | 0 | 3120 | 2875
DELTA (T I M R P): 310 | 250 | 0 | 15 | 20
BENT PATTERN: 11000
ACC: X=-1.72 Y=-2.58 Z=-10.00
GYRO: X=1.37 Y=3.60 Z=1.57
STATUS: MPU=OK LCD=OK
```
These lines **never** trigger speech synthesis or conversation entries. Instead, they update the diagnostics panel in place.

---

## 4. Supported Sketches

The web application automatically detects the active sketch from the startup banner and works with both:

### Sketch A — Finger-Based Signs (`glove_calibration.ino`)
- Hardware: 5 Flex Sensors + MPU6500 + 16x2 LCD
- Startup Banner: `DIFFERENCE-BASED DETECTION`
- Signs:
  1. `OKAY` (11000)
  2. `WATER` (10001)
  3. `TWO` (10011)
  4. `THREE` (00011)
  5. `FOUR` (10000)
  6. `SEVEN` (10010)

### Sketch B — Motion-Based Signs (`motion_gestures.ino`)
- Hardware: MPU6500 on open flat hand
- Startup Banner: `MOTION GLOVE (MPU6500 ONLY)`
- Signs:
  1. `HELLO`
  2. `BYE`
  3. `THANK YOU`
  4. `PLEASE`
  5. `HAPPY`
  6. `COME HERE`
  7. `SLOW DOWN`
  8. `FINISHED`

---

## 5. Feature Implementation Matrix

| Feature | Status | Notes |
|---|---|---|
| **Web Serial Connection (115200)** | Works Immediately | Native Chrome/Edge Web Serial API |
| **Official Event Parsing** | Works Immediately | Detects `>>> RECOGNIZED: X <<<` with chunk boundary tolerance |
| **English Translation Display** | Works Immediately | High-visibility accessible typography |
| **Automatic Speech (TTS)** | Works Immediately | Web Speech API with English voice priority and mute toggle |
| **Live Sensor Readings Panel** | Works Immediately | Pressing `Toggle Live Stream ('p')` streams flex & IMU in place |
| **Contextual Reply Suggestions** | Works Immediately | 1-click tailored answers per recognized sign |
| **Browser Multi-Tab Synchronization** | Works Immediately | Synchronizes Partner and Glove tabs via `BroadcastChannel` |
| **Cross-Device Wi-Fi Synchronization** | Works Immediately | Synchronizes across different devices via server SSE |
| **Simulated 16x2 LCD Preview** | Works Immediately | Renders dot-matrix preview on Glove interface |
| **Vibration Pattern Visualizer** | Works Immediately | Animates haptic rhythm on screen |
| **Physical ESP32 LCD & Vibration Reception** | Requires Firmware Additions | See [FIRMWARE_PROTOCOL.md](docs/FIRMWARE_PROTOCOL.md) for C++ code |

---

## 6. How Two Roles Communicate in Demo Mode

1. Open **Tab 1**: Navigate to `http://localhost:3000` and select **Communication Partner**.
2. Open **Tab 2**: Navigate to `http://localhost:3000` in a second window and select **Glove User**.
3. In **Tab 1 (Partner)**, click the demo pill **WATER** in the bottom floating toolbar:
   - Partner screen immediately displays **Water** and speaks it aloud.
   - Tailored replies appear: *"I'll get you some water"*, *"Cold or room-temperature water?"*, *"Here you go!"*.
4. In **Tab 1**, click **"I'll get you some water."**:
   - The message is marked as `Pending Delivery`.
   - **Tab 2 (Glove User)** receives the message instantly via `BroadcastChannel`.
   - Giant text updates on Glove screen, simulated 16x2 LCD displays `I'LL GET YOU` / `SOME WATER.`, and the haptic ring pulses with the vibration pattern.
   - Tab 2 automatically sends back an ACK.
   - **Tab 1** updates delivery badge to `✓ Delivered to Screen`.

---

## 7. Test Verification Checklist

Run `npm test` to execute automated test suites covering:
- [x] Official recognition event parsing (`>>> RECOGNIZED: SIGN <<<`)
- [x] Repeated-sign handling (identical event spoken every time)
- [x] Suppression of un-delimited diagnostics (`RECOGNIZED: OKAY` / `NONE`)
- [x] Chunk-boundary tolerance (arbitrary split points in serial chunks)
- [x] Mixed line endings (`\r\n`, `\n`, `\r`)
- [x] Live sensor diagnostic block parsing without creating conversation entries
- [x] Startup banner detection for both Sketch A and Sketch B
- [x] 16x2 LCD word-wrapping and long-phrase truncation
- [x] Vibration pattern classification for replies and emergency alerts
- [x] Outgoing command safety validation (preventing collisions with single-key firmware controls)
