/**
 * Auth guard placeholder component.
 *
 * Currently renders children unconditionally. To activate authentication:
 * 1. Add auth state (React context or zustand store) tracking logged-in user
 * 2. Check auth state here; if not authenticated, redirect to /login
 * 3. Optionally accept a `requiredRole` prop and check user.role
 * 4. Show a loading spinner while auth state is being determined
 */
export default function AuthGuard({ children }) {
  return children
}
