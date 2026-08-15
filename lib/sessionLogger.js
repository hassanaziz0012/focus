import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function writeLogEntry(entry) {
    const line = JSON.stringify(entry) + '\n';
    const primaryDir = Gio.File.new_for_path('/var/log/focus');
    let targetPath = '/var/log/focus/focus.log';

    if (primaryDir.query_exists(null)) {
        try {
            const info = primaryDir.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
            if (info.get_file_type() === Gio.FileType.REGULAR) {
                targetPath = '/var/log/focus';
            }
        } catch (_) {}
    }

    const pathsToTry = [
        targetPath,
        GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'focus.log']),
    ];

    for (const path of pathsToTry) {
        try {
            const file = Gio.File.new_for_path(path);
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
            log(`Focus Tasks: Successfully logged focus session to ${path}`);
            return;
        } catch (err) {
            log(`Focus Tasks: Failed writing log to ${path}: ${err.message}`);
        }
    }
}

export function readLogEntries() {
    const entries = [];
    const targetDir = '/var/log/focus';
    const primaryDir = Gio.File.new_for_path(targetDir);
    const pathsToRead = [];

    if (primaryDir.query_exists(null)) {
        try {
            const info = primaryDir.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
            if (info.get_file_type() === Gio.FileType.DIRECTORY) {
                pathsToRead.push('/var/log/focus/focus.log');
                pathsToRead.push('/var/log/focus/sessions.log');
                try {
                    const enumerator = primaryDir.enumerate_children('standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
                    let fileInfo;
                    while ((fileInfo = enumerator.next_file(null)) !== null) {
                        const name = fileInfo.get_name();
                        if (name.endsWith('.log')) {
                            const fullPath = `/var/log/focus/${name}`;
                            if (!pathsToRead.includes(fullPath)) {
                                pathsToRead.push(fullPath);
                            }
                        }
                    }
                } catch (_) {}
            } else if (info.get_file_type() === Gio.FileType.REGULAR) {
                pathsToRead.push('/var/log/focus');
            }
        } catch (_) {
            pathsToRead.push('/var/log/focus/focus.log');
        }
    } else {
        pathsToRead.push('/var/log/focus/focus.log');
    }

    pathsToRead.push(GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'focus.log']));

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
                    if (record && record.timestamp) {
                        entries.push(record);
                    }
                } catch (_) {}
            }
        } catch (e) {
            log(`Focus Tasks: Could not read log from ${path}: ${e.message}`);
        }
    }
    return entries;
}
