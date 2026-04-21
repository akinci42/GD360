import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /costs/categories
router.get('/categories', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { rows } = await client.query('SELECT * FROM cost_categories ORDER BY name');
    client.release();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /costs?year=&month=&category_id=&page=1
router.get('/', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { year, month, category_id, currency } = req.query;
    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(100, parseInt(req.query.limit) || 30);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (year)        { params.push(year);        conditions.push(`EXTRACT(YEAR  FROM c.cost_date) = $${params.length}`); }
    if (month)       { params.push(month);       conditions.push(`EXTRACT(MONTH FROM c.cost_date) = $${params.length}`); }
    if (category_id) { params.push(category_id); conditions.push(`c.category_id = $${params.length}`); }
    if (currency)    { params.push(currency);    conditions.push(`c.currency = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const { rows } = await client.query(`
      SELECT c.*, cat.name AS category_name, cat.color AS category_color,
             u.full_name AS creator_name,
             cu.company_name
      FROM costs c
      LEFT JOIN cost_categories cat ON cat.id = c.category_id
      LEFT JOIN users u ON u.id = c.created_by
      LEFT JOIN customers cu ON cu.id = c.customer_id
      ${where}
      ORDER BY c.cost_date DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    // totals per currency (same filters, without pagination)
    const filterParams = params.slice(0, -2);
    const { rows: totals } = await client.query(`
      SELECT currency, SUM(amount) AS total
      FROM costs c
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      GROUP BY currency
    `, filterParams);

    client.release();
    res.json({ success: true, data: rows, totals });
  } catch (err) { next(err); }
});

// GET /costs/summary?year=
router.get('/summary', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const year = parseInt(req.query.year) || new Date().getFullYear();

    const { rows: monthly } = await client.query(`
      SELECT
        TO_CHAR(cost_date, 'YYYY-MM') AS month,
        currency,
        SUM(amount) AS total
      FROM costs
      WHERE EXTRACT(YEAR FROM cost_date) = $1
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `, [year]);

    const { rows: byCategory } = await client.query(`
      SELECT cat.name, cat.color, co.currency, SUM(co.amount) AS total
      FROM costs co
      LEFT JOIN cost_categories cat ON cat.id = co.category_id
      WHERE EXTRACT(YEAR FROM co.cost_date) = $1
      GROUP BY cat.name, cat.color, co.currency
      ORDER BY total DESC
    `, [year]);

    client.release();
    res.json({ success: true, data: { monthly, byCategory } });
  } catch (err) { next(err); }
});

// POST /costs
router.post('/', async (req, res, next) => {
  try {
    const { category_id, title, amount, currency = 'USD', cost_date, notes, customer_id, opportunity_id } = req.body;
    if (!title || !amount || !cost_date) {
      return res.status(400).json({ success: false, error: 'title, amount, cost_date required' });
    }

    const client = await getRlsClient(req.user);
    const { rows } = await client.query(`
      INSERT INTO costs (category_id, title, amount, currency, cost_date, notes, customer_id, opportunity_id, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [category_id || null, title, amount, currency, cost_date, notes || null, customer_id || null, opportunity_id || null, req.user.id]);

    client.release();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// PATCH /costs/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { category_id, title, amount, currency, cost_date, notes, customer_id, opportunity_id } = req.body;
    const client = await getRlsClient(req.user);

    const { rows } = await client.query(`
      UPDATE costs SET
        category_id    = COALESCE($1, category_id),
        title          = COALESCE($2, title),
        amount         = COALESCE($3, amount),
        currency       = COALESCE($4, currency),
        cost_date      = COALESCE($5, cost_date),
        notes          = $6,
        customer_id    = $7,
        opportunity_id = $8,
        updated_at     = now()
      WHERE id = $9
      RETURNING *
    `, [category_id, title, amount, currency, cost_date, notes ?? null, customer_id ?? null, opportunity_id ?? null, req.params.id]);

    client.release();
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /costs/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    await client.query('DELETE FROM costs WHERE id = $1', [req.params.id]);
    client.release();
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
