#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <math.h>

// ======================================
// HARDWARE
// ======================================

// Pin on each finger (as worn on the glove):
// THUMB=33, INDEX=35, MIDDLE=25, RING=34, PINKY=32
const int flexPins[5] = {33, 35, 25, 34, 32};
const char* fingerNames[5] = {"THUMB", "INDEX", "MIDDLE", "RING", "PINKY"};

#define MPU_ADDR 0x68
#define MPU_SDA 21
#define MPU_SCL 22

#define LCD_SDA 18
#define LCD_SCL 19

TwoWire lcdWire(1);
Preferences prefs;

// ======================================
// FLEX SENSOR SETTINGS
// ======================================

// Per-finger thresholds (change from straight).
// Order: THUMB, INDEX, MIDDLE, RING, PINKY
// THUMB  pin 33: ~250-430 on glove -> 150
// INDEX  pin 35: ~157 on table     -> 100
// MIDDLE pin 25: currently reads 0 (sensor/wire fault)
// RING   pin 34: ~213-289          -> 130
// PINKY  pin 32: ~218 on table     -> 110
// Thresholds sit above the ~80 "pull" from neighbouring fingers.

const int BEND_ON[5] = {
  150, 100, 100, 130, 110
};

const int BEND_OFF[5] = {
  100, 65, 65, 85, 70
};

float baseline[5] = {};
float filtered[5] = {};
int rawFlex[5] = {};
int deltaFlex[5] = {};

bool bent[5] = {};

uint8_t currentMask = 0;

// ======================================
// GESTURE SETTINGS
// ======================================

const int NUM_GESTURES = 6;

// Every sign here keeps the MIDDLE finger straight.
// Patterns are THUMB INDEX MIDDLE RING PINKY (1 = bent).
const char* phrases[NUM_GESTURES] = {
  "OKAY",    // 1: thumb + index circle, 3 fingers up        (11000)
  "WATER",   // 2: thumb holds pinky, 3 fingers up ("W")     (10001)
  "TWO",     // 3: index + middle up ("V" / peace)           (10011)
  "THREE",   // 4: thumb, index, middle out                  (00011)
  "FOUR",    // 5: 4 fingers up, thumb folded in             (10000)
  "SEVEN"    // 6: thumb touches ring tip, others up         (10010)
};

// The pattern each sign SHOULD give (T I M R P).
// Training is refused if the glove sees something else,
// so a wrong pattern can never be saved by accident.
const char* expectedPatterns[NUM_GESTURES] = {
  "11000",   // OKAY
  "10001",   // WATER
  "10011",   // TWO
  "00011",   // THREE
  "10000",   // FOUR
  "10010"    // SEVEN
};

// 1 = ignore the middle finger (always "straight").
// Use while the middle sensor's wire is loose, so its
// flickering can't break the signs. Set to 0 once fixed.
#define IGNORE_MIDDLE 1

// 255 means not trained.
// Other values represent 5-bit masks.

uint8_t trainedMasks[NUM_GESTURES];

// Recognition stability
const int REQUIRED_STABLE = 8;

int candidate = -1;
int recognized = -1;
int stableCount = 0;

// ======================================
// LCD OUTPUT SETTINGS
// ======================================

// 1 = clean output (translation only)
// 0 = debug output (also shows finger pattern)
#define DEMO_MODE 1

// How long the translation stays on screen
// after you relax your hand (milliseconds)
const unsigned long HOLD_TEXT_MS = 3000;

int lastShown = -1;
unsigned long lastShownTime = 0;

// ======================================
// MPU6500
// ======================================

bool mpuOK = false;

float ax = 0, ay = 0, az = 0;
float gx = 0, gy = 0, gz = 0;
float gyroMagnitude = 0;

// ======================================
// LCD
// ======================================

bool lcdOK = false;
uint8_t lcdAddress = 0;

// Set when an LCD write fails (loose wire glitch).
// The LCD is then restarted automatically.
bool lcdError = false;

// The LCD is also quietly restarted every few seconds,
// so a scrambled screen fixes itself.
const unsigned long LCD_REFRESH_MS = 10000;
unsigned long lastLCDReinit = 0;

// ======================================
// TIMING
// ======================================

unsigned long lastSample = 0;
unsigned long lastLCD = 0;
unsigned long lastSerial = 0;
unsigned long lastMPURetry = 0;

// Live sensor printing in Serial Monitor.
// ON by default so sensor values appear immediately after calibration.
// Type p + Enter to switch it on/off.
bool liveOutput = true;

// ======================================
// MPU REGISTER FUNCTIONS
// ======================================

bool mpuWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(value);

  return Wire.endTransmission() == 0;
}

int mpuReadRegister(uint8_t reg) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);

  if (Wire.endTransmission(false) != 0) {
    return -1;
  }

  if (Wire.requestFrom(
        (uint8_t)MPU_ADDR,
        (uint8_t)1) != 1) {
    return -1;
  }

  return Wire.read();
}

bool initMPU() {
  int id = mpuReadRegister(0x75);

  if (id < 0) {
    Serial.println("MPU communication failed");
    return false;
  }

  Serial.printf("WHO_AM_I: 0x%02X\n", id);

  if (id != 0x70 && id != 0x68) {
    Serial.println("Unsupported MPU chip");
    return false;
  }

  if (!mpuWrite(0x6B, 0x00)) return false;

  delay(100);

  if (!mpuWrite(0x1C, 0x00)) return false;
  if (!mpuWrite(0x1B, 0x00)) return false;
  if (!mpuWrite(0x1A, 0x03)) return false;

  Serial.println("MPU6500 READY");
  return true;
}

bool readMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);

  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  if (Wire.requestFrom(
        (uint8_t)MPU_ADDR,
        (uint8_t)14) != 14) {
    return false;
  }

  int16_t data[7];

  for (int i = 0; i < 7; i++) {
    uint8_t high = Wire.read();
    uint8_t low = Wire.read();

    data[i] = (int16_t)((high << 8) | low);
  }

  ax = data[0] / 16384.0f * 9.80665f;
  ay = data[1] / 16384.0f * 9.80665f;
  az = data[2] / 16384.0f * 9.80665f;

  // data[3] is temperature

  gx = data[4] / 131.0f;
  gy = data[5] / 131.0f;
  gz = data[6] / 131.0f;

  gyroMagnitude = sqrtf(
    gx * gx + gy * gy + gz * gz
  );

  return true;
}

// ======================================
// LCD FUNCTIONS
// ======================================

void lcdExpanderWrite(uint8_t data) {
  lcdWire.beginTransmission(lcdAddress);
  lcdWire.write(data | 0x08);
  if (lcdWire.endTransmission() != 0) {
    lcdError = true;
  }
}

void lcdNibble(uint8_t nibble, bool rs) {
  uint8_t data =
    (nibble << 4) | (rs ? 0x01 : 0);

  lcdExpanderWrite(data);
  delayMicroseconds(2);

  lcdExpanderWrite(data | 0x04);
  delayMicroseconds(2);

  lcdExpanderWrite(data);
  delayMicroseconds(100);
}

void lcdSend(uint8_t value, bool rs) {
  lcdNibble(value >> 4, rs);
  lcdNibble(value & 0x0F, rs);
}

void lcdCommand(uint8_t cmd) {
  lcdSend(cmd, false);

  if (cmd == 0x01 || cmd == 0x02) {
    delay(2);
  }
}

void lcdLine(int row, const char* text) {
  if (!lcdOK) return;

  lcdCommand(row == 0 ? 0x80 : 0xC0);

  char buffer[17];

  snprintf(
    buffer,
    sizeof(buffer),
    "%-16.16s",
    text
  );

  for (int i = 0; i < 16; i++) {
    lcdSend(buffer[i], true);
  }
}

bool initLCDEx(bool showSplash) {
  lcdAddress = 0;
  lcdError = false;

  for (uint8_t addr = 0x20; addr <= 0x3F; addr++) {
    lcdWire.beginTransmission(addr);

    if (lcdWire.endTransmission() == 0) {
      lcdAddress = addr;
      break;
    }
  }

  if (lcdAddress == 0) {
    Serial.println("LCD not detected");
    return false;
  }

  delay(50);

  lcdNibble(0x03, false);
  delay(5);

  lcdNibble(0x03, false);
  delayMicroseconds(150);

  lcdNibble(0x03, false);
  delayMicroseconds(150);

  lcdNibble(0x02, false);

  lcdCommand(0x28);
  lcdCommand(0x08);
  lcdCommand(0x01);
  lcdCommand(0x06);
  lcdCommand(0x0C);

  lcdOK = true;

  if (showSplash) {
    lcdLine(0, "SIGN LANG GLOVE");
    lcdLine(1, "INITIALIZING...");

    Serial.printf(
      "LCD READY: 0x%02X\n",
      lcdAddress
    );
  }

  return true;
}

bool initLCD() {
  return initLCDEx(true);
}

// ======================================
// READ FLEX SENSORS
// ======================================

int readFlexPin(int pin) {
  // Discard first ADC reading
  analogRead(pin);

  long total = 0;

  for (int i = 0; i < 4; i++) {
    total += analogRead(pin);
  }

  return total / 4;
}

void readFlexSensors() {
  currentMask = 0;

  for (int i = 0; i < 5; i++) {
    rawFlex[i] = readFlexPin(flexPins[i]);

    // Exponential smoothing
    filtered[i] =
      filtered[i] * 0.65f +
      rawFlex[i] * 0.35f;

    // Difference from straight position.
    // Bending makes the reading go UP, so only
    // increases count. Small dips from touching
    // neighbouring sensors are ignored.
    deltaFlex[i] =
      (int)(filtered[i] - baseline[i]);
    if (deltaFlex[i] < 0) deltaFlex[i] = 0;

    // Hysteresis
    if (!bent[i]) {
      if (deltaFlex[i] >= BEND_ON[i]) {
        bent[i] = true;
      }
    } else {
      if (deltaFlex[i] <= BEND_OFF[i]) {
        bent[i] = false;
      }
    }

#if IGNORE_MIDDLE
    if (i == 2) bent[i] = false;   // middle finger ignored
#endif

    if (bent[i]) {
      currentMask |= (1 << i);
    }
  }
}

// ======================================
// BASELINE CALIBRATION
// ======================================

void calibrateStraight() {
  Serial.println();
  Serial.println("================================");
  Serial.println("STRAIGHT-FINGER CALIBRATION");
  Serial.println("Keep all five fingers straight!");
  Serial.println("================================");

  lcdLine(0, "CALIBRATING...");
  lcdLine(1, "FINGERS STRAIGHT");

  delay(2000);

  long sums[5] = {};

  // Collect 40 readings
  for (int sample = 0; sample < 40; sample++) {
    for (int i = 0; i < 5; i++) {
      sums[i] += readFlexPin(flexPins[i]);
    }

    delay(25);
  }

  currentMask = 0;

  for (int i = 0; i < 5; i++) {
    baseline[i] = sums[i] / 40.0f;

    filtered[i] = baseline[i];
    rawFlex[i] = (int)baseline[i];
    deltaFlex[i] = 0;
    bent[i] = false;

    Serial.printf(
      "%-6s (pin %d) baseline: %.0f\n",
      fingerNames[i],
      flexPins[i],
      baseline[i]
    );
  }

  candidate = -1;
  recognized = -1;
  stableCount = 0;

  Serial.println("CALIBRATION COMPLETE");

  lcdLine(0, "CALIBRATION OK");
  lcdLine(1, "READY");

  delay(1000);
}

// ======================================
// PATTERN HELPERS
// ======================================

void maskToText(uint8_t mask, char out[6]) {
  for (int i = 0; i < 5; i++) {
    out[i] = (mask & (1 << i)) ? '1' : '0';
  }

  out[5] = '\0';
}

int trainedCount() {
  int count = 0;

  for (int i = 0; i < NUM_GESTURES; i++) {
    if (trainedMasks[i] != 255) {
      count++;
    }
  }

  return count;
}

// ======================================
// SAVE / LOAD TRAINING
// ======================================

void saveTraining() {
  size_t written = prefs.putBytes(
    "patterns",
    trainedMasks,
    sizeof(trainedMasks)
  );

  if (written == sizeof(trainedMasks)) {
    Serial.println("Patterns saved to flash");
  } else {
    Serial.println("ERROR: Could not save patterns");
  }
}

void loadTraining() {
  size_t savedLen = prefs.getBytesLength("patterns");

  if (savedLen > 0 && savedLen <= sizeof(trainedMasks)) {

    // Older saves may hold fewer signs; new slots start empty
    memset(trainedMasks, 255, sizeof(trainedMasks));

    prefs.getBytes(
      "patterns",
      trainedMasks,
      savedLen
    );

    Serial.println("Saved patterns loaded");

    // Forget any saved sign whose pattern is wrong
    for (int g = 0; g < NUM_GESTURES; g++) {
      if (trainedMasks[g] == 255) continue;
      char bits[6];
      maskToText(trainedMasks[g], bits);
      if (strcmp(bits, expectedPatterns[g]) != 0) {
        Serial.printf("Removed wrong saved pattern for %s (%s)\n",
                      phrases[g], bits);
        trainedMasks[g] = 255;
      }
    }

  } else {
    memset(trainedMasks, 255,
           sizeof(trainedMasks));

    Serial.println("No saved patterns");
  }
}

void showTrainingStatus() {
  Serial.println();
  Serial.println("===== TRAINED GESTURES =====");

  for (int i = 0; i < NUM_GESTURES; i++) {
    if (trainedMasks[i] == 255) {
      Serial.printf(
        "%d. %-12s NOT TRAINED\n",
        i + 1,
        phrases[i]
      );
    } else {
      char bits[6];
      maskToText(trainedMasks[i], bits);

      Serial.printf(
        "%d. %-12s %s\n",
        i + 1,
        phrases[i],
        bits
      );
    }
  }

  Serial.println("============================");
}

// ======================================
// TRAIN A GESTURE
// ======================================

void trainGesture(int gesture) {
  Serial.println();
  Serial.printf(
    "TRAINING: %s\n",
    phrases[gesture]
  );

  Serial.println("Hold the gesture steady...");
  Serial.println("Measuring now - keep holding!");

  lcdLine(0, "TRAINING:");
  lcdLine(1, phrases[gesture]);

  // Give sensor filter time to settle
  delay(500);

  // Collect repeated binary patterns
  uint8_t samples[12];

  for (int i = 0; i < 12; i++) {
    readFlexSensors();
    samples[i] = currentMask;
    delay(70);
  }

  // Find the most common pattern
  uint8_t bestMask = 0;
  int bestCount = 0;

  for (int i = 0; i < 12; i++) {
    int count = 0;

    for (int j = 0; j < 12; j++) {
      if (samples[i] == samples[j]) {
        count++;
      }
    }

    if (count > bestCount) {
      bestCount = count;
      bestMask = samples[i];
    }
  }

  char bits[6];
  maskToText(bestMask, bits);

  Serial.printf(
    "Detected pattern: %s\n",
    bits
  );

  // Require the same pattern in at least
  // 10 of the 12 samples.
  if (bestCount < 10) {
    Serial.println(
      "FAILED: Finger pattern not stable"
    );

    lcdLine(0, "TRAINING FAILED");
    lcdLine(1, "HOLD HAND STILL");

    return;
  }

  // Compare with the pattern this sign should give
  char expected[6];
  strncpy(expected, expectedPatterns[gesture], 6);
  expected[5] = '\0';

  if (strcmp(bits, expected) != 0) {
    Serial.printf("NOT SAVED: expected %s, glove saw %s\n",
                  expected, bits);

    for (int i = 0; i < 5; i++) {
      if (bits[i] != expected[i]) {
        Serial.printf("  %-6s should be %s, but reads %s (DELTA %d, needs %d)\n",
                      fingerNames[i],
                      expected[i] == '1' ? "BENT" : "STRAIGHT",
                      bits[i] == '1' ? "BENT" : "STRAIGHT",
                      deltaFlex[i], BEND_ON[i]);
      }
    }

    lcdLine(0, "WRONG SHAPE");
    lcdLine(1, "SEE SERIAL");
    delay(1000);
    return;
  }

  // All-straight is treated as idle.
  if (bestMask == 0) {
    Serial.println(
      "FAILED: No fingers bent"
    );

    lcdLine(0, "TRAINING FAILED");
    lcdLine(1, "BEND A FINGER");

    return;
  }

  // Prevent duplicate patterns
  for (int i = 0; i < NUM_GESTURES; i++) {
    if (i != gesture &&
        trainedMasks[i] == bestMask) {

      Serial.printf(
        "FAILED: Same pattern already "
        "used by %s\n",
        phrases[i]
      );

      lcdLine(0, "DUPLICATE POSE");
      lcdLine(1, "TRY ANOTHER");

      return;
    }
  }

  trainedMasks[gesture] = bestMask;

  saveTraining();

  candidate = -1;
  recognized = -1;
  stableCount = 0;

  Serial.printf(
    "SUCCESS: %s = %s\n",
    phrases[gesture],
    bits
  );

  lcdLine(0, "GESTURE SAVED");
  lcdLine(1, phrases[gesture]);

  delay(800);
}

// ======================================
// RECOGNITION
// ======================================

int matchGesture(uint8_t mask) {
  // No fingers bent = idle state
  if (mask == 0) return -1;

  for (int i = 0; i < NUM_GESTURES; i++) {
    if (trainedMasks[i] == mask) {
      return i;
    }
  }

  return -1;
}

void recognizeGesture() {
  int newCandidate = matchGesture(currentMask);

  // Ignore rapid hand movement when the
  // motion sensor is available.
  if (mpuOK && gyroMagnitude > 40.0f) {
    newCandidate = -1;
  }

  if (newCandidate != candidate) {
    candidate = newCandidate;
    stableCount = candidate >= 0 ? 1 : 0;
    recognized = -1;

  } else if (candidate >= 0) {
    if (stableCount < REQUIRED_STABLE) {
      stableCount++;
    }
  }

  if (candidate >= 0 &&
      stableCount >= REQUIRED_STABLE) {

    if (recognized != candidate) {
      recognized = candidate;
      lastShown = recognized;
      lastShownTime = millis();

      Serial.println();
      Serial.printf(
        ">>> RECOGNIZED: %s <<<\n",
        phrases[recognized]
      );
    }
  }
}

// ======================================
// LCD DISPLAY
// ======================================

// Print text centered on one LCD row
void lcdCentered(int row, const char* text) {
  char line[17];
  int len = strlen(text);
  if (len > 16) len = 16;
  int pad = (16 - len) / 2;
  snprintf(line, sizeof(line), "%*s%.*s", pad, "", len, text);
  lcdLine(row, line);
}

// Show a phrase on the LCD.
// Up to 16 letters: one centered line.
// Longer (max 32): split at a space onto 2 lines.
void lcdPhrase(const char* text, const char* secondRow) {
  int len = strlen(text);

  if (len <= 16) {
    lcdCentered(0, text);
    lcdCentered(1, secondRow);
    return;
  }

  // Find the space closest to the middle
  int split = -1;
  for (int i = 0; i < len; i++) {
    if (text[i] == ' ' && i <= 16 && len - i - 1 <= 16) {
      if (split < 0 || abs(i - len / 2) < abs(split - len / 2)) {
        split = i;
      }
    }
  }

  char top[17], bottom[17];
  if (split < 0) split = 16;   // no good space: hard cut
  snprintf(top, sizeof(top), "%.*s", split, text);
  snprintf(bottom, sizeof(bottom), "%s",
           text + split + (text[split] == ' ' ? 1 : 0));

  lcdCentered(0, top);
  lcdCentered(1, bottom);
}

void updateLCD() {
  if (!lcdOK) return;

  char info[17] = "";
  char bits[6];
  maskToText(currentMask, bits);

#if !DEMO_MODE
  snprintf(info, sizeof(info), "B:%s MPU:%s",
           bits, mpuOK ? "OK" : "NO");
#endif

  // Currently recognized, or recently recognized:
  // show the translation
  bool recent = lastShown >= 0 &&
                millis() - lastShownTime < HOLD_TEXT_MS;

  if (recognized >= 0) {
    lastShownTime = millis();   // keep it fresh while held
    lcdPhrase(phrases[recognized], info);

  } else if (recent) {
    lcdPhrase(phrases[lastShown], info);

  } else if (trainedCount() == 0) {
    lcdCentered(0, "TRAIN GESTURES");
    lcdCentered(1, DEMO_MODE ? "" : info);

  } else {
    lcdCentered(0, "SHOW A SIGN...");
    lcdCentered(1, DEMO_MODE ? "" : info);
  }
}

// ======================================
// SERIAL OUTPUT
// ======================================

void printReadings() {
  char bits[6];
  maskToText(currentMask, bits);

  Serial.println("--------------------------------");

  Serial.printf(
    "FLEX  (T I M R P): %d | %d | %d | %d | %d\n",
    rawFlex[0], rawFlex[1],
    rawFlex[2], rawFlex[3], rawFlex[4]
  );

  Serial.printf(
    "DELTA (T I M R P): %d | %d | %d | %d | %d\n",
    deltaFlex[0], deltaFlex[1],
    deltaFlex[2], deltaFlex[3],
    deltaFlex[4]
  );

  Serial.printf("BENT PATTERN: %s\n", bits);

  if (mpuOK) {
    Serial.printf(
      "ACC: X=%.2f Y=%.2f Z=%.2f\n",
      ax, ay, az
    );

    Serial.printf(
      "GYRO: X=%.2f Y=%.2f Z=%.2f\n",
      gx, gy, gz
    );
  }

  if (recognized >= 0) {
    Serial.printf(
      "RECOGNIZED: %s\n",
      phrases[recognized]
    );
  } else {
    Serial.println("RECOGNIZED: NONE");
  }

  Serial.printf(
    "STATUS: MPU=%s LCD=%s\n",
    mpuOK ? "OK" : "FAIL",
    lcdOK ? "OK" : "FAIL"
  );
}

// ======================================
// SERIAL COMMANDS
// ======================================

void handleSerial() {
  while (Serial.available()) {
    char command = Serial.read();

    if (command >= '1' && command < '1' + NUM_GESTURES) {
      trainGesture(command - '1');
    }

    else if (command == 'c' ||
             command == 'C') {
      calibrateStraight();
    }

    else if (command == 's' ||
             command == 'S') {
      showTrainingStatus();
    }

    else if (command == 'p' ||
             command == 'P') {
      liveOutput = !liveOutput;
      Serial.printf("Live readings: %s\n",
                    liveOutput ? "ON" : "OFF");
    }

    else if (command == 'X') {
      memset(trainedMasks, 255,
             sizeof(trainedMasks));

      saveTraining();

      candidate = -1;
      recognized = -1;
      stableCount = 0;

      Serial.println("ALL PATTERNS ERASED");
    }
  }
}

// ======================================
// SETUP
// ======================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  analogReadResolution(12);

  Wire.begin(MPU_SDA, MPU_SCL);
  Wire.setClock(100000);
  Wire.setTimeOut(100);

  lcdWire.begin(LCD_SDA, LCD_SCL);
  lcdWire.setClock(100000);
  lcdWire.setTimeOut(100);

  prefs.begin("glove2", false);   // new name: old training (old pin order) is ignored
  loadTraining();

  mpuOK = initMPU();
  lcdOK = initLCD();

  Serial.println();
  Serial.println("===============================");
  Serial.println("SIGN LANGUAGE GLOVE");
  Serial.println("DIFFERENCE-BASED DETECTION");
  Serial.println("===============================");

  Serial.println("Commands:");
  for (int g = 0; g < NUM_GESTURES; g++) {
    Serial.printf("%d = Train %-6s (%s)\n",
                  g + 1, phrases[g], expectedPatterns[g]);
  }
  Serial.println("c = Calibrate straight fingers");
  Serial.println("s = Show trained patterns");
  Serial.println("X = Erase all patterns");
  Serial.println("p = Live readings on/off");

  // Hold fingers straight during startup!
  calibrateStraight();

  showTrainingStatus();
  Serial.println("Sensor units: FLEX/DELTA=ADC counts, ACC=m/s^2, GYRO=deg/s");
  Serial.println("Live readings: ON");
}

// ======================================
// MAIN LOOP
// ======================================

void loop() {
  handleSerial();

  unsigned long now = millis();

  // Read flex sensors every 100ms
  if (now - lastSample >= 100) {
    lastSample = now;

    readFlexSensors();

    if (mpuOK) {
      if (!readMPU()) {
        mpuOK = false;
        Serial.println("MPU read failed");
      }
    }

    recognizeGesture();
  }

  // Retry MPU if disconnected
  if (!mpuOK && now - lastMPURetry >= 5000) {
    lastMPURetry = now;
    mpuOK = initMPU();
  }

  // Restart the LCD if a write failed, or every
  // LCD_REFRESH_MS, so a scrambled screen recovers.
  if (lcdError || !lcdOK ||
      now - lastLCDReinit >= LCD_REFRESH_MS) {
    lastLCDReinit = now;
    lcdOK = initLCDEx(false);
    if (lcdOK) updateLCD();   // redraw at once, no blank flash
  }

  // LCD update
  if (now - lastLCD >= 350) {
    lastLCD = now;
    updateLCD();
  }

  // Serial output
  if (liveOutput && now - lastSerial >= 700) {
    lastSerial = now;
    printReadings();
  }
}
