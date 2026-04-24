import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// ─── Validation helpers ───────────────────────────────────────────────────────
const VALID_STATUSES = ['active', 'passive', 'blacklisted', 'unidentified'];

function validateCustomerType(body) {
  const { customer_type, partner_subtype, parent_id } = body;
  if (customer_type === undefined) return null;
  if (!['partner', 'direct', 'end_customer'].includes(customer_type)) {
    return 'customer_type must be partner, direct, or end_customer';
  }
  if (customer_type === 'partner' && !partner_subtype) {
    return 'partner_subtype is required when customer_type is partner (distributor or regional_office)';
  }
  if (customer_type === 'partner' && !['distributor', 'regional_office'].includes(partner_subtype)) {
    return 'partner_subtype must be distributor or regional_office';
  }
  if (customer_type === 'end_customer' && !parent_id) {
    return 'parent_id is required when customer_type is end_customer';
  }
  return null;
}

// Sort whitelist — invalid values silently fall back to default (last_activity_desc)
const SORT_WHITELIST = {
  company_name_asc:   'c.company_name COLLATE "tr-TR-x-icu" ASC',
  company_name_desc:  'c.company_name COLLATE "tr-TR-x-icu" DESC',
  country_asc:        'c.country ASC NULLS LAST',
  country_desc:       'c.country DESC NULLS LAST',
  last_activity_desc: '(SELECT MAX(created_at) FROM opportunities WHERE customer_id = c.id) DESC NULLS LAST',
  last_activity_asc:  '(SELECT MAX(created_at) FROM opportunities WHERE customer_id = c.id) ASC  NULLS LAST',
  created_at_desc:    'c.created_at DESC',
  created_at_asc:     'c.created_at ASC',
  quote_count_desc:   '(SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = c.id) DESC',
  quote_count_asc:    '(SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = c.id) ASC',
};
const DEFAULT_SORT = 'last_activity_desc';

// ─── GET /api/v1/customers ────────────────────────────────────────────────────
router.get('/', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const {
      page = 1, limit = 50,
      search, country,
      channel_type,      // legacy — maps to customer_type for backwards compat
      customer_type, partner_subtype, status,
      assigned_to,
      sort,
    } = req.query;
    const sortKey    = SORT_WHITELIST[sort] ? sort : DEFAULT_SORT;
    const orderByExpr = SORT_WHITELIST[sortKey];
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
    if (country)         { params.push(country);         conditions.push(`c.country          = $${params.length}`); }
    // channel_type kept for backwards compat (old frontend); customer_type takes precedence
    if (customer_type)   { params.push(customer_type);   conditions.push(`c.customer_type    = $${params.length}`); }
    else if (channel_type) { params.push(channel_type);  conditions.push(`c.channel_type     = $${params.length}`); }
    if (partner_subtype) { params.push(partner_subtype); conditions.push(`c.partner_subtype  = $${params.length}`); }
    if (status)          { params.push(status);          conditions.push(`c.status           = $${params.length}`); }
    if (assigned_to)     { params.push(assigned_to);     conditions.push(`c.assigned_to      = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit), offset);

    const sql = `
      SELECT
        c.id, c.company_name, c.country, c.city, c.address,
        c.customer_type, c.partner_subtype, c.parent_id,
        c.channel_type, c.industry, c.website, c.phone, c.tax_number,
        c.primary_language, c.source, c.status,
        c.name_normalized, c.imported_from_raw_id,
        c.notes, c.assigned_to, c.created_by, c.created_at, c.updated_at,
        u.full_name                                                              AS assigned_to_name,
        p.company_name                                                           AS parent_company_name,
        (SELECT COUNT(*)     FROM customer_contacts cc  WHERE cc.customer_id = c.id)                                              AS contacts_count,
        (SELECT cc.full_name FROM customer_contacts cc  WHERE cc.customer_id = c.id AND cc.is_primary ORDER BY cc.created_at LIMIT 1) AS primary_contact_name,
        (SELECT cc.phone     FROM customer_contacts cc  WHERE cc.customer_id = c.id AND cc.is_primary ORDER BY cc.created_at LIMIT 1) AS primary_contact_phone,
        (SELECT COUNT(*)     FROM customers             WHERE parent_id = c.id)                                                   AS children_count,
        (SELECT COUNT(*)     FROM historical_quotes_raw WHERE customer_id = c.id)                                                 AS historical_quote_count,
        (SELECT MAX(f.scheduled_at) FROM followups f    WHERE f.customer_id = c.id)                                               AS last_activity_at
      FROM customers c
      LEFT JOIN users     u ON u.id = c.assigned_to
      LEFT JOIN customers p ON p.id = c.parent_id
      ${where}
      ORDER BY ${orderByExpr}
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

// ─── GET /api/v1/customers/filter-options ────────────────────────────────────
router.get('/filter-options', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const [countries, salespeople, typeCounts] = await Promise.all([
      client.query(`SELECT DISTINCT country FROM customers WHERE country IS NOT NULL ORDER BY country`),
      client.query(`SELECT id, full_name FROM users WHERE role IN ('owner','coordinator','sales') AND is_active ORDER BY full_name`),
      client.query(`SELECT customer_type, partner_subtype, COUNT(*) AS cnt
                    FROM customers GROUP BY customer_type, partner_subtype ORDER BY customer_type, partner_subtype`),
    ]);
    res.json({
      success: true,
      data: {
        countries: countries.rows.map(r => r.country),
        salespeople: salespeople.rows,
        type_counts: typeCounts.rows,
      },
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── GET /api/v1/customers/hierarchy/:id ─────────────────────────────────────
// Must be defined before /:id to avoid Express treating "hierarchy" as an id param.
router.get('/hierarchy/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { id } = req.params;

    // Walk up parent chain (max 5 levels to prevent infinite loops)
    const ancestors = [];
    let currentId = id;
    for (let i = 0; i < 5; i++) {
      const { rows } = await client.query(
        `SELECT id, company_name, country, customer_type, partner_subtype, parent_id
         FROM customers WHERE id = $1`, [currentId]
      );
      if (!rows[0] || !rows[0].parent_id) break;
      currentId = rows[0].parent_id;
      const { rows: parentRows } = await client.query(
        `SELECT id, company_name, country, customer_type, partner_subtype
         FROM customers WHERE id = $1`, [currentId]
      );
      if (parentRows[0]) ancestors.unshift(parentRows[0]);
      else break;
    }

    // Direct children
    const { rows: children } = await client.query(
      `SELECT c.id, c.company_name, c.country, c.customer_type, c.partner_subtype,
              (SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = c.id) AS historical_quote_count
       FROM customers c
       WHERE c.parent_id = $1
       ORDER BY c.company_name`, [id]
    );

    // Self
    const { rows: selfRows } = await client.query(
      `SELECT id, company_name, country, customer_type, partner_subtype, parent_id
       FROM customers WHERE id = $1`, [id]
    );

    res.json({
      success: true,
      data: {
        self: selfRows[0] || null,
        ancestors,
        children,
      },
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── GET /api/v1/customers/:id ────────────────────────────────────────────────
router.get('/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT
         c.*,
         u.full_name  AS assigned_to_name,
         p.company_name AS parent_company_name,
         p.country      AS parent_country,
         p.customer_type AS parent_customer_type
       FROM customers c
       LEFT JOIN users     u ON u.id = c.assigned_to
       LEFT JOIN customers p ON p.id = c.parent_id
       WHERE c.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Customer not found' });

    const customer = rows[0];

    // Children (where parent_id = :id)
    const { rows: children } = await client.query(
      `SELECT id, company_name, country, customer_type, partner_subtype,
              (SELECT COUNT(*) FROM historical_quotes_raw WHERE customer_id = c.id) AS historical_quote_count
       FROM customers c
       WHERE parent_id = $1
       ORDER BY company_name`,
      [req.params.id]
    );

    // Historical quote count
    const { rows: hqRows } = await client.query(
      `SELECT COUNT(*) AS cnt FROM historical_quotes_raw WHERE customer_id = $1`,
      [req.params.id]
    );

    // Groups this customer belongs to
    const { rows: groups } = await client.query(
      `SELECT g.id, g.name, g.group_type
       FROM customer_groups g
       JOIN customer_group_members m ON m.group_id = g.id
       WHERE m.customer_id = $1
       ORDER BY g.name`,
      [req.params.id]
    );

    res.json({
      success: true,
      data: {
        ...customer,
        children,
        historical_quote_count: parseInt(hqRows[0].cnt),
        groups,
      },
    });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── POST /api/v1/customers ───────────────────────────────────────────────────
router.post('/', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const {
      company_name, country, city, address, industry, website, phone,
      tax_number, channel_type, notes, assigned_to,
      customer_type = 'direct', partner_subtype, parent_id,
      status = 'active', primary_language, source = 'manual',
    } = req.body;
    if (!company_name) return res.status(400).json({ success: false, error: 'company_name required' });

    const typeErr = validateCustomerType({ customer_type, partner_subtype, parent_id });
    if (typeErr) return res.status(400).json({ success: false, error: typeErr });

    const { rows } = await client.query(
      `INSERT INTO customers
         (company_name, country, city, address, industry, website, phone, tax_number,
          channel_type, notes, assigned_to, created_by,
          customer_type, partner_subtype, parent_id, status, primary_language, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [company_name, country, city, address, industry, website, phone, tax_number,
       channel_type, notes, assigned_to || req.user.id, req.user.id,
       customer_type, partner_subtype || null, parent_id || null,
       status, primary_language || null, source]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── PATCH /api/v1/customers/:id ─────────────────────────────────────────────
router.patch('/:id', requireRole('owner', 'coordinator', 'sales'), async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    if (req.body.company_name !== undefined && !String(req.body.company_name).trim()) {
      return res.status(400).json({ success: false, error: 'company_name cannot be empty' });
    }
    if (req.body.status !== undefined && !VALID_STATUSES.includes(req.body.status)) {
      return res.status(400).json({ success: false, error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    // Validate type rules if any type fields are being changed
    if (req.body.customer_type !== undefined || req.body.partner_subtype !== undefined || req.body.parent_id !== undefined) {
      // Fetch current values to merge with incoming changes
      const { rows: cur } = await client.query(
        'SELECT customer_type, partner_subtype, parent_id FROM customers WHERE id = $1',
        [req.params.id]
      );
      if (!cur[0]) return res.status(404).json({ success: false, error: 'Customer not found' });
      const merged = {
        customer_type:   req.body.customer_type   ?? cur[0].customer_type,
        partner_subtype: req.body.partner_subtype ?? cur[0].partner_subtype,
        parent_id:       req.body.parent_id       ?? cur[0].parent_id,
      };
      // Enforce nulls on type switch
      if (merged.customer_type === 'direct') {
        merged.partner_subtype = null;
        merged.parent_id = null;
        req.body.partner_subtype = null;
        req.body.parent_id = null;
      }
      const typeErr = validateCustomerType(merged);
      if (typeErr) return res.status(400).json({ success: false, error: typeErr });
    }

    const fields = [
      'company_name', 'country', 'city', 'address', 'industry', 'website',
      'phone', 'tax_number', 'channel_type', 'notes', 'assigned_to',
      'customer_type', 'partner_subtype', 'parent_id',
      'status', 'primary_language',
    ];
    const updates = [];
    const values = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        updates.push(`${f} = $${values.length + 1}`);
        values.push(req.body[f] === '' ? null : req.body[f]);
      }
    });
    if (!updates.length) return res.status(400).json({ success: false, error: 'No fields to update' });
    values.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE customers SET ${updates.join(', ')} WHERE id = $${values.length}
       RETURNING *,
         (SELECT full_name FROM users     WHERE id = assigned_to) AS assigned_to_name,
         (SELECT company_name FROM customers WHERE id = parent_id) AS parent_company_name`,
      values
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'Customer not found or no permission' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// ─── DELETE /api/v1/customers/:id ────────────────────────────────────────────
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
