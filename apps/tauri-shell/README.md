# Neurostore Tauri Shell

Single shell app target for:
- Windows
- macOS
- iOS
- Android

This shell loads the existing `web/` UI and provides native command hooks.

## Prerequisites

- Rust stable
- Node.js 20+
- `pnpm` or `npm`
- Platform SDKs:
  - Windows: MSVC build tools
  - macOS/iOS: Xcode + iOS SDK
  - Android: Android Studio + SDK + NDK + JDK 17

## Install

```bash
cd apps/tauri-shell
npm install
```

## Desktop Dev

```bash
npm run dev
```

## Desktop Build

```bash
npm run build
```

## iOS

```bash
npm run ios:init
npm run ios:dev
npm run ios:build
```

## Android

```bash
npm run android:init
npm run android:dev
npm run android:build
```

## Native Commands

- `app_info`
- `healthcheck`
- `pick_file`
- `set_secret`
- `get_secret`
- `delete_secret`
- `start_background_sync`
- `stop_background_sync`
- `sync_status`

Frontend integration lives in `web/app.js` and works in:
- Tauri mode: native bridge active
- Browser mode: native commands disabled with fallback logs
