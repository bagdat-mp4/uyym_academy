import { config } from '../server/config.js';
import { pool, transaction } from '../server/db.js';
import { cleanupTemporarySecurity } from '../server/cleanup.js';

if (!config.database) throw new Error('Configure server DATABASE_URL before cleanup');
const args = process.argv.slice(2);
if (args.some(arg => !/^--(?:batch|passes)=\d+$/.test(arg))) throw new Error('Usage: npx tsx scripts/cleanup.ts [--batch=200] [--passes=10]');
const option = (name: string, fallback: number) => Number(args.find(arg => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const batch = option('batch', 200), passes = option('passes', 10);
if (!Number.isInteger(batch) || batch < 1 || batch > 1000 || !Number.isInteger(passes) || passes < 1 || passes > 100) throw new Error('batch: 1..1000; passes: 1..100');
try {
  for (let pass = 1; pass <= passes; pass++) {
    const counts = await transaction(db => cleanupTemporarySecurity(db, batch));
    console.info(JSON.stringify({ pass, ...counts }));
    if (Object.values(counts).every(count => count === 0)) break;
  }
} finally { await pool.end(); }
