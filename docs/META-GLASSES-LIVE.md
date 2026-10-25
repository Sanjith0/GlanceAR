# Ray-Ban Meta as a Glance camera

`ios-glasses-live` is a small iPhone app that opens the live Glance web app (https://glancear.vercel.app by default) in a full-screen web view. It adds a camera picker, **iPhone camera** or **Ray-Ban Meta**, to **Who's here** (LIVE Camera) and the conversation screen.

## Camera use

| Screen | Camera |
| --- | --- |
| Face registration (scanning yourself and others) | iPhone camera, always |
| Who's here / LIVE Camera (recognition, talking points, countdown) | Your pick: iPhone camera or Ray-Ban Meta |
| Conversation screen (live view and finish gesture) | Your pick: iPhone camera or Ray-Ban Meta |
| Microphone (conversation recording) | iPhone microphone |

The picker appears only inside this app, and the choice is shared by both screens and remembered on the iPhone. With the glasses, the wearer is never in frame, so Who's here counts the wearer as present and holds on exactly one other registered attendee.

**Policy note:** Meta's [Wearables acceptable use policy](https://wearables.developer.meta.com/acceptable-use-policy) prohibits using device sensors to uniquely identify people by their faces unless Meta grants an exception with prior approval. Face recognition on the glasses feed (Who's here with Ray-Ban Meta selected) needs that approval before any release beyond Developer Mode testing. Everyone recognized in Glance has opted in and registered at the event.

## How it works

1. `Web/glassesCameraShim.js` is injected before the page loads. It wraps `navigator.mediaDevices.getUserMedia`. A request tagged `video: { glanceSource: 'glasses' }` returns the glasses feed. Every other request goes to the real iPhone camera or microphone.
2. With **Ray-Ban Meta** selected, Who's here (`src/capture/FaceCamera.tsx`) and the conversation screen (`src/capture/GestureCapture.tsx`) make the tagged request through `src/capture/glassesBridge.ts`. Native code (`Sources/GlassesCamera.swift`) then starts a Meta Wearables Device Access Toolkit (DAT) 1.0.1 camera session. The session uses raw video, medium resolution (504×896), 15 fps and no glasses audio.
3. Each frame is JPEG-encoded and drawn into a canvas. That canvas is exposed as a normal `MediaStream`, which the existing face and hand models read. The session stays open for 3 seconds after a screen releases it, so moving from Who's here to the conversation does not restart the glasses. If the page is busy, frames are dropped rather than queued. Nothing is saved or uploaded.
4. The track reports `facingMode: "environment"`, so the video is not mirrored. If no frame arrives within 15 seconds, or frames stall for 4 seconds, the track ends. Glance then shows its normal Retry state, and you can switch back to the iPhone camera.
5. The web view loads over HTTPS, so the iPhone camera and microphone work as they do in Safari. The app grants camera and microphone access only to the Glance site, and iOS asks for permission once.

In live mode, each phone has to see the other person's hand. If you wear the glasses and look at the other person, their hand is in your view.

## Build and run (Mac, physical iPhone and glasses)

```sh
cd glancear
git pull origin main
brew install xcodegen          # once
cd ios-glasses-live
xcodegen generate
open GlanceGlassesLive.xcodeproj
```

In Xcode:

- Select your development team under Signing & Capabilities.
- Change `com.glancear.glasses.live` to a bundle ID registered with Meta.
- Set `GLANCE_META_APP_ID` and `GLANCE_META_CLIENT_TOKEN` in `project.yml` or the target's build settings. For unpublished local builds, you can use Meta's Developer Mode instead.
- Optional: set `GLANCE_WEB_URL` to another HTTPS URL. The default is https://glancear.vercel.app.
- Run the app on the iPhone that is paired with the glasses in Meta AI.

In the app:

1. Open the **Glasses** bar at the top and tap **Connect Meta AI**. Approve the request in Meta AI.
2. Tap **Allow glasses camera**.
3. Use Glance as usual. In LIVE Camera (Who's here), pick **Ray-Ban Meta** and look at the person you want to meet. The conversation screen keeps the same choice.

Web changes ship through Vercel as usual. The app does not need a rebuild unless the Swift code or the shim changes.

## What was verified and what was not

- **Verified in Chromium:** The real shim was injected, with a stand-in for the native message handler. Requests without the tag went to the normal camera. With **Ray-Ban Meta** selected, the conversation screen received the unmirrored canvas track labelled `Meta glasses`. Switching back to **iPhone camera** stopped the glasses session. TypeScript and all 302 unit tests pass.
- **Not verified:** Swift compilation, Xcode signing, DAT registration, real glasses frames, WKWebView camera behaviour, performance, and battery or thermal behaviour. These need your Mac, iPhone and glasses.
