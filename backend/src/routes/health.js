import { Router } from 'express';
import pool from '../db/client.js';
import redis from '../redis/client.js';

const router = Router();

router.get('/', async (req, res) => {
  const checks = { postgres: 'ok', redis: 'ok' };

  try {
    await pool.query('SELECT 1');
  } catch {
    checks.postgres = 'error';
  }

  try {
    await redis.ping();
  } catch {
    checks.redis = 'error';
  }

  const healthy = Object.values(checks).every(v => v === 'ok');
  res.status(healthy ? 200 : 503).json({
    success: healthy,
    version: '0.1.0',
    checks,
  });
});

export default router;
