# everyday-data (private)

Your data for the Everyday app. The app edits these files through the GitHub API; you normally never touch them.

| File | What's in it |
|---|---|
| `data/tasks.json` | to-do list |
| `data/templates.json` | day templates |
| `data/categories.json` | categories and their colors |
| `data/blocks/YYYY-MM.json` | planned time blocks, one file per month |
| `data/events/YYYY-MM.json` | events copied from Google Calendar (written by the Google Calendar sync) |
| `data/gcal.json`, `data/gcal-state.json` | status and bookkeeping of the Google Calendar sync |
| `scripts/gcal-sync.mjs`, `.github/workflows/google-calendar.yml` | the Google Calendar sync (optional, see the app's README) |

Every change is a commit, so the history doubles as a backup.
See the README in the app repository for setup.
