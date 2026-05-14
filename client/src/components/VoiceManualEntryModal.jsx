// v1.22.00 -- Voice Manual Entry modal (wizard flow).
//
// Wizard model: a cursor highlights ONE field at a time. The operator speaks
// only the value (no section keywords). Voice commands:
//   - "Next"              -> advance wizard cursor by one
//   - "Redo"              -> clear the value of the active field
//   - "Submit" / "Done"   -> stop mic, jump to Review screen
//   - "No Time" / "NT"    -> sets the Time field to -1 (only meaningful there)
//
// Hardware hotkeys (SpeechMike F1–F4 or keyboard):
//   Dictation screen:
//   - F1  -> prior field (stays on field 0 — no wrap)
//   - F2  -> toggle record / stop mic
//   - F3  -> next field (+1); on last field -> Done (go to Review)
//   - F4  -> next open/blank field; on last field -> Done
//   Review screen:
//   - F1  -> re-record (discard and return to Dictation)
//   - F3  -> submit (if all fields valid)
//
// Click any field to set a temporary "edit target": the next spoken value
// lands in that clicked field, then the edit target clears (so the wizard
// cursor resumes its previous position). Saying "Next" after a click moves
// from the wizard cursor position, NOT the clicked field.
//
// Status overrides (DNS / DNF / DSQ) are toolbar buttons in the modal header,
// not voice commands. Clicking one prompts for confirmation then submits the
// run with that status.
//
// Jump codes are validated against the event's actual jump_dd_table. Invalid
// codes (mishears, typos, codes not in this event's DD table) flash red so
// the operator can immediately click + re-record or type-correct.

import { useEffect, useMemo, useRef, useState, forwardRef } from 'react';
import { api } from '../utils/api';
import { extractValueForField, tokenizeUtterance, validateJumpCode } from '../voice/parser';
import { createVoiceCapture } from '../voice/audioCapture';

const SCREEN = {
  BIB: 'bib',
  DICTATION: 'dictation',
  REVIEW: 'review',
  NEXT: 'next',
  ERROR: 'error',
};

function StatusGlyph({ status }) {
  if (status === 'ok') return <span className="text-emerald-400">✓</span>;
  if (status === 'warn') return <span className="text-amber-400">!</span>;
  if (status === 'invalid') return <span className="text-rose-400">✗</span>;
  return <span className="text-slate-500">·</span>;
}

function LevelMeter({ level }) {
  const pct = Math.round(Math.min(1, level) * 100);
  return (
    <div className="w-32 h-2 bg-slate-800 rounded overflow-hidden">
      <div className="h-full bg-emerald-500 transition-all duration-75" style={{ width: pct + '%' }} />
    </div>
  );
}

// ---------- Field sequence builder ----------

function buildFieldSequence(event) {
  const numTL = event?.num_tl_judges ?? 3;
  const numAir = event?.num_air_judges ?? 2;
  const numJumps = event?.num_jumps ?? 2;
  const hasSpeed = !!event?.has_speed;
  const componentScoring = event?.component_scoring == null ? true : !!event.component_scoring;
  const isAerials = event?.discipline === 'aerials';

  const fields = [];

  if (hasSpeed && !isAerials) {
    fields.push({ id: 'run_time', label: 'Time', section: null, type: 'time', path: ['run_time'] });
  }
  for (let i = 0; i < numTL; i++) {
    const tlSection = `T&L ${i + 1}`;
    if (componentScoring && !isAerials) {
      fields.push({ id: `tl${i}_carving`, label: 'Carving', section: tlSection, type: 'tl_carving', path: ['tl_components', i, 'carving'] });
      fields.push({ id: `tl${i}_absExt`, label: 'Absorption', section: tlSection, type: 'tl_absExt', path: ['tl_components', i, 'absExt'] });
      fields.push({ id: `tl${i}_upperBody`, label: 'Upper body', section: tlSection, type: 'tl_upperBody', path: ['tl_components', i, 'upperBody'] });
      fields.push({ id: `tl${i}_deduction`, label: 'Deduction', section: tlSection, type: 'tl_deduction', path: ['tl_components', i, 'deduction'] });
    } else if (!isAerials) {
      fields.push({ id: `tl${i}_raw`, label: 'Raw', section: tlSection, type: 'tl_raw', path: ['tl_scores', i] });
      fields.push({ id: `tl${i}_deduction`, label: 'Deduction', section: tlSection, type: 'tl_deduction', path: ['tl_components', i, 'deduction'] });
    }
  }
  if (numJumps >= 1 && !isAerials) {
    fields.push({ id: 'jump1_code', label: 'Jump 1 code', section: 'Jumps', type: 'jump_code', path: ['jump1_code'] });
  }
  if (numJumps >= 2 && !isAerials) {
    fields.push({ id: 'jump2_code', label: 'Jump 2 code', section: 'Jumps', type: 'jump_code', path: ['jump2_code'] });
  }
  for (let i = 0; i < numAir; i++) {
    const ajSection = `Air Judge ${i + 1}`;
    fields.push({ id: `air${i}_jump1`, label: 'Jump 1', section: ajSection, type: 'air_score', path: ['air_jump1_scores', i] });
    if (numJumps >= 2) {
      fields.push({ id: `air${i}_jump2`, label: 'Jump 2', section: ajSection, type: 'air_score', path: ['air_jump2_scores', i] });
    }
  }
  return fields;
}

function emptyEditable(event) {
  const numTL = event?.num_tl_judges ?? 3;
  const numAir = event?.num_air_judges ?? 2;
  const numJumps = event?.num_jumps ?? 2;
  return {
    run_time: null,
    run_status: null,
    jump1_code: null,
    jump2_code: numJumps > 1 ? null : undefined,
    tl_scores: Array(numTL).fill(null),
    tl_components: Array(numTL).fill(null).map(() => ({ carving: null, absExt: null, upperBody: null, deduction: null })),
    air_jump1_scores: Array(numAir).fill(null),
    air_jump2_scores: numJumps > 1 ? Array(numAir).fill(null) : [],
  };
}

function emptyStatuses() {
  return {};
}

// Get/set helpers for path-style addressing into the editable object.
function getIn(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

// "Next" advances the wizard cursor to the next BLANK field. If the current
// position is itself empty (e.g., the operator clicked back to fix an earlier
// field while their wizard cursor was on a still-empty field), it stays put.
// This prevents the cursor from silently skipping over fields the operator
// has not yet entered. If there is no remaining blank, falls back to a
// single-step advance so the cursor still progresses.
function findNextBlank(currentPos, fields, editable) {
  const isBlank = (idx) => {
    const f = fields[idx];
    if (!f) return false;
    const v = getIn(editable, f.path);
    return v == null || v === '';
  };
  if (isBlank(currentPos)) return currentPos;
  for (let i = currentPos + 1; i < fields.length; i++) {
    if (isBlank(i)) return i;
  }
  return Math.min(currentPos + 1, fields.length - 1);
}
function setIn(obj, path, val) {
  const clone = Array.isArray(obj) ? obj.slice() : { ...obj };
  let cur = clone;
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i];
    const next = cur[k];
    cur[k] = Array.isArray(next) ? next.slice() : { ...(next || {}) };
    cur = cur[k];
  }
  cur[path[path.length - 1]] = val;
  return clone;
}

// ---------- Component ----------

export default function VoiceManualEntryModal({
  event,
  mode,            // 'paper' | 'tablet'
  registration,    // pre-selected in tablet mode; null in paper until bib confirmed
  run,             // existing run object in tablet edit mode; null in paper
  runNumber = 1,
  onClose,
  onSuccess,
}) {
  const isPaper = mode === 'paper';

  // Field sequence is derived from event config.
  const fields = useMemo(() => buildFieldSequence(event), [event]);

  const [screen, setScreen] = useState(isPaper ? SCREEN.BIB : SCREEN.DICTATION);
  const [recording, setRecording] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [editable, setEditable] = useState(() => emptyEditable(event));
  const [statuses, setStatuses] = useState(emptyStatuses());
  const [wizardPos, setWizardPos] = useState(0);
  const [editTarget, setEditTarget] = useState(null);
  const [allowedJumpCodes, setAllowedJumpCodes] = useState(new Set());

  const [parsedBib, setParsedBib] = useState(null);
  const [matchedReg, setMatchedReg] = useState(registration || null);
  const [manualBibInput, setManualBibInput] = useState('');
  const [upcoming, setUpcoming] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedName, setLastSavedName] = useState('');
  const [statusConfirm, setStatusConfirm] = useState(null); // 'DNS'|'DNF'|'DSQ'|null

  const captureRef = useRef(null);
  const screenRef = useRef(screen);
  useEffect(() => { screenRef.current = screen; }, [screen]);
  const recordingRef = useRef(recording);
  useEffect(() => { recordingRef.current = recording; }, [recording]);

  // Refs for live transcript-handler reads of latest state.
  const wizardPosRef = useRef(wizardPos);
  useEffect(() => { wizardPosRef.current = wizardPos; }, [wizardPos]);
  const editTargetRef = useRef(editTarget);
  useEffect(() => { editTargetRef.current = editTarget; }, [editTarget]);
  const fieldsRef = useRef(fields);
  useEffect(() => { fieldsRef.current = fields; }, [fields]);
  const allowedJumpRef = useRef(allowedJumpCodes);
  useEffect(() => { allowedJumpRef.current = allowedJumpCodes; }, [allowedJumpCodes]);
  const editableRef = useRef(editable);
  useEffect(() => { editableRef.current = editable; }, [editable]);
  const statusesRef = useRef(statuses);
  useEffect(() => { statusesRef.current = statuses; }, [statuses]);
  const fKeyHandlerRef = useRef(null);

  // Fetch the event's jump-code list once on mount so we can validate codes.
  useEffect(() => {
    if (!event?.id) return;
    const disc = event.discipline === 'aerials' ? 'aerials' : 'mogul';
    const gender = event.gender || 'M';
    fetch(`/api/jump-dds?discipline=${disc}&gender=${gender}&ruleset=uss`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => {
        if (!Array.isArray(data)) return;
        const set = new Set();
        for (const row of data) {
          if (row && row.jump_code) set.add(row.jump_code);
        }
        setAllowedJumpCodes(set);
      })
      .catch(() => { /* validation just becomes permissive */ });
  }, [event?.id, event?.discipline, event?.gender]);

  // Load upcoming athletes for bib lookup in paper mode.
  useEffect(() => {
    if (!isPaper || !event?.id) return;
    let cancelled = false;
    api.getUpcomingAthletes(event.id, runNumber)
      .then(data => {
        if (!cancelled) setUpcoming(Array.isArray(data?.athletes) ? data.athletes : []);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isPaper, event?.id, runNumber, lastSavedName]);

  // F1/F2/F3/F4/Escape hotkeys. fKeyHandlerRef.current is assigned each render
  // (below, after all component functions are defined) to avoid stale closures.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'F1' || e.key === 'F3' || e.key === 'F4') {
        e.preventDefault();
        fKeyHandlerRef.current?.(e.key);
      } else if (e.key === 'F2') {
        const s = screenRef.current;
        if (s === SCREEN.BIB || s === SCREEN.DICTATION || s === SCREEN.NEXT) {
          e.preventDefault();
          toggleRecording();
        }
      } else if (e.key === 'Escape') {
        if (recordingRef.current) return;
        onClose && onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (captureRef.current && captureRef.current.isActive()) {
      try { captureRef.current.stop(); } catch (_) {}
    }
  }, []);

  // ---------- Recording control ----------

  async function startRecording() {
    setError(null);
    if (screenRef.current === SCREEN.NEXT) {
      setScreen(SCREEN.BIB);
      setParsedBib(null);
      setMatchedReg(null);
    }
    setInterimTranscript('');
    setFinalTranscript('');

    try {
      const cap = createVoiceCapture({
        eventId: event.id,
        onReady: () => setVoiceReady(true),
        onLevel: (l) => setAudioLevel(l),
        onTranscript: ({ transcript, is_final }) => {
          if (is_final) {
            setFinalTranscript(prev => (prev ? prev + ' ' : '') + transcript);
            setInterimTranscript('');
            // Process each final utterance against current wizard state.
            handleUtterance(transcript);
          } else {
            setInterimTranscript(transcript);
          }
        },
        onError: (e) => {
          setError(e.message || 'Voice service unavailable');
          setScreen(SCREEN.ERROR);
          setRecording(false);
        },
        onClose: () => {
          setRecording(false);
          setVoiceReady(false);
        },
      });
      captureRef.current = cap;
      await cap.start();
      setRecording(true);
    } catch (e) {
      setError(e.message || 'Could not start voice capture');
      setScreen(SCREEN.ERROR);
    }
  }

  async function stopRecording() {
    if (!captureRef.current || !captureRef.current.isActive()) {
      setRecording(false);
      return;
    }
    await captureRef.current.stop();
    setRecording(false);
    setVoiceReady(false);
    captureRef.current = null;

    if (screenRef.current === SCREEN.BIB) {
      // Bib was being captured -- run bib match on the accumulated transcript.
      const t = (finalTranscript + ' ' + interimTranscript).trim();
      handleBibTranscript(t);
    }
  }

  function toggleRecording() {
    if (recordingRef.current) stopRecording();
    else startRecording();
  }

  // ---------- Live utterance handler (wizard) ----------

  function handleUtterance(utterance) {
    if (screenRef.current !== SCREEN.DICTATION) return;

    const segments = tokenizeUtterance(utterance);
    if (segments.length === 0) return;

    // Multiple Deepgram final messages can arrive back-to-back faster than
    // React re-renders, so reading from useState would yield stale values.
    // The refs ARE updated synchronously at the end of this function (below),
    // so the next call sees the latest state regardless of render timing.
    let localEditable = editableRef.current;
    let localStatuses = statusesRef.current;
    let localWizardPos = wizardPosRef.current;
    let localEditTarget = editTargetRef.current;
    const fieldsArr = fieldsRef.current;
    const opts = { allowedJumpCodes: allowedJumpRef.current, isAerials: event.discipline === 'aerials' };

    const commitToRefs = () => {
      editableRef.current = localEditable;
      statusesRef.current = localStatuses;
      wizardPosRef.current = localWizardPos;
      editTargetRef.current = localEditTarget;
    };

    const flushAndGoToReview = () => {
      commitToRefs();
      setEditable(localEditable);
      setStatuses(localStatuses);
      setWizardPos(localWizardPos);
      setEditTarget(localEditTarget);
      if (captureRef.current && captureRef.current.isActive()) {
        captureRef.current.stop().then(() => {
          setRecording(false);
          setVoiceReady(false);
          captureRef.current = null;
          setScreen(SCREEN.REVIEW);
        });
      } else {
        setScreen(SCREEN.REVIEW);
      }
    };

    for (let s = 0; s < segments.length; s++) {
      const { chunk, cmd } = segments[s];

      if (chunk) {
        const activeIdx = localEditTarget != null ? localEditTarget : localWizardPos;
        const field = fieldsArr[activeIdx];
        if (field) {
          const { value, status } = extractValueForField(chunk, field.type, opts);
          if (value != null) {
            localEditable = setIn(localEditable, field.path, value);
            localStatuses = { ...localStatuses, [field.id]: status };
            if (localEditTarget != null) localEditTarget = null;
          }
        }
      }

      if (cmd === 'submit') {
        flushAndGoToReview();
        return;
      } else if (cmd === 'next') {
        localWizardPos = findNextBlank(localWizardPos, fieldsArr, localEditable);
        localEditTarget = null;
      } else if (cmd === 'redo') {
        const activeIdx = localEditTarget != null ? localEditTarget : localWizardPos;
        const field = fieldsArr[activeIdx];
        if (field) {
          localEditable = setIn(localEditable, field.path, null);
          localStatuses = { ...localStatuses, [field.id]: null };
        }
      } else if (cmd === 'no_time') {
        const activeIdx = localEditTarget != null ? localEditTarget : localWizardPos;
        const field = fieldsArr[activeIdx];
        if (field && field.type === 'time') {
          localEditable = setIn(localEditable, field.path, -1);
          localStatuses = { ...localStatuses, [field.id]: 'ok' };
          if (localEditTarget != null) localEditTarget = null;
        }
      }
    }

    // Synchronously update refs first, THEN trigger React state updates.
    commitToRefs();
    setEditable(localEditable);
    setStatuses(localStatuses);
    setWizardPos(localWizardPos);
    setEditTarget(localEditTarget);
  }

  // ---------- Bib flow (paper mode) ----------

  function handleBibTranscript(text) {
    const m = (text || '').match(/\b(\d{1,3})\b/);
    if (!m) {
      setError('Could not detect a bib number. Try again or type it below.');
      setParsedBib(null);
      setMatchedReg(null);
      return;
    }
    const bib = parseInt(m[1], 10);
    setParsedBib(bib);
    setError(null);
    const reg = upcoming.find(a => Number(a.bib_number) === bib);
    if (reg) setMatchedReg(reg);
    else {
      setMatchedReg(null);
      setError(`No athlete with bib ${bib} remaining in this round.`);
    }
  }

  function acceptBib() {
    if (!matchedReg) return;
    setScreen(SCREEN.DICTATION);
    setError(null);
    setEditable(emptyEditable(event));
    setStatuses(emptyStatuses());
    setWizardPos(0);
    setEditTarget(null);
    setFinalTranscript('');
    setInterimTranscript('');
  }

  function rejectBib() {
    setParsedBib(null);
    setMatchedReg(null);
    setError(null);
  }

  function selectBibFromList(bibNum) {
    const reg = upcoming.find(a => Number(a.bib_number) === Number(bibNum));
    setManualBibInput(String(bibNum));
    setParsedBib(Number(bibNum));
    setMatchedReg(reg || null);
    setError(reg ? null : `Bib ${bibNum} not in upcoming list.`);
  }

  // ---------- Submit ----------

  async function submit() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = serializeEditable(editable, event, finalTranscript);
      const reg = matchedReg || registration;
      // Dispatch on what's available: run = edit existing, registration = new entry.
      // The same modal serves three opening paths (top-level paper button, per-row
      // Manual Entry tablet entry, active-run edit), so we can't rely on isPaper.
      if (run) {
        await api.manualScore(event.id, run.id, body);
        if (onSuccess) onSuccess({ runId: run.id });
        onClose && onClose();
      } else if (reg) {
        body.registration_id = reg.id;
        body.run_number = runNumber;
        await api.manualEntry(event.id, body);
        if (isPaper) {
          // Paper batch flow: prompt for next bib.
          setLastSavedName(`bib ${reg.bib_number}, ${reg.first_name} ${reg.last_name}`);
          setScreen(SCREEN.NEXT);
          setEditable(emptyEditable(event));
          setStatuses(emptyStatuses());
          setWizardPos(0);
          setEditTarget(null);
          setParsedBib(null);
          setMatchedReg(null);
          setFinalTranscript('');
          if (onSuccess) onSuccess({ registrationId: reg.id });
        } else {
          // Tablet-mode new entry: close immediately.
          if (onSuccess) onSuccess({ registrationId: reg.id });
          onClose && onClose();
        }
      } else {
        throw new Error('No athlete or run selected');
      }
    } catch (e) {
      setError(e.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitStatus(statusCode) {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const reg = matchedReg || registration;
      const body = { run_status: statusCode, voice_transcript: finalTranscript || null };
      if (run) {
        await api.manualScore(event.id, run.id, body);
        if (onSuccess) onSuccess({ runId: run.id });
        onClose && onClose();
      } else if (reg) {
        body.registration_id = reg.id;
        body.run_number = runNumber;
        await api.manualEntry(event.id, body);
        if (isPaper) {
          setLastSavedName(`bib ${reg.bib_number}, ${reg.first_name} ${reg.last_name} (${statusCode})`);
          setScreen(SCREEN.NEXT);
          setEditable(emptyEditable(event));
          setStatuses(emptyStatuses());
          setWizardPos(0);
          setParsedBib(null);
          setMatchedReg(null);
          setFinalTranscript('');
          if (onSuccess) onSuccess({ registrationId: reg.id });
        } else {
          if (onSuccess) onSuccess({ registrationId: reg.id });
          onClose && onClose();
        }
      } else {
        throw new Error('No athlete or run selected');
      }
    } catch (e) {
      setError(e.message || 'Submit failed');
    } finally {
      setSubmitting(false);
      setStatusConfirm(null);
    }
  }

  function done() { onClose && onClose(); }

  function cancelReview() {
    if (isPaper) {
      setScreen(SCREEN.BIB);
      setEditable(emptyEditable(event));
      setStatuses(emptyStatuses());
      setMatchedReg(null);
      setParsedBib(null);
      setFinalTranscript('');
    } else {
      onClose && onClose();
    }
  }

  function reRecord() {
    setEditable(emptyEditable(event));
    setStatuses(emptyStatuses());
    setWizardPos(0);
    setEditTarget(null);
    setFinalTranscript('');
    setInterimTranscript('');
    setScreen(SCREEN.DICTATION);
  }

  // Component-level "go to review" used by F3/F4 key handler (no local
  // utterance variables to commit — state is already current via refs).
  function goToReviewFromKey() {
    if (captureRef.current && captureRef.current.isActive()) {
      captureRef.current.stop().then(() => {
        setRecording(false);
        setVoiceReady(false);
        captureRef.current = null;
        setScreen(SCREEN.REVIEW);
      });
    } else {
      setScreen(SCREEN.REVIEW);
    }
  }

  // F1/F3/F4 dispatch — re-assigned every render so closures are always fresh.
  fKeyHandlerRef.current = (key) => {
    const s = screenRef.current;
    const pos = wizardPosRef.current;
    const flds = fieldsRef.current;
    const edbl = editableRef.current;

    if (s === SCREEN.DICTATION) {
      if (key === 'F1') {
        const prev = Math.max(0, pos - 1);
        wizardPosRef.current = prev;
        editTargetRef.current = null;
        setWizardPos(prev);
        setEditTarget(null);
      } else if (key === 'F3') {
        if (pos >= flds.length - 1) {
          goToReviewFromKey();
        } else {
          const next = pos + 1;
          wizardPosRef.current = next;
          editTargetRef.current = null;
          setWizardPos(next);
          setEditTarget(null);
        }
      } else if (key === 'F4') {
        if (pos >= flds.length - 1) {
          goToReviewFromKey();
        } else {
          const next = findNextBlank(pos, flds, edbl);
          wizardPosRef.current = next;
          editTargetRef.current = null;
          setWizardPos(next);
          setEditTarget(null);
        }
      }
    } else if (s === SCREEN.REVIEW) {
      if (key === 'F1') {
        reRecord();
      } else if (key === 'F3') {
        if (isReadyToSubmit(edbl, event, allowedJumpCodes)) {
          submit();
        }
      }
    }
  };

  // ---------- Rendering ----------

  const activeAthleteName = matchedReg
    ? `bib ${matchedReg.bib_number} · ${matchedReg.first_name} ${matchedReg.last_name}`
    : (run ? `bib ${run.bib_number} · ${run.first_name} ${run.last_name}` : null);

  const showStatusToolbar = (screen === SCREEN.DICTATION || screen === SCREEN.REVIEW)
    && (matchedReg || registration || run);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-100">
            Voice Manual Entry
            {activeAthleteName && <span className="ml-3 text-sm text-slate-400">· {activeAthleteName}</span>}
          </h2>
          <div className="flex items-center gap-2">
            {showStatusToolbar && (
              <>
                <button onClick={() => setStatusConfirm('DNS')} className="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white" title="Mark as DNS (did not start)">DNS</button>
                <button onClick={() => setStatusConfirm('DNF')} className="text-xs px-3 py-1 rounded bg-amber-700 hover:bg-amber-600 text-white" title="Mark as DNF (did not finish)">DNF</button>
                <button onClick={() => setStatusConfirm('DSQ')} className="text-xs px-3 py-1 rounded bg-rose-700 hover:bg-rose-600 text-white" title="Disqualify">DSQ</button>
              </>
            )}
            <button
              onClick={() => { if (recordingRef.current) { stopRecording(); } onClose && onClose(); }}
              className="text-slate-400 hover:text-slate-200 text-2xl leading-none ml-1"
              aria-label="Close"
            >×</button>
          </div>
        </div>

        <div className="p-6">
          {screen === SCREEN.BIB && (
            <BibScreen
              parsedBib={parsedBib}
              matchedReg={matchedReg}
              recording={recording}
              audioLevel={audioLevel}
              error={error}
              interim={interimTranscript || finalTranscript}
              onToggle={toggleRecording}
              onAccept={acceptBib}
              onReject={rejectBib}
              upcoming={upcoming}
              manualBibInput={manualBibInput}
              setManualBibInput={setManualBibInput}
              onSelectFromList={selectBibFromList}
              onDone={done}
            />
          )}
          {screen === SCREEN.DICTATION && (
            <DictationScreen
              fields={fields}
              editable={editable}
              statuses={statuses}
              wizardPos={wizardPos}
              editTarget={editTarget}
              setWizardPos={(p) => { wizardPosRef.current = p; setWizardPos(p); }}
              setEditTarget={(p) => { editTargetRef.current = p; setEditTarget(p); }}
              recording={recording}
              audioLevel={audioLevel}
              interim={interimTranscript}
              finalText={finalTranscript}
              onToggle={toggleRecording}
              onCancel={() => { if (isPaper) { setScreen(SCREEN.BIB); } else { onClose && onClose(); } }}
              onReview={() => setScreen(SCREEN.REVIEW)}
            />
          )}
          {screen === SCREEN.REVIEW && (
            <ReviewScreen
              event={event}
              fields={fields}
              editable={editable}
              statuses={statuses}
              setEditable={setEditable}
              setStatuses={setStatuses}
              allowedJumpCodes={allowedJumpCodes}
              transcript={finalTranscript}
              submitting={submitting}
              error={error}
              onSubmit={submit}
              onCancel={cancelReview}
              onReRecord={reRecord}
            />
          )}
          {screen === SCREEN.NEXT && (
            <NextAthleteScreen
              lastSavedName={lastSavedName}
              recording={recording}
              audioLevel={audioLevel}
              onToggle={toggleRecording}
              onDone={done}
            />
          )}
          {screen === SCREEN.ERROR && (
            <ErrorScreen
              error={error}
              onRetry={() => { setError(null); setScreen(isPaper ? SCREEN.BIB : SCREEN.DICTATION); }}
              onClose={done}
            />
          )}
        </div>
      </div>

      {statusConfirm && (
        <StatusConfirmDialog
          status={statusConfirm}
          athleteName={activeAthleteName}
          onConfirm={() => submitStatus(statusConfirm)}
          onCancel={() => setStatusConfirm(null)}
          submitting={submitting}
        />
      )}
    </div>
  );
}

// ---------- Screens ----------

function BibScreen({ parsedBib, matchedReg, recording, audioLevel, error, interim, onToggle, onAccept, onReject, upcoming, manualBibInput, setManualBibInput, onSelectFromList, onDone }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <button
          onClick={onToggle}
          className={`mx-auto flex items-center justify-center w-24 h-24 rounded-full border-4 transition-all ${
            recording ? 'bg-rose-500 border-rose-400 animate-pulse' : 'bg-slate-800 border-slate-600 hover:border-mountain-500'
          }`}
        >
          <span className="text-4xl">{recording ? '⏺' : '🎙'}</span>
        </button>
        <p className="mt-4 text-slate-300">
          {recording ? 'Recording — speak the bib number, then press stop' : 'Press start, then speak the bib number'}
        </p>
        <p className="mt-1 text-xs text-slate-500">F2 toggles record · PowerMic button if configured</p>
        {recording && <div className="mt-3 flex justify-center"><LevelMeter level={audioLevel} /></div>}
        {interim && <p className="mt-3 text-slate-400 italic">"{interim}"</p>}
      </div>

      {parsedBib != null && matchedReg && (
        <div className="bg-slate-800 border border-slate-700 rounded p-4 text-center space-y-3">
          <div className="text-4xl font-bold text-emerald-400">Bib {matchedReg.bib_number}</div>
          <div className="text-xl text-slate-200">{matchedReg.first_name} {matchedReg.last_name}</div>
          <div className="flex gap-3 justify-center">
            <button onClick={onAccept} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded text-white font-semibold">Accept & Start Entry</button>
            <button onClick={onReject} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Reject</button>
          </div>
        </div>
      )}

      {error && (
        <div className="bg-rose-900/30 border border-rose-700 rounded p-4 space-y-3">
          <p className="text-rose-300">{error}</p>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              value={manualBibInput}
              onChange={(e) => setManualBibInput(e.target.value)}
              placeholder="Type bib"
              className="bg-slate-900 border border-slate-700 rounded px-3 py-2 text-slate-100 w-32"
            />
            <button
              onClick={() => onSelectFromList(manualBibInput)}
              className="px-3 py-2 bg-mountain-600 hover:bg-mountain-500 rounded text-white"
            >Use Bib</button>
          </div>
          {upcoming.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-400 hover:text-slate-200">Remaining athletes ({upcoming.length})</summary>
              <div className="mt-2 max-h-48 overflow-y-auto border border-slate-700 rounded">
                <table className="w-full text-left">
                  <thead className="bg-slate-800 text-xs text-slate-400 uppercase">
                    <tr><th className="px-2 py-1">Order</th><th className="px-2 py-1">Bib</th><th className="px-2 py-1">Athlete</th></tr>
                  </thead>
                  <tbody>
                    {upcoming.map(a => (
                      <tr key={a.id} className="border-t border-slate-700 hover:bg-slate-800 cursor-pointer" onClick={() => onSelectFromList(a.bib_number)}>
                        <td className="px-2 py-1 text-slate-400">{a.run_order}</td>
                        <td className="px-2 py-1 text-slate-200">{a.bib_number}</td>
                        <td className="px-2 py-1 text-slate-200">{a.first_name} {a.last_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={onDone} className="text-slate-400 hover:text-slate-200 underline text-sm">Done</button>
      </div>
    </div>
  );
}

function DictationScreen({ fields, editable, statuses, wizardPos, editTarget, setWizardPos, setEditTarget, recording, audioLevel, interim, finalText, onToggle, onCancel, onReview }) {
  const activeIdx = editTarget != null ? editTarget : wizardPos;
  const activeField = fields[activeIdx];

  // Group fields by section so we can render section headers (T&L 1, etc.).
  const groups = useMemo(() => groupFields(fields), [fields]);

  // Every field filled AND no field is currently flagged invalid.
  const allValid = useMemo(() => {
    for (const f of fields) {
      const v = getIn(editable, f.path);
      if (v == null || v === '') return false;
      if (statuses[f.id] === 'invalid') return false;
    }
    return true;
  }, [fields, editable, statuses]);

  // Keep the active field in view AND keep ~2-3 rows of context visible below
  // it, so the operator can preview what's coming next while dictating.
  const activeRowRef = useRef(null);
  useEffect(() => {
    const el = activeRowRef.current;
    if (!el) return;
    const container = el.closest('.overflow-y-auto');
    if (!container) {
      if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const rowH = eRect.height || 28;
    const bottomBuffer = rowH * 2.5; // ~2-3 rows of look-ahead
    const topBuffer = rowH * 1.2;    // ~1 row of look-behind

    if (eRect.bottom + bottomBuffer > cRect.bottom) {
      const delta = (eRect.bottom + bottomBuffer) - cRect.bottom;
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
    } else if (eRect.top - topBuffer < cRect.top) {
      const delta = (cRect.top + topBuffer) - eRect.top;
      container.scrollTo({ top: Math.max(0, container.scrollTop - delta), behavior: 'smooth' });
    }
  }, [activeIdx]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={onToggle}
            className={`flex items-center justify-center w-14 h-14 rounded-full border-2 transition-all ${
              recording ? 'bg-rose-500 border-rose-400 animate-pulse' : 'bg-slate-800 border-slate-600 hover:border-mountain-500'
            }`}
          >
            <span className="text-2xl">{recording ? '⏺' : '🎙'}</span>
          </button>
          <div>
            <div className="font-semibold text-slate-100">
              {recording
                ? <>Speak <span className="text-mountain-300">{activeField?.label || '—'}</span></>
                : 'Press start to dictate'}
            </div>
            <div className="text-xs text-slate-500">
              "Next" advance · "Redo" clear · "Submit" / "Done" finish · click any field to retarget
            </div>
          </div>
        </div>
        {recording && <LevelMeter level={audioLevel} />}
      </div>

      <div className="bg-slate-950 border border-slate-800 rounded p-4 max-h-96 overflow-y-auto space-y-3">
        {groups.map((g, gi) => (
          <div key={gi}>
            {g.section && <div className="text-slate-300 font-semibold text-sm mb-1">{g.section}</div>}
            <div className={g.section ? 'pl-2 space-y-0.5' : 'space-y-0.5'}>
              {g.items.map(({ field, idx }) => {
                const value = getIn(editable, field.path);
                const status = statuses[field.id];
                const isWizard = idx === wizardPos;
                const isEditTarget = editTarget === idx;
                const isActive = idx === activeIdx;
                return (
                  <FieldRow
                    key={field.id}
                    ref={isActive ? activeRowRef : null}
                    label={field.label}
                    value={value}
                    type={field.type}
                    status={status}
                    isWizard={isWizard}
                    isEditTarget={isEditTarget}
                    onClick={() => setEditTarget(idx)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {(interim || finalText) && (
        <div className="bg-slate-950 border border-slate-800 rounded p-3 text-slate-400 text-sm italic max-h-20 overflow-y-auto">
          <span className="text-slate-500">{finalText}</span> <span>{interim}</span>
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onCancel} className="px-3 py-1.5 text-slate-400 hover:text-slate-200 underline text-sm">Cancel</button>
        <div className="flex gap-2">
          <button
            onClick={onReview}
            className={`px-3 py-1.5 rounded text-sm font-semibold transition-colors ${
              allValid
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
            }`}
            title="Or say 'Submit' / 'Done'"
          >{allValid ? 'Review and Approve →' : 'Review →'}</button>
          <button onClick={onToggle} className={`px-4 py-2 rounded font-semibold ${recording ? 'bg-rose-600 hover:bg-rose-500 text-white' : 'bg-mountain-600 hover:bg-mountain-500 text-white'}`}>
            {recording ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>
    </div>
  );
}

function groupFields(fields) {
  const groups = [];
  let cur = null;
  fields.forEach((field, idx) => {
    if (!cur || cur.section !== field.section) {
      cur = { section: field.section, items: [] };
      groups.push(cur);
    }
    cur.items.push({ field, idx });
  });
  return groups;
}

function formatFieldValue(value, type) {
  if (value == null || value === '') return '____';
  if (type === 'time' && value === -1) return 'NT';
  if (type === 'jump_code') return String(value);
  if (typeof value !== 'number' || !isFinite(value)) return String(value);
  if (type === 'time') return value.toFixed(2);
  return value.toFixed(1); // TL components, raw, deduction, air scores
}

const FieldRow = forwardRef(function FieldRow({ label, value, type, status, isWizard, isEditTarget, onClick }, ref) {
  const display = formatFieldValue(value, type);
  let valueColor = 'text-slate-500';
  if (status === 'ok') valueColor = 'text-emerald-300';
  else if (status === 'warn') valueColor = 'text-amber-300';
  else if (status === 'invalid') valueColor = 'text-rose-300';

  const baseRow = 'flex items-center gap-3 px-2 py-1 text-sm rounded transition-colors cursor-pointer';
  let highlight = 'hover:bg-slate-900';
  if (isWizard && !isEditTarget) highlight = 'bg-mountain-900/40 ring-2 ring-mountain-500';
  if (isEditTarget) highlight = 'bg-amber-900/40 ring-2 ring-amber-400 ring-dashed';

  return (
    <div ref={ref} className={`${baseRow} ${highlight}`} onClick={onClick}>
      <span className="w-4 text-center"><StatusGlyph status={status} /></span>
      <span className="text-slate-400 flex-1">{label}</span>
      <span className={`font-bold font-mono ${valueColor}`}>{display}</span>
    </div>
  );
});

function ReviewScreen({ event, fields, editable, statuses, setEditable, setStatuses, allowedJumpCodes, transcript, submitting, error, onSubmit, onCancel, onReRecord }) {
  const allFilled = useMemo(() => isReadyToSubmit(editable, event, allowedJumpCodes), [editable, event, allowedJumpCodes]);

  const groups = useMemo(() => groupFields(fields), [fields]);

  function update(field, val) {
    setEditable(prev => setIn(prev, field.path, val));
    // Recompute status for that field.
    if (field.type === 'jump_code') {
      const status = validateJumpCode(val, allowedJumpCodes);
      setStatuses(prev => ({ ...prev, [field.id]: val ? status : null }));
    } else {
      // For numeric fields, defer status recompute -- assume ok if a numeric was typed.
      setStatuses(prev => ({ ...prev, [field.id]: (val == null || val === '') ? null : 'ok' }));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-950 border border-slate-800 rounded p-3">
          <div className="text-xs uppercase text-slate-500 mb-2">Transcript</div>
          <div className="text-slate-300 text-sm whitespace-pre-wrap">{transcript || <em className="text-slate-600">(empty)</em>}</div>
        </div>
        <div className="bg-slate-950 border border-slate-800 rounded p-3 space-y-1 text-sm">
          <div className="text-xs uppercase text-slate-500 mb-2">Parsed Values · Click to edit</div>
          {groups.map((g, gi) => (
            <div key={gi} className={gi > 0 ? 'border-t border-slate-800 pt-2 mt-2' : ''}>
              {g.section && <div className="text-slate-400 font-semibold">{g.section}</div>}
              {g.items.map(({ field }) => {
                const value = getIn(editable, field.path);
                const status = statuses[field.id];
                return (
                  <Row key={field.id} label={field.label} status={status}>
                    {field.type === 'jump_code'
                      ? <TextInput value={value} onChange={(v) => update(field, v)} />
                      : <NumberInput value={value} onChange={(v) => update(field, v)} />
                    }
                  </Row>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {error && <div className="bg-rose-900/30 border border-rose-700 rounded p-3 text-rose-300 text-sm">{error}</div>}

      <div className="flex justify-between items-center gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 text-slate-400 hover:text-slate-200 underline text-sm">Cancel</button>
        <div className="flex gap-2">
          <button onClick={onReRecord} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Re-record</button>
          <button onClick={onSubmit} disabled={!allFilled || submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 rounded text-white font-semibold">
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
}

function NextAthleteScreen({ lastSavedName, recording, audioLevel, onToggle, onDone }) {
  return (
    <div className="space-y-6 text-center">
      <div className="bg-emerald-900/30 border border-emerald-700 rounded p-3 text-emerald-300">
        Score saved for {lastSavedName}.
      </div>
      <div>
        <button
          onClick={onToggle}
          className={`mx-auto flex items-center justify-center w-24 h-24 rounded-full border-4 transition-all ${
            recording ? 'bg-rose-500 border-rose-400 animate-pulse' : 'bg-slate-800 border-slate-600 hover:border-mountain-500'
          }`}
        >
          <span className="text-4xl">{recording ? '⏺' : '🎙'}</span>
        </button>
        <p className="mt-4 text-slate-300">Press start, then speak the next bib number, or press Done to finish.</p>
        {recording && <div className="mt-3 flex justify-center"><LevelMeter level={audioLevel} /></div>}
      </div>
      <div className="flex justify-center">
        <button onClick={onDone} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Done</button>
      </div>
    </div>
  );
}

function ErrorScreen({ error, onRetry, onClose }) {
  return (
    <div className="space-y-6 text-center">
      <div className="bg-rose-900/30 border border-rose-700 rounded p-4">
        <div className="text-rose-300 font-semibold mb-2">Voice service unavailable</div>
        <div className="text-rose-200 text-sm">{error || 'Use keyboard manual entry.'}</div>
      </div>
      <div className="flex justify-center gap-3">
        <button onClick={onRetry} className="px-4 py-2 bg-mountain-600 hover:bg-mountain-500 rounded text-white">Retry</button>
        <button onClick={onClose} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Close</button>
      </div>
    </div>
  );
}

function StatusConfirmDialog({ status, athleteName, onConfirm, onCancel, submitting }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-md p-5">
        <h3 className="text-lg font-semibold text-slate-100 mb-2">Mark as {status}?</h3>
        <p className="text-slate-300 text-sm mb-5">
          {athleteName ? `${athleteName} will be recorded as ${status}.` : `Record this athlete as ${status}.`}
          {' '}This overrides any scores entered so far.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} disabled={submitting} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded text-slate-200">Cancel</button>
          <button onClick={onConfirm} disabled={submitting} className="px-4 py-2 bg-rose-600 hover:bg-rose-500 rounded text-white font-semibold">
            {submitting ? 'Submitting…' : `Confirm ${status}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Inputs ----------

function NumberInput({ value, onChange }) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => { setText(value == null ? '' : String(value)); }, [value]);
  return (
    <input
      type="number"
      step="0.01"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = text === '' ? null : parseFloat(text);
        onChange(isFinite(v) ? v : null);
      }}
      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 w-24 text-right"
    />
  );
}

function TextInput({ value, onChange }) {
  return (
    <input
      type="text"
      value={value || ''}
      onChange={(e) => onChange(e.target.value || null)}
      className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-slate-100 w-24"
    />
  );
}

function Row({ label, status, children }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-4 text-center"><StatusGlyph status={status} /></span>
      <span className="text-slate-400 flex-1">{label}</span>
      {children}
    </div>
  );
}

// ---------- Helpers ----------

function isReadyToSubmit(editable, event, allowedJumpCodes) {
  if (!editable) return false;
  if (editable.run_status) return true;
  const numTL = event?.num_tl_judges ?? 3;
  const numAir = event?.num_air_judges ?? 2;
  const numJumps = event?.num_jumps ?? 2;
  const hasSpeed = !!event?.has_speed;
  const componentScoring = event?.component_scoring == null ? true : !!event.component_scoring;
  if (hasSpeed && editable.run_time == null) return false;
  for (let i = 0; i < numTL; i++) {
    const comp = editable.tl_components[i] || {};
    if (componentScoring) {
      if (comp.carving == null || comp.absExt == null || comp.upperBody == null || comp.deduction == null) return false;
    } else {
      if (editable.tl_scores[i] == null || comp.deduction == null) return false;
    }
  }
  // Jump codes must be present AND valid (when an allowed set is loaded).
  const set = allowedJumpCodes instanceof Set ? allowedJumpCodes : new Set();
  if (numJumps >= 1) {
    if (!editable.jump1_code) return false;
    if (set.size > 0 && !set.has(editable.jump1_code)) return false;
  }
  if (numJumps >= 2) {
    if (!editable.jump2_code) return false;
    if (set.size > 0 && !set.has(editable.jump2_code)) return false;
  }
  for (let i = 0; i < numAir; i++) {
    if (editable.air_jump1_scores[i] == null) return false;
    if (numJumps >= 2 && editable.air_jump2_scores[i] == null) return false;
  }
  return true;
}

function serializeEditable(editable, event, transcript) {
  if (editable.run_status) {
    return { run_status: editable.run_status, voice_transcript: transcript || null };
  }
  const componentScoring = event?.component_scoring == null ? true : !!event.component_scoring;
  const numTL = event?.num_tl_judges ?? 3;
  const numAir = event?.num_air_judges ?? 2;
  const numJumps = event?.num_jumps ?? 2;

  const tlScores = [];
  const tlComponents = [];
  for (let i = 0; i < numTL; i++) {
    const c = editable.tl_components[i] || {};
    if (componentScoring) {
      const total = (c.carving || 0) + (c.absExt || 0) + (c.upperBody || 0) - (c.deduction || 0);
      tlScores.push(Math.max(0.1, Math.min(20, total)));
      tlComponents.push({ carving: c.carving, absExt: c.absExt, upperBody: c.upperBody, deduction: c.deduction });
    } else {
      tlScores.push(editable.tl_scores[i]);
      tlComponents.push({ carving: null, absExt: null, upperBody: null, deduction: c.deduction });
    }
  }

  return {
    jump1_code: numJumps >= 1 ? editable.jump1_code || null : null,
    jump2_code: numJumps >= 2 ? editable.jump2_code || null : null,
    tl_scores: tlScores,
    tl_components: tlComponents,
    air_jump1_scores: editable.air_jump1_scores.slice(0, numAir),
    air_jump2_scores: numJumps >= 2 ? editable.air_jump2_scores.slice(0, numAir) : [],
    form_scores: [],
    landing_scores: [],
    run_time: editable.run_time,
    voice_transcript: transcript || null,
  };
}
