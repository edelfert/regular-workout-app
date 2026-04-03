# Workout Tracker

A static, single-user workout tracking app built around a 4-day push/pull split. Runs entirely in the browser with data stored in localStorage. Deployable on GitHub Pages — no server required.

## Live Demo

Enable GitHub Pages (Settings > Pages > Source: Deploy from branch `main`, root `/`) and visit:

```
https://<your-username>.github.io/regular-workout-app/
```

Or open `index.html` directly in a browser for local use.

## Features

- **Dashboard**: View today's workout with input fields for each exercise. Log sets/reps/weight per exercise.
- **Progressive Overload**: After logging, get automatic weight suggestions:
  - All sets at top of rep range → increase weight (+5 lbs compound, +2.5 lbs isolation)
  - Some sets at top → hold weight
  - Any set below bottom of range → consider dropping 5%
- **Progress Charts**: Line charts showing weight and average reps over time per exercise (Chart.js).
- **Manage**: Add new exercises to any day, or create entirely new workout days — no code changes needed.
- **Reset**: One-click database reset back to the default 4-day routine.

## Adding Exercises via the UI

1. Click **Manage** in the nav bar
2. Under "Add Exercise to Existing Day", select the day, fill in the exercise details, and submit
3. The exercise will appear on that day's dashboard immediately

## Adding a New Workout Day via the UI

1. Click **Manage** in the nav bar
2. Under "Add New Workout Day", enter a name (e.g. "Day 5 — Arms")
3. Add exercises using the "+ Add Exercise" button
4. Submit to create the day. It will appear as a new tab on the dashboard.

## Resetting the Database

1. Click **Manage** in the nav bar
2. Scroll to "Reset Database" and click **Reset All Data**
3. This clears all data from localStorage and re-seeds the default 4-day routine with the historical 2025-03-30 session

You can also clear data manually via browser DevTools: `localStorage.removeItem('workout_tracker_db')`

## Data Storage

- All data lives in `localStorage` under the key `workout_tracker_db`
- To back up: copy the value from DevTools (`localStorage.getItem('workout_tracker_db')`) and save it as a JSON file
- To restore: paste it back with `localStorage.setItem('workout_tracker_db', '<json>')`
- Data persists across browser sessions but is per-browser/per-device

## Running Tests

```bash
npm test
```

Uses Node.js built-in test runner with a localStorage shim. Tests cover the data layer, session logging, duplicate rejection, progressive overload logic, and manage operations.

## Tech Stack

- **Frontend**: Plain HTML/CSS/JS
- **Charts**: Chart.js (CDN)
- **Storage**: localStorage (no server, no database)
- **Hosting**: GitHub Pages (or any static file server)
