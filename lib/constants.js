import GLib from 'gi://GLib';

export const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'config.json']);
export const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
