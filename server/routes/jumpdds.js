const router = require('express').Router();
const { queryAll } = require('../db/schema');

router.get('/', async (req, res) => {
  try {
    const { discipline = 'mogul', ruleset = 'uss', gender } = req.query;
    let sql = 'SELECT * FROM jump_dd_table WHERE discipline = ? AND ruleset = ?';
    const args = [discipline, ruleset];
    if (gender) {
      sql += ' AND gender = ?';
      args.push(gender);
    }
    sql += ' ORDER BY dd_value';
    const dds = await queryAll(sql, args);
    res.json(dds);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
