import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost', 'on_hold'];

// GET /api/v1/opportunities — optional ?stage= filter
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { stage, customer_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    if (stage) { params.push(stage); conditions.push(`o.stage = $${params.length}`); }
    if (customer_id) { params.push(customer_id); conditions.push(`o.customer_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);
    const { rows } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS assigned_to_name
       FROM opportunities o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.assigned_to
       ${where}
       ORDER BY o.updated_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/opportunities/pipeline — grouped by stage (Kanban view)
router.get('/pipeline', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS assigned_to_name
       FROM opportunities o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.assigned_to
       WHERE o.stage NOT IN ('won','lost')
       ORDER BY o.stage, o.updated_at DESC`
    );
    const grouped = STAGES.reduce((acc, s) => ({ ...acc, [s]: [] }), {});
    rows.forEach(r => { if (grouped[r.stage]) grouped[r.stage].push(r); });
    res.json({ success: true, data: grouped });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/opportunities/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS assigned_to_name
       FROM opportunities o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.assigned_to
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Opportunity not found' });
    const { rows: log } = await client.query(
      `SELECT sl.*, u.full_name AS changed_by_name FROM opportunity_stage_log sl
       JOIN users u ON u.id = sl.changed_by
       WHERE sl.opportunity_id = $1 ORDER BY sl.changed_at DESC`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], stage_log: log } });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/opportunities
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { title, customer_id, contact_id, stage = 'lead', value, currency = 'USD',
            probability, expected_close_date, notes, assigned_to } = req.body;
    if (!title || !customer_id) {
      return res.status(400).json({ success: false, error: 'title and customer_id required' });
    }
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO opportunities
         (title, customer_id, contact_id, stage, value, currency, probability,
          expected_close_date, notes, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [title, customer_id, contact_id, stage, value, currency, probability,
       expected_close_date, notes, assigned_to || req.user.id, req.user.id]
    );
    await client.query(
      `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, changed_by, notes)
       VALUES ($1, NULL, $2, $3, 'Created')`,
      [rows[0].id, stage, req.user.id]
    );
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// PATCH /api/v1/opportunities/:id — handles stage transitions with log
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const existing = await client.query('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, error: 'Not found' });

    const fields = ['title', 'contact_id', 'stage', 'value', 'currency', 'probability',
                    'expected_close_date', 'lost_reason', 'notes', 'assigned_to'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });

    const oldStage = existing.rows[0].stage;
    values.push(req.params.id);

    await client.query('BEGIN');
    const { rows } = await client.query(
      `UPDATE opportunities SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (req.body.stage && req.body.stage !== oldStage) {
      await client.query(
        `INSERT INTO opportunity_stage_log (opportunity_id, from_stage, to_stage, changed_by, notes)
         VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, oldStage, req.body.stage, req.user.id, req.body.stage_note || null]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, data: rows[0] });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// DELETE /api/v1/opportunities/:id
router.delete('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM opportunities WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
