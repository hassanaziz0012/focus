import GLib from 'gi://GLib';

export const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'config.json']);
export const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const REDIRECT_URI = 'http://127.0.0.1:8765/callback';
export const AUTH_SCOPE = 'https://www.googleapis.com/auth/tasks';

