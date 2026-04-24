import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import redis from './redis/client.js';
import healthRouter from './routes/health.js';
import authRouter from './routes/auth.js';
import customersRouter from './routes/customers.js';
import opportunitiesRouter from './routes/opportunities.js';
import followupsRouter from './routes/followups.js';
import adminRouter from './routes/admin.js';
import dashboardRouter from './routes/dashboard.js';
import offersRouter from './routes/offers.js';
import productsRouter from './routes/products.js';
import configurationsRouter from './routes/configurations.js';
import filesRouter from './routes/files.js';
import reportsRouter from './routes/reports.js';
import notificationsRouter from './routes/notifications.js';
import costsRouter from './routes/costs.js';
import ustaBotRouter from './routes/ustabot.js';
import dedupeRouter from './routes/dedupe.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json());

app.use('/api/health', healthRouter);
app.use('/api/v1/auth', authRouter);
app.use('/api/v1/customers', customersRouter);
app.use('/api/v1/opportunities', opportunitiesRouter);
app.use('/api/v1/followups', followupsRouter);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/dashboard', dashboardRouter);
app.use('/api/v1/offers', offersRouter);
app.use('/api/v1/products', productsRouter);
app.use('/api/v1/configurations', configurationsRouter);
app.use('/api/v1/files', filesRouter);
app.use('/api/v1/reports', reportsRouter);
app.use('/api/v1/notifications', notificationsRouter);
app.use('/api/v1/costs', costsRouter);
app.use('/api/v1/ustabot', ustaBotRouter);
app.use('/api/v1/dedupe', dedupeRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ success: false, error: err.message || 'Internal server error' });
});

async function start() {
  await redis.connect();
  app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
}

start().catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
