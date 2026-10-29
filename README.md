# Everyday: day planner and to-do list

A companion app for planning and tracking your day. It runs in the browser on Linux, Windows and Android,
installs like a normal app, works offline, and keeps your data as JSON files in **your own private GitHub repository**,
the same way Ricette does.

Version 3: **to-do list, day planner and sync, smart planning, meals and a recipe browser from Ricette,
and two-way Google Calendar sync**. Time tracking and workouts come next and slot into the same structure.
The smart features are plain rules that run on the device: no AI and no paid services.

## What it does

- **Tasks:** quick add with shortcuts: `Write report 1h30 !1 #work` sets length, priority (`!1` high to `!3` low) and category.
  Due dates, notes, and repeats (daily, weekdays, weekly, monthly). Grouped into overdue, today, upcoming and anytime.
- **Day planner:** a timeline for each day.
  - Tap a task in *To plan* and it goes into the next free slot, or drag it to a specific time.
  - Drag blocks to move them, drag their bottom edge to resize. On a phone, press and hold a block first, then drag.
  - Tap an empty spot on the timeline to add a block at that time. Tap a block to edit, duplicate or delete it.
  - Ticking a block that came from a task completes the task. A repeating task moves on to its next date.
  - Overlapping blocks sit side by side. A red line shows the current time.
- **Day templates:** save a day as a template, or write one as text (`07:00-07:30 Morning run #health`).
  Apply it to any day, or have it fill chosen weekdays automatically. Anything you delete from an
  auto-filled day stays deleted on every device.
- **Suggest a plan:** looks at your open tasks (due date, priority, length, how long they've been waiting,
  preferred time of day) and the free gaps in the day, and proposes a layout. You see it on the timeline first,
  with the reason for each pick, untick what you don't want and add the rest. It leaves a small gap between blocks
  and stops at the daily limit you set (Settings → Planner), so the day isn't crammed.
- **I have time:** tells you how long you have until the next block and suggests what fits: single tasks, a
  combination of short ones, or a longer task to make a start on. One tap plans it from now.
- **Preparations:** a task can have things that must happen first (e.g. Gym → *Pack gym bag*, right before or the
  evening before). They're planned automatically whenever the task goes on the timeline, follow it when you move it,
  and stay deleted if you delete them.
- **Checklists:** a task (or a preparation) can have a checklist, e.g. *shoes, T-shirt, towel*. It can't be marked
  done until every item is ticked. Each time a repeating task comes round, its checklist starts fresh.
- **Conflicts:** overlapping blocks, a preparation or grocery trip planned after the thing it's for, or a task planned
  after its due date get a ⚠ and a warning. **Fix** moves the less important block to the next free gap;
  **It's fine** marks an overlap as intended. A block can also be set to "can overlap" (e.g. a podcast on the commute).
- **Meals (with Ricette):** add a meal from your recipes. Everyday checks the pantry, counting what's already on the
  shopping list and what earlier planned meals will use up, and lists what's missing. One tap puts it on Ricette's
  shopping list and plans a grocery trip before the meal, or reuses one already planned. In the grocery block you tick
  items off and the pantry restocks, exactly as in Ricette. Marking the meal done uses the ingredients up.
  Meals that came from a template show a reminder to check them.
- **Recipes tab:** browse Ricette's recipes with photos, by folder (subfolders included) and tag, search by title,
  tag or ingredient, filter to "can cook now" (everything in the pantry) or by time, and sort by name, speed or
  newest. A recipe shows what's in the pantry and what to buy for the number of people you choose. **+ Meal** opens
  the same browser to pick from.
- **Google Calendar (both ways):** your calendars appear in the planner as busy time (and the planner plans around
  them). Your plan appears in Google Calendar on a calendar called *Everyday*, with Google's reminders. Moving,
  renaming or deleting an Everyday event in Google Calendar changes the plan too. See the setup below.
- **Categories:** colors for tasks and blocks (Work, Personal, Health, Meals, Home built in; add your own).
- **Languages:** English, Italiano, Deutsch.
- **Offline:** everything works without a connection and syncs when you're back online.

## How it fits together

| Folder | GitHub repo | Visibility | What it holds |
|---|---|---|---|
| `app/` | `everyday` | public (needed for free GitHub Pages) | the app itself, with no personal data |
| `data-repo/` | `everyday-data` | **private** | your tasks, blocks, templates, categories |

The pantry and shopping list stay in Ricette's repo: Everyday reads and writes the same files Ricette does,
with the same merge rules, so both apps can be open at once. The shopping and pantry rules live in
`app/js/kitchen.js` (with `parse.js` copied from Ricette), written so Ricette can use the same file later.

Planned blocks are stored one file per month (`data/blocks/2026-10.json`), so each sync stays small no matter how
long you use the app. Each device keeps last month, this month, next month and any month you open in sync.
When two devices change the same thing, the most recent change wins, record by record.

## Setup (about 10 minutes, once)

1. **Data repo:** on GitHub create a new **private** repository named `everyday-data` and upload the contents of
   `data-repo/` (the `data` folder and the README).
2. **App repo:** create a **public** repository named `everyday`, upload the contents of `app/`, then go to
   **Settings → Pages → Deploy from a branch → `main` / root**. After a minute the app is live at
   `https://<your-username>.github.io/everyday/`.
3. **Token:** GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
   - Repository access: *Only select repositories* → `everyday-data` **and** `ricette-data`
     (the second one isn't used yet, but the meal-planning step will need it, and this saves making a new token later).
   - Permissions → Repository → **Contents: Read and write**
4. **Each device:** open the app → **Settings → Sync with GitHub** → your GitHub user, `everyday-data` and the token → **Save and test**.
   Then, under **Ricette**, check the repository name (`ricette-data`) and press **Connect**.
5. **Install it like an app:**
   - Android (Chrome): ⋮ → *Install app*
   - Linux / Windows (Chrome or Edge): the install icon in the address bar

## Google Calendar (optional, about 15 minutes, once)

The sync runs as a GitHub Action in your `everyday-data` repository: every hour, and right after you change
your plan in the app. Your Google credentials are stored only as secrets in that repository, never on your devices.

1. **Google Cloud project:** go to [console.cloud.google.com](https://console.cloud.google.com), create a project
   (e.g. "Everyday"), then **APIs & Services → Library → Google Calendar API → Enable**.
2. **Consent screen:** **APIs & Services → OAuth consent screen** (Google Auth Platform): user type **External**,
   app name "Everyday", your email as support and developer contact. Under **Audience** press **Publish app**
   ("In production"). It stays unverified, which is fine for your own use. Google shows a warning when you sign in
   ("Google hasn't verified this app": **Advanced → Go to Everyday**). Publishing matters: while an app is in
   "Testing", Google stops its access after 7 days.
3. **OAuth client:** **Credentials (Clients) → Create client → Web application**. Under *Authorized redirect URIs* add
   `https://developers.google.com/oauthplayground`. Copy the **Client ID** and **Client secret**.
4. **Refresh token:** open [developers.google.com/oauthplayground](https://developers.google.com/oauthplayground).
   Click the ⚙ (top right), tick **Use your own OAuth credentials** and paste the client ID and secret. In the box
   *Input your own scopes* enter `https://www.googleapis.com/auth/calendar`, press **Authorize APIs**, sign in and
   allow. Then press **Exchange authorization code for tokens** and copy the **Refresh token**.
5. **Secrets:** in the `everyday-data` repo on GitHub, **Settings → Secrets and variables → Actions → New repository
   secret**, three times: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`.
6. **Workflow files:** upload the `scripts` and `.github` folders from `data-repo/` into `everyday-data`
   (if the upload skips `.github`, create `.github/workflows/google-calendar.yml` by hand and paste its contents).
7. **Instant syncs (recommended):** edit your fine-grained GitHub token and add **Actions: Read and write** for
   `everyday-data`. Then the app can start a sync right after you change the plan, and from **Settings → Google
   Calendar → Sync with Google now**. Without it, syncing still happens every hour.
8. Run it once: in `everyday-data`, **Actions → Google Calendar sync → Run workflow**. A minute later the app's
   Settings show which calendars were imported, and your plan shows up on the *Everyday* calendar.

What gets synced:
- **Imported:** every calendar ticked (visible) in Google Calendar, last month to two months ahead. Events marked
  "free" and invitations you declined don't count as busy. All-day events show in a strip above the timeline.
  To stop importing a calendar, untick it in Google Calendar.
- **Exported:** every block in the same months, done ones with a ✓. Set the *Everyday* calendar's default
  notifications in Google Calendar to get reminders for everything you plan.
- **Changed in Google:** moving, resizing, renaming or deleting an *Everyday* event changes the block. If the block
  was also changed in the app since the last sync, the app's version wins.
- **Cost:** hourly runs use about 720 of the 2,000 free GitHub Actions minutes a month for private repositories,
  and instant syncs (at most one every 10 minutes) add a few more.

## Good to know

- Updating the app: replace the files in `everyday` with the new ones (this version adds `recipes.js`). Installed copies pick up the update because `VERSION` in `app/sw.js` is already bumped in this zip;
  bump it yourself whenever you change files later.
- Backups: the data repo keeps the full history of every change. Settings also has a one-click JSON download.
- Once GitHub sync works, Settings shows a summary instead of the form; the token is never shown again.
  **Change** lets you edit the connection, and leaving the token empty keeps the saved one.
- Day hours (when the timeline starts and ends) and the snap interval are in Settings → Planner, per device.

## Tests

From the `tests` folder:
- `node --test unit.test.mjs smart.test.mjs`: planning logic, smart rules, pantry maths and sync against a fake GitHub
- `node e2e.mjs`: two browsers (a laptop and a phone) planning and syncing through a fake GitHub
- `node e2e-smart.mjs`: suggestions, free time, preparations and checklists, conflicts, the recipe browser and meals against a fake Ricette repo
- `node e2e-calendar.mjs`: the locked connection settings, and Google Calendar events in the planner
- `node --test gcal.test.mjs`: the Google Calendar sync script against a fake Google Calendar API

The `e2e` files need Playwright.
