import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const STATE_DIR = GLib.build_filenamev([GLib.get_user_state_dir(), 'focus-tasks']);
const STATE_LOG_PATH = GLib.build_filenamev([STATE_DIR, 'focus.log']);
const LEGACY_LOG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'focus.log']);

export function writeLogEntry(entry) {
    const line = JSON.stringify(entry) + '\n';
    try {
        const file = Gio.File.new_for_path(STATE_LOG_PATH);
        const parent = file.get_parent();
        if (parent && !parent.query_exists(null)) {
            parent.make_directory_with_parents(null);
        }
        let stream;
        if (file.query_exists(null)) {
            stream = file.append_to(Gio.FileCreateFlags.NONE, null);
        } else {
            stream = file.create(Gio.FileCreateFlags.NONE, null);
        }
        stream.write_all(new TextEncoder().encode(line), null);
        stream.close(null);
    } catch (err) {
        console.error('Focus Tasks: Failed writing session log:', err.message);
    }
}

export function readLogEntries() {
    const entries = [];
    const pathsToRead = [STATE_LOG_PATH, LEGACY_LOG_PATH];
    const processedLines = new Set();

    for (const path of pathsToRead) {
        try {
            const file = Gio.File.new_for_path(path);
            if (!file.query_exists(null))
                continue;
            const [ok, bytes] = file.load_contents(null);
            if (!ok || !bytes)
                continue;
            const text = new TextDecoder().decode(bytes);
            const lines = text.split('\n');
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || processedLines.has(trimmed))
                    continue;
                processedLines.add(trimmed);
                try {
                    const record = JSON.parse(trimmed);
                    if (record?.timestamp) {
                        entries.push(record);
                    }
                } catch (_) {}
            }
        } catch (err) {
            console.error(`Focus Tasks: Could not read log from ${path}:`, err.message);
        }
    }
    return entries;
}
