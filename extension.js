import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const CONFIG_PATH = GLib.build_filenamev([GLib.get_user_config_dir(), 'focus-tasks', 'config.json']);
const TASKS_URL = 'https://tasks.googleapis.com/tasks/v1/users/@me/lists';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function truncate(value, max = 50) {
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function formatTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function formatDuration(seconds) {
    const totalMin = Math.round(seconds / 60);
    if (totalMin <= 0) return '0m';
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours > 0) {
        return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
}

function isSameDay(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth() &&
           d1.getDate() === d2.getDate();
}

function isSameWeek(d1, d2) {
    const getMonday = (d) => {
        const date = new Date(d);
        const day = date.getDay();
        const diff = date.getDate() - day + (day === 0 ? -6 : 1);
        const mon = new Date(date.setDate(diff));
        mon.setHours(0, 0, 0, 0);
        return mon;
    };
    return getMonday(d1).getTime() === getMonday(d2).getTime();
}

function isSameMonth(d1, d2) {
    return d1.getFullYear() === d2.getFullYear() &&
           d1.getMonth() === d2.getMonth();
}

function readConfig() {
    try {
        const [ok, bytes] = Gio.File.new_for_path(CONFIG_PATH).load_contents(null);
        return ok ? JSON.parse(new TextDecoder().decode(bytes)) : null;
    } catch (_) {
        return null;
    }
}

const FocusButton = GObject.registerClass(
class FocusButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Focus Tasks');
        this._extension = extension;
        this._session = new Soup.Session();
        // Default timer duration is 25 minutes. 0 represents Stopwatch, null represents unselected.
        this._duration = 25;
        this._selectedTask = null;
        this._tasks = [];
        this._allLists = [];
        this._selectedCustomListId = null;
        this._customTaskText = '';
        this._customMinutesText = '';
        this._tickId = 0;
        this._focus = null;
        this._isLoadingTasks = false;
        this._loadingFrame = 0;
        this._loadingTimerId = 0;
        this._loadingLabel = null;
        this._isDestroyed = false;
        this._currentView = 'timer'; // 'timer' or 'stats'
        this._statsFilter = 'week';  // 'today', 'week', 'month', 'all'

        this._panelBox = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        this._icon = new St.Icon({icon_name: 'alarm-symbolic', style_class: 'system-status-icon'});
        this._panelLabel = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER});
        this._panelBox.add_child(this._icon);
        this._panelBox.add_child(this._panelLabel);
        this.add_child(this._panelBox);
        this._buildMenu();
        this._loadTasks();
    }

    _clearMenu() {
        this.menu.removeAll();
        this._loadingLabel = null;
    }

    _loadingText() {
        const frames = ['◐', '◓', '◑', '◒'];
        return `${frames[this._loadingFrame]} Refreshing tasks…`;
    }

    _startLoadingAnimation() {
        if (this._loadingTimerId)
            return;
        this._loadingTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._loadingFrame = (this._loadingFrame + 1) % 4;
            if (this._loadingLabel)
                this._loadingLabel.text = this._loadingText();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopLoadingAnimation() {
        if (this._loadingTimerId) {
            GLib.Source.remove(this._loadingTimerId);
            this._loadingTimerId = 0;
        }
        this._loadingFrame = 0;
    }

    _selectionStyle(selected) {
        return selected
            ? 'background-color: rgba(53, 132, 228, 0.75); color: white;'
            : '';
    }

    _selectDuration(duration) {
        if (this._duration === duration) {
            this._duration = null;
        } else {
            this._duration = duration;
            this._customMinutesText = '';
        }
        if (!this._tryStartFocus())
            this._buildMenu();
    }

    _selectTask(task) {
        if (this._selectedTask?.id === task?.id) {
            this._selectedTask = null;
            this._buildMenu();
            return;
        }
        this._selectedTask = task;
        if (!this._tryStartFocus())
            this._buildMenu();
    }

    _tryStartFocus() {
        if (!this._selectedTask || this._duration === null)
            return false;
        this._startFocus(this._selectedTask.title);
        return true;
    }

    _buildMenu() {
        this._clearMenu();

        if (this._currentView === 'stats') {
            this._buildStatsMenu();
            return;
        }

        const titleRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const titleBox = new St.BoxLayout({x_expand: true, style: 'align-items: center;'});
        const titleLabel = new St.Label({text: 'Focus session', style: 'font-weight: bold;', x_expand: true});
        const statsBtn = new St.Button({
            label: '📊 Stats',
            style_class: 'button',
            can_focus: true,
            style: 'padding: 2px 10px; font-size: 0.9em; background-color: rgba(53, 132, 228, 0.75); color: white;'
        });
        statsBtn.connect('clicked', () => {
            this._currentView = 'stats';
            this._buildMenu();
        });
        titleBox.add_child(titleLabel);
        titleBox.add_child(statsBtn);
        titleRow.add_child(titleBox);
        this.menu.addMenuItem(titleRow);

        let instructionText = 'Select a task, then choose a timer or Stopwatch.';
        if (this._selectedTask && this._duration === null)
            instructionText = 'Task selected — choose a timer or Stopwatch to start.';
        else if (!this._selectedTask && this._duration !== null)
            instructionText = 'Timer selected — choose a task to start.';
        const instructions = new PopupMenu.PopupMenuItem(instructionText, {reactive: false});
        instructions.label.style = 'opacity: 0.75; font-size: 0.9em;';
        instructions.label.clutter_text.line_wrap = true;
        this.menu.addMenuItem(instructions);

        const selectionLabel = this._duration === null
            ? 'Timer: not selected'
            : `Timer selected: ${this._duration === 0 ? 'Stopwatch' : `${this._duration}m`}`;
        const selection = new PopupMenu.PopupMenuItem(selectionLabel, {reactive: false});
        selection.label.style = this._duration === null
            ? 'opacity: 0.65;'
            : 'color: #78e3ff; font-weight: bold;';
        this.menu.addMenuItem(selection);

        if (this._isLoadingTasks) {
            const loading = new PopupMenu.PopupMenuItem(this._loadingText(), {reactive: false});
            loading.label.style = 'color: #78e3ff;';
            this._loadingLabel = loading.label;
            this.menu.addMenuItem(loading);
        }

        const controls = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({x_expand: true, style: 'spacing: 4px;'});
        for (const value of [15, 25, 30, 60]) {
            const button = new St.Button({label: `${value}m`, style_class: 'button', can_focus: true});
            button.style = this._selectionStyle(value === this._duration);
            button.connect('clicked', () => this._selectDuration(value));
            box.add_child(button);
        }
        const stopwatch = new St.Button({label: 'Stopwatch', style_class: 'button', can_focus: true});
        stopwatch.style = this._selectionStyle(this._duration === 0);
        stopwatch.connect('clicked', () => this._selectDuration(0));
        box.add_child(stopwatch);
        controls.add_child(box);
        this.menu.addMenuItem(controls);

        const custom = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const customBox = new St.BoxLayout({x_expand: true, style: 'spacing: 8px;'});
        const entry = new St.Entry({hint_text: 'Minutes', input_purpose: Clutter.InputContentPurpose.DIGITS, x_expand: true});
        if (this._customMinutesText)
            entry.set_text(this._customMinutesText);

        const set = new St.Button({label: 'Set', style_class: 'button'});
        const applyCustomMinutes = () => {
            const minutes = Number.parseInt(entry.get_text(), 10);
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 480) {
                this._customMinutesText = String(minutes);
                this._duration = minutes;
                if (!this._tryStartFocus())
                    this._buildMenu();
            }
        };
        set.connect('clicked', applyCustomMinutes);
        entry.clutter_text.connect('activate', applyCustomMinutes);
        customBox.add_child(entry); customBox.add_child(set); custom.add_child(customBox);
        this.menu.addMenuItem(custom);

        // Custom Task Section below custom Minutes field
        const customTaskItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const customTaskBox = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 6px;'});

        const customTaskRow = new St.BoxLayout({x_expand: true, style: 'spacing: 8px;'});
        const customTaskEntry = new St.Entry({
            hint_text: 'Custom task title',
            x_expand: true,
            can_focus: true,
        });
        if (this._customTaskText)
            customTaskEntry.set_text(this._customTaskText);

        const customTaskStartBtn = new St.Button({
            label: 'Start',
            style_class: 'button',
            can_focus: true,
        });

        customTaskRow.add_child(customTaskEntry);
        customTaskRow.add_child(customTaskStartBtn);
        customTaskBox.add_child(customTaskRow);

        const listContainer = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 4px; padding-top: 2px;'});
        const listHeading = new St.Label({
            text: 'Select Google Tasks list:',
            style: 'font-weight: bold; opacity: 0.8; font-size: 0.85em;',
        });
        listContainer.add_child(listHeading);

        const listButtonsBox = new St.BoxLayout({x_expand: true, style: 'spacing: 4px;'});

        if (this._allLists.length === 0) {
            const noListsLabel = new St.Label({
                text: 'No lists available (refresh tasks)',
                style: 'opacity: 0.6; font-size: 0.85em;',
            });
            listButtonsBox.add_child(noListsLabel);
        } else {
            if (!this._selectedCustomListId && this._allLists.length > 0)
                this._selectedCustomListId = this._allLists[0].id;

            for (const listObj of this._allLists) {
                const isSelected = (listObj.id === this._selectedCustomListId);
                const listBtn = new St.Button({
                    label: listObj.title,
                    style_class: 'button',
                    can_focus: true,
                });
                listBtn.style = isSelected
                    ? 'background-color: rgba(53, 132, 228, 0.75); color: white; font-size: 0.85em;'
                    : 'font-size: 0.85em;';

                listBtn.connect('clicked', () => {
                    this._selectedCustomListId = listObj.id;
                    this._buildMenu();
                });
                listButtonsBox.add_child(listBtn);
            }
        }

        const listScrollView = new St.ScrollView({
            x_expand: true,
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
            style: 'max-width: 300px; padding-bottom: 2px;',
        });
        listScrollView.add_child(listButtonsBox);
        listContainer.add_child(listScrollView);
        customTaskBox.add_child(listContainer);

        const initialText = customTaskEntry.get_text().trim();
        listContainer.visible = initialText.length > 0;

        customTaskEntry.clutter_text.connect('text-changed', () => {
            const currentText = customTaskEntry.get_text();
            this._customTaskText = currentText;
            listContainer.visible = currentText.trim().length > 0;
        });

        const onStartCustomTask = () => {
            const taskTitle = customTaskEntry.get_text().trim();
            if (!taskTitle)
                return;

            if (this._duration === null)
                this._duration = 25;

            const targetListId = this._selectedCustomListId || (this._allLists[0]?.id);

            this._selectedTask = {
                id: `custom_${Date.now()}`,
                title: taskTitle,
            };
            this._customTaskText = '';

            this._startFocus(taskTitle);

            if (targetListId)
                this._createGoogleTask(targetListId, taskTitle);
        };

        customTaskStartBtn.connect('clicked', () => onStartCustomTask());
        customTaskEntry.clutter_text.connect('activate', () => onStartCustomTask());

        customTaskItem.add_child(customTaskBox);
        this.menu.addMenuItem(customTaskItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        if (this._focus) {
            const stop = new PopupMenu.PopupMenuItem('Stop current focus session');
            stop.connect('activate', () => this._stopFocus({ completed: false }));
            this.menu.addMenuItem(stop);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        if (this._selectedTask) {
            const selectedItem = this._createTaskMenuItem({
                id: this._selectedTask.id,
                title: this._selectedTask.title || '(Untitled task)',
                listId: this._selectedTask.listId || this._findListIdForTask(this._selectedTask.id),
            }, { isSelected: true });
            this.menu.addMenuItem(selectedItem);
            this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        }

        if (!this._tasks.length) {
            const message = new PopupMenu.PopupMenuItem('No tasks loaded — configure Google Tasks first.', {reactive: false});
            message.label.clutter_text.line_wrap = true;
            this.menu.addMenuItem(message);
        } else {
            const taskList = new PopupMenu.PopupMenuSection();
            let hasRemainingTasks = false;
            for (const list of this._tasks) {
                const remainingTasks = list.tasks.filter(task => task.id !== this._selectedTask?.id);
                if (!remainingTasks.length)
                    continue;
                hasRemainingTasks = true;
                const heading = new PopupMenu.PopupMenuItem(list.title || 'Untitled list', {reactive: false});
                heading.label.style = 'font-weight: bold; opacity: 0.8;';
                taskList.addMenuItem(heading);
                for (const task of remainingTasks) {
                    const item = this._createTaskMenuItem({
                        id: task.id,
                        title: task.title || 'Untitled task',
                        listId: task.listId || list.id,
                    });
                    taskList.addMenuItem(item);
                }
            }

            if (hasRemainingTasks) {
                // Keep very large Google Tasks lists inside the available popup area.
                const maxHeight = Math.max(160, Math.min(360, Math.floor(global.stage.height * 0.4)));
                const scrollView = new St.ScrollView({
                    x_expand: true,
                    hscrollbar_policy: St.PolicyType.NEVER,
                    vscrollbar_policy: St.PolicyType.AUTOMATIC,
                    overlay_scrollbars: true,
                    style: `max-height: ${maxHeight}px;`,
                });
                scrollView.add_child(taskList.actor);
                const scrollItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
                scrollItem.add_child(scrollView);
                this.menu.addMenuItem(scrollItem);
            }
        }
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        // A button inside a non-reactive menu item does not trigger the popup's
        // default activation handler, so the menu remains open while refreshing.
        const refreshItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const refresh = new St.Button({
            label: this._isLoadingTasks ? 'Refreshing tasks…' : 'Refresh tasks',
            style_class: 'button',
            x_expand: true,
            can_focus: !this._isLoadingTasks,
            reactive: !this._isLoadingTasks,
        });
        refresh.connect('clicked', () => this._loadTasks({notifyResult: true}));
        refreshItem.add_child(refresh);
        this.menu.addMenuItem(refreshItem);
    }

    _buildStatsMenu() {
        this._clearMenu();

        // Navigation Header: ← Back & Title
        const headerItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const headerBox = new St.BoxLayout({x_expand: true, style: 'spacing: 8px; align-items: center; margin-bottom: 4px;'});
        const backBtn = new St.Button({
            label: '← Back',
            style_class: 'button',
            can_focus: true,
            style: 'padding: 3px 10px; font-size: 0.9em;'
        });
        backBtn.connect('clicked', () => {
            this._currentView = 'timer';
            this._buildMenu();
        });
        const headerTitle = new St.Label({
            text: 'Focus Statistics',
            style: 'font-weight: bold; font-size: 1.1em; color: #78e3ff;',
            x_expand: true,
        });
        headerBox.add_child(backBtn);
        headerBox.add_child(headerTitle);
        headerItem.add_child(headerBox);
        this.menu.addMenuItem(headerItem);

        // Time Period Filter Selector: Today | Week | Month | All Time
        const filterItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const filterBox = new St.BoxLayout({x_expand: true, style: 'spacing: 4px; margin-bottom: 6px;'});
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
                style: this._statsFilter === f.id
                    ? 'background-color: rgba(53, 132, 228, 0.85); color: white; font-weight: bold; font-size: 0.85em;'
                    : 'font-size: 0.85em;',
            });
            btn.connect('clicked', () => {
                this._statsFilter = f.id;
                this._buildMenu();
            });
            filterBox.add_child(btn);
        }
        filterItem.add_child(filterBox);
        this.menu.addMenuItem(filterItem);

        // Read and filter session logs
        const allEntries = this._readLogEntries();
        const now = new Date();

        const filteredEntries = allEntries.filter(entry => {
            if (!entry.timestamp) return false;
            const entryDate = new Date(entry.timestamp);
            if (isNaN(entryDate.getTime())) return false;
            if (this._statsFilter === 'today') return isSameDay(entryDate, now);
            if (this._statsFilter === 'week') return isSameWeek(entryDate, now);
            if (this._statsFilter === 'month') return isSameMonth(entryDate, now);
            return true;
        });

        const totalSeconds = filteredEntries.reduce((acc, e) => acc + (e.elapsed_seconds || 0), 0);
        const completedTasksCount = filteredEntries.filter(e => e.completed).length;
        const totalSessionsCount = filteredEntries.length;

        // Container box for stats layout
        const statsContainer = new St.BoxLayout({
            vertical: true,
            x_expand: true,
            style: 'spacing: 8px; width: 340px; padding: 4px;'
        });

        // Overview Summary Cards Row
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

        // Weekly View (Weekday Horizontal Bars Layout)
        // Rendered for 'week' and 'today' view filters
        if (this._statsFilter === 'week' || this._statsFilter === 'today') {
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
                const ed = new Date(entry.timestamp);
                if (isNaN(ed.getTime())) continue;
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

        // Per-Task Focus Breakdown Section
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

                const detailsLabel = new St.Label({
                    text: `${formatDuration(taskStat.totalSeconds)} ${taskStat.completedCount > 0 ? `(✓ ${taskStat.completedCount})` : ''}`,
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

        const scrollItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        scrollItem.add_child(scrollView);
        this.menu.addMenuItem(scrollItem);
    }

    _writeLogEntry(entry) {
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

    _readLogEntries() {
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

    async _accessToken() {
        const config = readConfig();
        if (!config?.client_id || !config?.client_secret || !config?.refresh_token)
            throw new Error('Google account is not configured');
        const form = `client_id=${encodeURIComponent(config.client_id)}&client_secret=${encodeURIComponent(config.client_secret)}&refresh_token=${encodeURIComponent(config.refresh_token)}&grant_type=refresh_token`;
        const message = Soup.Message.new('POST', TOKEN_URL);
        message.set_request_body_from_bytes('application/x-www-form-urlencoded', new GLib.Bytes(new TextEncoder().encode(form)));
        const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.status_code !== Soup.Status.OK)
            throw new Error('Could not refresh Google access token');
        return JSON.parse(new TextDecoder().decode(bytes.get_data())).access_token;
    }

    async _loadTasks({notifyResult = false} = {}) {
        if (this._isLoadingTasks)
            return;

        this._isLoadingTasks = true;
        this._startLoadingAnimation();
        this._buildMenu();
        try {
            const token = await this._accessToken();
            const lists = await this._getAllPages(TASKS_URL, token);
            this._allLists = lists.map(l => ({ id: l.id, title: l.title || 'Untitled list' }));
            if (!this._selectedCustomListId && this._allLists.length > 0)
                this._selectedCustomListId = this._allLists[0].id;
            this._tasks = await Promise.all(lists.map(async list => {
                const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false`;
                const fetched = await this._getAllPages(url, token);
                return {
                    id: list.id,
                    title: list.title,
                    tasks: fetched.map(t => ({
                        id: t.id,
                        title: t.title || 'Untitled task',
                        listId: list.id,
                    })),
                };
            }));
            this._tasks = this._tasks.filter(list => list.tasks.length);
            if (this._selectedTask?.id?.startsWith('custom_')) {
                for (const list of this._tasks) {
                    const match = list.tasks.find(t => t.title === this._selectedTask.title);
                    if (match) {
                        this._selectedTask.id = match.id;
                        this._selectedTask.listId = list.id;
                        break;
                    }
                }
            }
            if (notifyResult && !this._isDestroyed)
                Main.notify('Tasks refreshed', 'Your Google Tasks list is up to date.');
        } catch (error) {
            log(`Focus Tasks: ${error.message}`);
            if (notifyResult && !this._isDestroyed)
                Main.notify('Could not refresh tasks', error.message || 'Please try again.');
        } finally {
            this._isLoadingTasks = false;
            this._stopLoadingAnimation();
            if (!this._isDestroyed)
                this._buildMenu();
        }
    }

    async _createGoogleTask(listId, title) {
        try {
            const token = await this._accessToken();
            const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`;
            const message = Soup.Message.new('POST', url);
            message.request_headers.append('Authorization', `Bearer ${token}`);
            const body = JSON.stringify({ title });
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.status_code === Soup.Status.OK || message.status_code === 201) {
                log(`Focus Tasks: Custom task "${title}" created successfully in Google Tasks.`);
                this._loadTasks();
            } else {
                log(`Focus Tasks: Google Tasks API returned status code ${message.status_code} when creating task.`);
            }
        } catch (error) {
            log(`Focus Tasks: Error creating task in Google Tasks: ${error.message}`);
        }
    }

    _findListIdForTask(taskId) {
        if (!taskId) return null;
        for (const list of this._tasks) {
            if (list.tasks.some(t => t.id === taskId))
                return list.id;
        }
        return null;
    }

    _createTaskMenuItem(task, { isSelected = false } = {}) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: true,
            can_focus: true,
        });

        if (isSelected)
            item.style = this._selectionStyle(true);

        const box = new St.BoxLayout({
            x_expand: true,
            vertical: false,
            style: 'spacing: 8px; align-items: center;',
        });

        const checkBtn = new St.Button({
            style_class: 'button',
            can_focus: true,
            reactive: true,
            style: 'padding: 2px 5px; margin-right: 4px;',
        });
        const checkIcon = new St.Icon({
            icon_name: 'checkbox-symbolic',
            style_class: 'popup-menu-icon',
            icon_size: 16,
        });
        checkBtn.set_child(checkIcon);

        checkBtn.connect('clicked', () => {
            this._onTaskCheck(task);
        });

        const label = new St.Label({
            text: truncate(task.title || '(Untitled task)'),
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });

        box.add_child(checkBtn);
        box.add_child(label);
        item.add_child(box);

        item.connect('activate', () => {
            this._selectTask(task);
        });

        return item;
    }

    async _onTaskCheck(task) {
        if (!task) return;

        const isCurrentSelected = (this._selectedTask?.id === task.id);
        if (isCurrentSelected) {
            if (this._focus) {
                this._stopFocus({ completed: true });
            } else {
                this._selectedTask = null;
                this._buildMenu();
            }
        }

        const listId = task.listId || this._findListIdForTask(task.id);
        if (listId && task.id && !task.id.startsWith('custom_')) {
            await this._completeGoogleTask(listId, task.id);
        }

        await this._loadTasks();
    }

    async _completeGoogleTask(listId, taskId) {
        if (!listId || !taskId || taskId.startsWith('custom_')) {
            log(`Focus Tasks: Cannot complete task without valid listId and taskId (${listId}, ${taskId})`);
            return;
        }
        try {
            const token = await this._accessToken();
            const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
            const message = Soup.Message.new('PATCH', url);
            message.request_headers.append('Authorization', `Bearer ${token}`);
            const body = JSON.stringify({ status: 'completed' });
            message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.status_code === Soup.Status.OK || message.status_code === 201) {
                log(`Focus Tasks: Task "${taskId}" marked completed in Google Tasks.`);
            } else {
                log(`Focus Tasks: Google Tasks API returned status code ${message.status_code} when completing task.`);
            }
        } catch (error) {
            log(`Focus Tasks: Error completing task in Google Tasks: ${error.message}`);
        }
    }

    async _getAllPages(url, token) {
        const items = [];
        let pageToken = null;
        do {
            const separator = url.includes('?') ? '&' : '?';
            const message = Soup.Message.new('GET', pageToken ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}` : url);
            message.request_headers.append('Authorization', `Bearer ${token}`);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.status_code !== Soup.Status.OK) throw new Error('Google Tasks request failed');
            const result = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            items.push(...(result.items || []));
            pageToken = result.nextPageToken || null;
        } while (pageToken);
        return items;
    }

    _startFocus(title) {
        if (this._duration === null)
            return;
        this._focus = {
            title,
            started: GLib.get_monotonic_time(),
            startedWall: GLib.DateTime.new_now_local(),
            duration: this._duration * 60,
            taskId: this._selectedTask?.id || null,
            mode: this._duration === 0 ? 'stopwatch' : 'timer',
        };
        if (this._tickId) GLib.Source.remove(this._tickId);
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => { this._updatePanel(); return GLib.SOURCE_CONTINUE; });
        this._updatePanel(); this.menu.close(); this._buildMenu();
    }

    _updatePanel() {
        if (!this._focus) return;
        const elapsed = (GLib.get_monotonic_time() - this._focus.started) / 1000000;
        if (this._focus.duration > 0 && elapsed >= this._focus.duration) {
            Main.notify('Focus session complete', this._focus.title);
            this._stopFocus({ completed: true, isFinished: true }); return;
        }
        const time = this._focus.duration > 0 ? formatTime(this._focus.duration - elapsed) : formatTime(elapsed);
        this._panelLabel.text = ` ${truncate(this._focus.title)} · ${time}`;
    }

    _stopFocus({ completed = false, isFinished = false } = {}) {
        if (this._tickId) { GLib.Source.remove(this._tickId); this._tickId = 0; }
        if (this._focus) {
            const elapsedSeconds = Math.max(1, Math.round((GLib.get_monotonic_time() - this._focus.started) / 1000000));
            const isComp = completed || isFinished || (this._focus.duration > 0 && elapsedSeconds >= this._focus.duration - 2);
            const entry = {
                timestamp: this._focus.startedWall ? this._focus.startedWall.format_iso8601() : GLib.DateTime.new_now_local().format_iso8601(),
                task_id: this._focus.taskId || 'custom',
                task_title: this._focus.title || 'Untitled task',
                target_duration_seconds: this._focus.duration,
                elapsed_seconds: elapsedSeconds,
                completed: isComp,
                mode: this._focus.mode || 'timer',
            };
            this._writeLogEntry(entry);
        }
        this._focus = null;
        this._duration = 25;
        this._selectedTask = null;
        this._customMinutesText = '';
        this._panelLabel.text = '';
        this._buildMenu();
    }

    destroy() {
        this._isDestroyed = true;
        this._stopFocus({ completed: false }); this._stopLoadingAnimation(); this._session.abort(); super.destroy();
    }
});

export default class FocusTasksExtension extends Extension {
    enable() {
        this._button = new FocusButton(this);
        Main.panel.addToStatusArea(this.uuid, this._button);
    }
    disable() {
        this._button.destroy(); this._button = null;
    }
}

