import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /api/v1/offers
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { status, customer_id, page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];
    if (status)      { params.push(status);      conditions.push(`o.status = $${params.length}`); }
    if (customer_id) { params.push(customer_id); conditions.push(`o.customer_id = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);
    const { rows } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS created_by_name
       FROM offers o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       ${where}
       ORDER BY o.created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/offers/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS created_by_name
       FROM offers o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Offer not found' });
    const { rows: items } = await client.query(
      `SELECT * FROM offer_items WHERE offer_id = $1 ORDER BY sort_order, id`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], items } });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/offers
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const {
      customer_id, opportunity_id, title, currency = 'USD',
      validity_days = 30, notes, items = [],
    } = req.body;
    if (!customer_id) return res.status(400).json({ success: false, error: 'customer_id required' });
    if (!title)       return res.status(400).json({ success: false, error: 'title required' });
    if (!items.length) return res.status(400).json({ success: false, error: 'at least one item required' });

    const valid_until = validity_days
      ? new Date(Date.now() + parseInt(validity_days) * 86400000).toISOString().slice(0, 10)
      : null;

    await client.query('BEGIN');

    const { rows: [offer] } = await client.query(
      `INSERT INTO offers
         (offer_number, customer_id, opportunity_id, title, currency, validity_days, notes, valid_until, created_by)
       VALUES ('', $1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [customer_id, opportunity_id || null, title, currency, validity_days, notes || null, valid_until, req.user.id]
    );

    for (let i = 0; i < items.length; i++) {
      const { product_name, description, quantity = 1, unit = 'pcs', unit_price = 0, discount_pct = 0 } = items[i];
      await client.query(
        `INSERT INTO offer_items (offer_id, product_name, description, quantity, unit, unit_price, discount_pct, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [offer.id, product_name, description || null, quantity, unit, unit_price, discount_pct, i]
      );
    }
    await client.query('COMMIT');

    // Return full offer with items
    const { rows: [full] } = await client.query(
      `SELECT o.*, c.company_name FROM offers o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
      [offer.id]
    );
    const { rows: savedItems } = await client.query(
      `SELECT * FROM offer_items WHERE offer_id = $1 ORDER BY sort_order`,
      [offer.id]
    );
    res.status(201).json({ success: true, data: { ...full, items: savedItems } });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// PATCH /api/v1/offers/:id
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const allowed = ['title', 'status', 'currency', 'validity_days', 'notes', 'opportunity_id', 'valid_until'];
    const updates = [];
    const values = [];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });

    // Handle items replacement if provided
    const { items } = req.body;
    await client.query('BEGIN');

    values.push(req.params.id);
    const { rows, rowCount } = await client.query(
      `UPDATE offers SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ success: false, error: 'Not found' }); }

    if (Array.isArray(items)) {
      await client.query('DELETE FROM offer_items WHERE offer_id = $1', [req.params.id]);
      for (let i = 0; i < items.length; i++) {
        const { product_name, description, quantity = 1, unit = 'pcs', unit_price = 0, discount_pct = 0 } = items[i];
        await client.query(
          `INSERT INTO offer_items (offer_id, product_name, description, quantity, unit, unit_price, discount_pct, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.id, product_name, description || null, quantity, unit, unit_price, discount_pct, i]
        );
      }
    }
    await client.query('COMMIT');

    const { rows: [full] } = await client.query(
      `SELECT o.*, c.company_name FROM offers o JOIN customers c ON c.id = o.customer_id WHERE o.id = $1`,
      [req.params.id]
    );
    const { rows: savedItems } = await client.query(
      `SELECT * FROM offer_items WHERE offer_id = $1 ORDER BY sort_order`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...full, items: savedItems } });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// POST /api/v1/offers/:id/send
router.post('/:id/send', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows, rowCount } = await client.query(
      `UPDATE offers SET status = 'sent', sent_at = NOW() WHERE id = $1 AND status = 'draft' RETURNING *`,
      [req.params.id]
    );
    if (!rowCount) return res.status(400).json({ success: false, error: 'Offer not found or already sent' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/offers/:id/clone
router.post('/:id/clone', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows: [src] } = await client.query('SELECT * FROM offers WHERE id = $1', [req.params.id]);
    if (!src) return res.status(404).json({ success: false, error: 'Offer not found' });
    const { rows: srcItems } = await client.query(
      'SELECT * FROM offer_items WHERE offer_id = $1 ORDER BY sort_order, id',
      [src.id]
    );

    await client.query('BEGIN');
    const validityDays = src.validity_days || 30;
    const valid_until = new Date(Date.now() + validityDays * 86400000).toISOString().slice(0, 10);

    const { rows: [cloned] } = await client.query(
      `INSERT INTO offers (offer_number, customer_id, opportunity_id, title, status, currency, validity_days, notes, valid_until, created_by)
       VALUES ('', $1, $2, $3, 'draft', $4, $5, $6, $7, $8) RETURNING id`,
      [src.customer_id, src.opportunity_id, `${src.title} (kopya)`, src.currency, validityDays, src.notes, valid_until, req.user.id]
    );
    for (let i = 0; i < srcItems.length; i++) {
      const s = srcItems[i];
      await client.query(
        `INSERT INTO offer_items (offer_id, product_name, description, quantity, unit, unit_price, discount_pct, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [cloned.id, s.product_name, s.description, s.quantity, s.unit, s.unit_price, s.discount_pct, i]
      );
    }
    await client.query('COMMIT');

    const { rows: [full] } = await client.query(
      `SELECT o.*, c.company_name, u.full_name AS created_by_name
       FROM offers o
       JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u ON u.id = o.created_by
       WHERE o.id = $1`,
      [cloned.id]
    );
    const { rows: clonedItems } = await client.query(
      `SELECT * FROM offer_items WHERE offer_id = $1 ORDER BY sort_order, id`,
      [cloned.id]
    );
    res.status(201).json({ success: true, data: { ...full, items: clonedItems } });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// DELETE /api/v1/offers/:id
router.delete('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM offers WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
