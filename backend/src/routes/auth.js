import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db/client.js';
import redis from '../redis/client.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

function signAccess(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
}

function signRefresh(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN,
  });
}

// POST /api/v1/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password required' });
    }

    const result = await query(
      'SELECT * FROM users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase().trim()]
    );
    const user = result.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ success: false, error: 'Invalid credentials' });
    }

    const token = signAccess(user);
    const refreshToken = signRefresh(user.id);

    // Store refresh token in Redis (TTL 7 days)
    await redis.set(`refresh:${user.id}:${refreshToken}`, '1', 'EX', 7 * 24 * 3600);

    // Update last_login_at
    await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    res.json({
      success: true,
      data: {
        token,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name,
          role: user.role,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ success: false, error: 'Refresh token required' });

    let payload;
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ success: false, error: 'Invalid refresh token' });
    }

    const key = `refresh:${payload.id}:${refreshToken}`;
    const exists = await redis.get(key);
    if (!exists) return res.status(401).json({ success: false, error: 'Token revoked or expired' });

    const result = await query('SELECT * FROM users WHERE id = $1 AND is_active = TRUE', [payload.id]);
    const user = result.rows[0];
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });

    // Rotate: revoke old, issue new
    await redis.del(key);
    const newToken = signAccess(user);
    const newRefresh = signRefresh(user.id);
    await redis.set(`refresh:${user.id}:${newRefresh}`, '1', 'EX', 7 * 24 * 3600);

    res.json({ success: true, data: { token: newToken, refreshToken: newRefresh } });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await redis.del(`refresh:${req.user.id}:${refreshToken}`);
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const result = await query(
      'SELECT id, email, full_name, role, last_login_at FROM users WHERE id = $1',
      [req.user.id]
    );
    if (!result.rows[0]) return res.status(404).json({ success: false, error: 'User not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

export default router;
