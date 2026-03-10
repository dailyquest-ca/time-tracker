# Time Tracker

Track daily work hours from a single **Google Calendar** (your Work calendar). Time updates on **any change** to that calendar via push notifications. Events are categorized by title: a leading **capitalized acronym** (e.g. PIS, ELAN) becomes the category when it matches a user-defined category; otherwise events fall into broad categories (Learning, 1:1s, General tasks/meetings). You can add and archive categories; archived categories still apply to past dates but are not used for new events.

## Stack

- Next.js 15 (App Router), TypeScript, Tailwind CSS
- Vercel Postgres + Drizzle ORM
- Google Calendar API (OAuth 2.0, events, push watch)

## Setup

1. **Install and env**
   - `npm install`
   - Copy `.env.example` to `.env.local` and fill in values (or use Vercel CLI: `vercel env pull .env.local`).
   - Do not commit `.env.local` (it is gitignored).

2. **Database**
   - Create a Postgres database and set `DATABASE_URL`.
   - Run the migration: apply `drizzle/0001_google_calendar.sql` to your database (or use `npm run db:push` if your schema is in sync).

3. **Google Calendar**
   - In [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials, create an OAuth 2.0 Client ID (Web application).
   - Add authorized redirect URI: `https://your-domain.com/api/auth/google/callback` (and `http://localhost:3000/api/auth/google/callback` for local).
   - Enable the Google Calendar API for the project.
   - In `.env.local`: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.

4. **Run**
   - `npm run dev` for local development.
   - Open **Settings**, connect Google, choose your **Work calendar**, then go to the Dashboard and click **Sync**. Time tracking updates when that calendar changes (push notifications); you can also run Sync manually or via cron.

## Env vars (see `.env.example`)

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` – Google OAuth (Calendar read-only)
- `APP_URL` – Public app URL for calendar push notifications (e.g. `https://your-app.vercel.app`). On Vercel, `VERCEL_URL` is set automatically.
- `CRON_SECRET` – Optional; set in Vercel and use as `Authorization: Bearer <CRON_SECRET>` for the cron job that renews the calendar watch and runs sync.
- `DATABASE_URL` – Postgres connection string.

## Real-time updates

- When you sync or select your work calendar, the app creates a **watch** on that calendar. Google sends a POST to `/api/webhooks/google-calendar` when events change; the app then syncs and recomputes daily totals.
- Watches expire after about 7 days. A daily cron job (`/api/cron/sync`) renews the watch and runs a sync. Configure the cron in `vercel.json` and set `CRON_SECRET` in the Vercel dashboard.

## GitHub and Vercel

1. Push the repo to GitHub.
2. In Vercel, import the repo and add environment variables from `.env.example`.
3. Set `APP_URL` to your Vercel app URL (e.g. `https://your-app.vercel.app`).
4. After deploy, run the DB migration if needed, then open the app, go to Settings, connect Google, choose your work calendar, and use Sync on the Dashboard.
