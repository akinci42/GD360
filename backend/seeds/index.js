import 'dotenv/config';
import bcrypt from 'bcryptjs';
import pool from '../src/db/client.js';

const DEFAULT_PASSWORD = 'GD360!2024';

const USERS = [
  {
    email: 'mert.selek@gencdegirmen.com.tr',
    full_name: 'Remzi Mert Selek',
    role: 'owner',
    level: 4,
    region: 'Genel',
  },
  {
    email: 'ahmet@gencdegirmen.com.tr',
    full_name: 'Ahmet Coban',
    role: 'coordinator',
    level: 3,
    region: 'Genel',
  },
  {
    email: 'orhan@gencdegirmen.com.tr',
    full_name: 'Orhan Guler',
    role: 'sales',
    level: 2,
    region: 'Türkiye',
  },
  {
    email: 'sinan.uzer@gmach.com.tr',
    full_name: 'Sinan Uzer',
    role: 'sales',
    level: 2,
    region: 'G.Asya, Afrika, EN',
  },
  {
    email: 'ramazan.topac@gmach.com.tr',
    full_name: 'Ramazan Topac',
    role: 'sales',
    level: 2,
    region: 'Özbekistan, Kazakistan, Rusya, Azerbaycan, Tacikistan, Ukrayna',
  },
  {
    email: 'sanzhar.estelikov@gmach.com.tr',
    full_name: 'Sanzhar Estelikov',
    role: 'sales',
    level: 2,
    region: 'Kırgızistan, Türkmenistan',
  },
  {
    email: 'sami.elseyh@gmach.com.tr',
    full_name: 'Sami Elseyh',
    role: 'sales',
    level: 2,
    region: 'Mısır, Libya, Sudan, Irak, Yemen, İran, Cezayir, Fas',
  },
  {
    email: 'isa.akinci@gmach.com.tr',
    full_name: 'Isa Akinci',
    role: 'viewer',
    level: 1,
    region: 'BT (Sunucu, Domain, Altyapı)',
  },
];

async function seed() {
  const hash = await bcrypt.hash(DEFAULT_PASSWORD, 12);
  const client = await pool.connect();
  try {
    // Clear existing users (cascade deletes refresh_tokens)
    await client.query('DELETE FROM users');
    console.log('Existing users cleared.\n');

    for (const u of USERS) {
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, level, region)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [u.email, hash, u.full_name, u.role, u.level, u.region]
      );
      console.log(`  ✓ ${u.full_name.padEnd(25)} ${u.role.padEnd(12)} L${u.level}  ${u.region}`);
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
