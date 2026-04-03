# Workout Tracker

A local, single-user workout tracking app built around a 4-day push/pull split. Tracks sets, reps, and weight with progressive overload suggestions using the double progression model.

## Quick Start

```bash
npm install
npm run seed    # Create database and populate with your 4-day routine + historical data
npm start       # Start server on http://localhost:3000
```

## Features

- **Dashboard**: View today's workout with input fields for each exercise. Log sets/reps/weight per exercise.
- **Progressive Overload**: After logging, get automatic weight suggestions:
  - All sets at top of rep range → increase weight (+5 lbs compound, +2.5 lbs isolation)
  - Some sets at top → hold weight
  - Any set below bottom of range → consider dropping 5%
- **Progress Charts**: Line charts showing weight and average reps over time per exercise.
- **Manage**: Add new exercises to any day, or create entirely new workout days — no code changes needed.

## Adding Exercises via the UI

1. Click **Manage** in the nav bar
2. Under "Add Exercise to Existing Day", select the day, fill in the exercise details, and submit
3. The exercise will appear on that day's dashboard immediately

## Adding a New Workout Day via the UI

1. Click **Manage** in the nav bar
2. Under "Add New Workout Day", enter a name (e.g. "Day 5 — Arms")
3. Add exercises using the "+ Add Exercise" button
4. Submit to create the day. It will appear as a new tab on the dashboard.

## Resetting / Reseeding the Database

```bash
rm workout.db          # Delete existing database
npm run seed           # Recreate with fresh seed data
```

The seed script is idempotent — running it on an existing database with data will skip the insert.

## Database

- SQLite file: `workout.db` in the project root
- **Not committed to git** (listed in `.gitignore`)
- To back up: simply copy the `workout.db` file to a safe location
- Schema: `workout_days`, `exercises`, `sessions` tables with foreign key constraints

## Running Tests

```bash
npm test
```

Uses Node.js built-in test runner. Tests cover API endpoints, input validation, duplicate rejection, and progressive overload suggestion logic.

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite via better-sqlite3
- **Frontend**: Plain HTML/CSS/JS + Chart.js (CDN)
- **No auth** — designed for local single-user use
