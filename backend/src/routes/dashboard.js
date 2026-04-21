import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';
import redis from '../redis/client.js';

const router = Router();
router.use(authenticate);

const CACHE_TTL = 300; // 5 minutes

async function withCache(key, fn) {
  const hit = await redis.get(key);
  if (hit) return JSON.parse(hit);
  const data = await fn();
  await redis.set(key, JSON.stringify(data), 'EX', CACHE_TTL);
  return data;
}

// GET /api/v1/dashboard/kpis
router.get('/kpis', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const scope = req.user.role === 'sales' ? req.user.id : 'all';
    const data = await withCache(`dashboard:kpis:${scope}`, async () => {
      const [customers, opps, activities] = await Promise.all([
        client.query('SELECT COUNT(*) FROM customers'),
        client.query(`
          SELECT
            COUNT(*) FILTER (WHERE stage NOT IN ('won','lost'))          AS active_count,
            COALESCE(SUM(value) FILTER (WHERE stage NOT IN ('won','lost')), 0) AS pipeline_value,
            COUNT(*) FILTER (WHERE stage = 'won')                        AS won_count,
            COUNT(*)                                                      AS total_count
          FROM opportunities
        `),
        client.query(`
          SELECT COUNT(*) FROM followups
          WHERE created_at >= date_trunc('month', CURRENT_DATE)
        `),
      ]);
      const opp = opps.rows[0];
      const wonRate = parseInt(opp.total_count) > 0
        ? Math.round((parseInt(opp.won_count) / parseInt(opp.total_count)) * 100)
        : 0;
      return {
        totalCustomers:      parseInt(customers.rows[0].count),
        activeOpportunities: parseInt(opp.active_count),
        pipelineValue:       parseFloat(opp.pipeline_value),
        wonRate,
        monthlyActivities:   parseInt(activities.rows[0].count),
      };
    });
    res.json({ success: true, data });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/dashboard/pipeline-summary
router.get('/pipeline-summary', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const scope = req.user.role === 'sales' ? req.user.id : 'all';
    const data = await withCache(`dashboard:pipeline:${scope}`, async () => {
      const { rows } = await client.query(`
        SELECT stage,
               COUNT(*)                  AS count,
               COALESCE(SUM(value), 0)   AS value
        FROM opportunities
        GROUP BY stage
      `);
      return rows.map(r => ({
        stage: r.stage,
        count: parseInt(r.count),
        value: parseFloat(r.value),
      }));
    });
    res.json({ success: true, data });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/dashboard/recent-activities
router.get('/recent-activities', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const scope = req.user.role === 'sales' ? req.user.id : 'all';
    const data = await withCache(`dashboard:activities:${scope}`, async () => {
      const { rows } = await client.query(`
        SELECT f.id, f.type, f.subject, f.notes, f.created_at, f.completed_at,
               c.company_name AS customer_name,
               u.full_name    AS user_name
        FROM followups f
        LEFT JOIN customers c ON c.id = f.customer_id
        LEFT JOIN users u     ON u.id = f.created_by
        ORDER BY f.created_at DESC
        LIMIT 10
      `);
      return rows;
    });
    res.json({ success: true, data });
  } catch (err) { next(err); } finally { client.release(); }
});

// GET /api/v1/dashboard/sales-by-user  (owner/coordinator only — uses non-RLS data)
router.get('/sales-by-user', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const data = await withCache('dashboard:sales-by-user', async () => {
      const { rows } = await client.query(`
        SELECT u.id, u.full_name,
               COUNT(o.id)                                                       AS total_opps,
               COUNT(o.id)   FILTER (WHERE o.stage = 'won')                     AS won_count,
               COALESCE(SUM(o.value) FILTER (WHERE o.stage = 'won'), 0)         AS won_value,
               COALESCE(SUM(o.value) FILTER (WHERE o.stage NOT IN ('won','lost')), 0) AS pipeline_value
        FROM users u
        LEFT JOIN opportunities o ON o.assigned_to = u.id
        WHERE u.role = 'sales' AND u.is_active = true
        GROUP BY u.id, u.full_name
        ORDER BY won_value DESC
      `);
      return rows.map(r => ({
        id:            r.id,
        fullName:      r.full_name,
        totalOpps:     parseInt(r.total_opps),
        wonCount:      parseInt(r.won_count),
        wonValue:      parseFloat(r.won_value),
        pipelineValue: parseFloat(r.pipeline_value),
      }));
    });
    res.json({ success: true, data });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
