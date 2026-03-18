# 🏆 Squad League — Shooting Blanks S2

A multi-sport competition tracker for a group of friends. Tracks Pool, Bowling, and Golf with a full points engine including upset bonuses, underdog multipliers, anti-farm rules, and a King of the Week system.

**Live site:** `https://YOUR_USERNAME.github.io/squad-league`

---

## Stack

- **Frontend:** Vanilla HTML, CSS, JavaScript — no framework needed
- **Database:** [Supabase](https://supabase.com) (free Postgres)
- **Hosting:** GitHub Pages (free)

---

## Setup Guide

Follow these steps exactly, in order.

---

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign up (free)
2. Click **New Project**
3. Give it a name (e.g. `squad-league`), set a database password, choose a region
4. Wait ~2 minutes for it to provision

---

### Step 2 — Run the database setup SQL

1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open `supabase_setup.sql` from this repo
4. Paste the entire contents into the editor
5. Click **Run** (or press Cmd/Ctrl+Enter)
6. You should see "Success. No rows returned"

This creates all tables, sets up security policies, seeds your 6 players, and creates Season 2.

---

### Step 3 — Get your Supabase credentials

1. In Supabase, go to **Settings → API**
2. Copy:
   - **Project URL** (looks like `https://abcdefgh.supabase.co`)
   - **anon public** key (long string under "Project API keys")

---

### Step 4 — Add credentials to the project

Open `js/config.js` and replace the two placeholder values:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT_ID.supabase.co';  // ← paste here
const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';                  // ← paste here
```

---

### Step 5 — Create a GitHub repo and push

```bash
# 1. Create a new repo on github.com called "squad-league" (public)

# 2. In your terminal, navigate to the squad-league folder
cd squad-league

# 3. Initialise git and push
git init
git add .
git commit -m "Initial commit — Squad League S2"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/squad-league.git
git push -u origin main
```

---

### Step 6 — Enable GitHub Pages

1. Go to your repo on GitHub
2. Click **Settings → Pages**
3. Under **Source**, select **Deploy from a branch**
4. Branch: `main`, folder: `/ (root)`
5. Click **Save**
6. Wait ~60 seconds, then visit `https://YOUR_USERNAME.github.io/squad-league`

---

### Step 7 — Add player photos (optional)

1. Host your photos anywhere publicly accessible (e.g. upload to [imgur.com](https://imgur.com) or your own GitHub repo)
2. In Supabase, go to **Table Editor → players**
3. Click on each player row and paste their photo URL into the `photo_url` column

---

### Step 8 — Share with friends

Send everyone the link: `https://YOUR_USERNAME.github.io/squad-league`

To submit a match, tap **+ Submit Match** in the nav.

---

## Weekly Reset (manual)

Every Monday, you need to manually reset the weekly points and update the King of the Week.

Run this in the **Supabase SQL Editor**:

```sql
-- 1. Find this week's king (highest week scorer)
-- Check the dashboard and note the leader

-- 2. Update config manually
update config set value = 'PlayerName' where key = 'current_king';
update config set value = 'PlayerName' where key = 'current_underdog';
update config set value = (select value::int + 1 from config where key = 'current_week')::text where key = 'current_week';

-- 3. Every 4 weeks, update monthly king
update config set value = 'PlayerName' where key = 'monthly_king';
```

Or — add a scheduled Supabase Edge Function to automate this (see the Supabase docs on Edge Functions + cron).

---

## Scoring Rules Summary

| Situation | Points |
|---|---|
| Win a Pool match | +3 |
| Bowling/Golf 1st place | +5 |
| Bowling/Golf 2nd place | +2 |
| Beat the King of the Week | +3 bonus |
| Underdog (last place) multiplier | ×1.5 all week |
| Upset bonus (per rank gap) | ×(1 + 0.2 × gap) |
| 3rd+ win vs same opponent same week | 1 pt only |

---

## File Structure

```
squad-league/
├── index.html            Dashboard
├── submit.html           Match submission form
├── history.html          Full match log with filters
├── rules.html            Scoring rules explainer
├── css/
│   └── style.css         All styles
├── js/
│   ├── config.js         Supabase credentials + helpers
│   ├── db.js             All database queries
│   └── engine.js         Scoring logic (points calculation)
├── supabase_setup.sql    Run once in Supabase SQL editor
└── README.md
```

---

## Making Changes

After editing any file locally:

```bash
git add .
git commit -m "describe your change"
git push
```

GitHub Pages auto-deploys within ~30 seconds.
