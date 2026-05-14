import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function ChangePasswordModal({ onClose }) {
  const { changePassword } = useAuth();
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
    if (form.new_password.length < 6) {
      setError('New password must be at least 6 characters.');
      return;
    }
    setSaving(true);
    try {
      await changePassword({ current_password: form.current_password, new_password: form.new_password });
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to change password');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-sm">
        <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "'Oswald', sans-serif" }}>
          Change Password
        </h2>
        {success ? (
          <div>
            <p className="text-green-400 text-sm mb-4">Password changed successfully.</p>
            <button onClick={onClose} className="w-full px-4 py-2 rounded-lg bg-slate-700 text-white text-sm hover:bg-slate-600 transition-colors">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Current Password</label>
              <input
                type="password"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                value={form.current_password}
                onChange={e => setForm({ ...form, current_password: e.target.value })}
                autoComplete="current-password"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">New Password</label>
              <input
                type="password"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                value={form.new_password}
                onChange={e => setForm({ ...form, new_password: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Confirm New Password</label>
              <input
                type="password"
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
                value={form.confirm}
                onChange={e => setForm({ ...form, confirm: e.target.value })}
                autoComplete="new-password"
                required
              />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
                Cancel
              </button>
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
