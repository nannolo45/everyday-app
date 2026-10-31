# Everyday: day planner and to-do list

A companion app for planning and tracking your day. It runs in the browser on Linux, Windows and Android,
installs like a normal app, works offline, and keeps your data as JSON files in **your own private GitHub repository**,
the same way Ricette does.

Version 5: **to-do list, planner (list, day, week and month views), smart planning, rules, meals with
recipes from Ricette, and two-way Google Calendar sync**. Time tracking and workouts come next and slot into the same structure.
The smart features are plain rules that run on the device: no AI and no paid services.

## What it does

- **Tasks tab:** **To do | Saved**. *To do* has two parts: **To plan** (grouped by due date) and **Planned** (tasks
  already on a day, grouped by that day), then Done. Parts and groups fold and stay folded. The date groups are set
  in Settings → *Task list*: Overdue, Later and No date are always there; Today, Tomorrow and Soon can be switched
  on or off, and "Soon" can mean the next 3, 5, 7, 14 or 30 days. The tray uses the same groups. *Saved* has saved tasks, day templates and preparations, the things you set up once.
- **Tasks:** quick add with shortcuts: `Write report 1h30 !1 #work` sets length, importance (`!1` very important to
  `!5` not important) and category.
- **Import:** Tasks → **⤓ Import**: paste a list (from a message, a note, an email), one task per line. Bullets,
  numbers and checkboxes are stripped and the same shortcuts work; you see the tasks before adding them (a line
  ending in ":" starts unticked, as it's usually a heading) and can give them all a due date and a category.
- **Search:** the search box in Tasks (🔍, both *To do* and *Saved*; the tray and the task picker have the same one)
  filters as you type; ✕ (or Esc) clears it. Every word must match,
  in any order, ignoring case and accents, in the title, notes, place, category, steps, checklist or rules
  ("cafe" finds "café"). While you search, folded groups open to show their matches.
- **Sorting:** Tasks → *Sort by*: smart, **my order**, due date, importance, shortest first, category, newest. With
  *My order* you drag ⠿ to put tasks in your own order, and *Suggest a plan* takes it as a preference (tasks higher
  up go earlier, but due dates still count). The tray has its own *Sort by*, separate from the list's.
- **Categories** are picked as coloured chips, so you see each one's colour.
- **Importance:** every task has an importance from 1 (very low) to 5 (very high), 3 being normal. It sorts the task
  list, shows at a glance (`!!!`, `!!`, `↓`), and weighs in *Suggest a plan* about as much as a close due date: a very
  important task goes before a normal one due tomorrow, and the least important wait when the day is full.
- **Task editor:** sections you can fold (length and importance, when, place, steps, checklist, rules, notes);
  what you fold stays folded. Lengths are a number plus a unit (min or h).
  - **When:** for a to-do, a day and a time put it on the plan. If it's already planned, changing them moves it
    and clearing the day takes it off.
  - **Place:** a place and an optional link (Maps, a booking…); without a link the place opens in Google Maps.
    It shows in the list and in the block.
  - **From the plan:** tap a block, then **Edit "…" (steps, rules)** to open its task. A plain block can become a
    task with **Add steps**.
- **Getting there:** a task with a place gets a **Get there** step before it (and, if you switch it on, **Come back**
  after it), with the travel time from the map. Set your **home** in Settings → Travel, and how you usually go
  (public transport, bike, on foot, car); each task can say otherwise. The trip starts from the place of the
  previous task that day (if that one doesn't come home), otherwise from home, or from where your phone is if you
  tap **Use my location** today. Settings → Travel → *"Get there" by default*: when a place is set (default),
  always (tasks without a place get a "? Get there" as a reminder to account for the trip), or off. Until a time is known the step shows as **? Get there** and counts 30 minutes; the
  time is looked up a moment later and the block moves so the task itself stays at its time. Times come from free
  services with no key (OpenStreetMap for addresses, OSRM for walking, cycling and driving, VBB for public transport
  in Berlin-Brandenburg); with your own Google Maps key (Routes API) they come from Google instead, everywhere. The
  reminder in Google Calendar fires before the block, so before you have to leave.
- **Readiness:** a ⚠ on a task (in the list, the tray and the tasks column) means the planner is missing something:
  the length is still the default 30 minutes, home isn't set, the place wasn't found on the map, the travel time
  isn't known yet, or the task is longer than a day's limit and not split into steps. Tap it to fix. *Suggest a
  plan* says how many tasks are missing details before it starts.
- **Times** are typed in 24-hour form (19:00; typing 1900 or 930 also works), whatever the phone's language.
  Setting a time switches "best time" to morning, afternoon or evening to match.
- **Recurring tasks:** *Repeats* → every day, weekdays, every week or every month, plus **every N** (every 2
  weeks…), the **weekdays** for weekly ones (Mon and Wed), and an optional **until** date. Give the task a day and
  a time and every occurrence in the coming eight weeks goes on the plan (marked ↻); more are added as time goes by.
  Changing an occurrence from its block asks **Only this one** or **This and all the following**; so does deleting
  one (a deleted occurrence stays deleted). Opening the task from an occurrence and changing anything (the rule, the
  steps, the title…) applies from that occurrence on: the old series ends the day before and a new one carries the
  changes, so earlier occurrences stay as they were. From the task list, changes apply to the whole series.
  Ticking an occurrence (or the task in the list) moves the task on to its next date.
- **Saved tasks** are ordinary tasks kept under *Saved* instead of the to-do list: same editor, same recurrence,
  same travel steps. Tick **Saved task** in the editor to move a to-do there, untick it to bring it back.
- **Filters** (Tasks tab, the tray and the tasks column share them): **⚠ To fix** (tasks the planner is still
  missing details for), **↻ Recurring**, **📍 With a place**, and one category. **≡ Compact** puts each task on one
  line with less air, handy on a phone with many tasks; both are remembered per device.
- **Repeat X times:** *Repeat → X times per…*, e.g. Gym 3× per week. The planner places the times still missing in
  each period, each one you tick counts (the list shows 1/3), and it starts over the next week.
- **Needs first:** *When → Needs these done first*, e.g. Meldebescheinigung needs SPID level 3. A wrong order on the
  plan gets a ⚠ with **Fix** (moves it after).
- **Only at these times:** *When → Only at these times*: days and hours (office hours, opening times), or a
  specific date and hours (*or on the day* 12 Nov, 9:00–11:00). The same goes for rule windows and shop hours.
- **Reminders:** *When → Reminder*: how long before a task Google Calendar notifies you (or none). The default for
  every task is in Settings → Google Calendar. Reminders come from Google Calendar, so you need the calendar sync.
- **Long tasks:** with Settings → Planner → *Longer units*, lengths can be days, weeks, months or years too
  (calendar time). A task with steps that's longer than a day's limit, or set to *Plan each step on its own*, is
  planned step by step (each step its own block, "Move house · Pack"); it's done when all its steps are.
- **Steps:** any task can be split into steps (Dinner → *Prep* 30m, *Eat* 20m, *Clean up* 10m). It lasts as long as
  its steps together. On the plan it stays one block you move as a whole; each step has its own time inside it and
  its own tick box. Tick steps one by one (the task is done when they all are) or tick the whole task. A step can be
  marked **Couldn't do it**, and each step can have rules of its own (in the editor they sit right under the step;
  rules for the whole task have their own section below). **▤ Hide steps / Show steps** on the plan switches
  between seeing every step (Day and List views) and just the main tasks with a count.
- **Steps before and after the time (⚓):** the task's time is when the ⚓ step starts. Mark *Workout* in
  *Go to the gym* (Get there 20m → Workout 1h → Get back 20m) and "19:00" means the workout starts at 19:00: the
  block runs 18:40–20:20, and the time fields say "Workout at". By default it's the first step (for meals, the step
  after the recipe-based prep).
- **Prep time from the recipes:** in a meal type, a step's length can be **⟲ from the recipes** (with a length to use
  when there's no recipe or no time). The meal's usual time is when the step after it starts (you eat at 19:30), so
  picking a longer recipe makes prep start earlier instead of pushing dinner later; the ingredient check and grocery
  trip move with it. Several recipes: the longest plus 10 minutes for each other one (cooked side by side). Waiting
  time in a recipe ("+ 4 ore di riposo") isn't counted as prep. The meal dialog shows each step's time and where
  its length comes from, and **✎** sets your own length for that one meal.
  Due dates, notes, and repeats (daily, weekdays, weekly, monthly). Grouped into overdue, today, upcoming and anytime.
- **Views:** switch the planner between **List** (the next seven days as an agenda), **Day**, **Week** and **Month**.
  Settings choose which view opens first and what each list row shows at a glance (time, length, category, due
  date, priority, checklist progress, what it prepares, recipes, place, notes). Tap a row in the list to expand it:
  checklist, recipes, notes, and buttons for Edit and "Couldn't do it". Tasks due that day but not planned yet appear
  in the list with a **Plan it** button. In the week view you can drag blocks to another day; tap a day in the month
  to open it.
- **Day planner:** a timeline for each day.
  - Tap a task in *To plan* and it goes into the next free slot, or drag it to a specific time.
  - Drag blocks to move them, drag their bottom edge to resize. On a phone, press and hold a block first, then drag.
  - Tap an empty spot on the timeline to add a block at that time. Tap a block to edit, duplicate or delete it.
  - Ticking a block that came from a task completes the task. A repeating task moves on to its next date.
  - Overlapping blocks sit side by side. A red line shows the current time.
- **Day templates:** save a day as a template, or write one as text (`07:00-07:30 Morning run #health`).
  Apply it to any day, or have it fill chosen weekdays automatically. Anything you delete from an
  auto-filled day stays deleted on every device.
- **Plan header:** the **Tasks** switch (left), the view (List, Day, Week, Month) in the middle, the **Steps**
  switch (right). Below the date, all the actions in one row: **✦ Suggest a plan** and **⇢ Assign** (planning
  what's still open), **⏱ I have time** (when today is on screen) and **＋ Add** for things you put on the plan by
  hand (a task, a saved task, a meal, a free block, a day template).
- **Tasks column:** in every view, the tasks still to plan sit in a column beside the plan (grouped like the task
  list), with a field to add one and a folded *Already planned*. In Day, tap a task to put it in the next free time
  or drag it onto the timeline; in Week, Month and List, drag it onto a day (or a time, in Week) or tap it to choose
  when. Hide it with the **Tasks** switch or ⟨; it stays as you left it on that device (hidden to start with on
  phones).
- **＋ Add → Task:** type a new task, or search and pick one of yours (grouped by when it's due, then saved tasks and
  steps), then choose the time.
- **Suggest a plan:** asks for the period (today, 2 days, 3 days, a week, 2 weeks, the month, or N days, from a day
  you choose; it remembers your last choice) and lays out everything still to place, or just the tasks selected in
  the tray, as previews: check, tap away what you don't want, **Add**. Each preview says why it was picked (due
  today, very important, your evening slot, in its time window…), and the tray's **✦ Why these** lists them all
  with their times and reasons (handy in Week and on a phone, where previews are small). It doesn't start too early: Settings →
  Planner → *Hours for suggestions* has separate hours for weekdays and weekends (9:00–20:00 and 10:00–20:00 to start
  with). It respects:
  - due dates, importance and the daily limit;
  - each task's time windows ("only Thu 14–16, Fri 9–11");
  - required tasks: a task is never placed before the tasks it needs, and while those are open and unplanned it
    waits (the tray says why);
  - "X times per week": the missing occurrences go on different days;
  - long tasks: their steps are planned one by one, in order, over several days.
- **Assign (the tray):** **⇢ Assign** on the plan opens a tray of your unplanned to-dos that stays while you switch
  between Day, Week, Month and List. It's a list you scroll up and down (no sideways scrolling), with a search box
  and its own sorting, grouped by when tasks are due; tap its bar to fold it. While you drag, it folds out of the
  way.
  - Tap tasks to select them. Press and hold, then drag them onto a day: in the Day and Week views at the time
    you drop them, in Month and List onto the day.
  - Tap two days to pick a range. **✦ Spread** puts the selected tasks (or all of them) over that range or over
    what's on screen. Each task lands by its due date, the most important earliest, keeping days balanced and
    under your daily limit (⚙: max hours per day, keep weekends free).
  - Every day shows a busy bar, in every view and at all times (under the date in Day, under each day in Week,
    in each cell in Month, next to each day in List): what's planned against your daily limit, red when it's
    full. While the tray is open it also shows, striped, what the tray would add.
  - Tasks already on a day aren't in the list to plan: they sit in a folded **Already planned** section at the
    bottom (of the tray, the Day view's *To plan* panel and the ＋ Add → Task picker), each linking to its day.
    Picking one in the picker asks first, so you don't plan it twice by mistake.
  - The open tray takes at most about half the screen; its list shrinks first.
  - Nothing is planned until you tap **Add**: the tasks first appear as dashed previews you can tap away.
- **I have time:** tells you how long you have until the next block and suggests what fits: single tasks, a
  combination of short ones, or a longer task to make a start on. One tap plans it from now.
- **Preparations** (Tasks → Saved): each one shows the tasks it belongs to, with a button to open each; unused ones
  can be deleted.
- **Preparations:** a rule "*when it's planned* → *Pack gym bag*, right before / earlier that day / the evening
  before". Unlike steps, these are separate tasks: planned automatically whenever the task goes on the timeline,
  they follow it when you move it, and stay deleted if you delete them.
- **Checklists:** a task (or a preparation) can have a checklist, e.g. *shoes, T-shirt, towel*. It can't be marked
  done until every item is ticked. Each time a repeating task comes round, its checklist starts fresh.
- **Conflicts:** overlapping blocks, a preparation or grocery trip planned after the thing it's for, or a task planned
  after its due date get a ⚠ and a warning. **Fix** moves the less important block to the next free gap;
  **It's fine** marks an overlap as intended. A block can also be set to "can overlap" (e.g. a podcast on the commute).
- **Same rules as Ricette:** recipes show Ricette's automatic tags (with your renames and keywords from
  `data/tags.json`) and your own tags, pinned tags first; folders and subfolders come from `data/folders.json`;
  cooking times like "30 min + 4 ore di riposo" are read the same way; salt, pepper, oil and water count as always
  at home. Ticking an item in a grocery block only marks it bought on Ricette's list: it goes into the pantry when
  you put the shopping away in Ricette (with expiry dates and barcodes), as Ricette does.
- **Pantry maths (with Ricette):** the ingredient check counts the pantry, what's already on the shopping list, and
  what earlier planned meals (and earlier recipes in the same meal) will use up. In the grocery block you tick items
  off and the pantry restocks, exactly as in Ricette. Marking a meal done uses its ingredients up.
- **Shops:** Settings → *Shops*: where you shop, with opening hours (by weekday or on a date) and how long a visit
  takes. An item on the list can say which shops have it (one or more); items without a shop can be bought anywhere.
  **🛒 Plan trips** (Shopping tab) plans the grocery trips when the shops are open and you're free, inside your
  hours for suggestions where possible: **one trip per shop**, or **one trip for all** (Settings → *Shopping in several
  shops*; the shop closing first goes first). Each trip lists what to buy there. The list can also be viewed **By
  shop**. The shops are shared with Ricette (`data/shops.json` in its repo); `docs/shops-spec.md` describes the rules,
  and `docs/ricette-handoff.md` (with `docs/shoplist.css`) is everything Ricette needs to show the shopping list the same way.
  The list's views live in `app/js/shoplist.js`, which Ricette can copy unchanged.
- **Same list as Ricette:** with Ricette connected (Settings), the Shopping tab *is* Ricette's list: adding,
  editing, ticking or deleting here changes it in Ricette, and changes made in Ricette show up here. It syncs a
  few seconds after each change, every minute while the app is open, and when you come back to it; the tab shows
  when it last synced, with ↻ to sync now.
- **Shopping tab:** your grocery list, imported automatically from Ricette (meal ingredients, items running low),
  plus anything else you need to buy: type "detersivo piatti", "shampoo" or "2 kg mele" and it lands in the right
  department, with two extra ones for non-food: 🧽 Household and 🧴 Personal care. Handled like Ricette: views by
  department / by recipe / by shop / my order, or sorted A–Z, newest first or oldest first (⇅ menu), with a
  search box. Drag ⠿ to reorder items and departments (the order is shared with Ricette),
  tap an item to change quantity, unit, department, note or **shops** (you can create a shop right there), tick items at the shop, then **Put in pantry**: food
  goes into Ricette's pantry, household and personal-care items just leave the list. Share copies the list as text.
  Without Ricette connected it's a list of its own (synced through `everyday-data`), and it moves into Ricette's
  list when you connect. The tab shows how many items are left. (Ricette shows Everyday's two non-food
  departments under "Other".)
- **Saved tasks** (Tasks → Saved): tasks that come back often, at different times. They are grouped by category (Meals,
  Home, Health…), and each has its length or steps, importance, rules, and optionally a usual time or part of the day.
  **+ From saved** on the plan puts one on the day: at its usual time, or in the first free slot of its part of the
  day, which you can change before planning. A saved task marked as a meal gets recipes.
- **Meals:** **+ Meal** creates a meal of a type (Breakfast, Lunch, Snack, Dinner, or your own saved meals, each
  with its usual time). Inside it you add one or more recipes with the recipe picker: a full-screen sheet with
  photos, search (titles, tags, ingredients), folders and subfolders, tags, "can cook now" and "≤ 30 min" filters.
  Each card shows what's missing from the pantry; ⓘ opens the recipe with every ingredient marked.
- **Rules:** any task, preparation or saved task can have rules: *when this task* (or *one of its steps*) is planned /
  is done / couldn't be done / was missed (its time passed) → *add a task* right before, right after, at the
  next free time today, tomorrow, **in the next free time window** (you give the windows, e.g. Thu 14–16), or
  **another time**: it becomes a to-do of its own, labelled "↪ from …", back among the tasks to plan, with its
  windows, so *Suggest a plan* puts it in the right slot. Or *plan a grocery trip*. Example: *Call the insurance* →
  step *Check opening hours* couldn't be done → *Call another time*, another time, Thu 14–16 / Fri 9–11. The task a rule adds is a real task: pick an existing one, or type
  a new name and it becomes a step of its own (under Tasks → Saved → Preparations) that can have its own checklist and
  rules, so rules can chain. Example: *Go to the gym* → step *Check the backpack* → rule "couldn't be done → *Prepare
  clothes*, right before the gym". Ticking a step that has a "couldn't be done" rule asks how it went
  (**Done, all good** / **Couldn't do it**) and says what follows if not. Every block can be marked **Couldn't do it**; undoing that takes back
  what the rules added. Built in: each meal with recipes gets a **Check ingredients** step (earlier that day; the
  evening before for breakfast). It runs by itself when its time comes, or when you tick it: if everything's in the
  pantry it's done; if not, the missing items go on Ricette's shopping list, the step "couldn't be done", and its
  rule plans a grocery trip before the meal (or reuses one already planned). You can edit these steps and rules in
  Tasks → Saved like any other task.
- **Home-screen shortcuts:** long-press the app icon on Android for *Today*, *Add task*, *I have time* and *+ Meal*;
  drag any of them onto the home screen as its own icon.
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

When a new version is published, the app downloads it in the background and shows an **Update** bar; tap it to
switch (or just close and reopen the app). New versions are always downloaded fresh, never pieced together from
the browser's cache (GitHub Pages lets browsers keep files for 10 minutes, which could mix old and new files).

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
   Then, under **Ricette**, enter the repository that holds Ricette's `data/` folder (`ricette-data`, Ricette's
   private data repo) and press **Connect**.
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
- **Exported:** every block in the same months, done ones with a ✓, each with a notification (10 minutes before
  unless you change it: Settings → Google Calendar → *Reminder*, or per task under *When*). Done blocks get none.
- **Changed in Google:** moving, resizing, renaming or deleting an *Everyday* event changes the block. If the block
  was also changed in the app since the last sync, the app's version wins.
- **Cost:** hourly runs use about 720 of the 2,000 free GitHub Actions minutes a month for private repositories,
  and instant syncs (at most one every 10 minutes) add a few more.

## Good to know

- Updating the app: replace the files in `everyday` with the new ones. Installed copies pick up the update because `VERSION` in `app/sw.js` is already bumped in this zip;
  bump it yourself whenever you change files later.
- **Another person, another repo:** each person needs their own data repository and their own calendar secrets
  in it. The app keeps a copy of everything on the device: when you point it at a different repository it asks
  whether to **start empty** (for someone else) or bring the device's data along and merge it in. **Settings →
  Sync → Empty this device** clears the device without touching any repository.
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
- `node e2e-stability.mjs`: the page stays still while you type (no redraws from syncs or the clock)
- `node e2e-steps.mjs`: steps, rules on a step, preparations as rules, saved tasks and importance
- `node e2e-autoplan.mjs`: the auto-planner with windows, prerequisites, 3× a week, long tasks in steps; rules
  "another time" and "next free window"; 24-hour times; the plan header
- `node e2e-assign.mjs`: the tray (drag onto days and times, load bars, ranges, spreading, previews), folding groups, To do | Saved
- `node e2e-recur.mjs`: recurring tasks: rules, occurrences on the plan, only-this-one vs this-and-following, splits, deleting, ticking
- `node e2e-travel.mjs`: Get there / Come back steps with mocked map services, origins, "?" until known, readiness warnings, Settings → Travel
- `node e2e-v13.mjs`: the tasks column in every view, import, search, sorting and your own order, category chips, reminders, auto-planner hours and periods,
  ＋ Add → Task, shops with opening hours and grocery trips (per shop / one trip)

The `e2e` files need Playwright.
