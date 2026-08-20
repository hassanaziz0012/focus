import GLib from 'gi://GLib';

import { formatTime, showNotification, truncate } from './utils.js';
import { writeLogEntry } from './sessionLogger.js';

export function getElapsedSeconds(focus) {
    if (!focus) return 0;
    if (focus.isPaused) {
        return focus.accumulatedElapsedSeconds || 0;
    }
    const currentSegment = (GLib.get_monotonic_time() - focus.lastResumeMono) / 1000000;
    return (focus.accumulatedElapsedSeconds || 0) + currentSegment;
}

export function startFocus(button, title) {
    if (button._duration === null)
        return;

    const nowMono = GLib.get_monotonic_time();
    button._focus = {
        title,
        startedMono: nowMono,
        lastResumeMono: nowMono,
        accumulatedElapsedSeconds: 0,
        isPaused: false,
        startedWall: GLib.DateTime.new_now_local(),
        duration: button._duration * 60,
        taskId: button._selectedTask?.id || null,
        mode: button._duration === 0 ? 'stopwatch' : 'timer',
    };

    if (button._tickId) {
        GLib.Source.remove(button._tickId);
        button._tickId = 0;
    }

    button._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        updatePanel(button);
        return GLib.SOURCE_CONTINUE;
    });

    updatePanel(button);
    button.menu.close();
    button._buildMenu();
}

export function pauseFocus(button) {
    if (!button._focus || button._focus.isPaused) return;
    button._focus.accumulatedElapsedSeconds = getElapsedSeconds(button._focus);
    button._focus.isPaused = true;
    updatePanel(button);
    button._buildMenu();
}

export function resumeFocus(button) {
    if (!button._focus || !button._focus.isPaused) return;
    button._focus.lastResumeMono = GLib.get_monotonic_time();
    button._focus.isPaused = false;
    updatePanel(button);
    button._buildMenu();
}

export function addOneMinute(button) {
    if (!button._focus) return;
    if (button._focus.duration > 0) {
        button._focus.duration += 60;
    } else {
        button._focus.duration = Math.round(getElapsedSeconds(button._focus)) + 60;
        button._focus.mode = 'timer';
    }
    updatePanel(button);
    button._buildMenu();
}

export function updatePanel(button) {
    if (!button._focus) return;
    if (button._focus.isPaused) {
        button._panelLabel.text = ' Paused';
        return;
    }
    const elapsed = getElapsedSeconds(button._focus);
    if (button._focus.duration > 0 && elapsed >= button._focus.duration) {
        showNotification('Focus session complete', button._focus.title);
        stopFocus(button, { completed: true, isFinished: true });
        return;
    }
    const remaining = Math.max(0, button._focus.duration - elapsed);
    const time = button._focus.duration > 0 ? formatTime(remaining) : formatTime(elapsed);
    button._panelLabel.text = ` ${truncate(button._focus.title)} · ${time}`;
}

export function stopFocus(button, { completed = false, isFinished = false } = {}) {
    if (button._tickId) {
        GLib.Source.remove(button._tickId);
        button._tickId = 0;
    }
    if (button._focus) {
        const elapsedSeconds = Math.max(1, Math.round(getElapsedSeconds(button._focus)));
        const isComp = completed || isFinished || (button._focus.duration > 0 && elapsedSeconds >= button._focus.duration - 2);
        let startedIso;
        if (button._focus.startedWall) {
            try {
                const iso = button._focus.startedWall.format_iso8601();
                startedIso = iso.replace(/([+-]\d{2})$/, '$1:00');
            } catch (_) {
                startedIso = new Date().toISOString();
            }
        } else {
            startedIso = new Date().toISOString();
        }

        const entry = {
            timestamp: startedIso,
            task_id: button._focus.taskId || 'custom',
            task_title: button._focus.title || 'Untitled task',
            target_duration_seconds: button._focus.duration,
            elapsed_seconds: elapsedSeconds,
            completed: isComp,
            mode: button._focus.mode || 'timer',
        };
        writeLogEntry(entry);
    }
    button._focus = null;
    button._duration = null;
    button._selectedTask = null;
    button._customMinutesText = '';
    button._customTaskText = '';
    button._panelLabel.text = '';
    button._buildMenu();
}
