const router = require('express').Router();
const { queryAll, queryOne, execute } = require('../db/schema');
const { syncFromServer, processUpload } = require('../usss/sync');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Configure multer for temp file uploads
const USSS_TMP_DIR = path.join(__dirname, '../../data/tmp');
try { fs.mkdirSync(USSS_TMP_DIR, { recursive: true }); } catch {}
const upload = multer({ dest: USSS_TMP_DIR });

// GET /api/usss/status -- sync status and record counts
router.get('/status', async (req, res) => {
  try {
    const status = await queryOne('SELECT * FROM usss_sync_status WHERE id = 1');
    const counts = await queryOne(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN type = 'C' THEN 1 ELSE 0 END) as competitors,
        SUM(CASE WHEN type = 'CO' THEN 1 ELSE 0 END) as coaches,
        SUM(CASE WHEN type = 'O' THEN 1 ELSE 0 END) as officials
      FROM usss_people
    `);
    res.json({
      status: status || null,
      counts: {
        total: parseInt(counts?.total) || 0,
        competitors: parseInt(counts?.competitors) || 0,
        coaches: parseInt(counts?.coaches) || 0,
        officials: parseInt(counts?.officials) || 0,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/usss/sync -- trigger manual sync from USSS server
router.post('/sync', async (req, res) => {
  try {
    const result = await syncFromServer();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/usss/upload -- manual file upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileText = fs.readFileSync(req.file.path, 'utf-8');
    const originalName = req.file.originalname || 'uploaded.txt';
    const result = await processUpload(fileText, originalName);
    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.json(result);
  } catch (e) {
    // Clean up temp file on error
    if (req.file) try { fs.unlinkSync(req.file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// GET /api/usss/athletes?last=&first=&ussa_id=  -- search competitors (type C and CO)
// CO = "coach" but in practice includes many young coach-competitors who are
// active athletes, so they belong in athlete search results.
// Backwards-compatible: q= still works (matches last_name OR ussa_id)
router.get('/athletes', async (req, res) => {
  try {
    const { q, last, first, ussa_id } = req.query;
    const conds = ["type IN ('C', 'CO')"];
    const args = [];

    if (q && q.trim()) {
      const term = q.trim();
      conds.push('(last_name LIKE ? OR ussa_id LIKE ?)');
      args.push(`${term}%`, `${term}%`);
    } else {
      const hasLast = last && last.trim();
      const hasUssa = ussa_id && ussa_id.trim();
      if (!hasLast && !hasUssa) return res.json([]);
      if (hasLast) { conds.push('last_name LIKE ?'); args.push(`${last.trim()}%`); }
      if (hasUssa) { conds.push('ussa_id LIKE ?'); args.push(`${ussa_id.trim()}%`); }
      if (first && first.trim()) { conds.push('first_name LIKE ?'); args.push(`${first.trim()}%`); }
    }

    const results = await queryAll(
      `SELECT * FROM usss_people WHERE ${conds.join(' AND ')} ORDER BY last_name, first_name LIMIT 50`,
      args
    );
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/usss/officials?q=searchterm -- search coaches and officials
router.get('/officials', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json([]);
    const term = q.trim();
    const results = await queryAll(
      `SELECT * FROM usss_people WHERE type IN ('CO', 'O') AND (last_name LIKE ? OR ussa_id LIKE ?) ORDER BY last_name, first_name LIMIT 20`,
      [`${term}%`, `${term}%`]
    );
    res.json(results);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
