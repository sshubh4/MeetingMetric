/**
 * useAuth — reads JWT from localStorage, decodes payload (no signature verification),
 * returns { userId, email, role, orgId, fullName } or null.
 */
export function useAuth() {
  const token = localStorage.getItem('mm_token');
  if (!token) return null;

  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return {
      userId: payload.sub,
      email: payload.email || null,
      role: payload.role || 'employee',
      orgId: payload.orgId || null,
      fullName: payload.fullName || null,
    };
  } catch {
    return null;
  }
}

export function isRole(auth, ...roles) {
  if (!auth) return false;
  const hierarchy = ['employee', 'manager', 'hr', 'admin'];
  const userLevel = hierarchy.indexOf(auth.role);
  const minRequired = Math.min(...roles.map((r) => hierarchy.indexOf(r)));
  return userLevel >= minRequired;
}
