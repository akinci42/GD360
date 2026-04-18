import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /api/v1/customers
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { page = 1, limit = 20, search } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = `WHERE c.company_name ILIKE $${params.length} OR c.country ILIKE $${params.length}`;
    }
    params.push(parseInt(limit), offset);
    const sql = `
      SELECT c.*, u.full_name AS assigned_to_name,
             (SELECT COUNT(*) FROM customer_contacts cc WHERE cc.customer_id = c.id) AS contacts_count
      FROM customers c
      LEFT JOIN users u ON u.id = c.assigned_to
      ${where}
      ORDER BY c.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);
    const countSql = `SELECT COUNT(*) FROM customers c ${where}`;
    const { rows: countRows } = await client.query(countSql, search ? [`%${search}%`] : []);
    res.json({ success: true, data: rows, total: parseInt(countRows[0].count), page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/customers/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT c.*, u.full_name AS assigned_to_name FROM customers c
       LEFT JOIN users u ON u.id = c.assigned_to WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/customers
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { company_name, country, city, industry, website, notes, assigned_to } = req.body;
    if (!company_name) return res.status(400).json({ success: false, error: 'company_name required' });
    const { rows } = await client.query(
      `INSERT INTO customers (company_name, country, city, industry, website, notes, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [company_name, country, city, industry, website, notes, assigned_to || req.user.id, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/customers/:id
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const fields = ['company_name', 'country', 'city', 'industry', 'website', 'notes', 'assigned_to'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Customer not found or no permission' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// DELETE /api/v1/customers/:id
router.delete('/:id', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM customers WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

// --- Contacts sub-resource ---

// GET /api/v1/customers/:id/contacts
router.get('/:id/contacts', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      'SELECT * FROM customer_contacts WHERE customer_id = $1 ORDER BY is_primary DESC, created_at ASC',
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/customers/:id/contacts
router.post('/:id/contacts', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { full_name, title, email, phone, is_primary, notes } = req.body;
    if (!full_name) return res.status(400).json({ success: false, error: 'full_name required' });
    if (is_primary) {
      await client.query(
        'UPDATE customer_contacts SET is_primary = FALSE WHERE customer_id = $1',
        [req.params.id]
      );
    }
    const { rows } = await client.query(
      `INSERT INTO customer_contacts (customer_id, full_name, title, email, phone, is_primary, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.id, full_name, title, email, phone, is_primary || false, notes, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/customers/:id/contacts/:cid
router.patch('/:id/contacts/:cid', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const fields = ['full_name', 'title', 'email', 'phone', 'is_primary', 'notes'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    if (req.body.is_primary) {
      await client.query('UPDATE customer_contacts SET is_primary = FALSE WHERE customer_id = $1', [req.params.id]);
    }
    values.push(req.params.cid);
    const { rows } = await client.query(
      `UPDATE customer_contacts SET ${updates.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// DELETE /api/v1/customers/:id/contacts/:cid
router.delete('/:id/contacts/:cid', requireRole('owner', 'coordinator'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rowCount } = await client.query('DELETE FROM customer_contacts WHERE id = $1', [req.params.cid]);
    if (!rowCount) return res.status(404).json({ success: false, error: 'Contact not found' });
    res.json({ success: true });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
