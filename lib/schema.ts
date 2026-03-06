import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
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

/** Canonical category definitions. Events reference categories by id. */
export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: text('name').notNull().unique(),
  kind: text('kind').notNull().default('manual'),
  archived: boolean('archived').notNull().default(false),
  displayOrder: integer('display_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** Canonical fact table for all tracked time. One row per time entry. */
export const events = pgTable(
  'events',
  {
    id: serial('id').primaryKey(),
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    lengthHours: numeric('length_hours', { precision: 6, scale: 2 })
      .notNull(),
    sourceType: text('source_type').notNull().default('manual'),
    sourceId: text('source_id').notNull(),
    sourceGroup: text('source_group'),
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    rawTitle: text('raw_title'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique().on(t.sourceType, t.sourceId)]
);

/** Overtime notes per day. One row per date, user-editable. */
export const dailyOvertimeNotes = pgTable('daily_overtime_notes', {
  date: date('date', { mode: 'string' }).primaryKey(),
  note: text('note'),
  noteSource: text('note_source'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** App config key-value store (e.g. work_calendar_id, overtime settings). */
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
export type InsertEvents = typeof events.$inferInsert;
export type SelectEvents = typeof events.$inferSelect;
export type InsertDailyOvertimeNotes = typeof dailyOvertimeNotes.$inferInsert;
export type SelectDailyOvertimeNotes = typeof dailyOvertimeNotes.$inferSelect;
export type InsertAppConfig = typeof appConfig.$inferInsert;
export type SelectAppConfig = typeof appConfig.$inferSelect;
