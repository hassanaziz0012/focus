# Focus Tasks

[![GNOME Extensions](https://img.shields.io/badge/GNOME%20Extensions-Available-blue?logo=gnome)](https://extensions.gnome.org/extension/10741/focus-tasks/)
[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45%20|%2046%20|%2047%20|%2048%20|%2049%20|%2050-blue)](https://extensions.gnome.org/extension/10741/focus-tasks/)

A GNOME Shell extension for running focus sessions against tasks from Google Tasks. Click the alarm icon in the top bar to select a task and choose a timer duration or Stopwatch. The focus session starts once both choices are selected, or instantly when starting a custom task.

While running, the top bar panel displays the active task title (truncated to 50 characters) alongside the remaining countdown or elapsed stopwatch time, with desktop notifications on completion.

👉 **Install from GNOME Extensions:** [extensions.gnome.org/extension/10741/focus-tasks/](https://extensions.gnome.org/extension/10741/focus-tasks/)

---

## Features

- **Flexible Session Timers & Live Controls**:
  - Quick preset timer buttons (**15m**, **25m**, **30m**, **60m**).
  - **Stopwatch** mode for open-ended focus sessions.
  - **Custom Minutes** input: set any custom timer between 1 and 480 minutes.
  - **In-Session Controls**: While a session is active, quickly **Pause / Resume**, **Stop**, or add extra focus time with **+1 min**.
  - Select either task or timer first; session starts automatically once both are chosen.

- **Google Tasks Integration & Search**:
  - Syncs non-completed tasks from all Google Tasks lists with automatic pagination support.
  - **Hierarchical Subtask View**: Subtasks are automatically ordered and rendered with tree indentation (`└ `).
  - **Real-Time Task Search**: Filter through all tasks across lists quickly using the search field.
  - **Mark Tasks Completed**: Click the checkbox next to any task to complete it directly in Google Tasks via API (`PATCH`). Completing an active focus task automatically stops the session and marks it completed in your stats.

- **Create Custom Tasks on the Fly**:
  - Type a title in the **Custom task title** field.
  - Choose the target Google Tasks list from the dynamically displayed list selector.
  - Press Enter or start to immediately start a focus session (defaults to 25m or your configured default duration if no timer is selected) while creating the task in Google Tasks (`POST`).

- **Focus Session Tracking & Statistics**:
  - Automatically logs every completed or ended focus session locally to `~/.local/state/focus-tasks/focus.log` (with fallback to `~/.config/focus-tasks/focus.log`).
  - **Stats Button & Dedicated Layout**: Access detailed analytics via the **Stats** button in the popup header (with a **← Back** button to return).
  - **Time-based & Per-Task Analytics**: Switch between **Today**, **Week**, **Month**, and **All Time** stats.
  - **Summary Cards**: Quick overview of Total Focus time, Completed tasks count, and total Sessions count.
  - **Weekly Weekday Breakdown**: Displays Monday through Sunday breakdown with horizontal visual progress bars indicating focus time spent on each weekday and highlighting today.
  - **Per-Task Focus Time**: View cumulative focus time, session counts, and task completion indicators per task.

- **Native Preferences & Customization**:
  - Built with GTK4 and Libadwaita (`Adw.PreferencesWindow`).
  - One-click Google sign-in with automatic local callback authentication.
  - Configurable **Default Duration** (1–480 minutes) saved in GSettings.

- **Polished UI & Feedback**:
  - Active task title and countdown/stopwatch displayed in the GNOME top bar.
  - Live "Paused" status indicator on the top bar and in the menu.
  - Desktop notifications on session completion and task refresh.
  - Non-blocking background task refreshes using `Gio.Cancellable`.
  - Manual **Refresh tasks** button with loading indicator.

---

## Installation

### From GNOME Extensions (Recommended)

Install Focus Tasks directly from the official GNOME Extensions website:
👉 **[Focus Tasks on GNOME Extensions](https://extensions.gnome.org/extension/10741/focus-tasks/)**

### For Local Development

1. Clone the repository and run the local installation script:
   ```bash
   ./scripts/install-local.sh
   ```

2. After updating code, run `./scripts/install-local.sh` from a terminal in your GNOME desktop session. If Focus Tasks is enabled, the script reloads the extension automatically—no logout or machine restart is needed.

3. For a first-time install, enable **Focus Tasks** in the Extensions app, or run:
   ```bash
   gnome-extensions enable focus-tasks@hassandev.me
   ```

### Packaging for Release

To build the extension zip package for submission or distribution:
```bash
./package.sh
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
- Session logs are stored locally in `~/.local/state/focus-tasks/focus.log` and are never sent to external servers.

