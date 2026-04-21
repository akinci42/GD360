import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
// coordinator has owner-level access everywhere in admin
router.use(authenticate, requireRole('owner', 'coordinator'));

// GET /api/v1/admin/users
router.get('/users', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { rows } = await client.query(
      `SELECT id, email, full_name, role, level, region, is_active, last_login_at, created_at
       FROM users ORDER BY created_at ASC`
    );
    res.json({ success: true, data: rows });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/admin/users
router.post('/users', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { email, full_name, role, level, region } = req.body;
    if (!email || !full_name || !role) {
      return res.status(400).json({ success: false, error: 'email, full_name, role required' });
    }
    const validRoles = ['owner', 'coordinator', 'sales', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    const hash = await bcrypt.hash('GD360!2024', 12);
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, level, region)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, full_name, role, level, region, is_active, created_at`,
      [email.toLowerCase().trim(), hash, full_name.trim(), role, level || 1, region || null]
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Email already exists' });
    next(err);
  } finally { client.release(); }
});

// PUT /api/v1/admin/users/:id
router.put('/users/:id', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const { email, full_name, role, level, region } = req.body;
    const validRoles = ['owner', 'coordinator', 'sales', 'viewer'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({ success: false, error: 'Invalid role' });
    }
    const { rows } = await client.query(
      `UPDATE users
       SET email     = COALESCE($1, email),
           full_name = COALESCE($2, full_name),
           role      = COALESCE($3, role),
           level     = COALESCE($4, level),
           region    = COALESCE($5, region)
       WHERE id = $6
       RETURNING id, email, full_name, role, level, region, is_active, last_login_at`,
      [email?.toLowerCase().trim() || null, full_name?.trim() || null, role || null, level || null, region !== undefined ? region : null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ success: false, error: 'Email already exists' });
    next(err);
  } finally { client.release(); }
});

// PATCH /api/v1/admin/users/:id/status
router.patch('/users/:id/status', async (req, res, next) => {
  // coordinator cannot toggle their own account — only owner (Remzi) can
  if (req.user.role === 'coordinator' && req.params.id === req.user.id) {
    return res.status(403).json({ success: false, error: 'Coordinator cannot change their own account status' });
  }
  const client = await getRlsClient(req.user);
  try {
    const { is_active } = req.body;
    if (typeof is_active !== 'boolean') {
      return res.status(400).json({ success: false, error: 'is_active (boolean) required' });
    }
    const { rows } = await client.query(
      `UPDATE users SET is_active = $1 WHERE id = $2
       RETURNING id, email, full_name, role, is_active`,
      [is_active, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); } finally { client.release(); }
});

// POST /api/v1/admin/users/:id/reset-password
router.post('/users/:id/reset-password', async (req, res, next) => {
  const client = await getRlsClient(req.user);
  try {
    const newPassword = req.body.password || 'GD360!2024';
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, email, full_name`,
      [hash, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: { message: 'Password reset successfully' } });
  } catch (err) { next(err); } finally { client.release(); }
});

export default router;
