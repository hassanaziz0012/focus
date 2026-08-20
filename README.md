# Focus Tasks

A GNOME Shell extension for running focus sessions against tasks from Google Tasks. Click the alarm icon in the top bar to select a task and choose a timer duration or Stopwatch. The focus session starts once both choices are selected, or instantly when starting a custom task.

While running, the top bar panel displays the active task title (truncated to 50 characters) alongside the remaining countdown or elapsed stopwatch time, with desktop notifications on completion.

---

## Features

- **Flexible Session Timers**:
  - Quick preset timer buttons (**15m**, **25m**, **30m**, **60m**).
  - **Stopwatch** mode for open-ended focus sessions.
  - **Custom Minutes** input: set any custom timer between 1 and 480 minutes.
  - Select either task or timer first; session starts automatically once both are chosen.

- **Google Tasks Integration**:
  - Syncs non-completed tasks from all Google Tasks lists with automatic pagination support.
  - Scrollable view for long task lists.
  - **Mark Tasks Completed**: Click the checkbox next to any task to complete it directly in Google Tasks via API (`PATCH`). Completing an active focus task automatically stops or clears the session.

- **Create Custom Tasks on the Fly**:
  - Type a title in the **Custom task title** field.
  - Choose the target Google Tasks list from the dynamically displayed list selector.
  - Click **Start** (or press Enter) to immediately start a focus session (defaults to 25m if no timer is selected) while creating the task in Google Tasks (`POST`).

- **Focus Session Tracking & Statistics**:
  - Automatically logs every completed or ended focus session locally to `~/.local/state/focus-tasks/focus.log` (with fallback to `~/.config/focus-tasks/focus.log`).
  - **Stats Button & Dedicated Layout**: Access detailed analytics via the **Stats** button in the extension popup menu.
  - **Time-based & Per-Task Analytics**: Switch between **Today**, **Week**, **Month**, and **All Time** stats.
  - **Weekly Weekday Layout**: Displays Monday through Sunday breakdown with horizontal visual progress bars indicating focus time spent on each weekday.
  - **Per-Task Focus Time**: View cumulative focus time, session counts, and task completion indicators per task.

- **Polished UI & Feedback**:
  - Selection highlighting for active timers and tasks.
  - Non-blocking background task refreshes.
  - **Refresh tasks** menu item that stays open during loading and sends desktop notifications upon completion or failure.

---

## Install for Development

```bash
./scripts/install-local.sh
```

After updating code, run `./scripts/install-local.sh` from a terminal in your GNOME desktop session. If Focus Tasks is enabled, the script reloads the extension automatically—no logout or machine restart is needed.

For a first-time install, enable **Focus Tasks** in the Extensions app, or run:

```bash
gnome-extensions enable focus-tasks@hassandev.me
```

---

## Connect Google Tasks

1. In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create a **Desktop app** OAuth client and enable the **Google Tasks API** for your project.
2. Open **Focus Tasks Preferences** (via the Extensions app or Extension Manager).
3. Paste your **Client ID** and **Client Secret**, then click **Sign in with Google**.
4. Your default browser will open Google's authorization page. Sign in and grant access to Google Tasks.
5. Once approved, the preferences window automatically receives the token and marks your account as **Connected**.
6. Open the extension menu in the top bar and click **Refresh tasks**.

*(Optional CLI Alternative)*: You can also use the terminal helper script:
```bash
./scripts/google-auth.py configure
./scripts/google-auth.py login
```

Credentials are saved privately in `~/.config/focus-tasks/config.json`.

---

## Notes & Security

- The extension uses local OAuth 2.0 credentials to obtain short-lived access tokens from Google.
- All API interactions use standard HTTPS endpoints (`https://tasks.googleapis.com/tasks/v1/...`) to fetch task lists, create custom tasks, and mark tasks as completed.

