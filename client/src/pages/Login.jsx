import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PasswordInput from '../components/PasswordInput';

export default function Login() {
  const { login, authEnabled, loading, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const next = params.get('next') || '/dashboard';

  useEffect(() => {
    if (loading) return;
    if (!authEnabled) { navigate('/'); return; }
    if (user) { navigate(next, { replace: true }); }
  }, [loading, authEnabled, user, navigate, next]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#070d1a',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'DM Sans, sans-serif',
    }}>
      <div style={{
        background: '#0e1628',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 12,
        padding: '40px 36px',
        width: '100%',
        maxWidth: 380,
      }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            fontFamily: 'Bebas Neue, sans-serif',
            fontSize: 32,
            letterSpacing: '0.06em',
            color: '#e2e8f0',
            marginBottom: 4,
          }}>STICKIT</div>
          <div style={{ color: '#64748b', fontSize: 13 }}>Officials + Admin Login</div>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                padding: '10px 12px',
                color: '#e2e8f0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: 12, marginBottom: 6, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Password
            </label>
            <PasswordInput
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 6,
                padding: '10px 12px',
                color: '#e2e8f0',
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 14,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div style={{
              background: 'rgba(220,38,38,0.15)',
              border: '1px solid rgba(220,38,38,0.4)',
              borderRadius: 6,
              padding: '10px 12px',
              color: '#fca5a5',
              fontSize: 13,
              marginBottom: 16,
            }}>
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              width: '100%',
              background: submitting ? '#1e3a5f' : '#2563eb',
              border: 'none',
              borderRadius: 6,
              padding: '12px',
              color: '#fff',
              fontFamily: 'Bebas Neue, sans-serif',
              fontSize: 18,
              letterSpacing: '0.08em',
              cursor: submitting ? 'wait' : 'pointer',
            }}
          >
            {submitting ? 'SIGNING IN…' : 'SIGN IN'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 24, color: '#475569', fontSize: 12 }}>
          Judges, scoreboard, and live scores don't require login
        </div>
      </div>
    </div>
  );
}
