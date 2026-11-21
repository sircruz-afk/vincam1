# VinCam

A camera app with live digital filters for **photos and videos**, which saves what you capture **straight to your phone's gallery**.

- Asks for camera permission when you open it, and explains how to fix it if you said no
- 17 real-time GPU filters with live previews: Vivid, Mono, Noir, Vintage, Arctic, Duotone, Thermal, Neon, Comic, Sketch, Dots, 8-Bit, Glitch, VHS, Kaleido, Mirror, X-Ray
- Intensity slider, swipe left/right on the viewfinder to change filter, double-tap to switch cameras
- Photo mode (JPEG) and Video mode (MP4/WebM with sound), plus a 3 s / 10 s self-timer
- Review screen with **Save to Gallery**, Share and Delete, and a grid of this session's captures with **Save all**

## How saving works

| Where it runs | What "Save" does |
| --- | --- |
| **Android app** (Capacitor) | Writes into a **VinCam** album that shows up in Gallery / Google Photos. Needs no storage permission. |
| **iOS app** (Capacitor) | Adds the photo or video to the **Photos** library (asks for "add photos" permission the first time). |
| iPhone Safari (web) | Opens the share sheet. Tap **Save Image** / **Save Video** to put it in Photos. |
| Android Chrome / desktop (web) | Downloads the file. On Android it appears under *Downloads* in the gallery. |

Browsers can't write directly into the photo gallery, so build the native app if you want one-tap saving.

## Project layout

```
index.html            screens: permission gate, camera, review, gallery
src/filters.ts        every filter as a small GLSL fragment shader
src/renderer.ts       WebGL renderer (cover-crop, mirroring, intensity, rounded thumbnails)
src/main.ts           camera, permission flow, UI, photo + video capture
src/save.ts           save to gallery / share (native) and the web fallbacks
android/, ios/        Capacitor native projects (camera, mic and photo-library permissions already set)
```

## Run it

```bash
npm install
npm run dev          # http://localhost:5173. The camera needs localhost or HTTPS.
```

To try it on your phone, open the dev server over HTTPS (for example with a tunnel) or deploy `dist/` to any HTTPS host. `.github/workflows/pages.yml` deploys to GitHub Pages once you set **Settings → Pages → Source** to **GitHub Actions**.

### Android app (real gallery saving)

Requirements: Android Studio and JDK 21.

```bash
npm run android      # builds the web app, syncs it into android/ and opens Android Studio
```

Press **Run** in Android Studio to install it on a connected phone. You can also download a ready-made debug APK from the **Build Android APK** workflow under the repo's **Actions** tab (artifact `VinCam-debug-apk`).

### iOS app

Requirements: a Mac with Xcode 16 or later. The project uses Swift Package Manager, so you don't need CocoaPods.

```bash
npm run ios          # builds, syncs into ios/ and opens Xcode
```

Choose your team under *Signing & Capabilities* and run it on your iPhone.

### App icons

The VinCam icon is already set for Android and iOS. `resources/icon.png` is the 1024×1024 source. If you change it, regenerate every launcher and splash size with:

```bash
npx @capacitor/assets generate --iconBackgroundColor '#111116' --splashBackgroundColor '#000000'
```

## Adding a filter

Add an entry to `FILTERS` in `src/filters.ts` with a GLSL function `vec3 filt(vec2 uv)`. Helpers you can use: `tex(uv)`, `luma(c)`, `hash(p)`, `u_time`, `u_res` and `u_texel`. The filter shows up in the carousel automatically.
