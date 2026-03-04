# Time Tracker

Track daily hours from completed TickTick tasks (with start/end times), by category (Work project, General tasks, Meetings), and overtime (over 8h per work day accumulates; under 8h or no work consumes it).

## Stack

- Next.js 15 (App Router), TypeScript, Tailwind CSS
- Vercel Postgres + Drizzle ORM
- TickTick Open API (OAuth 2.0, tasks, projects)

## Setup

1. **Install and env**
   - `npm install`
   - **Local development:** Environment variables in Vercel only apply to deployed builds. To run locally you need a `.env.local` file:
     - **Option A (recommended):** Install [Vercel CLI](https://vercel.com/docs/cli), run `vercel link` in this repo, then `vercel env pull .env.local` to download your Vercel env vars into `.env.local`.
     - **Option B:** Copy `.env.example` to `.env.local` and paste in values (e.g. from Vercel → Project → Settings → Environment Variables).
   - Do not commit `.env.local` (it is gitignored).

2. **Database**
   - Create a Vercel Postgres (or any Postgres) database and set `POSTGRES_URL` or `DATABASE_URL`.
   - Run `npm run db:push` to create tables (or use `npm run db:generate` then your migration runner).

3. **TickTick**
   - Create an app in the [TickTick developer portal](https://developer.ticktick.com/) and get Client ID and Client Secret.
   - Set redirect URI to `https://your-domain.com/api/auth/ticktick/callback` (or `http://localhost:3000/api/auth/ticktick/callback` for local).
   - In `.env.local`: `TICKTICK_CLIENT_ID`, `TICKTICK_CLIENT_SECRET`, `TICKTICK_REDIRECT_URI`.
   - Optional: register a webhook (e.g. `POST https://your-app.vercel.app/api/webhooks/ticktick`) and set `TICKTICK_WEBHOOK_SECRET`.

4. **Run**
   - `npm run dev` for local development.
   - Open Settings, connect TickTick, set category mapping and work days, then use Dashboard and “Sync now” to pull completed tasks.

## Env vars (see `.env.example`)

- `TICKTICK_CLIENT_ID`, `TICKTICK_CLIENT_SECRET`, `TICKTICK_REDIRECT_URI` – TickTick OAuth
- `TICKTICK_WEBHOOK_SECRET` – webhook HMAC verification (optional)
- `DATABASE_URL` or `POSTGRES_URL` – Postgres connection string

Set these in the Vercel project dashboard for production.

---

## GitHub and Vercel setup

### 1. First commit and push to GitHub

In a terminal (from the project root), run:

```bash
git init
git add .
git commit -m "feat: initial time tracker with TickTick sync and overtime"
```

Create a new repository on GitHub (do **not** initialize with README if you already have one). Then:

```bash
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git branch -M main
git push -u origin main
```

Replace `YOUR_USERNAME` and `YOUR_REPO` with your GitHub username and repository name.

### 2. Connect to Vercel

1. Go to [vercel.com](https://vercel.com) and sign in (use **Continue with GitHub** if you want).
2. Click **Add New…** → **Project**.
3. **Import** your GitHub repository (select the time-tracker repo).
4. Vercel will detect Next.js. Leave **Build and Output Settings** as default.
5. Before deploying, open **Environment Variables** and add each variable from `.env.example`:
   - `TICKTICK_CLIENT_ID`
   - `TICKTICK_CLIENT_SECRET`
   - `TICKTICK_REDIRECT_URI` → use your production URL, e.g. `https://your-app.vercel.app/api/auth/ticktick/callback`
   - `POSTGRES_URL` or `DATABASE_URL` (e.g. from Vercel Postgres: create a store in the Vercel dashboard and copy the connection string)
   - Optionally: `TICKTICK_WEBHOOK_SECRET`
6. Click **Deploy**. The first deployment will run from the push you made to `main`.

### 3. After first deploy

- In the TickTick developer portal, add your production redirect URI:  
  `https://<your-vercel-app>.vercel.app/api/auth/ticktick/callback`
- If you use Vercel Postgres: create the database, copy `POSTGRES_URL` into the project’s Environment Variables, then run **Redeploy** (or run `npm run db:push` locally with that URL to create tables).
- Open your Vercel app URL and confirm the home page, Dashboard, and Settings load. Connect TickTick in Settings and use **Sync now** on the Dashboard to verify the pipeline.
