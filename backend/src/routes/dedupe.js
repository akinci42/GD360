import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

const VALID_STATUSES = ['pending', 'merged', 'rejected', 'under_review'];

// ─── GET /api/v1/dedupe/suggestions ──────────────────────────────────────────
router.get('/suggestions', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const {
      status = 'pending',
      min_score,
      search,
      page = 1,
      limit = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const params = [];
    const conds  = [];
    if (VALID_STATUSES.includes(status)) {
      params.push(status);
      conds.push(`s.status = $${params.length}`);
    }
    if (min_score) {
      const n = parseFloat(min_score);
      if (!Number.isNaN(n)) { params.push(n); conds.push(`s.similarity_score >= $${params.length}`); }
    }
    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      conds.push(`(a.company_name ILIKE $${n} OR b.company_name ILIKE $${n})`);
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const sql = `
      SELECT
        s.id, s.similarity_score, s.match_reason, s.status,
        s.created_at, s.reviewed_at, s.review_notes, s.merged_into_id,
        jsonb_build_object(
          'id', a.id, 'company_name', a.company_name, 'country', a.country,
          'city', a.city, 'status', a.status, 'assigned_to_name', ua.full_name,
          'quote_count',
            (SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = a.id) +
            (SELECT COUNT(*) FROM offers                WHERE customer_id = a.id),
          'last_quote_date', GREATEST(
            (SELECT MAX(tarih)            FROM historical_quotes_raw WHERE customer_id = a.id),
            (SELECT MAX(created_at)::date FROM offers                WHERE customer_id = a.id)
          )
        ) AS customer_a,
        jsonb_build_object(
          'id', b.id, 'company_name', b.company_name, 'country', b.country,
          'city', b.city, 'status', b.status, 'assigned_to_name', ub.full_name,
          'quote_count',
            (SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = b.id) +
            (SELECT COUNT(*) FROM offers                WHERE customer_id = b.id),
          'last_quote_date', GREATEST(
            (SELECT MAX(tarih)            FROM historical_quotes_raw WHERE customer_id = b.id),
            (SELECT MAX(created_at)::date FROM offers                WHERE customer_id = b.id)
          )
        ) AS customer_b
      FROM dedupe_suggestions s
      LEFT JOIN customers a  ON a.id  = s.customer_a_id
      LEFT JOIN customers b  ON b.id  = s.customer_b_id
      LEFT JOIN users     ua ON ua.id = a.assigned_to
      LEFT JOIN users     ub ON ub.id = b.assigned_to
      ${where}
      ORDER BY s.similarity_score DESC, s.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);

    const countSql = `SELECT COUNT(*) FROM dedupe_suggestions s
                      LEFT JOIN customers a ON a.id = s.customer_a_id
                      LEFT JOIN customers b ON b.id = s.customer_b_id
                      ${where}`;
    const { rows: countRows } = await client.query(countSql, params.slice(0, params.length - 2));

    res.json({
      success: true,
      data: rows,
      total: parseInt(countRows[0].count),
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── GET /api/v1/dedupe/stats ────────────────────────────────────────────────
router.get('/stats', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')  AS pending,
        COUNT(*) FILTER (WHERE status = 'merged')   AS merged,
        COUNT(*) FILTER (WHERE status = 'rejected') AS rejected,
        COUNT(*)                                    AS total,
        ROUND(AVG(similarity_score)::numeric, 3)    AS avg_score,
        MAX(similarity_score)                       AS top_score
      FROM dedupe_suggestions
    `);
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── POST /api/v1/dedupe/suggestions/:id/merge ───────────────────────────────
router.post('/suggestions/:id/merge', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { master_id, review_notes } = req.body;
    if (!master_id) return res.status(400).json({ success: false, error: 'master_id required' });

    await client.query('BEGIN');

    // Lock + validate the suggestion
    const { rows: sRows } = await client.query(
      `SELECT id, customer_a_id, customer_b_id, status
       FROM dedupe_suggestions WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    const suggestion = sRows[0];
    if (!suggestion) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Suggestion not found' }); }
    if (suggestion.status !== 'pending' && suggestion.status !== 'under_review') {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: `Suggestion already ${suggestion.status}` });
    }

    // Determine master/other. master_id must equal customer_a_id or customer_b_id.
    const aId = suggestion.customer_a_id;
    const bId = suggestion.customer_b_id;
    let masterId, otherId;
    if (master_id === aId)      { masterId = aId; otherId = bId; }
    else if (master_id === bId) { masterId = bId; otherId = aId; }
    else {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'master_id must be one of the pair' });
    }

    // Snapshot the 'other' customer before deletion (for audit)
    const { rows: otherRows } = await client.query(
      `SELECT * FROM customers WHERE id = $1`, [otherId]
    );
    const otherSnapshot = otherRows[0];
    if (!otherSnapshot) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Other customer vanished' }); }

    // Re-parent child records to master
    const reparent = async (sql, label) => {
      const r = await client.query(sql, [masterId, otherId]);
      return { [label]: r.rowCount };
    };
    const reparents = {};
    Object.assign(reparents, await reparent(
      `UPDATE offers SET customer_id = $1 WHERE customer_id = $2`, 'offers'));
    Object.assign(reparents, await reparent(
      `UPDATE historical_quotes_raw SET customer_id = $1 WHERE customer_id = $2`, 'historical_quotes_raw'));
    Object.assign(reparents, await reparent(
      `UPDATE customer_contacts SET customer_id = $1 WHERE customer_id = $2`, 'customer_contacts'));
    // Move group memberships, dropping duplicates where master is already a member
    await client.query(
      `DELETE FROM customer_group_members
       WHERE customer_id = $1
         AND group_id IN (SELECT group_id FROM customer_group_members WHERE customer_id = $2)`,
      [otherId, masterId]
    );
    Object.assign(reparents, await reparent(
      `UPDATE customer_group_members SET customer_id = $1 WHERE customer_id = $2`, 'customer_group_members'));

    // Also re-parent child customers (end_customer parent pointers)
    Object.assign(reparents, await reparent(
      `UPDATE customers SET parent_id = $1 WHERE parent_id = $2`, 'customers_parent'));

    // Audit BEFORE delete (customer_id FK in audit_log is SET NULL on delete, but
    // we capture the snapshot in new_values so the merge is fully reconstructable).
    await client.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, old_values, new_values)
       VALUES ($1, $2, 'merge_customer', 'customers', $3, $4, $5)`,
      [
        req.user.id, req.user.email, otherId,
        JSON.stringify(otherSnapshot),
        JSON.stringify({
          merged_into:   masterId,
          suggestion_id: suggestion.id,
          reparents,
          review_notes:  review_notes || null,
        }),
      ]
    );

    // Mark suggestion merged BEFORE deleting the customer.
    // FK is ON DELETE SET NULL (migration 015) so the row survives either way,
    // but updating first keeps the lifecycle readable in logs.
    await client.query(
      `UPDATE dedupe_suggestions
       SET status = 'merged', merged_into_id = $1, reviewed_by = $2,
           reviewed_at = NOW(), review_notes = $3
       WHERE id = $4`,
      [masterId, req.user.id, review_notes || null, suggestion.id]
    );

    // Delete the 'other' customer
    await client.query(`DELETE FROM customers WHERE id = $1`, [otherId]);

    await client.query('COMMIT');

    // Return the updated master customer
    const { rows: masterRows } = await client.query(`SELECT * FROM customers WHERE id = $1`, [masterId]);
    res.json({ success: true, data: { master: masterRows[0], reparents } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── POST /api/v1/dedupe/suggestions/:id/reject ──────────────────────────────
router.post('/suggestions/:id/reject', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { review_notes } = req.body;
    const { rows, rowCount } = await client.query(
      `UPDATE dedupe_suggestions
       SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_notes = $2
       WHERE id = $3 AND status IN ('pending', 'under_review')
       RETURNING *`,
      [req.user.id, review_notes || null, req.params.id]
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Suggestion not found or already reviewed' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
