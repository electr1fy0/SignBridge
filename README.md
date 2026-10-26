# SignBridge · Two-Way IoT Assistive Sign Language Communication System

An accessible, real-time assistive communication platform bridging sign language glove users and verbal communication partners.

Combines ESP32 microcontroller firmware (flex sensors, 6-axis MPU6500 IMU, 16x2 I2C LCD, and haptic vibration feedback) with a zero-dependency Web Serial and Web Speech web application.

---

## 🌟 Architecture Overview

```
                      ┌─────────────────────────────────────────┐
                      │            ESP32 SMART GLOVE            │
                      │  • 5x ADC Flex Sensors (Fingers)        │
                      │  • 1x MPU6500 6-Axis IMU (Motion)       │
                      │  • 1x 16x2 LCD (PCF8574 Backpack)       │
                      │  • 1x Vibration Motor (Haptic Feedback) │
                      └────────────────────┬────────────────────┘
                                           │
                                  USB Serial (115200)
                                           │
                      ┌────────────────────▼────────────────────┐
                      │         SIGNBRIDGE WEB APPLICATION      │
                      │  • Web Serial API (Direct ESP32 link)   │
                      │  • Speech Synthesis (English Voice Out) │
                      │  • Dual-Role Dashboards (Partner/Glove) │
                      │  • Contextual 1-Click Quick Replies     │
                      │  • Cross-Tab & Cross-Device LAN Sync    │
                      └─────────────────────────────────────────┘
```

---

## 📁 Repository Structure

```
├── glove_calibration.ino          # Sketch A: Difference-based 5-finger bend calibration & recognition
├── motion_gestures.ino            # Sketch B: 3D motion-based gesture detection (MPU6500 IMU)
├── signbridge/                    # Web Application
│   ├── docs/
│   │   └── FIRMWARE_PROTOCOL.md   # Firmware protocol & copy-paste ESP32 C++ additions
│   ├── public/
│   │   ├── css/index.css          # Design system, accessible high-contrast UI, LCD preview
│   │   ├── js/
│   │   │   ├── app.js             # Master controller & UI orchestration
│   │   │   ├── comm.js            # BroadcastChannel + SSE cross-tab / LAN messaging
│   │   │   ├── parser.js          # Streaming serial parser with noise delimiter isolation
│   │   │   ├── phrases.js         # Contextual scenario library (Cafe, Travel, Hospital, etc.)
│   │   │   ├── protocol.js        # 16x2 LCD word-wrapping & haptic pulse builder
│   │   │   ├── serial.js          # Web Serial API manager (115200 baud)
│   │   │   ├── signs.js           # Gesture dictionaries (Sketch A & B)
│   │   │   └── tts.js             # Web Speech API controller
│   │   └── index.html             # Accessible, semantic UI layout
│   ├── test/
│   │   ├── parser.test.js         # 14 unit tests for streaming serial parser
│   │   └── protocol.test.js       # 4 unit tests for LCD formatter & protocol
│   ├── package.json               # Zero external dependencies; Node test runner
│   ├── server.js                  # Lightweight HTTP & SSE synchronization server (Port 3050)
│   └── README.md                  # Web app specific documentation
└── README.md                      # Project documentation
```

---

## 🚀 Quick Start

### 1. Requirements
- **Node.js 18+**
- **Google Chrome** or **Microsoft Edge** (for Web Serial USB hardware access)
- **ESP32 Development Board** (connected via USB)

### 2. Run the Web App
```bash
cd signbridge

# Run automated test suite (18 unit tests)
npm test

# Launch local server
npm start
```
Open your browser at:
👉 **`http://localhost:3050`**

---

## 🧤 Firmware Sketches

### Sketch A — Finger-Based Gestures (`glove_calibration.ino`)
- **Hardware:** 5 Flex Sensors (ADC) + MPU6500 (I2C0: GPIO 21/22) + 16x2 LCD (I2C1: GPIO 18/19).
- **Detection:** Difference-based delta thresholding with per-sensor calibration and hysteresis.
- **Signs:** `OKAY` (11000), `WATER` (10001), `TWO` (10011), `THREE` (00011), `FOUR` (10000), `SEVEN` (10010).

### Sketch B — Dynamic Motion Gestures (`motion_gestures.ino`)
- **Hardware:** MPU6500 6-axis accelerometer & gyroscope on open flat hand.
- **Detection:** Dynamic pitch/roll tilt, continuous shake/wave integration, and directional velocity matching.
- **Signs:** `HELLO`, `BYE`, `THANK YOU`, `PLEASE`, `HAPPY`, `COME HERE`, `SLOW DOWN`, `FINISHED`.

---

## 📡 Serial Protocol & Safety

### Serial Monitor controls

Open Serial Monitor at **115200 baud**. Both sketches now print sensor readings
every 700 ms after startup calibration. Send `p` to pause or resume the stream.

| Command | `glove_calibration.ino` | `motion_gestures.ino` |
|---|---|---|
| `p` | Toggle flex, delta, bend pattern, acceleration, and gyro readings | Toggle acceleration and gyro readings |
| `d` | Not used | Toggle gesture match scores; lower means a closer match |
| `s` | Show saved gesture training | Show saved gesture training |
| `c` | Recalibrate straight fingers | Recalibrate the flat, still hand |

Acceleration is printed in m/s² and gyro readings in degrees/second. Live
readings start ON; motion match-score debug starts OFF. These toggles are
independent and reset to their defaults after a restart. The web app's
**Toggle Live Stream ('p')** button works with either updated sketch.

Flash only one sketch at a time. In Arduino IDE, keep each `.ino` in its own
same-named sketch folder so the two sketches are not compiled together.

SignBridge parses streaming serial output with strict delimiter isolation:
- **Recognition Event:** `>>> RECOGNIZED: SIGN_NAME <<<`
  - Immediately translates to natural English.
  - Automatically speaks aloud via Web Speech API.
  - Generates contextual reply suggestions for the partner.
- **Diagnostic Telemetry:** `FLEX (...)`, `ACC (...)`, `GYRO (...)`, `STATUS (...)`
  - Live sensor stream is filtered into diagnostics and never triggers unwanted speech.
- **Safe Outgoing Commands:** Outgoing replies from the web app use safe framing (`~MSG|...`) to never accidentally trigger ESP32 training (`'1'`–`'8'`) or flash erase (`'X'`).
- See [signbridge/docs/FIRMWARE_PROTOCOL.md](signbridge/docs/FIRMWARE_PROTOCOL.md) for complete protocol specification and copy-paste ESP32 C++ handler code.

---

## ♿ Accessibility & UX Highlights
- Built according to WCAG 2.2 AA/AAA guidelines with Atkinson Hyperlegible typography.
- Scalable SVG iconography and high contrast color palette.
- Simulated 16x2 LCD dot-matrix preview and haptic vibration rhythm visualizer.
- Zero external client runtime libraries.
