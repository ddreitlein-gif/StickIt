// v1.25.00 (A-3) — Single source of truth for the role model.
// v2.7.02 — collapsed to TWO roles (David's ruling 10-28-26):
// official:     "Judge / Official" — the full Officials section (meets, events,
//               registration, scoring, reports, exports); no /admin
// system_admin: everything including /admin
// Legacy aliases kept in ROLE_RANK only so an un-migrated row still works:
//   judge       → ranked with official (was a login-only role restricted to the
//                 Links area; rows are migrated to 'official' in schema.js)
//   event_admin → ranked with system_admin (rows migrated in schema.js)
// Neither alias is creatable.
const ROLE_RANK = { judge: 2, official: 2, event_admin: 3, system_admin: 3 };
const VALID_ROLES = ['official', 'system_admin'];

module.exports = { ROLE_RANK, VALID_ROLES };
