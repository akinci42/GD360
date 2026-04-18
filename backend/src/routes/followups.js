import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

const LOCK_HOURS = 48;

// GET /api/v1/followups
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { opportunity_id, customer_id, completed, page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];
    if (opportunity_id) { params.push(opportunity_id); conditions.push(`f.opportunity_id = $${params.length}`); }
    if (customer_id) { params.push(customer_id); conditions.push(`f.customer_id = $${params.length}`); }
    if (completed === 'true') conditions.push('f.completed_at IS NOT NULL');
    if (completed === 'false') conditions.push('f.completed_at IS NULL');
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);
    const { rows } = await client.query(
      `SELECT f.*, u.full_name AS assigned_to_name, u2.full_name AS locked_by_name
       FROM followups f
       LEFT JOIN users u ON u.id = f.assigned_to
       LEFT JOIN users u2 ON u2.id = f.locked_by
       ${where}
       ORDER BY f.scheduled_at ASC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/followups
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { opportunity_id, customer_id, type, subject, notes, scheduled_at, assigned_to } = req.body;
    if (!type || !subject || !scheduled_at) {
      return res.status(400).json({ success: false, error: 'type, subject, scheduled_at required' });
    }
    if (!opportunity_id && !customer_id) {
      return res.status(400).json({ success: false, error: 'opportunity_id or customer_id required' });
    }
    const lockedUntil = new Date(Date.now() + LOCK_HOURS * 3600 * 1000).toISOString();
    const { rows } = await client.query(
      `INSERT INTO followups
         (opportunity_id, customer_id, type, subject, notes, scheduled_at,
          locked_by, locked_until, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [opportunity_id, customer_id, type, subject, notes, scheduled_at,
       req.user.id, lockedUntil, assigned_to || req.user.id, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/followups/:id
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const existing = await client.query('SELECT * FROM followups WHERE id = $1', [req.params.id]);
    const f = existing.rows[0];
    if (!f) return res.status(404).json({ success: false, error: 'Follow-up not found' });

    // 48-hour lock check for sales role
    if (req.user.role === 'sales') {
      const isLocked = f.locked_until && new Date(f.locked_until) > new Date();
      const holdsLock = f.locked_by?.toString() === req.user.id;
      if (isLocked && !holdsLock) {
        return res.status(423).json({
          success: false,
          error: 'Follow-up is locked',
          locked_by: f.locked_by,
          locked_until: f.locked_until,
        });
      }
    }

    const fields = ['type', 'subject', 'notes', 'scheduled_at', 'completed_at', 'assigned_to'];
    const updates = [];
    const values = [];
    fields.forEach(field => {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = $${values.length + 1}`);
        values.push(req.body[field]);
      }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE followups SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/followups/:id/complete
router.post('/:id/complete', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `UPDATE followups SET completed_at = NOW(), locked_until = NULL, locked_by = NULL
       WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// DELETE /api/v1/followups/:id
router.delete('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM followups WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
