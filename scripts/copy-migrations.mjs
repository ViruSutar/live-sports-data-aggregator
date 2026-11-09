import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const source = resolve('src/database/migrations');
const destination = resolve('dist/database/migrations');

if (!existsSync(source)) {
  throw new Error(`Migration directory not found: ${source}`);
}

mkdirSync(dirname(destination), { recursive: true });
cpSync(source, destination, { recursive: true });
console.log(`Copied SQL migrations to ${destination}`);
