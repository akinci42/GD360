import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /api/v1/customers
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { page = 1, limit = 50, search, country, channel_type, assigned_to } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const params = [];
    const conditions = [];

    if (search) {
      params.push(`%${search}%`);
      const n = params.length;
      conditions.push(`(
        c.company_name ILIKE $${n}
        OR c.country    ILIKE $${n}
        OR EXISTS (
          SELECT 1 FROM customer_contacts cc
          WHERE cc.customer_id = c.id AND cc.full_name ILIKE $${n}
        )
      )`);
    }
    if (country)      { params.push(country);      conditions.push(`c.country      = $${params.length}`); }
    if (channel_type) { params.push(channel_type); conditions.push(`c.channel_type = $${params.length}`); }
    if (assigned_to)  { params.push(assigned_to);  conditions.push(`c.assigned_to  = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const sql = `
      SELECT
        c.*,
        u.full_name                                                              AS assigned_to_name,
        (SELECT COUNT(*)       FROM customer_contacts cc WHERE cc.customer_id = c.id)            AS contacts_count,
        (SELECT cc.full_name   FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.is_primary ORDER BY cc.created_at LIMIT 1) AS primary_contact_name,
        (SELECT cc.phone       FROM customer_contacts cc WHERE cc.customer_id = c.id AND cc.is_primary ORDER BY cc.created_at LIMIT 1) AS primary_contact_phone,
        (SELECT MAX(f.scheduled_at) FROM followups f WHERE f.customer_id = c.id) AS last_activity_at
      FROM customers c
      LEFT JOIN users u ON u.id = c.assigned_to
      ${where}
      ORDER BY c.updated_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `;
    const { rows } = await client.query(sql, params);

    const countSql = `SELECT COUNT(*) FROM customers c ${where}`;
    const { rows: countRows } = await client.query(countSql, params.slice(0, params.length - 2));

    res.json({
      success: true,
      data: rows,
      total: parseInt(countRows[0].count),
      page: parseInt(page),
      limit: parseInt(limit),
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/customers/filter-options  (unique countries + salespeople for dropdowns)
router.get('/filter-options', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const [countries, salespeople] = await Promise.all([
      client.query(`SELECT DISTINCT country FROM customers WHERE country IS NOT NULL ORDER BY country`),
      client.query(`SELECT id, full_name FROM users WHERE role IN ('owner','coordinator','sales') AND is_active ORDER BY full_name`),
    ]);
    res.json({ success: true, data: { countries: countries.rows.map(r => r.country), salespeople: salespeople.rows } });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/customers/:id
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT c.*, u.full_name AS assigned_to_name
       FROM customers c
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id = $1`,
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
    const { company_name, country, city, address, industry, website, phone, tax_number, channel_type, notes, assigned_to } = req.body;
    if (!company_name) return res.status(400).json({ success: false, error: 'company_name required' });
    const { rows } = await client.query(
      `INSERT INTO customers
         (company_name, country, city, address, industry, website, phone, tax_number, channel_type, notes, assigned_to, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [company_name, country, city, address, industry, website, phone, tax_number, channel_type, notes,
       assigned_to || req.user.id, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/customers/:id
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const fields = ['company_name', 'country', 'city', 'address', 'industry', 'website',
                    'phone', 'tax_number', 'channel_type', 'notes', 'assigned_to'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${values.length + 1}`);
        values.push(req.body[f]);
      }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING *, (SELECT full_name FROM users WHERE id = assigned_to) AS assigned_to_name`,
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

// ─── Contacts sub-resource ───────────────────────────────────────────────────

// GET /api/v1/customers/:id/contacts
router.get('/:id/contacts', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT * FROM customer_contacts
       WHERE customer_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
      [req.params.id]
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/customers/:id/contacts
router.post('/:id/contacts', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { full_name, title, email, phone, whatsapp, language, is_primary, notes } = req.body;
    if (!full_name) return res.status(400).json({ success: false, error: 'full_name required' });
    if (is_primary) {
      await client.query(
        'UPDATE customer_contacts SET is_primary = FALSE WHERE customer_id = $1',
        [req.params.id]
      );
    }
    const { rows } = await client.query(
      `INSERT INTO customer_contacts
         (customer_id, full_name, title, email, phone, whatsapp, language, is_primary, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.params.id, full_name, title, email, phone, whatsapp, language, is_primary || false, notes, req.user.id]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// PATCH /api/v1/customers/:id/contacts/:cid
router.patch('/:id/contacts/:cid', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const fields = ['full_name', 'title', 'email', 'phone', 'whatsapp', 'language', 'is_primary', 'notes'];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) { updates.push(`${f} = $${values.length + 1}`); values.push(req.body[f]); }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    if (req.body.is_primary) {
      await client.query(
        'UPDATE customer_contacts SET is_primary = FALSE WHERE customer_id = $1',
        [req.params.id]
      );
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
