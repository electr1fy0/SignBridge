# Legacy USB sketches

These preserve the previous independent recognizers for reference. The maintained,
combined firmware is **../SignBridge/SignBridge.ino**. Flash that file for Wi-Fi,
combined recognition, and physical LCD replies. Do not add these legacy sketches
to its Arduino folder.

Legacy GPIO25 is replaced by GPIO36 in the unified firmware. The new firmware
imports legacy gesture training from the `glove2` and `motion2` preference
namespaces on its first start; keep flash erase disabled when uploading.
