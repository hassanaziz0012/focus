import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { formatDuration, isSameDay, isSameWeek, isSameMonth, truncate, parseDate } from './utils.js';
import { readLogEntries } from './sessionLogger.js';

export async function buildStatsView(button) {
    const generation = (button._statsViewGen = (button._statsViewGen || 0) + 1);

    const headerItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    const headerBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 8px; align-items: center; margin-bottom: 4px;' });
    const backBtn = new St.Button({
        label: '← Back',
        style_class: 'button',
        can_focus: true,
        style: 'padding: 3px 10px; font-size: 0.9em;'
    });
    backBtn.connect('clicked', () => {
        button._currentView = 'timer';
        button._buildMenu();
    });
    const headerTitle = new St.Label({
        text: 'Focus Statistics',
        style: 'font-weight: bold; font-size: 1.1em; color: #78e3ff;',
        x_expand: true,
    });
    headerBox.add_child(backBtn);
    headerBox.add_child(headerTitle);
    headerItem.add_child(headerBox);
    button.menu.addMenuItem(headerItem);

    const filterItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    const filterBox = new St.BoxLayout({ x_expand: true, style: 'spacing: 4px; margin-bottom: 6px;' });
    const filters = [
        { id: 'today', label: 'Today' },
        { id: 'week', label: 'Week' },
        { id: 'month', label: 'Month' },
        { id: 'all', label: 'All Time' },
    ];
    for (const f of filters) {
        const btn = new St.Button({
            label: f.label,
            style_class: 'button',
            can_focus: true,
            x_expand: true,
            style: button._statsFilter === f.id
                ? 'background-color: rgba(53, 132, 228, 0.85); color: white; font-weight: bold; font-size: 0.85em;'
                : 'font-size: 0.85em;',
        });
        btn.connect('clicked', () => {
            button._statsFilter = f.id;
            button._buildMenu();
        });
        filterBox.add_child(btn);
    }
    filterItem.add_child(filterBox);
    button.menu.addMenuItem(filterItem);

    let allEntries = [];
    try {
        allEntries = await readLogEntries(button._cancellable);
    } catch (_) {}

    if (button._currentView !== 'stats' || button._statsViewGen !== generation || (button._cancellable && button._cancellable.is_cancelled()))
        return;

    const now = new Date();

    const filteredEntries = allEntries.filter(entry => {
        if (!entry.timestamp) return false;
        const entryDate = parseDate(entry.timestamp);
        if (!entryDate) return false;
        if (button._statsFilter === 'today') return isSameDay(entryDate, now);
        if (button._statsFilter === 'week') return isSameWeek(entryDate, now);
        if (button._statsFilter === 'month') return isSameMonth(entryDate, now);
        return true;
    });

    const totalSeconds = filteredEntries.reduce((acc, e) => acc + (e.elapsed_seconds || 0), 0);
    const completedTasksCount = filteredEntries.filter(e => e.completed).length;
    const totalSessionsCount = filteredEntries.length;

    const statsContainer = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style: 'spacing: 8px; width: 340px; padding: 4px;'
    });

    const summaryRow = new St.BoxLayout({
        x_expand: true,
        style: 'spacing: 6px; margin-bottom: 4px;'
    });

    const makeCard = (val, label) => {
        const card = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'background-color: rgba(255, 255, 255, 0.07); border-radius: 6px; padding: 8px; align-items: center;'
        });
        const vLabel = new St.Label({
            text: String(val),
            style: 'font-weight: bold; font-size: 1.1em; color: #78e3ff;'
        });
        const lLabel = new St.Label({
            text: label,
            style: 'font-size: 0.75em; opacity: 0.75;'
        });
        card.add_child(vLabel);
        card.add_child(lLabel);
        return card;
    };

    summaryRow.add_child(makeCard(formatDuration(totalSeconds), 'Total Focus'));
    summaryRow.add_child(makeCard(`${completedTasksCount}`, 'Completed'));
    summaryRow.add_child(makeCard(`${totalSessionsCount}`, 'Sessions'));
    statsContainer.add_child(summaryRow);

    if (button._statsFilter === 'week' || button._statsFilter === 'today') {
        const weekSection = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'background-color: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 8px; margin-bottom: 4px; spacing: 4px;'
        });

        const weekTitle = new St.Label({
            text: 'Weekly Focus Activity (Mon — Sun)',
            style: 'font-weight: bold; font-size: 0.85em; opacity: 0.85; margin-bottom: 4px;'
        });
        weekSection.add_child(weekTitle);

        const dayOfWeek = now.getDay();
        const distToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + distToMon);
        monday.setHours(0, 0, 0, 0);

        const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const weekdaysData = weekdayNames.map((name, idx) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + idx);
            return { name, date: d, seconds: 0 };
        });

        for (const entry of allEntries) {
            if (!entry.timestamp) continue;
            const ed = parseDate(entry.timestamp);
            if (!ed) continue;
            for (const wd of weekdaysData) {
                if (isSameDay(ed, wd.date)) {
                    wd.seconds += (entry.elapsed_seconds || 0);
                    break;
                }
            }
        }

        const maxDaySec = Math.max(...weekdaysData.map(w => w.seconds), 1);

        for (const wd of weekdaysData) {
            const row = new St.BoxLayout({
                x_expand: true,
                vertical: false,
                style: 'spacing: 6px; align-items: center;'
            });

            const isToday = isSameDay(wd.date, now);
            const dayLabel = new St.Label({
                text: wd.name,
                style: `width: 32px; font-size: 0.8em; font-weight: bold; ${isToday ? 'color: #78e3ff;' : 'opacity: 0.7;'}`
            });

            const barBg = new St.BoxLayout({
                style: 'width: 140px; height: 12px; background-color: rgba(255,255,255,0.12); border-radius: 6px;',
                y_align: Clutter.ActorAlign.CENTER,
            });

            const fillRatio = wd.seconds > 0 ? Math.max(0.04, wd.seconds / maxDaySec) : 0;
            const filledWidth = Math.round(fillRatio * 140);
            if (filledWidth > 0) {
                const barFill = new St.BoxLayout({
                    style: `width: ${filledWidth}px; height: 12px; background-color: ${isToday ? '#78e3ff' : '#3584e4'}; border-radius: 6px;`,
                });
                barBg.add_child(barFill);
            }

            const timeLabel = new St.Label({
                text: formatDuration(wd.seconds),
                style: 'font-size: 0.8em; opacity: 0.8; width: 60px;',
                x_expand: true,
            });

            row.add_child(dayLabel);
            row.add_child(barBg);
            row.add_child(timeLabel);
            weekSection.add_child(row);
        }

        statsContainer.add_child(weekSection);
    }

    const taskSection = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        style: 'background-color: rgba(255, 255, 255, 0.05); border-radius: 8px; padding: 8px; spacing: 4px;'
    });

    const taskTitleLabel = new St.Label({
        text: 'Per-Task Stats',
        style: 'font-weight: bold; font-size: 0.85em; opacity: 0.85; margin-bottom: 4px;'
    });
    taskSection.add_child(taskTitleLabel);

    const taskMap = new Map();
    for (const entry of filteredEntries) {
        const title = entry.task_title || 'Untitled task';
        if (!taskMap.has(title)) {
            taskMap.set(title, {
                title,
                totalSeconds: 0,
                completedCount: 0,
                sessionCount: 0,
            });
        }
        const st = taskMap.get(title);
        st.totalSeconds += (entry.elapsed_seconds || 0);
        st.sessionCount += 1;
        if (entry.completed)
            st.completedCount += 1;
    }

    const sortedTasks = Array.from(taskMap.values()).sort((a, b) => b.totalSeconds - a.totalSeconds);

    if (sortedTasks.length === 0) {
        const emptyLabel = new St.Label({
            text: 'No focus sessions logged for this period.',
            style: 'font-size: 0.85em; opacity: 0.6; padding: 6px 0;'
        });
        taskSection.add_child(emptyLabel);
    } else {
        for (const taskStat of sortedTasks) {
            const row = new St.BoxLayout({
                x_expand: true,
                vertical: false,
                style: 'spacing: 6px; padding: 3px 0; align-items: center;'
            });

            const tLabel = new St.Label({
                text: truncate(taskStat.title, 26),
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'font-size: 0.85em;'
            });

            const detailsText = taskStat.completedCount > 0
                ? `${formatDuration(taskStat.totalSeconds)} (${taskStat.completedCount} completed)`
                : formatDuration(taskStat.totalSeconds);

            const detailsLabel = new St.Label({
                text: detailsText,
                style: 'font-size: 0.85em; color: #78e3ff; font-weight: bold;',
                y_align: Clutter.ActorAlign.CENTER,
            });

            row.add_child(tLabel);
            row.add_child(detailsLabel);
            taskSection.add_child(row);
        }
    }

    statsContainer.add_child(taskSection);

    const maxHeight = Math.max(200, Math.min(450, Math.floor(global.stage.height * 0.5)));
    const scrollView = new St.ScrollView({
        x_expand: true,
        hscrollbar_policy: St.PolicyType.NEVER,
        vscrollbar_policy: St.PolicyType.AUTOMATIC,
        overlay_scrollbars: true,
        style: `max-height: ${maxHeight}px; max-width: 340px;`,
    });
    scrollView.add_child(statsContainer);

    const scrollItem = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    scrollItem.add_child(scrollView);
    button.menu.addMenuItem(scrollItem);
}
