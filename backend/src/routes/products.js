import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /api/v1/products
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { category, active = 'true', search } = req.query;
    const conditions = [];
    const params = [];
    if (active !== 'all') { conditions.push(`is_active = TRUE`); }
    if (category) { params.push(category); conditions.push(`category = $${params.length}`); }
    if (search)   { params.push(`%${search}%`); conditions.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await client.query(
      `SELECT * FROM products ${where} ORDER BY category, name`,
      params
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/products/categories
router.get('/categories', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT DISTINCT category FROM products WHERE category IS NOT NULL AND is_active = TRUE ORDER BY category`
    );
    res.json({ success: true, data: rows.map(r => r.category) });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/products/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Product not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/products
router.post('/', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { name, sku, category, description, base_price = 0, currency = 'USD', unit = 'pcs', specs = {}, is_active = true } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    const { rows } = await client.query(
      `INSERT INTO products (name, sku, category, description, base_price, currency, unit, specs, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, sku || null, category || null, description || null, base_price, currency, unit, JSON.stringify(specs), is_active, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/products/:id
router.patch('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const allowed = ['name', 'sku', 'category', 'description', 'base_price', 'currency', 'unit', 'specs', 'is_active'];
    const updates = [];
    const values = [];
    allowed.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${values.length + 1}`);
        values.push(f === 'specs' ? JSON.stringify(req.body[f]) : req.body[f]);
      }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const { rows, rowCount } = await client.query(
      `UPDATE products SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// DELETE /api/v1/products/:id
router.delete('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM products WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
