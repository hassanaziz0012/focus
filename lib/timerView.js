import Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { truncate } from './utils.js';
import { createGoogleTask, completeGoogleTask, fetchTasks } from './googleTasks.js';
import { startFocus, stopFocus, pauseFocus, resumeFocus, addOneMinute } from './focusTimer.js';

export function selectionStyle(selected) {
    return selected
        ? 'background-color: rgba(53, 132, 228, 0.75); color: white;'
        : '';
}

export function findListIdForTask(button, taskId) {
    if (!taskId) return null;
    for (const list of button._tasks) {
        if (list.tasks.some(t => t.id === taskId))
            return list.id;
    }
    return null;
}

export function createTaskMenuItem(button, task, { isSelected = false } = {}) {
    const item = new PopupMenu.PopupBaseMenuItem({
        reactive: true,
        can_focus: true,
    });

    if (isSelected)
        item.style = selectionStyle(true);

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
        onTaskCheck(button, task);
    });

    const label = new St.Label({
        text: truncate(task.displayTitle || task.title || '(Untitled task)'),
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    });

    box.add_child(checkBtn);
    box.add_child(label);
    item.add_child(box);

    item.connect('activate', () => {
        selectTask(button, task);
    });

    return item;
}

export async function onTaskCheck(button, task) {
    if (!task) return;

    const isCurrentSelected = (button._selectedTask?.id === task.id);
    if (isCurrentSelected) {
        if (button._focus) {
            stopFocus(button, { completed: true });
        } else {
            button._selectedTask = null;
            button._buildMenu();
        }
    }

    const listId = task.listId || findListIdForTask(button, task.id);
    if (listId && task.id && !task.id.startsWith('custom_')) {
        await completeGoogleTask(button._session, listId, task.id);
    }

    await fetchTasks(button);
}

export function selectDuration(button, duration) {
    if (button._duration === duration) {
        button._duration = null;
    } else {
        button._duration = duration;
        button._customMinutesText = '';
    }
    if (!tryStartFocus(button))
        button._buildMenu();
}

export function selectTask(button, task) {
    if (button._selectedTask?.id === task?.id) {
        button._selectedTask = null;
        button._buildMenu();
        return;
    }
    button._selectedTask = task;
    if (!tryStartFocus(button))
        button._buildMenu();
}

export function tryStartFocus(button) {
    if (!button._selectedTask || button._duration === null)
        return false;
    startFocus(button, button._selectedTask.title);
    return true;
}

function createActionButton(iconName, labelText, onClick, extraStyle = '') {
    const btn = new St.Button({
        style_class: 'button',
        can_focus: true,
        reactive: true,
        x_expand: true,
        style: `padding: 4px 8px; ${extraStyle}`,
    });
    const content = new St.BoxLayout({
        style: 'spacing: 5px; align-items: center; justify-content: center;',
        x_expand: true,
    });
    const icon = new St.Icon({
        icon_name: iconName,
        icon_size: 14,
        style_class: 'popup-menu-icon',
    });
    const label = new St.Label({
        text: labelText,
        y_align: Clutter.ActorAlign.CENTER,
    });
    content.add_child(icon);
    content.add_child(label);
    btn.set_child(content);
    btn.connect('clicked', onClick);
    return btn;
}

export function buildTimerView(button) {
    // Header Row: Focus session title + Stats button
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
        button._currentView = 'stats';
        button._buildMenu();
    });
    titleBox.add_child(titleLabel);
    titleBox.add_child(statsBtn);
    titleRow.add_child(titleBox);
    button.menu.addMenuItem(titleRow);

    // Instructions Row
    let instructionText = 'Select a task, then choose a timer or Stopwatch.';
    if (button._focus) {
        instructionText = `${button._focus.isPaused ? '⏸ Paused' : '▶ Active'}: ${truncate(button._focus.title)}`;
    } else if (button._selectedTask && button._duration === null) {
        instructionText = 'Task selected — choose a timer or Stopwatch to start.';
    } else if (!button._selectedTask && button._duration !== null) {
        instructionText = 'Timer selected — choose a task to start.';
    }
    const instructions = new PopupMenu.PopupMenuItem(instructionText, {reactive: false});
    instructions.label.style = 'opacity: 0.75; font-size: 0.9em;';
    instructions.label.clutter_text.line_wrap = true;
    button.menu.addMenuItem(instructions);

    // Selection Indicator Row
    const getSelectionLabelText = () => {
        if (button._focus) {
            return `Focus in progress (${button._focus.duration > 0 ? `${Math.round(button._focus.duration / 60)}m` : 'Stopwatch'})`;
        }
        return button._duration === null
            ? 'Timer: not selected'
            : `Timer selected: ${button._duration === 0 ? 'Stopwatch' : `${button._duration}m`}`;
    };

    const selection = new PopupMenu.PopupMenuItem(getSelectionLabelText(), {reactive: false});
    selection.label.style = (button._duration === null && !button._focus)
        ? 'opacity: 0.65;'
        : 'color: #78e3ff; font-weight: bold;';
    button.menu.addMenuItem(selection);

    // Loading Indicator (if tasks are loading)
    if (button._isLoadingTasks) {
        const loading = new PopupMenu.PopupMenuItem(button._loadingText(), {reactive: false});
        loading.label.style = 'color: #78e3ff;';
        button._loadingLabel = loading.label;
        button.menu.addMenuItem(loading);
    }

    // Active Session Controls Row (Stop, Pause/Resume, Separator, +1 min)
    if (button._focus) {
        const sessionControlsItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const sessionControlsBox = new St.BoxLayout({
            x_expand: true,
            style: 'spacing: 6px; align-items: center; margin: 4px 0;',
        });

        // 1. Stop Button
        const stopBtn = createActionButton(
            'media-playback-stop-symbolic',
            'Stop',
            () => stopFocus(button, { completed: false })
        );

        // 2. Pause / Resume Button
        const isPaused = Boolean(button._focus.isPaused);
        const pauseBtn = createActionButton(
            isPaused ? 'media-playback-start-symbolic' : 'media-playback-pause-symbolic',
            isPaused ? 'Resume' : 'Pause',
            () => {
                if (button._focus.isPaused) {
                    resumeFocus(button);
                } else {
                    pauseFocus(button);
                }
            }
        );

        // 3. Separator
        const sep = new St.BoxLayout({
            style: 'width: 1px; height: 20px; background-color: rgba(255, 255, 255, 0.2); margin: 0 2px;',
        });

        // 4. +1 min Button
        const addMinBtn = createActionButton(
            'list-add-symbolic',
            '+1 min',
            () => addOneMinute(button)
        );

        sessionControlsBox.add_child(stopBtn);
        sessionControlsBox.add_child(pauseBtn);
        sessionControlsBox.add_child(sep);
        sessionControlsBox.add_child(addMinBtn);
        sessionControlsItem.add_child(sessionControlsBox);
        button.menu.addMenuItem(sessionControlsItem);
        button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // Custom Task & Custom Minutes Input Row (in the same row)
    const customTaskItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const customTaskBox = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 6px;'});

    const customInputsRow = new St.BoxLayout({x_expand: true, style: 'spacing: 6px; align-items: center;'});

    const customTaskEntry = new St.Entry({
        hint_text: 'Custom task title',
        x_expand: true,
        can_focus: true,
        style: 'min-width: 180px;',
    });
    if (button._customTaskText)
        customTaskEntry.set_text(button._customTaskText);

    const customMinutesEntry = new St.Entry({
        hint_text: 'Min',
        input_purpose: Clutter.InputContentPurpose.DIGITS,
        can_focus: true,
        style: 'width: 52px; min-width: 44px; text-align: center;',
    });
    if (button._customMinutesText)
        customMinutesEntry.set_text(button._customMinutesText);

    customInputsRow.add_child(customTaskEntry);
    customInputsRow.add_child(customMinutesEntry);
    customTaskBox.add_child(customInputsRow);

    // Google Tasks list selector (for custom tasks)
    const listContainer = new St.BoxLayout({vertical: true, x_expand: true, style: 'spacing: 4px; padding-top: 2px;'});
    const listHeading = new St.Label({
        text: 'Select Google Tasks list:',
        style: 'font-weight: bold; opacity: 0.8; font-size: 0.85em;',
    });
    listContainer.add_child(listHeading);

    const listButtonsBox = new St.BoxLayout({x_expand: true, style: 'spacing: 4px;'});

    if (button._allLists.length === 0) {
        const noListsLabel = new St.Label({
            text: 'No lists available (refresh tasks)',
            style: 'opacity: 0.6; font-size: 0.85em;',
        });
        listButtonsBox.add_child(noListsLabel);
    } else {
        if (!button._selectedCustomListId && button._allLists.length > 0)
            button._selectedCustomListId = button._allLists[0].id;

        for (const listObj of button._allLists) {
            const isSelected = (listObj.id === button._selectedCustomListId);
            const listBtn = new St.Button({
                label: listObj.title,
                style_class: 'button',
                can_focus: true,
            });
            listBtn.style = isSelected
                ? 'background-color: rgba(53, 132, 228, 0.75); color: white; font-size: 0.85em;'
                : 'font-size: 0.85em;';

            listBtn.connect('clicked', () => {
                button._selectedCustomListId = listObj.id;
                button._buildMenu();
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
        button._customTaskText = currentText;
        listContainer.visible = currentText.trim().length > 0;
    });

    customTaskItem.add_child(customTaskBox);
    button.menu.addMenuItem(customTaskItem);

    // Predefined Timers Row (placed BELOW the task & minutes inputs)
    const predefinedControls = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const predefinedBox = new St.BoxLayout({x_expand: true, style: 'spacing: 4px;'});
    const predefinedButtons = [];

    const updateTimerSelectionUI = () => {
        selection.label.text = getSelectionLabelText();
        selection.label.style = (button._duration === null && !button._focus)
            ? 'opacity: 0.65;'
            : 'color: #78e3ff; font-weight: bold;';

        for (const { val, btn } of predefinedButtons) {
            btn.style = selectionStyle(val === button._duration);
        }
    };

    for (const value of [15, 25, 30, 60]) {
        const buttonEl = new St.Button({label: `${value}m`, style_class: 'button', can_focus: true});
        buttonEl.style = selectionStyle(value === button._duration);
        buttonEl.connect('clicked', () => {
            customMinutesEntry.set_text('');
            selectDuration(button, value);
        });
        predefinedButtons.push({ val: value, btn: buttonEl });
        predefinedBox.add_child(buttonEl);
    }
    const stopwatch = new St.Button({label: 'Stopwatch', style_class: 'button', can_focus: true});
    stopwatch.style = selectionStyle(button._duration === 0);
    stopwatch.connect('clicked', () => {
        customMinutesEntry.set_text('');
        selectDuration(button, 0);
    });
    predefinedButtons.push({ val: 0, btn: stopwatch });
    predefinedBox.add_child(stopwatch);
    predefinedControls.add_child(predefinedBox);
    button.menu.addMenuItem(predefinedControls);

    // Custom Minutes input event: automatically updates duration when typed
    customMinutesEntry.clutter_text.connect('text-changed', () => {
        const rawText = customMinutesEntry.get_text().trim();
        button._customMinutesText = rawText;
        if (rawText.length > 0) {
            const minutes = Number.parseInt(rawText, 10);
            if (Number.isInteger(minutes) && minutes >= 1 && minutes <= 480) {
                button._duration = minutes;
            } else {
                button._duration = null;
            }
        } else {
            button._duration = null;
        }
        updateTimerSelectionUI();
    });

    const onStartCustomTask = () => {
        const taskTitle = customTaskEntry.get_text().trim();
        if (!taskTitle)
            return;

        const rawMins = customMinutesEntry.get_text().trim();
        if (rawMins) {
            const mins = Number.parseInt(rawMins, 10);
            if (Number.isInteger(mins) && mins >= 1 && mins <= 480) {
                button._duration = mins;
            }
        }

        if (button._duration === null)
            button._duration = 25;

        const targetListId = button._selectedCustomListId || (button._allLists[0]?.id);

        button._selectedTask = {
            id: `custom_${Date.now()}`,
            title: taskTitle,
        };
        button._customTaskText = '';
        button._customMinutesText = '';

        startFocus(button, taskTitle);

        if (targetListId)
            createGoogleTask(button._session, targetListId, taskTitle, () => fetchTasks(button));
    };

    customTaskEntry.clutter_text.connect('activate', () => onStartCustomTask());
    customMinutesEntry.clutter_text.connect('activate', () => {
        if (customTaskEntry.get_text().trim().length > 0) {
            onStartCustomTask();
        } else if (button._selectedTask) {
            tryStartFocus(button);
        }
    });

    button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Selected Task (if any)
    if (button._selectedTask) {
        const selectedItem = createTaskMenuItem(button, {
            id: button._selectedTask.id,
            title: button._selectedTask.title || '(Untitled task)',
            displayTitle: button._selectedTask.displayTitle,
            listId: button._selectedTask.listId || findListIdForTask(button, button._selectedTask.id),
        }, { isSelected: true });
        button.menu.addMenuItem(selectedItem);
        button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    // Google Tasks Lists
    if (!button._tasks.length) {
        const message = new PopupMenu.PopupMenuItem('No tasks loaded — configure Google Tasks first.', {reactive: false});
        message.label.clutter_text.line_wrap = true;
        button.menu.addMenuItem(message);
    } else {
        const searchItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const searchEntry = new St.Entry({
            hint_text: '🔍 Search tasks…',
            x_expand: true,
            can_focus: true,
            style: 'margin: 2px 0;',
        });
        if (button._taskSearchText)
            searchEntry.set_text(button._taskSearchText);
        searchItem.add_child(searchEntry);
        button.menu.addMenuItem(searchItem);

        const taskList = new PopupMenu.PopupMenuSection();
        const listsData = [];
        let hasRemainingTasks = false;

        for (const list of button._tasks) {
            const remainingTasks = list.tasks.filter(task => task.id !== button._selectedTask?.id);
            if (!remainingTasks.length)
                continue;
            hasRemainingTasks = true;
            const heading = new PopupMenu.PopupMenuItem(list.title || 'Untitled list', {reactive: false});
            heading.label.style = 'font-weight: bold; opacity: 0.8;';
            taskList.addMenuItem(heading);

            const listItems = [];
            for (const task of remainingTasks) {
                const item = createTaskMenuItem(button, {
                    id: task.id,
                    title: task.title || 'Untitled task',
                    displayTitle: task.displayTitle,
                    listId: task.listId || list.id,
                });
                taskList.addMenuItem(item);
                listItems.push({
                    item,
                    title: (task.title || '').toLowerCase(),
                });
            }
            listsData.push({ heading, listItems });
        }

        const noMatchesItem = new PopupMenu.PopupMenuItem('No tasks found matching search', {reactive: false});
        noMatchesItem.label.style = 'opacity: 0.6; font-size: 0.9em;';
        noMatchesItem.actor.visible = false;
        taskList.addMenuItem(noMatchesItem);

        const updateFilter = () => {
            const query = (button._taskSearchText || '').trim().toLowerCase();
            let totalVisible = 0;
            for (const { heading, listItems } of listsData) {
                let listVisibleCount = 0;
                for (const { item, title } of listItems) {
                    const matches = !query || title.includes(query);
                    item.actor.visible = matches;
                    if (matches)
                        listVisibleCount++;
                }
                heading.actor.visible = (listVisibleCount > 0);
                totalVisible += listVisibleCount;
            }
            noMatchesItem.actor.visible = (totalVisible === 0 && query.length > 0);
        };

        searchEntry.clutter_text.connect('text-changed', () => {
            button._taskSearchText = searchEntry.get_text();
            updateFilter();
        });

        updateFilter();

        if (hasRemainingTasks) {
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
            button.menu.addMenuItem(scrollItem);
        }
    }
    button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

    // Refresh Tasks Button
    const refreshItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const refresh = new St.Button({
        label: button._isLoadingTasks ? 'Refreshing tasks…' : 'Refresh tasks',
        style_class: 'button',
        x_expand: true,
        can_focus: !button._isLoadingTasks,
        reactive: !button._isLoadingTasks,
    });
    refresh.connect('clicked', () => fetchTasks(button, {notifyResult: true}));
    refreshItem.add_child(refresh);
    button.menu.addMenuItem(refreshItem);
}
