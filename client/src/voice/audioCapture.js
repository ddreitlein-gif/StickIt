// v1.20.00 -- Browser-side audio capture + WebSocket bridge to /ws/voice/<eventId>.
//
// Captures microphone audio via AudioContext + AudioWorklet (modern path) or
// ScriptProcessorNode (fallback), downsamples to 16 kHz mono linear PCM, and
// sends 250 ms chunks as binary WebSocket frames to the StickIt server. The
// server proxies to Deepgram and relays transcripts back.
//
// Usage:
//   const cap = createVoiceCapture({
//     eventId: 'abc',
//     onTranscript: ({ transcript, is_final, confidence }) => { ... },
//     onLevel: (rms01) => { ... },         // 0..1 RMS level for the level meter
//     onError: (err) => { ... },
//     onReady: () => { ... },
//   });
//   await cap.start();
//   // ... operator speaks ...
//   await cap.stop();           // resolves when Deepgram closes; returns final transcript

const TARGET_SAMPLE_RATE = 16000;
const CHUNK_MS = 250;

function makeWsUrl(eventId) {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  // Vite dev proxy forwards /ws to the server.
  return `${proto}//${loc.host}/ws/voice/${encodeURIComponent(eventId)}`;
}

// Naive linear-interpolation downsample from sourceRate -> TARGET_SAMPLE_RATE.
// Input: Float32Array of mono samples at sourceRate.
// Output: Int16Array (linear PCM little-endian) at TARGET_SAMPLE_RATE.
function downsampleAndConvert(input, sourceRate) {
  if (sourceRate === TARGET_SAMPLE_RATE) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const s = Math.max(-1, Math.min(1, input[i]));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return out;
  }
  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(input.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    const sample = input[lo] * (1 - frac) + input[hi] * frac;
    const clamped = Math.max(-1, Math.min(1, sample));
    out[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return out;
}

function rms01(float32Buf) {
  if (!float32Buf || float32Buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < float32Buf.length; i++) sum += float32Buf[i] * float32Buf[i];
  const rms = Math.sqrt(sum / float32Buf.length);
  return Math.min(1, rms * 4); // amplify so quiet speech registers visually
}

export function createVoiceCapture({ eventId, onTranscript, onLevel, onError, onReady, onClose }) {
  let ws = null;
  let audioCtx = null;
  let mediaStream = null;
  let sourceNode = null;
  let workletNode = null;
  let processorNode = null;
  let levelTimer = null;
  let latestLevel = 0;
  let started = false;
  let stopping = false;
  let pendingFloatBuffer = []; // accumulated Float32 frames before the next 250ms chunk send
  let pendingFloatLength = 0;
  let sourceRate = 48000;
  let resolveStop = null;
  let finalTranscriptText = '';

  function flushChunk() {
    if (!pendingFloatLength) return;
    const merged = new Float32Array(pendingFloatLength);
    let off = 0;
    for (const f of pendingFloatBuffer) {
      merged.set(f, off);
      off += f.length;
    }
    pendingFloatBuffer = [];
    pendingFloatLength = 0;
    const int16 = downsampleAndConvert(merged, sourceRate);
    if (ws && ws.readyState === WebSocket.OPEN && int16.byteLength > 0) {
      try { ws.send(int16.buffer); } catch (_) {}
    }
  }

  function handleAudioFrame(float32Buf) {
    latestLevel = Math.max(latestLevel, rms01(float32Buf));
    // Keep a copy because the underlying buffer is reused by the audio thread.
    const copy = new Float32Array(float32Buf.length);
    copy.set(float32Buf);
    pendingFloatBuffer.push(copy);
    pendingFloatLength += copy.length;
    // Flush after CHUNK_MS worth at sourceRate.
    const chunkSamples = Math.floor((CHUNK_MS / 1000) * sourceRate);
    if (pendingFloatLength >= chunkSamples) flushChunk();
  }

  async function start() {
    if (started) return;
    started = true;

    // Open the WS first so we don't waste mic permission on a dead bridge.
    ws = new WebSocket(makeWsUrl(eventId));
    ws.binaryType = 'arraybuffer';

    const wsOpen = new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(new Error('WebSocket failed to open'));
    });

    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'transcript') {
        if (msg.is_final && msg.transcript) {
          finalTranscriptText += (finalTranscriptText ? ' ' : '') + msg.transcript;
        }
        onTranscript && onTranscript(msg);
      } else if (msg.type === 'voice_ready') {
        onReady && onReady(msg);
      } else if (msg.type === 'voice_error') {
        onError && onError(new Error(msg.message || 'Voice service error'));
      } else if (msg.type === 'voice_closed') {
        if (msg.final_transcript && !finalTranscriptText) finalTranscriptText = msg.final_transcript;
        if (resolveStop) {
          resolveStop(finalTranscriptText);
          resolveStop = null;
        }
      }
    };

    ws.onclose = () => {
      if (resolveStop) {
        resolveStop(finalTranscriptText);
        resolveStop = null;
      }
      onClose && onClose();
    };

    try {
      await wsOpen;
    } catch (e) {
      onError && onError(e);
      throw e;
    }

    // Now request mic permission.
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (e) {
      onError && onError(new Error('Microphone permission denied or unavailable.'));
      try { ws.close(); } catch (_) {}
      throw e;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    sourceRate = audioCtx.sampleRate;
    sourceNode = audioCtx.createMediaStreamSource(mediaStream);

    // Prefer AudioWorklet when available (modern browsers / Safari 14+).
    let usedWorklet = false;
    try {
      if (audioCtx.audioWorklet && typeof audioCtx.audioWorklet.addModule === 'function') {
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
        await audioCtx.audioWorklet.addModule(blobUrl);
        workletNode = new AudioWorkletNode(audioCtx, 'stickit-pcm-tap');
        workletNode.port.onmessage = (e) => handleAudioFrame(e.data);
        sourceNode.connect(workletNode);
        // The worklet does not need to connect to destination -- no playback.
        usedWorklet = true;
      }
    } catch (_) {
      // fall through to ScriptProcessor path
    }

    if (!usedWorklet) {
      // Legacy fallback: ScriptProcessorNode (deprecated but still widely supported).
      processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (e) => {
        const inputBuf = e.inputBuffer.getChannelData(0);
        handleAudioFrame(inputBuf);
      };
      sourceNode.connect(processorNode);
      processorNode.connect(audioCtx.destination);
    }

    levelTimer = setInterval(() => {
      onLevel && onLevel(latestLevel);
      latestLevel = 0; // decay
    }, 100);
  }

  function stop() {
    if (!started || stopping) return Promise.resolve(finalTranscriptText);
    stopping = true;
    flushChunk();
    return new Promise((resolve) => {
      resolveStop = resolve;
      // Ask the bridge to finalize and close. The server will reply with
      // voice_closed including the accumulated final_transcript, then close.
      try {
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
      } catch (_) {}
      // Belt + suspenders timeout in case the server never closes.
      setTimeout(() => {
        if (resolveStop) {
          try { ws && ws.close(); } catch (_) {}
          resolveStop(finalTranscriptText);
          resolveStop = null;
        }
      }, 4000);

      // Tear down audio pipeline immediately so the mic LED turns off.
      try { if (processorNode) processorNode.disconnect(); } catch (_) {}
      try { if (workletNode) workletNode.disconnect(); } catch (_) {}
      try { if (sourceNode) sourceNode.disconnect(); } catch (_) {}
      try { if (audioCtx) audioCtx.close(); } catch (_) {}
      try { if (mediaStream) mediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
      if (levelTimer) { clearInterval(levelTimer); levelTimer = null; }
    });
  }

  function isActive() {
    return started && !stopping;
  }

  return { start, stop, isActive };
}

// Worklet source -- runs on the audio thread, forwards each render quantum
// (typically 128 samples) back to the main thread.
const WORKLET_SOURCE = `
class StickItPcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Copy out since the buffer is reused across renders.
      const copy = new Float32Array(input[0].length);
      copy.set(input[0]);
      this.port.postMessage(copy, [copy.buffer]);
    }
    return true;
  }
}
registerProcessor('stickit-pcm-tap', StickItPcmTap);
`;
