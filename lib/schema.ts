import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

const USER_ID = 'default';

/** Google OAuth tokens (single user). */
export const googleTokens = pgTable('google_tokens', {
  userId: text('user_id').primaryKey().default(USER_ID),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Calendar watch state for push notifications (renew before expiration). */
export const calendarWatch = pgTable('calendar_watch', {
  userId: text('user_id').primaryKey().default(USER_ID),
  calendarId: text('calendar_id').notNull(),
  channelId: text('channel_id').notNull(),
  resourceId: text('resource_id').notNull(),
  expiration: timestamp('expiration', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** User-defined categories; archived = still valid for past dates, not for new events. */
export const categories = pgTable('categories', {
  id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
  name: text('name').notNull().unique(),
  archived: integer('archived').notNull().default(0), // 0 = active, 1 = archived
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Work segments: one row per calendar event occurrence. Unique by (calendarId, externalId, date) to avoid double counting. */
export const workSegments = pgTable(
  'work_segments',
  {
    id: integer('id').generatedByDefaultAsIdentity().primaryKey(),
    calendarId: text('calendar_id').notNull(),
    externalId: text('external_id').notNull(),
    date: text('date').notNull(),
    title: text('title'),
    category: text('category').notNull(),
    durationMinutes: integer('duration_minutes').notNull(),
    startAt: timestamp('start_at', { withTimezone: true }),
    endAt: timestamp('end_at', { withTimezone: true }),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.calendarId, t.externalId, t.date)]
);

/** Daily aggregated totals (recomputed after sync). */
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

/** App config key-value (e.g. work_calendar_id). */
export const appConfig = pgTable('app_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type InsertGoogleTokens = typeof googleTokens.$inferInsert;
export type SelectGoogleTokens = typeof googleTokens.$inferSelect;
export type InsertCalendarWatch = typeof calendarWatch.$inferInsert;
export type SelectCalendarWatch = typeof calendarWatch.$inferSelect;
export type InsertCategories = typeof categories.$inferInsert;
export type SelectCategories = typeof categories.$inferSelect;
export type InsertWorkSegments = typeof workSegments.$inferInsert;
export type SelectWorkSegments = typeof workSegments.$inferSelect;
export type InsertDailyTotals = typeof dailyTotals.$inferInsert;
export type SelectDailyTotals = typeof dailyTotals.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;
export type SelectAppConfig = typeof appConfig.$inferSelect;
