import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { authHeaders, checkApiResponse } from '../../utils/api';
import { useAuth } from '../../auth/AuthContext';

export default function AdminSecurity() {
  const auth = useAuth();
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function load() {
    try {
      const data = await fetch('/api/admin/auth-settings', { headers: authHeaders() }).then(checkApiResponse);
      setSettings(data);
    } catch (_) {}
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function toggle() {
    setError('');
    setSuccess('');
    setToggling(true);
    try {
      const r = await fetch('/api/admin/auth-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled: !settings.enabled }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || 'Failed to update setting');
      } else {
        setSuccess(data.enabled ? 'Password protection enabled.' : 'Password protection disabled.');
        await load();
        await auth.refresh();
      }
    } catch (e) {
      setError(e.message || 'Request failed');
    }
    setToggling(false);
  }

  if (loading) return <div style={{ padding: 32, color: '#94a3b8' }}>Loading…</div>;

  const canEnable = settings?.hasAdminPassword;
  const isEnvForced = settings?.envForced;
  const isEnabled = settings?.enabled;

  return (
    <div style={{ padding: 32, maxWidth: 600 }}>
      <h1 style={{ fontFamily: 'Bebas Neue, sans-serif', fontSize: 28, color: '#e2e8f0', marginBottom: 24 }}>
        Security — Password Protection
      </h1>

      <div style={{
        background: '#0e1628',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 10,
        padding: 24,
        marginBottom: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ color: '#94a3b8', fontSize: 14 }}>Protection status:</span>
          <span style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: 16,
            letterSpacing: '0.06em',
            color: isEnabled ? '#4ade80' : '#94a3b8',
          }}>
            {isEnabled ? 'ON' : 'OFF'}
          </span>
          {isEnvForced && (
            <span style={{
              background: 'rgba(245,197,24,0.15)',
              border: '1px solid rgba(245,197,24,0.4)',
              color: '#fde047',
              fontSize: 11,
              padding: '2px 8px',
              borderRadius: 4,
              letterSpacing: '0.05em',
            }}>ENV FORCED</span>
          )}
        </div>

        <div style={{ marginBottom: 16, fontSize: 13, color: '#64748b' }}>
          Admin password set:{' '}
          <span style={{ color: canEnable ? '#4ade80' : '#ef4444', fontWeight: 600 }}>
            {canEnable ? 'Yes' : 'No'}
          </span>
        </div>

        {error && (
          <div style={{
            background: 'rgba(220,38,38,0.15)',
            border: '1px solid rgba(220,38,38,0.4)',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#fca5a5',
            fontSize: 13,
            marginBottom: 12,
          }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{
            background: 'rgba(74,222,128,0.1)',
            border: '1px solid rgba(74,222,128,0.3)',
            borderRadius: 6,
            padding: '10px 12px',
            color: '#86efac',
            fontSize: 13,
            marginBottom: 12,
          }}>
            {success}
          </div>
        )}

        {isEnvForced ? (
          <div style={{ color: '#64748b', fontSize: 13 }}>
            Protection is forced off via the <code style={{ fontFamily: 'monospace', color: '#94a3b8' }}>STICKIT_AUTH=off</code> environment variable. Remove that variable and restart the server to re-enable.
          </div>
        ) : !canEnable && !isEnabled ? (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Set a password for an admin user in{' '}
            <Link to="/admin/users" style={{ color: '#60a5fa' }}>Admin → Users</Link>{' '}
            before enabling protection.
          </div>
        ) : (
          <button
            onClick={toggle}
            disabled={toggling}
            style={{
              background: isEnabled ? 'rgba(220,38,38,0.2)' : 'rgba(37,99,235,0.8)',
              border: isEnabled ? '1px solid rgba(220,38,38,0.5)' : '1px solid rgba(37,99,235,0.5)',
              borderRadius: 6,
              padding: '10px 20px',
              color: isEnabled ? '#fca5a5' : '#fff',
              fontFamily: 'Bebas Neue, sans-serif',
              fontSize: 16,
              letterSpacing: '0.06em',
              cursor: toggling ? 'wait' : 'pointer',
            }}
          >
            {toggling ? '…' : isEnabled ? 'DISABLE PASSWORD PROTECTION' : 'ENABLE PASSWORD PROTECTION'}
          </button>
        )}
      </div>

      <div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6 }}>
        <p><strong style={{ color: '#64748b' }}>When OFF:</strong> All officials and admin pages are accessible without login — same as v1.22.00 behavior.</p>
        <p style={{ marginTop: 8 }}><strong style={{ color: '#64748b' }}>When ON:</strong> The Officials dashboard and Admin panel require a username + password. Judge tablets, scoreboard, and live scores remain publicly accessible.</p>
        <p style={{ marginTop: 8 }}><strong style={{ color: '#64748b' }}>Lockout recovery:</strong> Set <code style={{ fontFamily: 'monospace', color: '#94a3b8' }}>STICKIT_AUTH=off</code> in environment variables and restart the server.</p>
      </div>
    </div>
  );
}
