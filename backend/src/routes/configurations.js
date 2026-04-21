import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /api/v1/configurations
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT cfg.*, c.company_name
       FROM configurations cfg
       LEFT JOIN customers c ON c.id = cfg.customer_id
       ORDER BY cfg.created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/configurations/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT cfg.*, c.company_name
       FROM configurations cfg
       LEFT JOIN customers c ON c.id = cfg.customer_id
       WHERE cfg.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Configuration not found' });
    const { rows: items } = await client.query(
      `SELECT ci.*, p.name AS product_name_catalog, p.sku, p.category
       FROM configuration_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.configuration_id = $1
       ORDER BY ci.sort_order`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...rows[0], items } });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/configurations
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { name, customer_id, opportunity_id, notes, currency = 'USD', items = [] } = req.body;
    if (!name)          return res.status(400).json({ success: false, error: 'name required' });
    if (!items.length)  return res.status(400).json({ success: false, error: 'at least one item required' });

    await client.query('BEGIN');
    const total_price = items.reduce((sum, i) => sum + (parseFloat(i.quantity || 1) * parseFloat(i.unit_price || 0)), 0);
    const { rows: [cfg] } = await client.query(
      `INSERT INTO configurations (name, customer_id, opportunity_id, notes, total_price, currency, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [name, customer_id || null, opportunity_id || null, notes || null, total_price, currency, req.user.id]
    );
    for (let i = 0; i < items.length; i++) {
      const { product_id, quantity = 1, unit_price, specs = {}, notes: iNotes } = items[i];
      await client.query(
        `INSERT INTO configuration_items (configuration_id, product_id, quantity, unit_price, specs, notes, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [cfg.id, product_id, quantity, unit_price, JSON.stringify(specs), iNotes || null, i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: cfg });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// POST /api/v1/configurations/:id/to-offer — convert to offer
router.post('/:id/to-offer', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows: [cfg] } = await client.query('SELECT * FROM configurations WHERE id = $1', [req.params.id]);
    if (!cfg) return res.status(404).json({ success: false, error: 'Configuration not found' });
    if (!cfg.customer_id) return res.status(400).json({ success: false, error: 'Configuration must have a customer to create an offer' });

    const { rows: cfgItems } = await client.query(
      `SELECT ci.*, p.name AS product_name_catalog, p.unit
       FROM configuration_items ci
       JOIN products p ON p.id = ci.product_id
       WHERE ci.configuration_id = $1
       ORDER BY ci.sort_order`,
      [cfg.id]
    );

    const { title = cfg.name, validity_days = 30 } = req.body;
    const valid_until = new Date(Date.now() + parseInt(validity_days) * 86400000).toISOString().slice(0, 10);

    await client.query('BEGIN');
    const { rows: [offer] } = await client.query(
      `INSERT INTO offers (offer_number, customer_id, opportunity_id, title, currency, validity_days, notes, valid_until, created_by)
       VALUES ('', $1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [cfg.customer_id, cfg.opportunity_id, title, cfg.currency, validity_days, cfg.notes, valid_until, req.user.id]
    );
    for (let i = 0; i < cfgItems.length; i++) {
      const item = cfgItems[i];
      await client.query(
        `INSERT INTO offer_items (offer_id, product_name, description, quantity, unit, unit_price, discount_pct, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,0,$7)`,
        [offer.id, item.product_name_catalog, item.notes, item.quantity, item.unit, item.unit_price, i]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, data: offer });
  } catch (err) { await client.query('ROLLBACK'); next(err); } finally { client.release(); }
});

// DELETE /api/v1/configurations/:id
router.delete('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM configurations WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
