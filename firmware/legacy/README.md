# Legacy USB sketches

These preserve the previous independent recognizers for reference. The maintained,
combined firmware is **../SignBridge/SignBridge.ino**. Flash that file for Wi-Fi,
combined recognition, and physical LCD replies. Do not add these legacy sketches
to its Arduino folder.

Legacy GPIO25 is replaced by GPIO36 in the unified firmware. The unified
firmware no longer uses trained gestures, so saved legacy training is ignored.
