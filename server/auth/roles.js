// v1.25.00 (A-3) — Single source of truth for the role model.
// judge:        login-only convenience role; Officials dashboard restricted to Links
// official:     full Officials section
// system_admin: everything including /admin
// event_admin is a legacy alias kept in ROLE_RANK only (ranked with system_admin);
// existing rows are migrated to system_admin in schema.js and it is not creatable.
const ROLE_RANK = { judge: 1, official: 2, event_admin: 3, system_admin: 3 };
const VALID_ROLES = ['judge', 'official', 'system_admin'];

module.exports = { ROLE_RANK, VALID_ROLES };
