# Kettlebell Progression Trainer

Single-user PWA that runs a fixed 12-week kettlebell program, drives work/rest
timing during a session, and logs what actually got done. Offline-capable,
installable to an iPhone home screen.

## Run locally

```
python3 serve.py
```

Then open http://localhost:8123. (`python3 -m http.server` also works if run
from this folder in a terminal with Desktop access.)

## Install on iPhone

Service workers require HTTPS (or localhost), so to install on a phone the app
needs real hosting — GitHub Pages works fine (same pattern as the Duet apps).
Open the URL in Safari → Share → **Add to Home Screen**. Audio cues unlock on
the first tap of the Start button.

## Layout

- `program.json` — the 12-week program, static read-only asset. All rendering
  is data-driven; no week-specific code.
- `js/timer.js` — pure timer state machine. No DOM, no `Date.now()`; every
  function takes an explicit timestamp and all timing derives from anchor
  timestamps (never interval ticks), so backgrounding/killing the app can't
  drift the clock.
- `js/storage.js` — all persistence (localStorage in v1). Swap this module for
  a Firebase adapter later without touching UI code.
- `js/app.js` — screens (Today / Session / Wrap-up / History / Settings),
  cues, wake lock, progression logic.
- `js/timer.test.mjs` — engine unit tests with fake timestamps. Run with
  `node --test js/` (Node is not installed on this machine yet; the same
  assertions were verified in-browser).
- `sw.js`, `manifest.webmanifest`, `icons/` — PWA shell. Bump the `CACHE`
  name in `sw.js` when shipping changes.

## Key behaviors

- **Timers** anchor to `Date.now()` at start; every frame re-derives the
  current round/set and remaining time, and `visibilitychange` re-requests the
  wake lock. Returning after minutes away lands on the correct round.
- **Sessions in progress** are persisted on every state change and restored on
  launch, timing intact.
- **Week advancement is never silent.** When all days of a week are logged and
  any session flagged the back or form toggle, the app prompts with *repeat*
  as the recommended default. The prompt re-appears on relaunch if the app was
  killed before choosing.
- Logged reps default to the prescription; +/- adjusts only exceptions.
