import { db } from '../lib/db';
import { workSegments } from '../lib/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select()
    .from(workSegments)
    .orderBy(desc(workSegments.syncedAt))
    .limit(10);

  if (rows.length === 0) {
    console.log('No work segments found in the database.');
  } else {
    console.log(`Found ${rows.length} segment(s):\n`);
    for (const r of rows) {
      console.log(`  ${r.date} | ${r.category} | ${r.title ?? '(no title)'} | ${r.durationMinutes} min`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
