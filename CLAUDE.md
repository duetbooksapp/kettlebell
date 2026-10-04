# CLAUDE.md

## This repo

Kettlebell Trainer: an offline 12-week kettlebell program PWA. Run it locally with `python3 serve.py` (port 8123). Bump the cache version in `sw.js` when you change assets, or phones keep the old build. See `README.md`.

## Duet Suite map (same table in every repo)

Every app is one self-contained HTML file deployed to GitHub Pages from `main`
(push to main, wait ~60s). The one exception is weekly1-companion, which is on Vercel.
The shared Firebase Realtime DB is `https://duet-crm-default-rtdb.firebaseio.com/`.
Its rules are open, so treat everything in it and in every public repo as public.

| App | Repo | Live URL | Data |
|---|---|---|---|
| DuetCRM (+ Mobile `m.html`, DuetHome, SalesTracker demo) | smaxim-spec/duet | https://smaxim-spec.github.io/duet/ | Firebase root (`/leads`, `/backups`, `/calley_webhook_logs`, `/phone_inbox_leads`, `/weeklyReviews`); reads `/duetbooks/steve_maxim/cases.json` |
| DuetBooks (cases and commissions) | duetbooksapp/duetbooks | https://duetbooksapp.github.io/duetbooks/ | Firebase `/duetbooks/<agent>/…`; PATCHes CRM `/leads/data/<idx>/policyStatus`; Anthropic API (user key) |
| DuetCoach (sales roleplay) | duetbooksapp/duetcoach | https://duetbooksapp.github.io/duetcoach/ (app: `/app.html`) | Firebase `/duetcoach`; Anthropic + ElevenLabs (user keys) |
| DuetIncome (retirement comparisons) | duetbooksapp/duetincome | https://duetbooksapp.github.io/duetincome/ | Firebase `/duetincome`; localStorage `doi_*` |
| DuetMealPrep (Steve & Max) | duetbooksapp/mealprep | https://duetbooksapp.github.io/mealprep/ | Firebase `/duetmealprep/steve_maxim.json`; recipes live in the `RECIPES` array |
| DuetMealPrep (Amanda) | duetbooksapp/mealprep-amanda | https://duetbooksapp.github.io/mealprep-amanda/ | Firebase `/duetmealprep/amanda.json` |
| DuetPantry | duetbooksapp/duetpantry | https://duetbooksapp.github.io/duetpantry/ | Firebase `/duetpantry` |
| OZTracker (call activity and billing) | duetbooksapp/oztracker | https://duetbooksapp.github.io/oztracker/ | Firebase `/oztracker` |
| UGC Brand Outreach Tracker | duetbooksapp/ugc | https://duetbooksapp.github.io/ugc/ | localStorage `ugcTracker.v2`; Gmail OAuth; Worker `ugc-ideas.smaxim.workers.dev` |
| UGC feedback (issues only) | duetbooksapp/ugc-feedback | (none) | GitHub issues for the UGC tracker |
| DMAT Rewrite Calculator (term) | duetbooksapp/duet-rewrite-calc | https://duetbooksapp.github.io/duet-rewrite-calc/ | localStorage `dmat_rates_v1` |
| DuetAttorney CRM | duetbooksapp/duetattorney | https://duetbooksapp.github.io/duetattorney/ | localStorage only |
| Kettlebell Trainer (PWA) | duetbooksapp/kettlebell | https://duetbooksapp.github.io/kettlebell/ | localStorage; program in `program.json` |
| Weekly 1:1 Companion (Amanda) | duetbooksapp/weekly1-companion (private) | https://weekly1-companion.vercel.app | Supabase (`schema.sql`); `api/capture.js` calls Claude |

Other services: the Calley webhook runs as a Cloudflare Worker at `calley-webhook.smaxim.workers.dev`
and writes `/calley_webhook_logs`. The source isn't in any repo; it's on the laptop at `~/.duet-server/`.

Retired: `smaxim-spec/duetbooks` is archived and `duetbooksapp/duetbooks` is the live one.
The old DuetBooks, DuetCoach and DuetWithClaude copies were removed from smaxim-spec/duet.
Don't recreate copies of an app inside another app's repo. Each app lives only in its own repo.

Rules: never commit client or lead data (xls, csv, exports). The public repos and the open Firebase rules mean it would be exposed.
When you add or move an app, update this table in **every** repo.
