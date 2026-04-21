import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

// GET /notifications?page=1&unread_only=true
router.get('/', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const page       = Math.max(1, parseInt(req.query.page) || 1);
    const limit      = Math.min(50, parseInt(req.query.limit) || 20);
    const unreadOnly = req.query.unread_only === 'true';
    const offset     = (page - 1) * limit;

    const where = unreadOnly ? 'AND is_read = FALSE' : '';

    const { rows } = await client.query(`
      SELECT * FROM notifications
      WHERE user_id = $1 ${where}
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `, [req.user.id, limit, offset]);

    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE is_read = FALSE) AS unread FROM notifications WHERE user_id = $1',
      [req.user.id]
    );

    client.release();
    res.json({
      success: true,
      data: rows,
      meta: { total: parseInt(countRows[0].total), unread: parseInt(countRows[0].unread) },
    });
  } catch (err) { next(err); }
});

// POST /notifications (owner/coordinator broadcast)
router.post('/', async (req, res, next) => {
  try {
    if (!['owner', 'coordinator'].includes(req.user.role)) {
      return res.status(403).json({ success: false, error: 'Forbidden' });
    }
    const { user_id, type = 'system', title, body, related_type, related_id } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title required' });

    const client = await getRlsClient(req.user);

    if (user_id) {
      const { rows } = await client.query(`
        INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
        VALUES ($1,$2,$3,$4,$5,$6) RETURNING *
      `, [user_id, type, title, body || null, related_type || null, related_id || null]);
      client.release();
      return res.status(201).json({ success: true, data: rows[0] });
    }

    // broadcast to all active users
    const { rows: users } = await client.query('SELECT id FROM users WHERE is_active = TRUE');
    for (const u of users) {
      await client.query(`
        INSERT INTO notifications (user_id, type, title, body, related_type, related_id)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [u.id, type, title, body || null, related_type || null, related_id || null]);
    }

    client.release();
    res.status(201).json({ success: true, data: { broadcast: true, count: users.length } });
  } catch (err) { next(err); }
});

// PATCH /notifications/:id/read
router.patch('/:id/read', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    await client.query(
      'UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    client.release();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// POST /notifications/read-all
router.post('/read-all', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    await client.query(
      'UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE',
      [req.user.id]
    );
    client.release();
    res.json({ success: true });
  } catch (err) { next(err); }
});

// DELETE /notifications/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    await client.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    client.release();
    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
