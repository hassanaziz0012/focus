# Focus Tasks

A GNOME Shell extension for running a focus session against a task from Google
Tasks. Click the target icon in the top bar, select a task and explicitly
choose a duration (or Stopwatch), in either order. The focus session starts
only once both selections are made. Selected choices are highlighted, and long
task lists scroll within the menu. While running, the panel shows the task
title (truncated to 50 characters) and remaining time.

## Install for development

```bash
./scripts/install-local.sh
```

After an update, run `./scripts/install-local.sh` from a terminal in your
GNOME desktop session. If Focus Tasks is enabled, the script reloads just that
extension automatically—no logout or machine restart is needed. For a first
install, enable **Focus Tasks** in the Extensions app, or run
`gnome-extensions enable focus-tasks@hassan.local`.

## Connect Google Tasks

1. In Google Cloud Console, create a **Desktop app** OAuth client and enable
   the Google Tasks API for its project.
2. Run `./scripts/google-auth.py configure` and paste the client ID and client
   secret. The credentials are written with owner-only permissions to
   `~/.config/focus-tasks/config.json`.
3. Run `./scripts/google-auth.py login`. It opens Google's consent page and
   uses a temporary callback at `http://127.0.0.1:8765/callback` to obtain a
   refresh token.
4. Re-open the extension menu and choose **Refresh tasks**.

The client secret and refresh token are deliberately never stored in this
repository. See `scripts/google-auth.py --help` for revoke/status commands.

## Notes

The extension reads its token only to request a short-lived access token and
calls `https://tasks.googleapis.com/tasks/v1/users/@me/lists`. Tasks are never
marked complete automatically.
