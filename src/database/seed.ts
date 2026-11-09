/**
 * Standalone script to seed the database.
 * Usage: npx tsx src/database/seed.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { createDatabase, seedDatabase } from './connection.js';

const dbPath = process.env.DB_PATH ?? 'data/matches.sqlite';
const db = createDatabase(dbPath);
seedDatabase(db);
console.log(`Database seeded at ${dbPath}`);
db.close();
