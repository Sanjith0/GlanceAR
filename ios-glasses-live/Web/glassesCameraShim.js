/*
 * Glance Glasses Live camera bridge. Injected at document start by the iPhone
 * shell. Only getUserMedia({ video: { glanceSource: 'glasses' } }) returns the
 * live Meta glasses feed (JPEG frames pushed from native DAT code, drawn to a
 * canvas, exposed as a canvas MediaStream). The web app asks for that on Who's
 * here (LIVE Camera) and the conversation screen when the user picks
 * "Ray-Ban Meta". Every other request (face registration, microphone) goes to
 * the real iPhone camera/mic.
 *
 * Native -> JS:  window.__glanceGlassesCamera.frame(base64Jpeg)
 *                window.__glanceGlassesCamera.failed(message)
 * JS -> Native:  webkit.messageHandlers.glanceGlasses.postMessage({ type: 'start' | 'stop' })
 */
(function () {
  'use strict';
  if (window.__glanceGlassesCamera) return;
  var native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.glanceGlasses;
  if (!native) return;

  var FIRST_FRAME_TIMEOUT_MS = 15000;
  var STALL_TIMEOUT_MS = 4000;
  // Keep the glasses session open briefly after the last track stops so the
  // LIVE Camera -> conversation handoff does not restart the DAT session.
  var HANDOFF_GRACE_MS = 3000;
  var graceTimer = null;
  var LABEL = 'Meta glasses';

  var canvas = document.createElement('canvas');
  canvas.width = 504; canvas.height = 896;
  var ctx = canvas.getContext('2d');
  var state = 'idle'; // idle | starting | live
  var waiters = [];
  var tracks = [];
  var lastFrameAt = 0;
  var pending = null, decoding = false;
  var firstFrameTimer = null, stallTimer = null;

  var original = navigator.mediaDevices ? {
    getUserMedia: navigator.mediaDevices.getUserMedia ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null,
    enumerateDevices: navigator.mediaDevices.enumerateDevices ? navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices) : null,
  } : { getUserMedia: null, enumerateDevices: null };

  function post(type) { try { native.postMessage({ type: type }); } catch (e) { /* shell gone */ } }
  function error(message, name) {
    try { return new DOMException(message, name || 'NotReadableError'); } catch (e) { return new Error(message); }
  }

  function settle(err) {
    var list = waiters; waiters = [];
    list.forEach(function (w) { if (err) w.reject(err); else w.resolve(); });
  }

  function clearGrace() { if (graceTimer) clearTimeout(graceTimer); graceTimer = null; }

  function clearTimers() {
    clearGrace();
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    if (stallTimer) clearInterval(stallTimer);
    firstFrameTimer = null; stallTimer = null;
  }

  function endTracks() {
    var list = tracks; tracks = [];
    list.forEach(function (t) {
      try { t.__glanceStop(); } catch (e) { /* already stopped */ }
      try { t.dispatchEvent(new Event('ended')); } catch (e) { /* ignore */ }
    });
  }

  function fail(message) {
    var wasActive = state !== 'idle';
    state = 'idle'; pending = null;
    clearTimers();
    settle(error(message));
    endTracks();
    if (wasActive) post('stop');
  }

  function goLive() {
    if (state !== 'starting') return;
    state = 'live';
    if (firstFrameTimer) clearTimeout(firstFrameTimer);
    firstFrameTimer = null;
    stallTimer = setInterval(function () {
      if (state === 'live' && performance.now() - lastFrameAt > STALL_TIMEOUT_MS) {
        fail('The Meta glasses stopped sending video. Check the glasses connection and retry.');
      }
    }, 1000);
    settle(null);
  }

  function pump() {
    if (!pending || state === 'idle') { decoding = false; return; }
    decoding = true;
    var b64 = pending; pending = null;
    var img = new Image();
    img.onload = function () {
      if (state !== 'idle') {
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        }
        ctx.drawImage(img, 0, 0);
        lastFrameAt = performance.now();
        goLive();
      }
      pump();
    };
    img.onerror = function () { pump(); };
    img.src = 'data:image/jpeg;base64,' + b64;
  }

  function ensureLive() {
    clearGrace();
    if (state === 'live') return Promise.resolve();
    var p = new Promise(function (resolve, reject) { waiters.push({ resolve: resolve, reject: reject }); });
    if (state === 'idle') {
      state = 'starting';
      lastFrameAt = 0;
      firstFrameTimer = setTimeout(function () {
        if (state === 'starting') fail('No video from the Meta glasses. Connect them in the Glasses panel above, or switch the camera back to iPhone.');
      }, FIRST_FRAME_TIMEOUT_MS);
      post('start');
    }
    return p;
  }

  function makeStream() {
    var stream = canvas.captureStream();
    var track = stream.getVideoTracks()[0];
    var nativeStop = track.stop.bind(track);
    var nativeSettings = track.getSettings ? track.getSettings.bind(track) : function () { return {}; };
    track.__glanceStop = nativeStop;
    try { Object.defineProperty(track, 'label', { value: LABEL }); } catch (e) { /* read-only */ }
    // World-facing camera: tell the app not to mirror it.
    track.getSettings = function () {
      var s = nativeSettings() || {};
      s.facingMode = 'environment'; s.deviceId = 'meta-glasses';
      s.width = canvas.width; s.height = canvas.height;
      return s;
    };
    track.stop = function () {
      var i = tracks.indexOf(track);
      nativeStop();
      if (i < 0) return;
      tracks.splice(i, 1);
      if (!tracks.length) {
        clearGrace();
        graceTimer = setTimeout(function () {
          graceTimer = null;
          if (tracks.length || state === 'idle') return;
          state = 'idle'; pending = null; clearTimers(); post('stop');
        }, HANDOFF_GRACE_MS);
      }
    };
    tracks.push(track);
    return stream;
  }

  var devices = navigator.mediaDevices;
  if (!devices) return; // Not a secure context: leave the page untouched.

  function wantsGlasses(constraints) {
    var v = constraints && constraints.video;
    return !!(v && typeof v === 'object' && v.glanceSource === 'glasses');
  }

  devices.getUserMedia = function (constraints) {
    constraints = constraints || {};
    if (!wantsGlasses(constraints)) {
      if (original.getUserMedia) return original.getUserMedia(constraints);
      return Promise.reject(error('The camera is not available in this view.', 'NotFoundError'));
    }
    return ensureLive().then(function () {
      var stream = makeStream();
      if (!constraints.audio || !original.getUserMedia) return stream;
      return original.getUserMedia({ audio: constraints.audio }).then(function (audio) {
        audio.getAudioTracks().forEach(function (t) { stream.addTrack(t); });
        return stream;
      });
    });
  };

  devices.enumerateDevices = function () {
    var glasses = { kind: 'videoinput', label: LABEL, deviceId: 'meta-glasses', groupId: 'meta-glasses', toJSON: function () { return this; } };
    var others = original.enumerateDevices ? original.enumerateDevices() : Promise.resolve([]);
    return others.catch(function () { return []; }).then(function (list) { return list.concat([glasses]); });
  };

  window.__glanceGlassesCamera = {
    available: true,
    label: LABEL,
    frame: function (b64) {
      if (state === 'idle' || typeof b64 !== 'string' || !b64) return;
      pending = b64;
      if (!decoding) pump();
    },
    failed: function (message) { fail(String(message || 'The Meta glasses camera stopped.')); },
  };
})();
