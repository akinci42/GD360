import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /reports/performance?year=&month=&user_id=
router.get('/performance', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const year  = parseInt(req.query.year)  || new Date().getFullYear();
    const month = parseInt(req.query.month) || null;

    const dateFilter = month
      ? `AND EXTRACT(YEAR FROM o.updated_at) = $1 AND EXTRACT(MONTH FROM o.updated_at) = $2`
      : `AND EXTRACT(YEAR FROM o.updated_at) = $1`;
    const params = month ? [year, month] : [year];

    const { rows } = await client.query(`
      SELECT
        u.id,
        u.full_name,
        u.role,
        u.region,
        COUNT(DISTINCT c.id)                                       AS customer_count,
        COUNT(DISTINCT o.id)                                       AS opportunity_count,
        COUNT(DISTINCT o.id) FILTER (WHERE o.stage = 'won')       AS won_count,
        COUNT(DISTINCT o.id) FILTER (WHERE o.stage = 'lost')      AS lost_count,
        COALESCE(SUM(o.value) FILTER (WHERE o.stage = 'won'), 0)  AS won_revenue,
        COALESCE(SUM(o.value), 0)                                  AS pipeline_value,
        COUNT(DISTINCT f.id)                                       AS followup_count,
        COUNT(DISTINCT f.id) FILTER (WHERE f.status = 'completed') AS followup_done
      FROM users u
      LEFT JOIN customers c ON c.assigned_to = u.id
      LEFT JOIN opportunities o ON o.owner_id = u.id ${dateFilter}
      LEFT JOIN followups f ON f.created_by = u.id
      WHERE u.role = 'sales' AND u.is_active = TRUE
      GROUP BY u.id, u.full_name, u.role, u.region
      ORDER BY won_revenue DESC
    `, params);

    client.release();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /reports/leaderboard
router.get('/leaderboard', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { year = new Date().getFullYear() } = req.query;

    const { rows } = await client.query(`
      SELECT
        u.id,
        u.full_name,
        u.region,
        COALESCE(SUM(o.value) FILTER (WHERE o.stage = 'won'), 0) AS won_revenue,
        COUNT(o.id) FILTER (WHERE o.stage = 'won')               AS won_count,
        COUNT(o.id) FILTER (WHERE o.stage NOT IN ('won','lost'))  AS active_count
      FROM users u
      LEFT JOIN opportunities o ON o.owner_id = u.id
        AND EXTRACT(YEAR FROM o.updated_at) = $1
      WHERE u.role = 'sales' AND u.is_active = TRUE
      GROUP BY u.id, u.full_name, u.region
      ORDER BY won_revenue DESC
    `, [year]);

    client.release();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// GET /reports/pipeline-trends?months=6
router.get('/pipeline-trends', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const months = Math.min(24, parseInt(req.query.months) || 6);

    const { rows } = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
        COUNT(*) FILTER (WHERE stage NOT IN ('won','lost'))  AS active,
        COUNT(*) FILTER (WHERE stage = 'won')                AS won,
        COUNT(*) FILTER (WHERE stage = 'lost')               AS lost,
        COALESCE(SUM(value) FILTER (WHERE stage = 'won'), 0) AS revenue
      FROM opportunities
      WHERE created_at >= NOW() - INTERVAL '1 month' * $1
      GROUP BY 1
      ORDER BY 1 ASC
    `, [months]);

    client.release();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

export default router;
