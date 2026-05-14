import { useState, useEffect } from 'react'
import { authHeaders, checkApiResponse } from '../../utils/api'

const ROLES = ['official', 'event_admin', 'system_admin']
const ROLE_LABELS = { official: 'Official', event_admin: 'Event Admin', system_admin: 'System Admin' }

function UserModal({ user, onClose, onSave }) {
  const [form, setForm] = useState({
    username: user?.username || '',
    display_name: user?.display_name || '',
    role: user?.role || 'official',
    password: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!form.username.trim() || !form.display_name.trim()) {
      setError('Username and display name are required.')
      return
    }
    if (!user && !form.password) {
      setError('Password is required for new users.')
      return
    }
    setSaving(true)
    try {
      const url = user ? `/api/admin/users/${user.id}` : '/api/admin/users'
      const method = user ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save')
      }
      onSave()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 w-full max-w-md">
        <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-xl font-bold text-white mb-4">
          {user ? 'Edit User' : 'Create User'}
        </h2>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Username</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={form.username}
              onChange={e => setForm({ ...form, username: e.target.value })}
              disabled={!!user}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Display Name</label>
            <input
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={form.display_name}
              onChange={e => setForm({ ...form, display_name: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">Role</label>
            <select
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={form.role}
              onChange={e => setForm({ ...form, role: e.target.value })}
            >
              {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1 uppercase tracking-wider">
              Password{user ? ' (leave blank to keep current)' : ' *'}
            </label>
            <input
              type="password"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500"
              value={form.password}
              onChange={e => setForm({ ...form, password: e.target.value })}
              placeholder={user ? 'Leave blank to keep current password' : 'Required'}
              autoComplete="new-password"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 rounded-lg border border-slate-600 text-slate-300 text-sm hover:bg-slate-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 transition-colors">
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function AdminUsers() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null) // null | 'create' | user object

  const fetchUsers = () => {
    setLoading(true)
    fetch('/api/admin/users', { headers: authHeaders() })
      .then(checkApiResponse)
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }

  useEffect(fetchUsers, [])

  const toggleActive = async (user) => {
    await fetch(`/api/admin/users/${user.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ is_active: user.is_active ? 0 : 1 }),
    })
    fetchUsers()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 style={{ fontFamily: "'Oswald', sans-serif" }} className="text-2xl font-bold tracking-wide uppercase text-white">
          User Management
        </h2>
        <button
          onClick={() => setModal('create')}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 transition-colors"
        >
          + Create User
        </button>
      </div>

      {loading ? (
        <div className="text-slate-500 py-8 text-center">Loading...</div>
      ) : users.length === 0 ? (
        <div className="text-slate-500 py-8 text-center">No users yet. Create one to get started.</div>
      ) : (
        <div className="rounded-xl border border-slate-700/50 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-800/80 text-left">
                <th className="px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-medium">Username</th>
                <th className="px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-medium">Display Name</th>
                <th className="px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-medium">Role</th>
                <th className="px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-medium">Status</th>
                <th className="px-4 py-3 text-xs text-slate-400 uppercase tracking-wider font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/30">
              {users.map(user => (
                <tr key={user.id} className={`hover:bg-slate-800/30 transition-colors ${!user.is_active ? 'opacity-50' : ''}`}>
                  <td className="px-4 py-3 text-white font-mono">{user.username}</td>
                  <td className="px-4 py-3 text-slate-300">{user.display_name}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-slate-700/50 text-slate-300">
                      {ROLE_LABELS[user.role] || user.role}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${user.is_active ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                      {user.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setModal(user)}
                        className="px-2 py-1 rounded text-xs text-blue-400 hover:bg-blue-500/20 transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => toggleActive(user)}
                        className={`px-2 py-1 rounded text-xs transition-colors ${user.is_active ? 'text-red-400 hover:bg-red-500/20' : 'text-green-400 hover:bg-green-500/20'}`}
                      >
                        {user.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <UserModal
          user={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSave={() => { setModal(null); fetchUsers() }}
        />
      )}
    </div>
  )
}
