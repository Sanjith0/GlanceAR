# Meta glasses as Glance's live camera

`ios-glasses-live` is a small iPhone app that runs the **unchanged Glance app** and uses your Meta glasses as its camera instead of the iPhone camera. Face recognition, talking points, the recognition countdown, the three-finger gesture, the green flash and the shared chat are the same code as the web/same-camera version.

## How it works

1. The app bundles the normal web build (`dist/`) and shows it in a full-screen web view, served from `glance-app://app/`.
2. `Web/glassesCameraShim.js` is injected before the app loads. It replaces `navigator.mediaDevices.getUserMedia({ video })` so it returns the glasses feed. Microphone requests still go to the iPhone microphone.
3. When a Glance screen asks for the camera, native code (`Sources/GlassesCamera.swift`) starts a Meta Wearables Device Access Toolkit (DAT) 1.0.1 camera session. It uses the same calls as `ios-glasses/Sources/DatCameraBridge.swift`: raw video, medium resolution, 15 fps and no glasses audio.
4. Each frame is JPEG-encoded and drawn into a canvas. That canvas is exposed as a normal `MediaStream`, which the existing face and hand models consume. If the page is busy, frames are dropped, never queued. Nothing is saved or uploaded.
5. The stream reports `facingMode: "environment"`, so the view is not mirrored. When Glance releases the camera, the glasses session stops. If glasses frames stall for 4 seconds, the camera track ends and Glance shows its normal camera-stopped or retry state.

## One behaviour change: the wearer counts as present

Glasses film from the wearer's point of view, so the wearer's own face is never in the frame. When the glasses camera is active, `LiveCamera.tsx` counts the wearer as present. The three-second hold then needs exactly **one** other registered attendee in view. Any other face, an unknown face or a second attendee still resets the hold. Without glasses, nothing changes.

The finish gesture is unchanged: the wearer's hand and the other person's hand are both visible from the wearer's point of view.

## Build and run (Mac, physical iPhone and glasses)

```sh
cd glancear
npm ci
npm run build:glasses          # web build in sample/demo mode -> dist/
brew install xcodegen
cd ios-glasses-live
xcodegen generate
open GlanceGlassesLive.xcodeproj
```

In Xcode:

- Select your development team.
- Change `com.glancear.glasses.live` to a bundle ID registered with Meta.
- Set `GLANCE_META_APP_ID` and `GLANCE_META_CLIENT_TOKEN`, or use Meta's Developer Mode for unpublished local builds.
- Run the app on the iPhone that is paired with the glasses in Meta AI.

The capabilities, plist keys and Developer Mode steps are the same as in `docs/IOS-GLASSES.md`. The Meta callback scheme is `glance-live://`, so this app and the separate harness can be installed together.

In the app, open the **Glasses** bar at the top:

1. Tap **Connect Meta AI** and approve the request in Meta AI.
2. Tap **Allow glasses camera**.
3. Use Glance as usual. LIVE Camera and the conversation screen show the glasses feed.

After each web code change, re-run `npm run build:glasses` and then rebuild the app.

## What was verified and what was not

- **Verified in Chromium:** The real shim was injected with a stand-in for the native message handler, and the real iPhone camera was blocked. Frames pushed through the bridge produced a 720×400 unmirrored track labelled `Meta glasses`. The production face models enrolled the fictional Alex and Sam portraits. With only Sam in view, the countdown showed 3, 2 and 1 and then opened the conversation. The production hand model then recognized the two-hand fixture, which opened the shared chat. The glasses session started once, was handed from LIVE Camera to the conversation screen and stopped once after the chat opened. There were no page errors.
- **Not verified:** Swift compilation, Xcode signing, DAT registration, real glasses frames, WKWebView performance, real-world recognition accuracy and battery or thermal behaviour. These need a Mac, a physical iPhone and glasses supported by DAT. The Meta glasses model you have is still unconfirmed for DAT camera access.
