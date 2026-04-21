import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { authenticate } from '../middleware/auth.js';
import { getRlsClient } from '../db/rls.js';

const router = Router();
router.use(authenticate);

const UPLOAD_DIR = '/app/uploads';
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// GET /files?customer_id=&page=1&limit=20
router.get('/', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { customer_id, opportunity_id, category } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(50, parseInt(req.query.limit) || 20);
    const offset = (page - 1) * limit;

    const conditions = [];
    const params     = [];

    if (customer_id)    { params.push(customer_id);    conditions.push(`f.customer_id = $${params.length}`); }
    if (opportunity_id) { params.push(opportunity_id); conditions.push(`f.opportunity_id = $${params.length}`); }
    if (category)       { params.push(category);       conditions.push(`f.category = $${params.length}`); }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(limit, offset);
    const { rows } = await client.query(`
      SELECT f.*, u.full_name AS uploader_name, c.company_name
      FROM files f
      LEFT JOIN users u ON u.id = f.created_by
      LEFT JOIN customers c ON c.id = f.customer_id
      ${where}
      ORDER BY f.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    client.release();
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// POST /files (multipart upload)
router.post('/', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const { customer_id, opportunity_id, category = 'general', notes } = req.body;
    const client = await getRlsClient(req.user);

    const { rows } = await client.query(`
      INSERT INTO files (file_name, file_path, mime_type, file_size, category, notes, customer_id, opportunity_id, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      req.file.originalname,
      req.file.filename,
      req.file.mimetype,
      req.file.size,
      category,
      notes || null,
      customer_id || null,
      opportunity_id || null,
      req.user.id,
    ]);

    client.release();
    res.status(201).json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// GET /files/:id/download
router.get('/:id/download', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { rows } = await client.query('SELECT * FROM files WHERE id = $1', [req.params.id]);
    client.release();

    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });

    const filePath = path.join(UPLOAD_DIR, rows[0].file_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'File missing' });

    res.download(filePath, rows[0].file_name);
  } catch (err) { next(err); }
});

// PATCH /files/:id
router.patch('/:id', async (req, res, next) => {
  try {
    const { category, notes } = req.body;
    const client = await getRlsClient(req.user);

    const { rows } = await client.query(`
      UPDATE files SET category = COALESCE($1, category), notes = $2, updated_at = now()
      WHERE id = $3
      RETURNING *
    `, [category, notes ?? null, req.params.id]);

    client.release();
    if (!rows.length) return res.status(404).json({ success: false, error: 'Not found' });
    res.json({ success: true, data: rows[0] });
  } catch (err) { next(err); }
});

// DELETE /files/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const client = await getRlsClient(req.user);
    const { rows } = await client.query('DELETE FROM files WHERE id = $1 RETURNING file_path', [req.params.id]);
    client.release();

    if (rows.length) {
      const filePath = path.join(UPLOAD_DIR, rows[0].file_path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    res.json({ success: true });
  } catch (err) { next(err); }
});

export default router;
