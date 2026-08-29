import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import PasswordInput from './PasswordInput';

// v2.0.01 — `forced` mode: rendered by Layout/AdminLayout when the server says
// must_change_password (admin-issued credentials). No cancel/close affordance;
// on success the auth context refreshes, the flag clears, and the modal unmounts.
export default function ChangePasswordModal({ onClose, forced = false }) {
  const { changePassword, refresh } = useAuth();
  const [form, setForm] = useState({ current_password: '', new_password: '', confirm: '' });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (form.new_password !== form.confirm) {
      setError('New passwords do not match.');
      return;
    }
    if (form.new_password.length < 8) {
      setError('New password must be at least 8 characters.');
      return;
    }
    setSaving(true);
    try {
      await changePassword({ current_password: form.current_password, new_password: form.new_password });
      setSuccess(true);
      if (forced) await refresh(); // clears must_change_password → unmounts this modal
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  const inputClass = 'w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500';

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
        <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "'Oswald', sans-serif" }}>
          {forced ? 'Set a New Password' : 'Change Password'}
        </h2>
        {forced && !success && (
          <p className="text-slate-400 text-sm mb-4">
            Your password was set by an administrator. Choose a new password to continue.
          </p>
        )}
        {success ? (
          <div>
            <p className="text-green-400 text-sm mb-4">Password changed successfully.</p>
            <button
              onClick={() => (forced ? refresh() : onClose())}
              className="w-full px-4 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600 transition-colors"
            >
              {forced ? 'Continue' : 'Close'}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Current Password</label>
              <PasswordInput
                className={inputClass}
                value={form.current_password}
                onChange={e => setForm({ ...form, current_password: e.target.value })}
                autoComplete="current-password"
                required
                autoFocus={forced}
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">New Password</label>
              <PasswordInput
                className={inputClass}
                value={form.new_password}
                onChange={e => setForm({ ...form, new_password: e.target.value })}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Confirm New Password</label>
              <PasswordInput
                className={inputClass}
                value={form.confirm}
                onChange={e => setForm({ ...form, confirm: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              {!forced && (
                <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
                  Cancel
                </button>
              )}
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
                {saving ? 'Saving…' : 'Change Password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
