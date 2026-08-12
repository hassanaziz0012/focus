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

- **Polished UI & Feedback**:
  - Selection highlighting for active timers and tasks.
  - Animated spinner (`◐` `◓` `◑` `◒`) during background task refreshes.
  - **Refresh tasks** menu item that stays open during loading and sends desktop notifications upon completion or failure.

---

## Install for Development

```bash
./scripts/install-local.sh
```

After updating code, run `./scripts/install-local.sh` from a terminal in your GNOME desktop session. If Focus Tasks is enabled, the script reloads the extension automatically—no logout or machine restart is needed.

For a first-time install, enable **Focus Tasks** in the Extensions app, or run:

```bash
gnome-extensions enable focus-tasks@hassan.local
```

---

## Connect Google Tasks

1. In the Google Cloud Console, create a **Desktop app** OAuth client and enable the **Google Tasks API** for its project.
2. Run `./scripts/google-auth.py configure` and paste your Client ID and Client Secret. Credentials are saved with owner-only permissions to `~/.config/focus-tasks/config.json`.
3. Run `./scripts/google-auth.py login`. This opens Google's consent page and uses a local callback at `http://127.0.0.1:8765/callback` to obtain a refresh token.
4. Open the extension menu and click **Refresh tasks**.

The client secret and refresh token are stored only in your local configuration directory (`~/.config/focus-tasks/config.json`) and never included in this repository. See `scripts/google-auth.py --help` for status and token revocation commands.

---

## Notes & Security

- The extension uses local OAuth 2.0 credentials to obtain short-lived access tokens from Google.
- All API interactions use standard HTTPS endpoints (`https://tasks.googleapis.com/tasks/v1/...`) to fetch task lists, create custom tasks, and mark tasks as completed.

