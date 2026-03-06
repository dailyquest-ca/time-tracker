import { db } from '../lib/db';
import { categories, events } from '../lib/schema';
import { desc, eq } from 'drizzle-orm';

async function main() {
  const rows = await db
    .select({
      date: events.date,
      name: events.name,
      categoryName: categories.name,
      lengthHours: events.lengthHours,
    })
    .from(events)
    .innerJoin(categories, eq(events.categoryId, categories.id))
    .orderBy(desc(events.updatedAt))
    .limit(10);

  if (rows.length === 0) {
    console.log('No events found in the database.');
  } else {
    console.log(`Found ${rows.length} event(s):\n`);
    for (const r of rows) {
      const hours = parseFloat(r.lengthHours ?? '0');
      const mins = Math.round(hours * 60);
      console.log(`  ${r.date} | ${r.categoryName} | ${r.name ?? '(no name)'} | ${hours} h (${mins} min)`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
