# GD360 — Database Notes

## Veritabanı Bağlantı Bilgileri

PostgreSQL (Docker):
- Container: gd360-postgres
- User: gd360
- Database: gd360
- Password: (DATABASE_URL'de, docker-compose.yml satir 44)

Hızlı psql giriş:
  docker compose exec postgres psql -U gd360 -d gd360

YANLIŞ (sık yapılan hata): psql -U postgres -d gdsales360

## Backend bağlantı (.env)
DATABASE_URL=postgresql://gd360:<pwd>@postgres:5432/gd360
