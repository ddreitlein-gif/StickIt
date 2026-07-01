// v1.20.00 -- Deepgram Nova-3 WebSocket bridge for voice manual score entry.
// The client opens ws://server/ws/voice/<eventId> and streams binary PCM frames
// (linear16, 16000 Hz, mono). This module proxies them to Deepgram and relays
// transcripts back. The DEEPGRAM_API_KEY environment variable is read here; the
// client never sees it.

const WebSocket = require('ws');
const { queryOne, queryAll } = require('../db/schema');

const DEEPGRAM_WS_URL = 'wss://api.deepgram.com/v1/listen';

// Static section keywords always included in the keyterm list.
const STATIC_KEYTERMS = [
  'time', 'T and L', 'TL',
  'carving', 'absorption', 'ab ext', 'abs ext', 'upper body', 'deduction', 'raw',
  'jump one', 'jump two', 'jump 1', 'jump 2',
  'air judge one', 'air judge two', 'air judge three',
  'air judge 1', 'air judge 2', 'air judge 3',
  'DNS', 'DNF', 'DSQ', 'no time', 'NT',
  'correction', 'scratch that', 'bib',
  // v1.26.00 (FS-13): grab phrases — "grab" = basic g, "big grab" /
  // "advanced grab" = advanced G. Codes themselves come from the DD table.
  'grab', 'big grab', 'advanced grab',
];

async function getKeytermsForEvent(eventId) {
  try {
    const ev = await queryOne('SELECT discipline, gender FROM events WHERE id=?', [eventId]);
    if (!ev) return STATIC_KEYTERMS.slice();
    const rows = await queryAll(
      `SELECT DISTINCT jump_code FROM jump_dd_table WHERE discipline=? AND (gender=? OR gender='M')`,
      [ev.discipline || 'mogul', ev.gender || 'M']
    );
    const jumpCodes = rows.map(r => r.jump_code).filter(Boolean);
    return [...STATIC_KEYTERMS, ...jumpCodes];
  } catch (_) {
    return STATIC_KEYTERMS.slice();
  }
}

function buildDeepgramUrl(keyterms) {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en-US',
    smart_format: 'true',
    punctuate: 'true',
    endpointing: '300',
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
  });
  const base = `${DEEPGRAM_WS_URL}?${params.toString()}`;
  const keytermQuery = keyterms.map(t => `keyterm=${encodeURIComponent(t)}`).join('&');
  return keytermQuery ? `${base}&${keytermQuery}` : base;
}

async function attachVoiceBridge(clientWs, eventId) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    safeSend(clientWs, { type: 'voice_error', message: 'Voice service unavailable: DEEPGRAM_API_KEY not configured on server.' });
    try { clientWs.close(1011, 'voice unavailable'); } catch (_) {}
    return;
  }

  // v1.25.00 (A-9) -- only open the paid Deepgram leg for a real event.
  try {
    const ev = await queryOne('SELECT id FROM events WHERE id=?', [eventId]);
    if (!ev) {
      safeSend(clientWs, { type: 'voice_error', message: 'Unknown event' });
      try { clientWs.close(1008, 'unknown event'); } catch (_) {}
      return;
    }
  } catch (_) {
    safeSend(clientWs, { type: 'voice_error', message: 'Event lookup failed' });
    try { clientWs.close(1011, 'event lookup failed'); } catch (_) {}
    return;
  }

  const keyterms = await getKeytermsForEvent(eventId);
  const dgUrl = buildDeepgramUrl(keyterms);

  let dgWs;
  try {
    dgWs = new WebSocket(dgUrl, { headers: { Authorization: `Token ${apiKey}` } });
  } catch (e) {
    safeSend(clientWs, { type: 'voice_error', message: `Failed to open Deepgram connection: ${e.message}` });
    try { clientWs.close(1011, 'deepgram open failed'); } catch (_) {}
    return;
  }

  let dgOpen = false;
  let finalTranscript = '';

  dgWs.on('open', () => {
    dgOpen = true;
    safeSend(clientWs, { type: 'voice_ready', keyterm_count: keyterms.length });
  });

  dgWs.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'Results') {
        const alt = msg.channel && msg.channel.alternatives && msg.channel.alternatives[0];
        if (alt && typeof alt.transcript === 'string' && alt.transcript.length > 0) {
          if (msg.is_final) finalTranscript += (finalTranscript ? ' ' : '') + alt.transcript;
          safeSend(clientWs, {
            type: 'transcript',
            transcript: alt.transcript,
            is_final: !!msg.is_final,
            confidence: typeof alt.confidence === 'number' ? alt.confidence : null,
          });
        }
      } else if (msg.type === 'UtteranceEnd') {
        safeSend(clientWs, { type: 'utterance_end' });
      } else if (msg.type === 'Metadata') {
        // Deepgram's session metadata; ignored.
      }
    } catch (_) { /* ignore malformed deepgram messages */ }
  });

  dgWs.on('error', err => {
    safeSend(clientWs, { type: 'voice_error', message: `Deepgram error: ${err.message}` });
    try { clientWs.close(1011, 'deepgram error'); } catch (_) {}
  });

  dgWs.on('close', () => {
    safeSend(clientWs, { type: 'voice_closed', final_transcript: finalTranscript });
    try { clientWs.close(1000, 'deepgram closed'); } catch (_) {}
  });

  clientWs.on('message', (data, isBinary) => {
    if (!dgOpen) return;
    if (isBinary) {
      // Forward raw PCM audio frames straight to Deepgram.
      try { dgWs.send(data); } catch (_) {}
    } else {
      // Text control frames from the client.
      try {
        const ctrl = JSON.parse(data.toString());
        if (ctrl && ctrl.type === 'stop') {
          // Ask Deepgram to finalize and close. It will reply with a final
          // Results message, then close, which we proxy back to the client.
          try { dgWs.send(JSON.stringify({ type: 'CloseStream' })); } catch (_) {}
        }
      } catch (_) { /* ignore non-JSON text frames */ }
    }
  });

  clientWs.on('close', () => {
    if (dgWs.readyState === WebSocket.OPEN || dgWs.readyState === WebSocket.CONNECTING) {
      try { dgWs.close(); } catch (_) {}
    }
  });

  clientWs.on('error', () => {
    if (dgWs.readyState === WebSocket.OPEN || dgWs.readyState === WebSocket.CONNECTING) {
      try { dgWs.close(); } catch (_) {}
    }
  });
}

function safeSend(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }
}

module.exports = { attachVoiceBridge };
