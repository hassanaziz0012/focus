import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { CONFIG_PATH } from './constants.js';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

export function showNotification(title, body = '') {
    try {
        Main.notify(title, body);
    } catch (e) {
        console.error('Focus Tasks: Failed to display notification:', e);
    }
}


export function truncate(value, max = 50) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatDuration(seconds) {
    const totalMin = Math.round(seconds / 60);
    if (totalMin <= 0) return '0m';
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
}

export function parseDate(ts) {
    if (!ts) return null;
    if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
    if (typeof ts === 'number') {
        const d = new Date(ts);
        return isNaN(d.getTime()) ? null : d;
    }
    if (typeof ts === 'string') {
        // Fix GLib/ISO 2-digit timezone offset at end, e.g. +05 or -04 -> +05:00 or -04:00
        let normalized = ts.replace(/([+-]\d{2})$/, '$1:00');
        // Fix 4-digit offset without colon e.g. +0500 -> +05:00
        normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
        let d = new Date(normalized);
        if (!isNaN(d.getTime())) return d;
        d = new Date(ts);
        if (!isNaN(d.getTime())) return d;
    }
    return null;
}

export function isSameDay(d1, d2) {
    const date1 = parseDate(d1);
    const date2 = parseDate(d2);
    if (!date1 || !date2) return false;
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
}

export function isSameWeek(d1, d2) {
    const date1 = parseDate(d1);
    const date2 = parseDate(d2);
    if (!date1 || !date2) return false;
    const getMonday = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(date.setDate(diff));
        mon.setHours(0, 0, 0, 0);
        return mon;
    };
    return getMonday(date1).getTime() === getMonday(date2).getTime();
}

export function isSameMonth(d1, d2) {
    const date1 = parseDate(d1);
    const date2 = parseDate(d2);
    if (!date1 || !date2) return false;
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth();
}

export async function readConfig(cancellable = null) {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        const [bytes] = await file.load_contents_async(cancellable);
        return bytes ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    } catch (_) {
        return null;
    }
}

