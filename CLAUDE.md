# GDSales360.ai — Genc Degirmen Makinalari Digital Sales Platform

## Project Overview

GDSales360.ai is an internal B2B CRM and sales management platform for Genc Degirmen Makinalari, a Turkish milling machinery manufacturer. The platform centralizes customer relations, tracks the full sales pipeline, and coordinates the sales team across geographies.

## Architecture

```
GD360/
├── backend/          # Node.js + Express API server
│   ├── src/
│   │   ├── routes/   # API route handlers
│   │   ├── middleware/
│   │   ├── db/       # PostgreSQL client & migrations
│   │   ├── redis/    # Redis client
│   │   └── index.js
│   ├── migrations/   # SQL migration files (immutable, numbered)
│   ├── seeds/        # Seed data scripts
│   └── Dockerfile
├── frontend/         # React + Vite + Tailwind SPA
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── layouts/
│   │   ├── store/    # Zustand state
│   │   ├── i18n/     # 5-language support
│   │   └── main.jsx
│   └── Dockerfile
├── docker-compose.yml
└── CLAUDE.md
```

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Backend   | Node.js 20, Express 5               |
| Database  | PostgreSQL 16 + Row-Level Security  |
| Cache     | Redis 7                             |
| Frontend  | React 18, Vite, Tailwind CSS v3     |
| Auth      | JWT (access + refresh tokens)       |
| i18n      | 5 languages: TR, EN, RU, AR, FR     |
| Deploy    | Docker Compose                      |

## Roles & Permissions

| Role        | Users         | Access                                    |
|-------------|---------------|-------------------------------------------|
| owner       | Remzi         | Full access, all reports, admin panel     |
| coordinator | Ahmet         | All modules except admin                  |
| sales       | Orhan, Sinan, Ramazan, Sanzhar, Sami | Own customers + pipeline |
| viewer      | Isa           | Read-only all data                        |

Default password for all users: `GD360!2024`

## Modules (12)

1. **Dashboard** — KPI cards, pipeline overview
2. **CRM** — Customers & contacts management
3. **Sales Radar** — 7-stage pipeline (Lead → Qualified → Proposal → Negotiation → Won → Lost → On Hold)
4. **Activities** — Follow-ups with 48-hour lock mechanism
5. **Offers** — Quotation management
6. **Orders** — Order tracking
7. **Products** — Product catalog
8. **Reports** — Sales analytics
9. **Calendar** — Appointment scheduling
10. **Messages** — Internal messaging
11. **Settings** — User preferences
12. **Admin** — User management (owner only)

## Database Conventions

- All tables have `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`
- All tables have `created_at`, `updated_at` timestamps
- All tables have `created_by UUID REFERENCES users(id)` for RLS
- Migrations are immutable and numbered: `001_`, `002_`, etc.
- RLS enabled on all business tables with role-based policies

## API Conventions

- Base path: `/api/v1`
- Auth header: `Authorization: Bearer <token>`
- All responses: `{ success: bool, data?: any, error?: string }`
- Pagination: `?page=1&limit=20`

## Environment Variables

Backend (`.env`):
```
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://gd360:gd360pass@postgres:5432/gd360
REDIS_URL=redis://redis:6379
JWT_SECRET=<strong-secret>
JWT_REFRESH_SECRET=<strong-refresh-secret>
JWT_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
```

Frontend (`.env`):
```
VITE_API_URL=http://localhost:3001/api/v1
```

## Versioning Policy

- **Immutable versioning**: migrations are never edited after commit
- Semantic versioning: `MAJOR.MINOR.PATCH`
- Current version: `0.1.0`
- Git tags on each release

## Development Commands

```bash
# Start all services
docker-compose up -d

# Run migrations
docker-compose exec backend npm run migrate

# Run seeds
docker-compose exec backend npm run seed

# Backend logs
docker-compose logs -f backend

# Frontend dev (local)
cd frontend && npm run dev
```
