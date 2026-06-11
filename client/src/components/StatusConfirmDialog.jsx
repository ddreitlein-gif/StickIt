// v1.25.00 (C-5) — shared DNS/DNF/DSQ confirmation dialog, extracted from
// VoiceManualEntryModal so the keyboard ManualScoreModal confirms the same way.
export default function StatusConfirmDialog({ status, athleteName, onConfirm, onCancel, submitting }) {
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
