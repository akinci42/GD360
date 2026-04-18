import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../src/db/client.js';

const DEFAULT_PASSWORD = 'GD360!2024';

const USERS = [
  { email: 'remzi@gencdegirmen.com.tr', full_name: 'Remzi Genc', role: 'owner' },
  { email: 'ahmet@gencdegirmen.com.tr', full_name: 'Ahmet Coban', role: 'coordinator' },
  { email: 'orhan@gencdegirmen.com.tr', full_name: 'Orhan Degirmen', role: 'sales' },
  { email: 'sinan@gencdegirmen.com.tr', full_name: 'Sinan Kaya', role: 'sales' },
  { email: 'ramazan@gencdegirmen.com.tr', full_name: 'Ramazan Celik', role: 'sales' },
  { email: 'sanzhar@gencdegirmen.com.tr', full_name: 'Sanzhar Nurmagambetov', role: 'sales' },
  { email: 'sami@gencdegirmen.com.tr', full_name: 'Sami Yilmaz', role: 'sales' },
  { email: 'isa@gencdegirmen.com.tr', full_name: 'Isa Demir', role: 'viewer' },
];

async function seed() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const client = await pool.connect();
  try {
    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           role = EXCLUDED.role,
           password_hash = EXCLUDED.password_hash`,
        [u.email, hash, u.full_name, u.role]
      );
      console.log(`  ✓ ${u.full_name} (${u.role})`);
    }
    console.log(`\nSeeded ${USERS.length} users. Default password: ${DEFAULT_PASSWORD}`);
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(err => {
  console.error(err.message);
  process.exit(1);
});
