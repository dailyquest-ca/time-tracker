import { db } from '@/lib/db';
import { categoryMapping, type WorkCategory } from '@/lib/schema';
import { NextRequest, NextResponse } from 'next/server';

export type CategoryMappingBody = Array<{
  type: 'project' | 'tag';
  value: string;
  category: WorkCategory;
}>;

export async function GET() {
  const rows = await db.select().from(categoryMapping);
  const data = rows.map((r) => ({
    id: r.id,
    type: r.type,
    value: r.value,
    category: r.category,
  }));
  return NextResponse.json({ data });
}

export async function PATCH(request: NextRequest) {
  let body: CategoryMappingBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400 }
    );
  }
  if (!Array.isArray(body)) {
    return NextResponse.json(
      { error: 'Body must be an array of { type, value, category }' },
      { status: 400 }
    );
  }
  const validCategories: WorkCategory[] = [
    'work_project',
    'general_task',
    'meeting',
  ];
  for (const item of body) {
    if (
      !item ||
      (item.type !== 'project' && item.type !== 'tag') ||
      typeof item.value !== 'string' ||
      !validCategories.includes(item.category)
    ) {
      return NextResponse.json(
        { error: 'Each item must have type (project|tag), value (string), category' },
        { status: 400 }
      );
    }
  }
  await db.delete(categoryMapping);
  if (body.length > 0) {
    await db.insert(categoryMapping).values(
      body.map((item) => ({
        type: item.type,
        value: item.value,
        category: item.category,
      }))
    );
  }
  return NextResponse.json({ ok: true });
}
