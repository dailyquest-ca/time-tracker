import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

/** Legacy type; categories are now free text (TickTick project names). */
export type WorkCategory = 'work_project' | 'general_task' | 'meeting';

export const ticktickTokens = pgTable('ticktick_tokens', {
  userId: text('user_id').primaryKey().default('default'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'), // nullable: TickTick may not always return one
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const syncState = pgTable('sync_state', {
  userId: text('user_id').primaryKey().default('default'),
  lastModifiedTime: timestamp('last_modified_time', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const workSegments = pgTable(
  'work_segments',
  {
    id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
    ticktickTaskId: text('ticktick_task_id').notNull(),
    date: text('date').notNull(),
    projectId: text('project_id'),
    projectName: text('project_name'),
    tags: jsonb('tags').$type<string[]>().default([]),
    category: text('category').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique().on(t.ticktickTaskId, t.date)]
);

export const dailyTotals = pgTable('daily_totals', {
  date: text('date').primaryKey(),
  totalMinutes: integer('total_minutes').notNull().default(0),
  minutesByCategory: jsonb('minutes_by_category')
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  overtimeBalanceAfter: integer('overtime_balance_after').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const categoryMapping = pgTable('category_mapping', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  type: text('type').notNull(), // 'project' | 'tag'
  value: text('value').notNull(), // project id/name or tag name
  category: text('category').$type<WorkCategory>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type InsertTicktickTokens = typeof ticktickTokens.$inferInsert;
export type SelectTicktickTokens = typeof ticktickTokens.$inferSelect;
export type InsertSyncState = typeof syncState.$inferInsert;
export type SelectSyncState = typeof syncState.$inferSelect;
export type InsertWorkSegments = typeof workSegments.$inferInsert;
export type SelectWorkSegments = typeof workSegments.$inferSelect;
export type InsertDailyTotals = typeof dailyTotals.$inferInsert;
export type SelectDailyTotals = typeof dailyTotals.$inferSelect;
export type InsertCategoryMapping = typeof categoryMapping.$inferInsert;
export type SelectCategoryMapping = typeof categoryMapping.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;
export type SelectAppConfig = typeof appConfig.$inferSelect;
