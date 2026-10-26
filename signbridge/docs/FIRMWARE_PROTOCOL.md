# SignBridge Firmware Protocol Specification & Integration Guide

## 1. Why Existing Firmware Cannot Receive Arbitrary Serial Text

In both existing sketches:
- **Sketch A** (`glove_calibration.ino`)
- **Sketch B** (`motion_gestures.ino`)

The serial input loop is implemented as follows:

```cpp
void handleSerial() {
  while (Serial.available()) {
    char command = Serial.read();
    if (command >= '1' && command < '1' + NUM_GESTURES) {
      trainGesture(command - '1');  // BLOCKING training routine
    } else if (command == 'c' || command == 'C') {
      calibrateStraight();
    } else if (command == 'p' || command == 'P') {
      liveOutput = !liveOutput;
    } else if (command == 'X') {
      // DANGER: ERASES ALL TRAINED GESTURES IN FLASH!
      memset(trainedMasks, 255, sizeof(trainedMasks));
      saveTraining();
    }
  }
}
```

### The Conflict:
If a web application sends plain text like `"PLEASE_WAIT"`, `"I'LL_HEAT_IT"`, or `"NO_PROBLEM"`:
1. The character `'1'` triggers training mode and blocks `loop()`!
2. The character `'c'` triggers sensor recalibration!
3. **Most critically, the uppercase letter `'X'` instantly erases all trained gesture masks from NVS Flash memory!**

Therefore, sending arbitrary incoming text over serial without framing and protocol isolation would corrupt the glove.

---

## 2. Proposed Safe Framed Command Format

To safely distinguish web application commands from the single-key Arduino IDE terminal keys, all incoming web messages must start with the tilde prefix `~` and end with a newline `\n`.

### Command Syntax:
```text
~MSG|<ID>|<VIB>|<LINE1>|<LINE2>\n
```

### Field Definitions:
| Field | Type | Description | Example |
|---|---|---|---|
| `~` | Prefix | Framing delimiter distinguishing incoming packets from single-char commands | `~` |
| `MSG` | Opcode | Message display & haptic command | `MSG` |
| `<ID>` | Alphanumeric (4 chars) | Transaction ID for confirmation acknowledgment | `A7K2` |
| `<VIB>` | String | Vibration pattern code (`ACK`, `YES`, `NO`, `MSG`, `URGENT`) | `YES` |
| `<LINE1>` | ASCII (Max 16 chars) | Top line text for 16x2 LCD display | `COLD OR ROOM` |
| `<LINE2>` | ASCII (Max 16 chars) | Bottom line text for 16x2 LCD display | `TEMP WATER?` |

---

## 3. Firmware Acknowledgment (ACK)

When the ESP32 receives, parses, and displays the message, it replies over USB serial:

```text
ACK|<ID>\n
```

Example:
```text
ACK|A7K2\n
```

The SignBridge web app's parser immediately detects this line and changes the delivery badge in the conversation log from `Delivered to Screen` to `✓✓ Hardware ACK`.

---

## 4. Suggested Vibration Motor Patterns

Hardware: Connect a transistor/MOSFET driver for a small 3V disc vibration motor to an unused digital GPIO (e.g., **GPIO 26** or **GPIO 27**).

| VIB Code | Timing Sequence (ms) | Sensation | Use Case |
|---|---|---|---|
| `ACK` | `[150]` | 1 brief tap | Simple acknowledgment / confirmation |
| `YES` | `[150, 150, 150]` | 2 short pulses | Affirmative ("Yes", "Understood") |
| `NO` | `[800]` | 1 sustained buzz | Negative ("No", "Cannot do that") |
| `MSG` | `[150, 150, 150, 150, 150]` | 3 distinct pulses | Standard incoming reply from partner |
| `URGENT`| `[500, 120, 150, 120, 500, ...]` | Pulsing siren rhythm | Emergency, pain, or doctor requests |

---

## 5. Ready-to-Paste C++ Implementation for ESP32

Add these additions to `glove_calibration.ino`:

```cpp
// -------------------------------------------------------------
// 1. HARDWARE PIN DEFINITIONS
// -------------------------------------------------------------
#define VIB_MOTOR_PIN 26 // Connect gate/base of vibration motor driver

// -------------------------------------------------------------
// 2. NON-BLOCKING HAPTIC ENGINE
// -------------------------------------------------------------
struct VibrationSequence {
  uint16_t pulses[8];
  uint8_t count;
  uint8_t index;
  uint32_t stepTime;
  bool state;
  bool active;
};

VibrationSequence vibEngine = { {0}, 0, 0, 0, false, false };

void startVibrationPattern(const char* code) {
  vibEngine.active = false;
  digitalWrite(VIB_MOTOR_PIN, LOW);

  if (strcmp(code, "ACK") == 0) {
    vibEngine.pulses[0] = 150;
    vibEngine.count = 1;
  } else if (strcmp(code, "YES") == 0) {
    vibEngine.pulses[0] = 150; vibEngine.pulses[1] = 150; vibEngine.pulses[2] = 150;
    vibEngine.count = 3;
  } else if (strcmp(code, "NO") == 0) {
    vibEngine.pulses[0] = 800;
    vibEngine.count = 1;
  } else if (strcmp(code, "URGENT") == 0) {
    vibEngine.pulses[0] = 500; vibEngine.pulses[1] = 120; vibEngine.pulses[2] = 500; vibEngine.pulses[3] = 120;
    vibEngine.count = 4;
  } else { // "MSG" default
    vibEngine.pulses[0] = 150; vibEngine.pulses[1] = 150; vibEngine.pulses[2] = 150;
    vibEngine.pulses[3] = 150; vibEngine.pulses[4] = 150;
    vibEngine.count = 5;
  }

  vibEngine.index = 0;
  vibEngine.state = true;
  vibEngine.stepTime = millis();
  vibEngine.active = true;
  digitalWrite(VIB_MOTOR_PIN, HIGH);
}

void updateVibrationEngine() {
  if (!vibEngine.active) return;
  uint32_t now = millis();
  if (now - vibEngine.stepTime >= vibEngine.pulses[vibEngine.index]) {
    vibEngine.index++;
    if (vibEngine.index >= vibEngine.count) {
      vibEngine.active = false;
      digitalWrite(VIB_MOTOR_PIN, LOW);
      return;
    }
    vibEngine.state = !vibEngine.state;
    digitalWrite(VIB_MOTOR_PIN, vibEngine.state ? HIGH : LOW);
    vibEngine.stepTime = now;
  }
}

// -------------------------------------------------------------
// 3. FRAMED SERIAL COMMAND PARSER
// -------------------------------------------------------------
char serialRxBuf[96];
uint8_t rxIndex = 0;

void processFramedPacket(char* packet) {
  // Expected: ~MSG|<ID>|<VIB>|<LINE1>|<LINE2>
  if (strncmp(packet, "~MSG|", 5) != 0) return;

  char* id = strtok(packet + 5, "|");
  char* vib = strtok(NULL, "|");
  char* l1 = strtok(NULL, "|");
  char* l2 = strtok(NULL, "|");

  if (!id || !vib) return;

  // 1. Update 16x2 LCD
  if (lcdOK) {
    lcdWire.beginTransmission(0x27);
    // Write Line 1 & Line 2 formatted to 16 cols
    lcdPrint(0, l1 ? l1 : "");
    lcdPrint(1, l2 ? l2 : "");
  }

  // 2. Trigger Haptic Motor
  startVibrationPattern(vib);

  // 3. Send physical Acknowledgment back to Web App
  Serial.printf("ACK|%s\n", id);
}

// -------------------------------------------------------------
// 4. INTEGRATE INTO handleSerial()
// -------------------------------------------------------------
void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();

    if (c == '~' || rxIndex > 0) {
      // Packet receiving mode
      if (c == '\n' || c == '\r') {
        serialRxBuf[rxIndex] = '\0';
        if (rxIndex > 0) processFramedPacket(serialRxBuf);
        rxIndex = 0;
      } else if (rxIndex < sizeof(serialRxBuf) - 1) {
        serialRxBuf[rxIndex++] = c;
      }
      continue;
    }

    // Existing single-character development commands
    if (c >= '1' && c < '1' + NUM_GESTURES) {
      trainGesture(c - '1');
    } else if (c == 'c' || c == 'C') {
      calibrateStraight();
    } else if (c == 'p' || c == 'P') {
      liveOutput = !liveOutput;
      Serial.printf("Live readings: %s\n", liveOutput ? "ON" : "OFF");
    } else if (c == 'X') {
      // Erase training
      memset(trainedMasks, 255, sizeof(trainedMasks));
      saveTraining();
    }
  }
}
```
