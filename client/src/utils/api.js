const API_BASE = '/api';

async function apiFetch(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}

export const api = {
  // Meets
  getMeets: (opts = {}) => apiFetch(`/meets${opts.excludeLocked ? '?excludeLocked=1' : ''}`),
  getMeet: (id, opts = {}) => apiFetch(`/meets/${id}${opts.excludeLocked ? '?excludeLocked=1' : ''}`),
  createMeet: (data) => apiFetch('/meets', { method: 'POST', body: data }),
  updateMeet: (id, data) => apiFetch(`/meets/${id}`, { method: 'PUT', body: data }),
  deleteMeet: (id) => apiFetch(`/meets/${id}`, { method: 'DELETE' }),

  // Events
  getEvents: (meetId) => apiFetch(`/meets/${meetId}/events`),
  getEvent: (meetId, id) => apiFetch(`/meets/${meetId}/events/${id}`),
  createEvent: (meetId, data) => apiFetch(`/meets/${meetId}/events`, { method: 'POST', body: data }),
  updateEvent: (meetId, id, data) => apiFetch(`/meets/${meetId}/events/${id}`, { method: 'PUT', body: data }),
  deleteEvent: (meetId, id) => apiFetch(`/meets/${meetId}/events/${id}`, { method: 'DELETE' }),

  // Athletes
  getAthletes: (q) => apiFetch(`/athletes${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  getAthlete: (id) => apiFetch(`/athletes/${id}`),
  createAthlete: (data) => apiFetch('/athletes', { method: 'POST', body: data }),
  updateAthlete: (id, data) => apiFetch(`/athletes/${id}`, { method: 'PUT', body: data }),

  // Registrations
  getRegistrations: (eventId) => apiFetch(`/events/${eventId}/registrations`),
  register: (eventId, data) => apiFetch(`/events/${eventId}/registrations`, { method: 'POST', body: data }),
  bulkRegister: (eventId, ids) => apiFetch(`/events/${eventId}/registrations/bulk`, { method: 'POST', body: { athlete_ids: ids } }),
  updateRegistration: (eventId, id, data) => apiFetch(`/events/${eventId}/registrations/${id}`, { method: 'PUT', body: data }),
  importBibsFromAthletes: (eventId) => apiFetch(`/events/${eventId}/registrations/import-bibs-from-athletes`, { method: 'POST' }),
  exportBibsToAthletes: (eventId) => apiFetch(`/events/${eventId}/registrations/export-bibs-to-athletes`, { method: 'POST' }),
  previewImportBibsFromEvent: (eventId, sourceEventId) => apiFetch(`/events/${eventId}/registrations/preview-import-bibs-from-event`, { method: 'POST', body: { sourceEventId } }),
  importBibsFromEvent: (eventId, sourceEventId) => apiFetch(`/events/${eventId}/registrations/import-bibs-from-event`, { method: 'POST', body: { sourceEventId } }),
  removeRegistration: (eventId, id) => apiFetch(`/events/${eventId}/registrations/${id}`, { method: 'DELETE' }),
  reorderRegistrations: (eventId, items) => apiFetch(`/events/${eventId}/registrations/reorder`, { method: 'PUT', body: items }),
  randomOrder: (eventId) => apiFetch(`/events/${eventId}/registrations/random-order`, { method: 'POST' }),
  seedFromResults: (eventId) => apiFetch(`/events/${eventId}/registrations/seed-from-results`, { method: 'POST' }),
  orderByAgeGroups: (eventId) => apiFetch(`/events/${eventId}/registrations/order-by-age-groups`, { method: 'POST' }),

  // Judges
  getJudges: (eventId) => apiFetch(`/events/${eventId}/judges`),
  addJudge: (eventId, data) => apiFetch(`/events/${eventId}/judges`, { method: 'POST', body: data }),
  updateJudge: (eventId, id, data) => apiFetch(`/events/${eventId}/judges/${id}`, { method: 'PUT', body: data }),
  removeJudge: (eventId, id) => apiFetch(`/events/${eventId}/judges/${id}`, { method: 'DELETE' }),
  // v1.18.00 — Aerials v2 panel seeding
  seedAerialsJudges: (eventId, data = {}) => apiFetch(`/events/${eventId}/judges/seed-aerials`, { method: 'POST', body: data }),

  // Runs
  getRuns: (eventId, params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch(`/events/${eventId}/runs${q ? `?${q}` : ''}`);
  },
  getActiveRun: (eventId) => apiFetch(`/events/${eventId}/runs/active`),
  getUpcomingAthletes: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/upcoming${runNumber ? `?run_number=${runNumber}` : ''}`),
  createRun: (eventId, data) => apiFetch(`/events/${eventId}/runs`, { method: 'POST', body: data }),
  startForerunner: (eventId) => apiFetch(`/events/${eventId}/runs/forerunner`, { method: 'POST' }),
  updateRun: (eventId, runId, data) => apiFetch(`/events/${eventId}/runs/${runId}`, { method: 'PUT', body: data }),
  setRunStatus: (eventId, runId, run_status) => apiFetch(`/events/${eventId}/runs/${runId}/status`, { method: 'PUT', body: { run_status } }),

  // Scoring
  submitScore: (eventId, runId, data) => apiFetch(`/events/${eventId}/runs/${runId}/scores`, { method: 'POST', body: data }),
  approveRun: (eventId, runId) => apiFetch(`/events/${eventId}/runs/${runId}/approve`, { method: 'POST' }),
  undoLastScore: (eventId, runId) => apiFetch(`/events/${eventId}/runs/${runId}/scores/last`, { method: 'DELETE' }),
  reopenRun: (eventId, runId) => apiFetch(`/events/${eventId}/runs/${runId}/reopen`, { method: 'POST' }),
  getRunScores: (eventId, runId) => apiFetch(`/events/${eventId}/runs/${runId}/scores`),
  manualEntry: (eventId, data) => apiFetch(`/events/${eventId}/runs/manual`, { method: 'POST', body: data }),
  manualScore: (eventId, runId, data) => apiFetch(`/events/${eventId}/runs/${runId}/manual-score`, { method: 'POST', body: data }),
  deleteRun: (eventId, runId) => apiFetch(`/events/${eventId}/runs/${runId}`, { method: 'DELETE' }),
  getResults: (eventId, round) => apiFetch(`/events/${eventId}/results${round ? `?round=${round}` : ''}`),

  // Jump DDs
  getJumpDDs: (discipline = 'mogul', gender) => apiFetch(`/jump-dds?ruleset=uss&discipline=${discipline}${gender ? `&gender=${gender}` : ''}`),

  // Officials
  getOfficials: (meetId) => apiFetch(`/meets/${meetId}/officials`),
  addOfficial: (meetId, data) => apiFetch(`/meets/${meetId}/officials`, { method: 'POST', body: data }),
  updateOfficial: (meetId, id, data) => apiFetch(`/meets/${meetId}/officials/${id}`, { method: 'PUT', body: data }),
  removeOfficial: (meetId, id) => apiFetch(`/meets/${meetId}/officials/${id}`, { method: 'DELETE' }),
  getEventOfficials: (meetId, eventId) => apiFetch(`/meets/${meetId}/officials/event/${eventId}`),
  copyOfficialsFromEvent: (meetId, sourceEventId, targetEventId) =>
    apiFetch(`/meets/${meetId}/officials/copy-from-event`, { method: 'POST', body: { sourceEventId, targetEventId } }),

  // USSS Database
  getUsssStatus: () => apiFetch('/usss/status'),
  triggerUsssSync: () => apiFetch('/usss/sync', { method: 'POST' }),
  searchUsssAthletes: (q) => apiFetch(`/usss/athletes?q=${encodeURIComponent(q)}`),
  searchUsssAthletesAdvanced: (params) => {
    const qs = new URLSearchParams()
    if (params.last) qs.set('last', params.last)
    if (params.first) qs.set('first', params.first)
    if (params.ussa_id) qs.set('ussa_id', params.ussa_id)
    return apiFetch(`/usss/athletes?${qs.toString()}`)
  },
  searchUsssOfficials: (q) => apiFetch(`/usss/officials?q=${encodeURIComponent(q)}`),
  syncAthletesWithUsss: () => apiFetch('/athletes/usss-sync', { method: 'POST' }),
  createAthletesFromUsss: (ussa_ids) => apiFetch('/athletes/from-usss', { method: 'POST', body: { ussa_ids } }),

  // Course Specs (single course per meet)
  getCourseSpec: (meetId) => apiFetch(`/meets/${meetId}/course-specs`),
  saveCourseSpec: (meetId, data) => apiFetch(`/meets/${meetId}/course-specs`, { method: 'PUT', body: data }),
  // Legacy aliases kept for backward compat
  getCourseSpecs: (meetId) => apiFetch(`/meets/${meetId}/course-specs`),
  addCourseSpec: (meetId, data) => apiFetch(`/meets/${meetId}/course-specs`, { method: 'POST', body: data }),
  updateCourseSpec: (meetId, id, data) => apiFetch(`/meets/${meetId}/course-specs/${id}`, { method: 'PUT', body: data }),
  removeCourseSpec: (meetId, id) => apiFetch(`/meets/${meetId}/course-specs/${id}`, { method: 'DELETE' }),

  // Heats (Phase 10a)
  getHeats: (eventId) => apiFetch(`/events/${eventId}/heats`),
  createHeat: (eventId, data) => apiFetch(`/events/${eventId}/heats`, { method: 'POST', body: data }),
  updateHeat: (eventId, heatId, data) => apiFetch(`/events/${eventId}/heats/${heatId}`, { method: 'PUT', body: data }),
  deleteHeat: (eventId, heatId) => apiFetch(`/events/${eventId}/heats/${heatId}`, { method: 'DELETE' }),
  assignAthleteToHeat: (eventId, data) => apiFetch(`/events/${eventId}/heats/athlete-assign`, { method: 'PUT', body: data }),
  assignHeatsRandom: (eventId, data) => apiFetch(`/events/${eventId}/heats/assign-random`, { method: 'POST', body: data }),
  assignHeatsRanked: (eventId, data) => apiFetch(`/events/${eventId}/heats/assign-ranked`, { method: 'POST', body: data }),
  selectFinalists: (eventId, data) => apiFetch(`/events/${eventId}/heats/select-finals`, { method: 'POST', body: data }),
  seedFromQualifier: (eventId, data) => apiFetch(`/events/${eventId}/registrations/seed-from-qualifier`, { method: 'POST', body: data }),

  // Phases (v1.9.00)
  getPhases: (eventId) => apiFetch(`/events/${eventId}/phases`),
  createPhase: (eventId, data) => apiFetch(`/events/${eventId}/phases`, { method: 'POST', body: data }),
  deletePhase: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}`, { method: 'DELETE' }),
  getPhaseStatus: (eventId) => apiFetch(`/events/${eventId}/phases/status`),
  finalizePhase: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}/finalize`, { method: 'POST' }),
  sendPhaseReview: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}/send-review`, { method: 'POST' }),
  approvePhase: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}/approve`, { method: 'POST' }),
  returnPhase: (eventId, phaseId, message) => apiFetch(`/events/${eventId}/phases/${phaseId}/return`, { method: 'POST', body: { message } }),
  reopenPhase: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}/reopen`, { method: 'POST' }),
  getPhaseEligible: (eventId, phaseId) => apiFetch(`/events/${eventId}/phases/${phaseId}/eligible`),
  getPhaseResults: (eventId) => apiFetch(`/events/${eventId}/phases/results`),

  // Run Round Status (v1.8.03)
  getRunRoundStatus: (eventId) => apiFetch(`/events/${eventId}/runs/round-status`),
  finalizeRunRound: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/round-status/${runNumber}/finalize`, { method: 'POST' }),
  sendRunRoundReview: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/round-status/${runNumber}/send-review`, { method: 'POST' }),
  approveRunRound: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/round-status/${runNumber}/approve`, { method: 'POST' }),
  returnRunRound: (eventId, runNumber, message) => apiFetch(`/events/${eventId}/runs/round-status/${runNumber}/return`, { method: 'POST', body: { message } }),
  reopenRunRound: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/round-status/${runNumber}/reopen`, { method: 'POST' }),
  getRunRoundReview: (eventId, runNumber) => apiFetch(`/events/${eventId}/runs/round-review/${runNumber}`),

  // Health
  health: () => apiFetch('/health'),
  getBackups: () => apiFetch('/health/backups'),

  // Meet status dashboard
  getMeetStatus: (meetId) => apiFetch(`/meets/${meetId}/status`),

  // Meet clone
  cloneMeet: (meetId, data) => apiFetch(`/meets/${meetId}/clone`, { method: 'POST', body: data }),

  // Training days
  listTrainingDays: (meetId) => apiFetch(`/meets/${meetId}/training-days`),
  createTrainingDay: (meetId, data) => apiFetch(`/meets/${meetId}/training-days`, { method: 'POST', body: data }),
  updateTrainingDay: (meetId, id, data) => apiFetch(`/meets/${meetId}/training-days/${id}`, { method: 'PUT', body: data }),
  deleteTrainingDay: (meetId, id) => apiFetch(`/meets/${meetId}/training-days/${id}`, { method: 'DELETE' }),
  getTrainingParticipants: (id) => apiFetch(`/training-days/${id}/participants`),
  toggleTrainingExclusion: (id, athlete_id, exclude) =>
    apiFetch(`/training-days/${id}/exclusions`, { method: 'POST', body: { athlete_id, exclude } }),
  resetTrainingExclusions: (id) => apiFetch(`/training-days/${id}/reset`, { method: 'POST' }),
  downloadTrainingDayPdf: async (id, suggestedName) => {
    const res = await fetch(`/api/pdf/training-day/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (suggestedName || `Training_Day_${id}`).replace(/[^A-Za-z0-9_-]/g, '_') + '.pdf';
    a.click();
    URL.revokeObjectURL(url);
  },
};

export function createWebSocket(eventId, onMessage) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const ws = new WebSocket(`${protocol}//${host}/ws`);

  ws.onopen = () => {
    ws.send(JSON.stringify({ type: 'subscribe', eventId }));
  };

  ws.onmessage = (e) => {
    try { onMessage(JSON.parse(e.data)); } catch {}
  };

  ws.onerror = (e) => console.error('WebSocket error:', e);
  return ws;
}

export default api;

api.printResultsUrl = (eventId, round = 'qualification') => `/api/print/results/${eventId}?round=${round}`;
