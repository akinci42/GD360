import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// ─── GET /api/v1/end-customer/suggestions ────────────────────────────────────
router.get('/suggestions', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const {
      status = 'pending',
      country,
      partner_id,
      search,
      page  = 1,
      limit = 20,
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const params = [];
    const conds  = ['hqr.end_customer_suggestion IS NOT NULL'];

    if (status === 'reviewed') {
      conds.push('hqr.end_customer_reviewed = true');
    } else {
      conds.push('hqr.end_customer_reviewed = false');
    }
    if (country) {
      params.push(country);
      conds.push(`(p.country = $${params.length} OR hqr.ulke = $${params.length})`);
    }
    if (partner_id) {
      params.push(partner_id);
      conds.push(`hqr.customer_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conds.push(`hqr.end_customer_suggestion ILIKE $${params.length}`);
    }
    const where = `WHERE ${conds.join(' AND ')}`;
    params.push(parseInt(limit), offset);

    const sql = `
      SELECT
        hqr.id,
        hqr.ref_no,
        hqr.tarih,
        hqr.aciklama         AS original_aciklama,
        hqr.lokasyon,
        hqr.ulke,
        hqr.end_customer_suggestion AS suggestion,
        hqr.end_customer_reviewed   AS reviewed,
        hqr.end_customer_review_notes AS review_notes,
        CASE WHEN p.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object(
          'id',              p.id,
          'company_name',    p.company_name,
          'country',         p.country,
          'customer_type',   p.customer_type,
          'partner_subtype', p.partner_subtype,
          'channel_type',    p.channel_type,
          'assigned_to_name', up.full_name,
          'quote_count', (SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = p.id)
        ) END AS partner,
        CASE WHEN ec.id IS NULL THEN NULL::jsonb ELSE jsonb_build_object(
          'id',           ec.id,
          'company_name', ec.company_name,
          'country',      ec.country,
          'city',         ec.city,
          'created_at',   ec.created_at,
          'created_by_review', ec.data_quality_flag = 'approved_via_end_customer_review'
        ) END AS end_customer
      FROM historical_quotes_raw hqr
      LEFT JOIN customers p  ON p.id  = hqr.customer_id
      LEFT JOIN customers ec ON ec.id = hqr.end_customer_id
      LEFT JOIN users     up ON up.id = p.assigned_to
      ${where}
      ORDER BY hqr.tarih DESC NULLS LAST, hqr.imported_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);

    const countSql = `
      SELECT COUNT(*) AS c
      FROM historical_quotes_raw hqr
      LEFT JOIN customers p  ON p.id = hqr.customer_id
      ${where}
    `;
    const { rows: cRows } = await client.query(countSql, params.slice(0, params.length - 2));

    res.json({
      success: true,
      data: rows,
      total: parseInt(cRows[0].c),
      page:  parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── GET /api/v1/end-customer/stats ──────────────────────────────────────────
router.get('/stats', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { country, partner_id, search } = req.query;
    const params = [];
    const conds  = ['end_customer_suggestion IS NOT NULL'];

    if (country) {
      params.push(country);
      conds.push(`(ulke = $${params.length} OR EXISTS (SELECT 1 FROM customers c WHERE c.id = customer_id AND c.country = $${params.length}))`);
    }
    if (partner_id) {
      params.push(partner_id);
      conds.push(`customer_id = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      conds.push(`end_customer_suggestion ILIKE $${params.length}`);
    }
    const where = `WHERE ${conds.join(' AND ')}`;

    const { rows } = await client.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT end_customer_reviewed)                                      AS pending,
        COUNT(*) FILTER (WHERE     end_customer_reviewed AND end_customer_id IS NOT NULL)      AS reviewed_linked_or_created,
        COUNT(*) FILTER (WHERE     end_customer_reviewed AND end_customer_id IS NULL)          AS reviewed_rejected,
        COUNT(DISTINCT end_customer_id) FILTER (
          WHERE end_customer_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM customers c
              WHERE c.id = historical_quotes_raw.end_customer_id
                AND c.data_quality_flag = 'approved_via_end_customer_review'
            )
        ) AS unique_end_customers_created
      FROM historical_quotes_raw
      ${where}
    `, params);

    const r = rows[0];
    res.json({
      success: true,
      data: {
        pending: parseInt(r.pending),
        reviewed_linked_or_created: parseInt(r.reviewed_linked_or_created),
        reviewed_rejected: parseInt(r.reviewed_rejected),
        unique_end_customers_created: parseInt(r.unique_end_customers_created),
      },
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── POST /api/v1/end-customer/suggestions/:hqr_id/approve ───────────────────
router.post('/suggestions/:hqr_id/approve', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { company_name, country, city, notes } = req.body;
    if (!company_name || !String(company_name).trim()) {
      return res.status(400).json({ success: false, error: 'company_name required' });
    }

    await client.query('BEGIN');

    const { rows: hqrRows } = await client.query(
      `SELECT id, customer_id, end_customer_id, end_customer_suggestion, end_customer_reviewed, lokasyon, ulke
       FROM historical_quotes_raw WHERE id = $1 FOR UPDATE`,
      [req.params.hqr_id]
    );
    const hqr = hqrRows[0];
    if (!hqr) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Suggestion not found' }); }
    if (hqr.end_customer_reviewed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Already reviewed' });
    }
    if (!hqr.customer_id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Quote has no partner — cannot create end customer' });
    }

    const { rows: partnerRows } = await client.query(
      `SELECT id, country, assigned_to FROM customers WHERE id = $1`,
      [hqr.customer_id]
    );
    const partner = partnerRows[0];
    if (!partner) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Partner customer not found' });
    }

    const finalCountry = country || partner.country || hqr.ulke || null;
    const finalCity    = city    || hqr.lokasyon || null;

    const { rows: insRows } = await client.query(
      `INSERT INTO customers
         (company_name, country, city, customer_type, parent_id, source, status,
          assigned_to, created_by, imported_from_raw_id, data_quality_flag, notes)
       VALUES ($1, $2, $3, 'end_customer', $4, 'import_2026', 'active',
               $5, $6, $7, 'approved_via_end_customer_review', $8)
       RETURNING *`,
      [
        company_name.trim(),
        finalCountry,
        finalCity,
        partner.id,
        partner.assigned_to,
        req.user.id,
        hqr.id,
        notes || null,
      ]
    );
    const newCustomer = insRows[0];

    await client.query(
      `UPDATE historical_quotes_raw
       SET end_customer_id = $1,
           end_customer_reviewed = true,
           end_customer_review_notes = $2
       WHERE id = $3`,
      [newCustomer.id, notes || null, hqr.id]
    );

    await client.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'create_end_customer_via_review', 'customers', $3, $4)`,
      [
        req.user.id, req.user.email, newCustomer.id,
        JSON.stringify({
          hqr_id: hqr.id,
          suggestion_text: hqr.end_customer_suggestion,
          partner_id: partner.id,
          ref_no: req.body.ref_no || null,
          notes: notes || null,
        }),
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { end_customer: newCustomer } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── POST /api/v1/end-customer/suggestions/:hqr_id/reject ────────────────────
router.post('/suggestions/:hqr_id/reject', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { notes } = req.body;
    await client.query('BEGIN');

    const { rows, rowCount } = await client.query(
      `UPDATE historical_quotes_raw
       SET end_customer_reviewed = true,
           end_customer_review_notes = $1
       WHERE id = $2 AND end_customer_reviewed = false
       RETURNING id, end_customer_suggestion, customer_id`,
      [notes || null, req.params.hqr_id]
    );
    if (!rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, error: 'Suggestion not found or already reviewed' });
    }

    await client.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'reject_end_customer_suggestion', 'historical_quotes_raw', $3, $4)`,
      [
        req.user.id, req.user.email, rows[0].id,
        JSON.stringify({
          suggestion_text: rows[0].end_customer_suggestion,
          partner_id: rows[0].customer_id,
          notes: notes || null,
        }),
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── POST /api/v1/end-customer/suggestions/bulk-reject ──────────────────────
// Reject many suggestions in one transaction. Already-reviewed rows are
// skipped (no error). Each successful rejection emits its own audit_log
// row so undo can still operate per-suggestion from the reviewed tab.
router.post('/suggestions/bulk-reject', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { hqr_ids, notes } = req.body;
    if (!Array.isArray(hqr_ids) || hqr_ids.length === 0) {
      return res.status(400).json({ success: false, error: 'hqr_ids must be a non-empty array' });
    }
    if (hqr_ids.length > 200) {
      return res.status(400).json({ success: false, error: 'hqr_ids exceeds max of 200 per request' });
    }
    const cleanNotes = (notes && String(notes).trim()) || 'Bulk reject';

    await client.query('BEGIN');

    const { rows: updated } = await client.query(
      `UPDATE historical_quotes_raw
       SET end_customer_reviewed = true,
           end_customer_review_notes = $1
       WHERE id = ANY($2::uuid[])
         AND end_customer_reviewed = false
       RETURNING id, end_customer_suggestion, customer_id`,
      [cleanNotes, hqr_ids]
    );

    if (updated.length > 0) {
      const auditValues = [];
      const auditParams = [];
      updated.forEach((row, i) => {
        const base = i * 6;
        auditParams.push(
          req.user.id, req.user.email,
          'bulk_reject_end_customer_suggestion',
          'historical_quotes_raw', row.id,
          JSON.stringify({
            suggestion_text: row.end_customer_suggestion,
            partner_id: row.customer_id,
            notes: cleanNotes,
            batch_size: updated.length,
          }),
        );
        auditValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
      });
      await client.query(
        `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, new_values)
         VALUES ${auditValues.join(', ')}`,
        auditParams
      );
    }

    await client.query('COMMIT');

    const skipped = hqr_ids.length - updated.length;
    res.json({
      success: true,
      data: {
        rejected: updated.length,
        skipped,
        errors: [],
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── POST /api/v1/end-customer/suggestions/:hqr_id/link ──────────────────────
router.post('/suggestions/:hqr_id/link', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { existing_customer_id, notes } = req.body;
    if (!existing_customer_id) {
      return res.status(400).json({ success: false, error: 'existing_customer_id required' });
    }

    await client.query('BEGIN');

    const { rows: hqrRows } = await client.query(
      `SELECT id, customer_id, end_customer_reviewed, end_customer_suggestion
       FROM historical_quotes_raw WHERE id = $1 FOR UPDATE`,
      [req.params.hqr_id]
    );
    const hqr = hqrRows[0];
    if (!hqr) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Suggestion not found' }); }
    if (hqr.end_customer_reviewed) { await client.query('ROLLBACK'); return res.status(409).json({ success: false, error: 'Already reviewed' }); }

    const { rows: ecRows } = await client.query(
      `SELECT id, company_name, customer_type FROM customers WHERE id = $1`,
      [existing_customer_id]
    );
    const ec = ecRows[0];
    if (!ec) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Target customer not found' }); }
    if (ec.customer_type !== 'end_customer') {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, error: 'Target must be an end_customer' });
    }

    await client.query(
      `UPDATE historical_quotes_raw
       SET end_customer_id = $1,
           end_customer_reviewed = true,
           end_customer_review_notes = $2
       WHERE id = $3`,
      [ec.id, notes || null, hqr.id]
    );

    await client.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'link_end_customer_via_review', 'historical_quotes_raw', $3, $4)`,
      [
        req.user.id, req.user.email, hqr.id,
        JSON.stringify({
          end_customer_id: ec.id,
          end_customer_name: ec.company_name,
          suggestion_text: hqr.end_customer_suggestion,
          partner_id: hqr.customer_id,
          notes: notes || null,
        }),
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { end_customer_id: ec.id } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── POST /api/v1/end-customer/suggestions/:hqr_id/undo ──────────────────────
// Reverses approve/reject/link if the review was made within the last 24h.
// If it created a new end_customer (data_quality_flag), delete that customer too —
// but only if no other hqr rows reference it.
router.post('/suggestions/:hqr_id/undo', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    await client.query('BEGIN');

    const { rows: hqrRows } = await client.query(
      `SELECT hqr.id, hqr.end_customer_id, hqr.end_customer_reviewed,
              hqr.end_customer_review_notes,
              ec.id AS ec_id, ec.created_at AS ec_created_at,
              ec.data_quality_flag AS ec_flag
       FROM historical_quotes_raw hqr
       LEFT JOIN customers ec ON ec.id = hqr.end_customer_id
       WHERE hqr.id = $1
       FOR UPDATE OF hqr`,
      [req.params.hqr_id]
    );
    const hqr = hqrRows[0];
    if (!hqr) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Suggestion not found' }); }
    if (!hqr.end_customer_reviewed) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Not yet reviewed' });
    }

    // Find the most recent review-related audit_log entry to enforce the 24h window
    const { rows: aRows } = await client.query(
      `SELECT created_at FROM audit_log
       WHERE (entity_id = $1 AND action IN ('reject_end_customer_suggestion', 'link_end_customer_via_review', 'bulk_reject_end_customer_suggestion'))
          OR (entity_id = $2 AND action = 'create_end_customer_via_review')
       ORDER BY created_at DESC LIMIT 1`,
      [hqr.id, hqr.end_customer_id]
    );
    if (!aRows[0]) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'No review audit found — cannot undo safely' });
    }
    const ageMs = Date.now() - new Date(aRows[0].created_at).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await client.query('ROLLBACK');
      return res.status(409).json({ success: false, error: 'Undo window (24h) expired' });
    }

    let deletedCustomer = null;
    if (hqr.ec_id && hqr.ec_flag === 'approved_via_end_customer_review') {
      // Only delete if no OTHER hqr references this end_customer
      const { rows: refRows } = await client.query(
        `SELECT COUNT(*) AS c FROM historical_quotes_raw
         WHERE end_customer_id = $1 AND id <> $2`,
        [hqr.ec_id, hqr.id]
      );
      if (parseInt(refRows[0].c) === 0) {
        await client.query(`DELETE FROM customers WHERE id = $1`, [hqr.ec_id]);
        deletedCustomer = hqr.ec_id;
      }
    }

    await client.query(
      `UPDATE historical_quotes_raw
       SET end_customer_id = NULL,
           end_customer_reviewed = false,
           end_customer_review_notes = NULL
       WHERE id = $1`,
      [hqr.id]
    );

    await client.query(
      `INSERT INTO audit_log (user_id, user_email, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, 'undo_end_customer_review', 'historical_quotes_raw', $3, $4)`,
      [
        req.user.id, req.user.email, hqr.id,
        JSON.stringify({
          previous_end_customer_id: hqr.end_customer_id,
          deleted_customer: deletedCustomer,
          previous_notes: hqr.end_customer_review_notes,
        }),
      ]
    );

    await client.query('COMMIT');
    res.json({ success: true, data: { hqr_id: hqr.id, deleted_customer: deletedCustomer } });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally { client.release(); }
});

// ─── GET /api/v1/end-customer/search-existing ────────────────────────────────
// Used by the "Link to existing" flow. Restricts to end_customers under the
// same partner (parent_id = partner_id), since cross-partner links would be
// surprising in this UI.
router.get('/search-existing', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { q = '', partner_id, limit = 15 } = req.query;
    const params = [];
    const conds  = [`customer_type = 'end_customer'`];

    if (partner_id) {
      params.push(partner_id);
      conds.push(`parent_id = $${params.length}`);
    }
    if (q && q.trim()) {
      params.push(`%${q.trim()}%`);
      conds.push(`company_name ILIKE $${params.length}`);
    }
    params.push(parseInt(limit));

    const sql = `
      SELECT id, company_name, country, city, parent_id
      FROM customers
      WHERE ${conds.join(' AND ')}
      ORDER BY company_name ASC
      LIMIT $${params.length}
    `;
    const { rows } = await client.query(sql, params);
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── GET /api/v1/end-customer/filter-options ─────────────────────────────────
// Country + partner dropdown options for the filter bar.
router.get('/filter-options', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows: countries } = await client.query(`
      SELECT DISTINCT COALESCE(p.country, hqr.ulke) AS country
      FROM historical_quotes_raw hqr
      LEFT JOIN customers p ON p.id = hqr.customer_id
      WHERE hqr.end_customer_suggestion IS NOT NULL
        AND COALESCE(p.country, hqr.ulke) IS NOT NULL
        AND COALESCE(p.country, hqr.ulke) <> ''
      ORDER BY 1
    `);
    const { rows: partners } = await client.query(`
      SELECT p.id, p.company_name, p.country,
             COUNT(*) AS suggestion_count
      FROM historical_quotes_raw hqr
      JOIN customers p ON p.id = hqr.customer_id
      WHERE hqr.end_customer_suggestion IS NOT NULL
      GROUP BY p.id, p.company_name, p.country
      HAVING COUNT(*) > 0
      ORDER BY COUNT(*) DESC, p.company_name
      LIMIT 200
    `);
    res.json({
      success: true,
      data: {
        countries: countries.map(r => r.country),
        partners,
      },
    });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
