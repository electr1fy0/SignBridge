// =====================================================
// SIGN LANGUAGE GLOVE - MOTION-ONLY GESTURES
// Uses ONLY the MPU6500 (accelerometer + gyroscope)
// and the 16x2 LCD. Flex sensors are not used.
//
// Two kinds of gestures:
//   MOVE  - a movement, e.g. waving       (gyroscope)
//   POSE  - a held hand direction,
//           e.g. palm up                  (accelerometer)
//
// Serial Monitor: 115200 baud
//   1-8 + Enter : train that gesture (do it 3 times each)
//   c   + Enter : recalibrate (hand flat, palm down, still)
//   s   + Enter : show training status
//   d   + Enter : debug on/off (shows match scores)
//   X   + Enter : erase all training
//
// GOLDEN RULE: between signs, rest your hand FLAT,
// palm down - that is the "neutral" position.
// =====================================================

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <math.h>

// ---------------- PINS ----------------
#define MPU_ADDR 0x68
#define MPU_SDA 21
#define MPU_SCL 22
#define LCD_SDA 18
#define LCD_SCL 19

TwoWire lcdWire(1);
Preferences prefs;

// ---------------- GESTURES ----------------
// Change the words freely (max 32 letters).
// Do NOT change the MOVE/POSE type unless you
// also change how you perform the gesture.

#define MOVE 0
#define POSE 1
const int NUM_GESTURES = 8;

// Every sign here uses an OPEN, FLAT hand (all fingers
// straight = flex pattern 00000). Only the MOVEMENT differs.
const char* phrases[NUM_GESTURES] = {
  "HELLO",       // 1: flat hand at forehead, salute outward
  "BYE",         // 2: open hand, wave side to side
  "THANK YOU",   // 3: fingertips at chin, move forward-down once
  "PLEASE",      // 4: flat hand on chest, rub in a circle
  "HAPPY",       // 5: flat hand on chest, brush upward twice
  "COME HERE",   // 6: palm up, curl hand toward you 2-3 times
  "SLOW DOWN",   // 7: palm down, pat downward 2-3 times
  "FINISHED"     // 8: palm facing you, flip it to face out once
};

const uint8_t gestureType[NUM_GESTURES] = {
  MOVE, MOVE, MOVE, MOVE,
  MOVE, MOVE, MOVE, MOVE
};

// ---------------- TUNING ----------------
const int   SAMPLE_MS        = 20;    // 50 readings per second
const int   WINDOW           = 75;    // 1.5 s per movement
const int   PRE              = 10;    // readings kept from just before a movement
const float MOVE_START_DPS   = 100;   // rotation speed that starts a movement
const float STILL_DPS        = 20;    // below this the hand counts as still
const unsigned long POSE_HOLD_MS = 900;   // hold a pose this long
const float POSE_MIN_TILT    = 40;    // degrees away from flat to count as a pose
const float POSE_MAX_ERR     = 28;    // degrees: how close to a trained pose
const float MOVE_MAX_DIST    = 0.65;  // lower = stricter movement matching
const unsigned long COOLDOWN_MS  = 1200;  // pause after a movement
const unsigned long HOLD_TEXT_MS = 3000;  // how long text stays on LCD

// ---------------- TRAINING DATA ----------------
#define EXAMPLES 3
#define NF 10   // numbers stored per example

struct TrainData {
  uint32_t magic;
  uint8_t count[NUM_GESTURES];
  uint8_t next[NUM_GESTURES];
  float ex[NUM_GESTURES][EXAMPLES][NF];
};
const uint32_t MAGIC = 0x4D4F5431;  // "MOT1"
TrainData db;

// ---------------- SENSOR STATE ----------------
bool mpuOK = false;
float acc[3], gyr[3];        // latest reading (acc in g, gyro in deg/s)
float gyroBias[3] = {0, 0, 0};
float neutral[3] = {0, 0, -1};  // gravity direction with hand flat

// Readings from just before a movement starts
float preAcc[PRE][3], preGyr[PRE][3];
int preIdx = 0;

// ---------------- RECOGNITION STATE ----------------
bool debugOn = false;
bool poseArmed = true;            // must return to flat before next pose
unsigned long stillSince = 0;
unsigned long neutralSince = 0;
unsigned long cooldownUntil = 0;
float stillGrav[3] = {0, 0, 0};
int stillCount = 0;

int lastShown = -1;
unsigned long lastShownTime = 0;
unsigned long lastSample = 0;

// ---------------- LCD STATE ----------------
bool lcdOK = false;
bool lcdError = false;
uint8_t lcdAddress = 0;
unsigned long lastLCD = 0;
unsigned long lastLCDReinit = 0;

// =====================================================
// MPU6500
// =====================================================

bool mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  return Wire.endTransmission() == 0;
}

bool initMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x75);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)1) != 1) return false;
  int id = Wire.read();
  Serial.printf("WHO_AM_I: 0x%02X\n", id);
  if (id != 0x70 && id != 0x68) return false;

  if (!mpuWrite(0x6B, 0x00)) return false;   // wake up
  delay(100);
  if (!mpuWrite(0x1C, 0x00)) return false;   // accel +/-2g
  if (!mpuWrite(0x1B, 0x08)) return false;   // gyro +/-500 deg/s (fast waves)
  if (!mpuWrite(0x1A, 0x03)) return false;   // low-pass filter
  return true;
}

bool readMPU() {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)MPU_ADDR, (uint8_t)14) != 14) return false;

  int16_t r[7];
  for (int i = 0; i < 7; i++) {
    uint8_t hi = Wire.read();
    uint8_t lo = Wire.read();
    r[i] = (int16_t)((hi << 8) | lo);
  }
  for (int i = 0; i < 3; i++) {
    acc[i] = r[i] / 16384.0f;                      // in g
    gyr[i] = r[i + 4] / 65.5f - gyroBias[i];       // deg/s at +/-500
  }
  return true;
}

float gyroMag() {
  return sqrtf(gyr[0]*gyr[0] + gyr[1]*gyr[1] + gyr[2]*gyr[2]);
}

void normalize3(float v[3]) {
  float n = sqrtf(v[0]*v[0] + v[1]*v[1] + v[2]*v[2]);
  if (n < 1e-6f) return;
  for (int i = 0; i < 3; i++) v[i] /= n;
}

float angleBetween(const float a[3], const float b[3]) {
  float d = a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  d = constrain(d, -1.0f, 1.0f);
  return acosf(d) * 57.2958f;
}

// =====================================================
// LCD (with automatic recovery if it gets scrambled)
// =====================================================

void lcdExpanderWrite(uint8_t data) {
  lcdWire.beginTransmission(lcdAddress);
  lcdWire.write(data | 0x08);
  if (lcdWire.endTransmission() != 0) lcdError = true;
}

void lcdNibble(uint8_t nibble, bool rs) {
  uint8_t data = (nibble << 4) | (rs ? 0x01 : 0);
  lcdExpanderWrite(data);
  delayMicroseconds(2);
  lcdExpanderWrite(data | 0x04);
  delayMicroseconds(2);
  lcdExpanderWrite(data);
  delayMicroseconds(100);
}

void lcdSend(uint8_t v, bool rs) {
  lcdNibble(v >> 4, rs);
  lcdNibble(v & 0x0F, rs);
}

void lcdCommand(uint8_t c) {
  lcdSend(c, false);
  if (c == 0x01 || c == 0x02) delay(2);
}

void lcdLine(int row, const char* text) {
  if (!lcdOK) return;
  lcdCommand(row == 0 ? 0x80 : 0xC0);
  char buf[17];
  snprintf(buf, sizeof(buf), "%-16.16s", text);
  for (int i = 0; i < 16; i++) lcdSend(buf[i], true);
}

void lcdCentered(int row, const char* text) {
  char line[17];
  int len = strlen(text);
  if (len > 16) len = 16;
  int pad = (16 - len) / 2;
  snprintf(line, sizeof(line), "%*s%.*s", pad, "", len, text);
  lcdLine(row, line);
}

// Long phrases are split over two lines at a space
void lcdPhrase(const char* text) {
  int len = strlen(text);
  if (len <= 16) {
    lcdCentered(0, text);
    lcdCentered(1, "");
    return;
  }
  int split = -1;
  for (int i = 0; i < len; i++) {
    if (text[i] == ' ' && i <= 16 && len - i - 1 <= 16) {
      if (split < 0 || abs(i - len / 2) < abs(split - len / 2)) split = i;
    }
  }
  if (split < 0) split = 16;
  char top[17], bottom[17];
  snprintf(top, sizeof(top), "%.*s", split, text);
  snprintf(bottom, sizeof(bottom), "%s", text + split + (text[split] == ' ' ? 1 : 0));
  lcdCentered(0, top);
  lcdCentered(1, bottom);
}

bool initLCDEx(bool splash) {
  lcdAddress = 0;
  lcdError = false;
  for (uint8_t a = 0x20; a <= 0x3F; a++) {
    lcdWire.beginTransmission(a);
    if (lcdWire.endTransmission() == 0) { lcdAddress = a; break; }
  }
  if (lcdAddress == 0) return false;

  delay(50);
  lcdNibble(0x03, false); delay(5);
  lcdNibble(0x03, false); delayMicroseconds(150);
  lcdNibble(0x03, false); delayMicroseconds(150);
  lcdNibble(0x02, false);
  lcdCommand(0x28);
  lcdCommand(0x08);
  lcdCommand(0x01);
  lcdCommand(0x06);
  lcdCommand(0x0C);
  lcdOK = true;

  if (splash) {
    lcdCentered(0, "MOTION GLOVE");
    lcdCentered(1, "STARTING...");
  }
  return true;
}

bool initLCD() {
  return initLCDEx(true);
}

void updateLCD() {
  if (!lcdOK) return;
  if (lastShown >= 0 && millis() - lastShownTime < HOLD_TEXT_MS) {
    lcdPhrase(phrases[lastShown]);
  } else {
    lcdCentered(0, "SHOW A SIGN...");
    lcdCentered(1, "");
  }
}

// =====================================================
// CALIBRATION (hand flat, palm down, still)
// =====================================================

void calibrate() {
  Serial.println();
  Serial.println("CALIBRATING: hand FLAT, palm DOWN, keep STILL");
  lcdCentered(0, "HAND FLAT");
  lcdCentered(1, "KEEP STILL...");
  delay(1500);

  float gSum[3] = {0, 0, 0}, aSum[3] = {0, 0, 0};
  int n = 0;
  float oldBias[3] = {gyroBias[0], gyroBias[1], gyroBias[2]};
  gyroBias[0] = gyroBias[1] = gyroBias[2] = 0;

  for (int i = 0; i < 60; i++) {
    if (readMPU()) {
      for (int k = 0; k < 3; k++) { gSum[k] += gyr[k]; aSum[k] += acc[k]; }
      n++;
    }
    delay(SAMPLE_MS);
  }

  if (n < 30) {
    Serial.println("Calibration failed (motion sensor not reading)");
    for (int k = 0; k < 3; k++) gyroBias[k] = oldBias[k];
    return;
  }
  for (int k = 0; k < 3; k++) {
    gyroBias[k] = gSum[k] / n;
    neutral[k] = aSum[k] / n;
  }
  normalize3(neutral);

  Serial.printf("Gyro offset removed: %.1f %.1f %.1f deg/s\n",
                gyroBias[0], gyroBias[1], gyroBias[2]);
  Serial.println("CALIBRATION COMPLETE");
  lcdCentered(0, "CALIBRATION OK");
  lcdCentered(1, "");
  delay(700);

  poseArmed = true;
  stillSince = 0;
  stillCount = 0;
}

// =====================================================
// FEATURES
// =====================================================

// Records a 1.5 s movement (including the moment just
// before it started) and turns it into 10 numbers that
// describe it:
//  [0..2] hand direction at the start
//  [3..5] share of rotation around each axis
//  [6..8] overall direction of rotation (one-way vs back-and-forth)
//  [9]    how many times it swings back and forth
bool captureMove(float f[NF]) {
  static float A[WINDOW][3], G[WINDOW][3];

  // Copy the readings from just before the start
  for (int i = 0; i < PRE; i++) {
    int j = (preIdx + i) % PRE;
    for (int k = 0; k < 3; k++) { A[i][k] = preAcc[j][k]; G[i][k] = preGyr[j][k]; }
  }
  // Record the rest
  for (int i = PRE; i < WINDOW; i++) {
    if (!readMPU()) return false;
    for (int k = 0; k < 3; k++) { A[i][k] = acc[k]; G[i][k] = gyr[k]; }
    delay(SAMPLE_MS);
  }

  // [0..2] start direction
  float g0[3] = {0, 0, 0};
  for (int i = 0; i < PRE; i++) for (int k = 0; k < 3; k++) g0[k] += A[i][k];
  normalize3(g0);

  // [3..5] and [6..8]
  float rms[3] = {0, 0, 0}, mean[3] = {0, 0, 0};
  for (int i = 0; i < WINDOW; i++) {
    for (int k = 0; k < 3; k++) {
      rms[k] += G[i][k] * G[i][k];
      mean[k] += G[i][k];
    }
  }
  float total = 0, overall = 0;
  for (int k = 0; k < 3; k++) {
    rms[k] = sqrtf(rms[k] / WINDOW);
    mean[k] /= WINDOW;
    total += rms[k];
    overall += rms[k] * rms[k];
  }
  overall = sqrtf(overall);
  if (total < 1) return false;

  // [9] back-and-forth swings on the main axis
  int mainAxis = 0;
  for (int k = 1; k < 3; k++) if (rms[k] > rms[mainAxis]) mainAxis = k;
  int swings = 0, state = 0;
  for (int i = 0; i < WINDOW; i++) {
    float v = G[i][mainAxis];
    if (v > 40 && state != 1)  { if (state != 0) swings++; state = 1; }
    if (v < -40 && state != -1) { if (state != 0) swings++; state = -1; }
  }

  for (int k = 0; k < 3; k++) {
    f[k] = g0[k];
    f[3 + k] = rms[k] / total;
    f[6 + k] = mean[k] / overall;
  }
  f[9] = min(swings, 8) / 6.0f;
  return true;
}

float moveDistance(const float a[NF], const float b[NF]) {
  float d = 0;
  for (int k = 0; k < 3; k++) {
    d += 0.5f * sq(a[k] - b[k]);           // start direction
    d += 2.0f * sq(a[3 + k] - b[3 + k]);   // which axis it rotates around
    d += 1.0f * sq(a[6 + k] - b[6 + k]);   // one-way vs back-and-forth
  }
  d += 1.5f * sq(a[9] - b[9]);             // number of swings
  return sqrtf(d);
}

// =====================================================
// MATCHING
// =====================================================

int matchMove(const float f[NF], float &bestD) {
  int best = -1;
  bestD = 99;
  for (int g = 0; g < NUM_GESTURES; g++) {
    if (gestureType[g] != MOVE) continue;
    for (int e = 0; e < db.count[g]; e++) {
      float d = moveDistance(f, db.ex[g][e]);
      if (debugOn) Serial.printf("  %-10s ex%d: %.2f\n", phrases[g], e + 1, d);
      if (d < bestD) { bestD = d; best = g; }
    }
  }
  if (bestD > MOVE_MAX_DIST) return -1;
  return best;
}

int matchPose(const float grav[3], float &bestErr) {
  int best = -1;
  bestErr = 999;
  for (int g = 0; g < NUM_GESTURES; g++) {
    if (gestureType[g] != POSE) continue;
    for (int e = 0; e < db.count[g]; e++) {
      float err = angleBetween(grav, db.ex[g][e]);
      if (debugOn) Serial.printf("  %-10s ex%d: %.0f deg\n", phrases[g], e + 1, err);
      if (err < bestErr) { bestErr = err; best = g; }
    }
  }
  if (bestErr > POSE_MAX_ERR) return -1;
  return best;
}

void showResult(int g) {
  lastShown = g;
  lastShownTime = millis();
  Serial.printf("\n>>> RECOGNIZED: %s <<<\n", phrases[g]);
  updateLCD();
}

// =====================================================
// SAVE / LOAD
// =====================================================

void saveTraining() {
  db.magic = MAGIC;
  if (prefs.putBytes("motion", &db, sizeof(db)) == sizeof(db)) {
    Serial.println("Training saved");
  } else {
    Serial.println("ERROR: could not save training");
  }
}

void loadTraining() {
  bool ok = false;
  if (prefs.getBytesLength("motion") == sizeof(db)) {
    prefs.getBytes("motion", &db, sizeof(db));
    ok = (db.magic == MAGIC);
    for (int g = 0; g < NUM_GESTURES; g++) {
      if (db.count[g] > EXAMPLES || db.next[g] >= EXAMPLES) ok = false;
    }
  }
  if (!ok) {
    memset(&db, 0, sizeof(db));
    db.magic = MAGIC;
    Serial.println("No saved training");
  } else {
    Serial.println("Saved training loaded");
  }
}

void showStatus() {
  Serial.println();
  Serial.println("======= MOTION GESTURES =======");
  for (int g = 0; g < NUM_GESTURES; g++) {
    Serial.printf("%d. %-10s %s  %d/%d examples\n",
                  g + 1, phrases[g],
                  gestureType[g] == MOVE ? "MOVE" : "POSE",
                  db.count[g], EXAMPLES);
  }
  Serial.println("Train each one 3 times for best results.");
  Serial.println("===============================");
}

// =====================================================
// TRAINING
// =====================================================

void storeExample(int g, const float f[NF]) {
  int slot = db.next[g];
  for (int k = 0; k < NF; k++) db.ex[g][slot][k] = f[k];
  db.next[g] = (slot + 1) % EXAMPLES;
  if (db.count[g] < EXAMPLES) db.count[g]++;
  saveTraining();
  Serial.printf("SUCCESS: %s example saved (%d/%d)\n", phrases[g], db.count[g], EXAMPLES);
  lcdCentered(0, "SAVED:");
  lcdCentered(1, phrases[g]);
  delay(1000);
}

void trainGesture(int g) {
  if (!mpuOK) { Serial.println("Motion sensor not ready"); return; }

  Serial.println();
  Serial.printf("TRAINING: %s (%s)\n", phrases[g], gestureType[g] == MOVE ? "MOVE" : "POSE");
  lcdCentered(0, "TRAIN:");
  lcdCentered(1, phrases[g]);

  if (gestureType[g] == POSE) {
    Serial.println("Get into the pose and HOLD it still...");
    for (int c = 3; c > 0; c--) {
      Serial.printf("%d...\n", c);
      char t[17]; snprintf(t, sizeof(t), "HOLD POSE  %d", c);
      lcdCentered(1, t);
      delay(800);
    }
    float sum[3] = {0, 0, 0};
    float maxG = 0;
    for (int i = 0; i < 50; i++) {
      if (!readMPU()) { Serial.println("Sensor read failed"); return; }
      for (int k = 0; k < 3; k++) sum[k] += acc[k];
      maxG = max(maxG, gyroMag());
      delay(SAMPLE_MS);
    }
    normalize3(sum);
    if (maxG > 45) {
      Serial.println("NOT SAVED: hand moved. Hold the pose still.");
      lcdCentered(0, "NOT SAVED");
      lcdCentered(1, "HOLD STILL");
      delay(1200);
      return;
    }
    float tilt = angleBetween(sum, neutral);
    if (tilt < POSE_MIN_TILT) {
      Serial.printf("NOT SAVED: too close to flat (%.0f deg). Tilt the hand more.\n", tilt);
      lcdCentered(0, "NOT SAVED");
      lcdCentered(1, "TILT MORE");
      delay(1200);
      return;
    }
    float f[NF] = {0};
    for (int k = 0; k < 3; k++) f[k] = sum[k];
    storeExample(g, f);
    return;
  }

  // MOVE
  Serial.println("Start in the starting position. Do the movement after GO!");
  for (int c = 3; c > 0; c--) {
    Serial.printf("%d...\n", c);
    char t[17]; snprintf(t, sizeof(t), "READY  %d", c);
    lcdCentered(1, t);
    delay(800);
  }
  Serial.println("GO!");
  lcdCentered(1, "GO!");

  // Wait up to 4 s for the movement to start
  unsigned long t0 = millis();
  while (millis() - t0 < 4000) {
    if (!readMPU()) return;
    for (int k = 0; k < 3; k++) { preAcc[preIdx][k] = acc[k]; preGyr[preIdx][k] = gyr[k]; }
    preIdx = (preIdx + 1) % PRE;
    if (gyroMag() > MOVE_START_DPS) {
      float f[NF];
      if (!captureMove(f)) { Serial.println("NOT SAVED: movement too small"); return; }
      storeExample(g, f);
      cooldownUntil = millis() + COOLDOWN_MS;
      return;
    }
    delay(SAMPLE_MS);
  }
  Serial.println("NOT SAVED: no movement detected. Move faster / bigger.");
  lcdCentered(0, "NOT SAVED");
  lcdCentered(1, "MOVE FASTER");
  delay(1200);
}

// =====================================================
// LIVE RECOGNITION (runs every 20 ms)
// =====================================================

void recognizeStep() {
  if (!readMPU()) { mpuOK = false; return; }

  // Keep the last few readings for movements
  for (int k = 0; k < 3; k++) { preAcc[preIdx][k] = acc[k]; preGyr[preIdx][k] = gyr[k]; }
  preIdx = (preIdx + 1) % PRE;

  unsigned long now = millis();
  float gm = gyroMag();

  // ---- MOVEMENT ----
  if (gm > MOVE_START_DPS && now > cooldownUntil) {
    float f[NF];
    if (captureMove(f)) {
      float d;
      if (debugOn) Serial.println("\nMovement scores (lower = closer):");
      int g = matchMove(f, d);
      if (g >= 0) {
        showResult(g);
        poseArmed = false;   // return to flat before a pose counts
      } else if (debugOn) {
        Serial.printf("No match (best %.2f, need < %.2f)\n", d, MOVE_MAX_DIST);
      }
    }
    cooldownUntil = millis() + COOLDOWN_MS;
    stillSince = 0;
    return;
  }

  // ---- STILLNESS / POSE ----
  if (gm < STILL_DPS) {
    if (stillSince == 0) {
      stillSince = now;
      stillGrav[0] = stillGrav[1] = stillGrav[2] = 0;
      stillCount = 0;
    }
    for (int k = 0; k < 3; k++) stillGrav[k] += acc[k];
    stillCount++;

    float cur[3] = {acc[0], acc[1], acc[2]};
    normalize3(cur);
    float tilt = angleBetween(cur, neutral);

    // Back to flat: re-arm poses
    if (tilt < 25) {
      if (neutralSince == 0) neutralSince = now;
      if (now - neutralSince > 300) poseArmed = true;
    } else {
      neutralSince = 0;
    }

    if (poseArmed && tilt >= POSE_MIN_TILT &&
        now - stillSince >= POSE_HOLD_MS && stillCount > 0) {
      float g3[3] = {stillGrav[0], stillGrav[1], stillGrav[2]};
      normalize3(g3);
      float err;
      if (debugOn) Serial.println("\nPose scores (degrees, lower = closer):");
      int g = matchPose(g3, err);
      if (g >= 0) {
        showResult(g);
        poseArmed = false;
      } else if (debugOn) {
        Serial.printf("No pose match (best %.0f deg, need < %.0f)\n", err, POSE_MAX_ERR);
      }
      stillSince = 0;
    }
  } else {
    stillSince = 0;
    neutralSince = 0;
  }
}

// =====================================================
// SERIAL COMMANDS
// =====================================================

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c >= '1' && c < '1' + NUM_GESTURES) {
      trainGesture(c - '1');
    } else if (c == 'c' || c == 'C') {
      calibrate();
    } else if (c == 's' || c == 'S') {
      showStatus();
    } else if (c == 'd' || c == 'D') {
      debugOn = !debugOn;
      Serial.printf("Debug: %s\n", debugOn ? "ON" : "OFF");
    } else if (c == 'X') {
      memset(&db, 0, sizeof(db));
      saveTraining();
      Serial.println("ALL TRAINING ERASED");
    }
  }
}

// =====================================================
// SETUP / LOOP
// =====================================================

void setup() {
  Serial.begin(115200);
  delay(1000);

  Wire.begin(MPU_SDA, MPU_SCL);
  Wire.setClock(400000);
  Wire.setTimeOut(100);

  lcdWire.begin(LCD_SDA, LCD_SCL);
  lcdWire.setClock(100000);
  lcdWire.setTimeOut(100);

  prefs.begin("motion2", false);   // fresh start for the open-hand set
  loadTraining();

  lcdOK = initLCD();
  mpuOK = initMPU();

  Serial.println();
  Serial.println("=================================");
  Serial.println(" MOTION GLOVE (MPU6500 ONLY)");
  Serial.printf (" Motion sensor: %s\n", mpuOK ? "OK" : "NOT FOUND");
  Serial.println("=================================");
  Serial.println("1-8 = train   c = calibrate   s = status");
  Serial.println("d = debug     X = erase all");

  if (mpuOK) calibrate();
  showStatus();
}

void loop() {
  handleSerial();
  unsigned long now = millis();

  if (!mpuOK) {
    static unsigned long lastTry = 0;
    if (now - lastTry > 3000) {
      lastTry = now;
      mpuOK = initMPU();
      if (mpuOK) calibrate();
    }
  } else if (now - lastSample >= SAMPLE_MS) {
    lastSample = now;
    recognizeStep();
  }

  // LCD self-repair
  if (lcdError || !lcdOK || now - lastLCDReinit >= 10000) {
    lastLCDReinit = now;
    lcdOK = initLCDEx(false);
    if (lcdOK) updateLCD();
  }

  if (now - lastLCD >= 300) {
    lastLCD = now;
    updateLCD();
  }
}
