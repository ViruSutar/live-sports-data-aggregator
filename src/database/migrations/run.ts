/**
 * Standalone script to run database migrations.
 * Usage: npx tsx src/database/migrations/run.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { createDatabase } from '../connection.js';

const dbPath = process.env.DB_PATH ?? 'data/matches.sqlite';
const db = createDatabase(dbPath);
console.log(`Migrations applied to ${dbPath}`);
db.close();
