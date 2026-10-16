# Hypertrophy

A five-lift training log for a phone. Barbell plus dips and pull-ups, double
progression, a weekly hard-set count, and a rest timer. It is a static web app
you add to the iPhone home screen; everything lives on the phone.

## The plan it ships with

Two sessions that alternate. The app tracks which comes next; it does not care
which weekday it is.

| Day A | Day B |
|---|---|
| Zercher squat 3 × 5–8 | Deadlift 3 × 5–8 |
| Dips 3 × up to 6 (superset) | Dips 3 × up to 6 (superset) |
| Pull-ups 3 × up to 6 (superset) | Pull-ups 3 × up to 6 (superset) |
| Barbell row 3 × 6–10 | Barbell row 3 × 6–10 |

Everything is editable on the Plan tab: sets, rep floor and ceiling, order,
supersets, days. The library also holds optional extras (chin-ups, ring face
pull, plate lateral raise, Romanian deadlift, overhead press, ring push-up).

## How it decides the next load

Each lift has a rep floor and ceiling.

- Every working set reached the ceiling → add one jump next time
  (default 5 lb upper body, 10 lb lower body). For dips and pull-ups that means
  "add weight once every set hits 6".
- A set fell under the floor at 0–1 reps in reserve → hold the weight.
- Under the floor two sessions running → drop one jump.
- Otherwise → same weight, aim for one more rep per set.

The Volume tab counts hard sets (3 or fewer reps in reserve) per muscle over a
rolling 7 days against a 10–20 band. Indirect work counts half. A deload week
(half the sets, stop around 4 RIR) is suggested every 5 training weeks or when
two lifts slip two sessions running; you confirm it.

Rep ranges from about 5 to 30 all build muscle near failure, and 10–20 sets a
week is a landmark from the literature, not a law. Reps in reserve is a guess
that gets more honest with practice.

## Put it on your iPhone

1. Push this folder to a GitHub repository, for example `hypertrophy`.
2. In the repository: Settings → Pages → Source "Deploy from a branch",
   branch `main`, folder `/ (root)`. Wait a minute.
3. Open `https://<your-user>.github.io/hypertrophy/` in Safari on the phone.
4. Share → Add to Home Screen. Open it from the icon, not from Safari.

The home-screen app works offline after the first load. Data is in the phone's
IndexedDB and is not synced anywhere; use Settings → Export JSON now and then.
A JSON export restores the whole app with Import.

## Run locally

```bash
python3 -m http.server 8788
```

Then open http://localhost:8788/. Engine tests:

```bash
node --test test/engine.test.mjs
```

## Releasing a change

Bump `VERSION` in `sw.js`. Installed phones pick up the new version on the
next open with a network connection and reload once.

## Files

- `index.html`, `styles.css`: shell and styling.
- `js/data.js`: exercise library, default plan, default settings.
- `js/engine.js`: pure progression, volume, deload and trend logic (tested).
- `js/db.js`: IndexedDB wrapper.
- `js/app.js`: rendering and events.
- `sw.js`, `manifest.webmanifest`, `icons/`: PWA bits. `tools/make_icons.py` regenerates the icons.

## Known limits

- iPhone pauses web timers in the background, so the rest timer only beeps
  while the app is on screen. The countdown catches up when you return.
- The silent switch mutes the beep.
- Dip and pull-up trends estimate a 1RM that includes bodyweight; set your
  bodyweight in Settings or it assumes 170 lb.
- Changing units does not convert numbers already logged.
