const { verifyToken } = require('../lib/auth');
const db = require('../lib/db');

// Role hierarchy: higher index = higher privilege
const ROLE_HIERARCHY = ['employee', 'manager', 'hr', 'admin'];

function roleLevel(role) {
  const idx = ROLE_HIERARCHY.indexOf(role);
  return idx === -1 ? 0 : idx;
}

/**
 * requireAuth — validates JWT, loads full user from DB, attaches to req.user
 * req.user = { id, email, orgId, role, managerId, fullName, active }
 * Returns 401 if no/invalid token, 403 if user.active = 0
 */
function requireAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const payload = verifyToken(h.slice(7));
  if (!payload) return res.status(401).json({ error: 'Invalid token' });

  const user = db
    .prepare('SELECT id, email, full_name, role, org_id, manager_id, active FROM users WHERE id = ?')
    .get(payload.sub);

  if (!user) return res.status(401).json({ error: 'User not found' });
  if (user.active === 0) return res.status(403).json({ error: 'Account deactivated' });

  req.user = {
    id: user.id,
    email: user.email,
    fullName: user.full_name || null,
    role: user.role || 'employee',
    orgId: user.org_id || null,
    managerId: user.manager_id || null,
    active: user.active !== 0,
  };
  next();
}

/**
 * requireRole(...roles) — 403 if req.user.role not at or above the minimum required role.
 * Admin > hr > manager > employee.
 * Passing multiple roles means "any of these roles or higher".
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const userLevel = roleLevel(req.user.role);
    // Find the minimum level required (lowest of the passed roles)
    const minRequired = Math.min(...roles.map(roleLevel));
    if (userLevel >= minRequired) return next();
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}

/**
 * requireSameOrg — validates that the org_id of the resource matches req.user.orgId.
 * resourceOrgIdGetter is a function that takes req and returns the org_id to check.
 */
function requireSameOrg(resourceOrgIdGetter) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const resourceOrgId = resourceOrgIdGetter(req);
    if (resourceOrgId !== req.user.orgId) {
      return res.status(403).json({ error: 'Access denied: different organization' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole, requireSameOrg };
