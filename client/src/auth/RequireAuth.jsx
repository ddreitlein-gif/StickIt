import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthContext';

export default function RequireAuth({ children, role }) {
  const { user, authEnabled, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // v1.25.00 (A-3) — mirrors server/auth/roles.js: judge < official < system_admin,
  // event_admin kept only as a legacy alias ranked with system_admin.
  const ROLE_RANK = { judge: 1, official: 2, event_admin: 3, system_admin: 3 };

  useEffect(() => {
    if (loading) return;
    if (!authEnabled) return;
    if (!user) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      return;
    }
    if (role) {
      const userRank = ROLE_RANK[user.role] || 0;
      const requiredRank = ROLE_RANK[role] || 0;
      if (userRank < requiredRank) {
        navigate('/', { replace: true });
      }
    }
  }, [loading, authEnabled, user, role, navigate, location]);

  if (loading) return null;
  if (authEnabled && !user) return null;
  if (authEnabled && role) {
    const userRank = ROLE_RANK[user?.role] || 0;
    const requiredRank = ROLE_RANK[role] || 0;
    if (userRank < requiredRank) return null;
  }

  return children;
}
