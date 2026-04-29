// Normalize gender strings to 'M' or 'F' for consistent comparison.
// Handles: M, m, male, Male, MALE, men, Men, MEN → 'M'
//          F, f, female, Female, FEMALE, W, w, women, Women, WOMEN → 'F'
function normalizeGender(g) {
  if (!g) return null;
  const s = String(g).trim().toUpperCase();
  if (s === 'M' || s === 'MALE' || s === 'MEN') return 'M';
  if (s === 'F' || s === 'FEMALE' || s === 'W' || s === 'WOMEN') return 'F';
  return s; // unknown — pass through as-is
}

module.exports = { normalizeGender };
