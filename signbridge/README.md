# SignBridge web interface

The ESP32 serves this interface directly. **Flash
[../firmware/SignBridge/SignBridge.ino](../firmware/SignBridge/SignBridge.ino)**,
join Wi-Fi `SignBridge` (password `signbridge`), and open http://192.168.4.1.

The page provides live translations and speech, contextual and custom LCD
replies, everyday phrase search, a shared recent conversation, live sensor
values, training, calibration, and hardware settings. It uses local assets only.
There is no role-selection screen, simulated LCD/motor UI, or demo gesture bar.

## Develop

Node 18+ is required only for these development commands. No packages need installing.

```sh
npm start              # preview at http://localhost:3050
npm run embed          # embed updated HTML/CSS/JS in the single .ino
npm run check:embed    # detect a stale embedded copy
npm test               # parser, formatting, event replay and preview tests
```

The preview truthfully reports disconnected without a glove. To use it with a
real glove while editing the UI, connect to the glove's Wi-Fi and run:

```sh
SIGNBRIDGE_DEVICE=http://192.168.4.1 npm start
```

HTTP and WebSockets are proxied to the device. The ESP32 firmware itself needs
no Node process. See the [project guide](../README.md) for wiring, flashing,
training, Serial Monitor commands and saved-training migration.
