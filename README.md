# AlgoDesk Pro — Android APK

This repository builds the Android APK through GitHub Actions.

## Build
- Workflow: Build Fresh AlgoDesk APK
- Trigger: push to main or manual workflow dispatch
- Output: `android/app/build/outputs/apk/debug/app-debug.apk`
- Artifact: `AlgoDesk-Pro-Fresh-APK`

## Architecture
- Capacitor Android shell
- Offline-first web UI in `www/`
- Backend/API configuration is injected through GitHub Actions secrets
- Broker credentials are not stored in source code

## Current status
The Android debug APK workflow has been verified successfully on GitHub Actions.
