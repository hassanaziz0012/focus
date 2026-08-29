import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

import { TASKS_URL, TOKEN_URL } from './constants.js';
import { readConfig, showNotification } from './utils.js';

export async function fetchAccessToken(session, cancellable = null) {
    const config = readConfig();
    const clientId = config?.client_id?.trim();
    const clientSecret = config?.client_secret?.trim();
    const refreshToken = config?.refresh_token?.trim();

    if (!clientId || !clientSecret || !refreshToken)
        throw new Error('Google account is not configured in preferences');

    const form = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&refresh_token=${encodeURIComponent(refreshToken)}&grant_type=refresh_token`;
    const message = Soup.Message.new('POST', TOKEN_URL);
    message.set_request_body_from_bytes(
        'application/x-www-form-urlencoded',
        new GLib.Bytes(new TextEncoder().encode(form))
    );

    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
    if (!bytes)
        throw new Error('No response from Google authentication server');

    if (message.status_code !== Soup.Status.OK) {
        try {
            const errData = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (errData.error_description)
                throw new Error(`Google Auth: ${errData.error_description}`);
            if (errData.error)
                throw new Error(`Google Auth: ${errData.error}`);
        } catch (e) {
            if (e.message?.startsWith('Google Auth:'))
                throw e;
        }
        throw new Error(`Could not refresh Google access token (HTTP ${message.status_code})`);
    }

    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    if (!data.access_token)
        throw new Error('Google authentication response missing access token');

    return data.access_token;
}

export async function getAllPages(session, url, token, cancellable = null) {
    const items = [];
    let pageToken = null;

    do {
        const separator = url.includes('?') ? '&' : '?';
        const pageUrl = pageToken ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}` : url;
        const message = Soup.Message.new('GET', pageUrl);
        message.request_headers.append('Authorization', `Bearer ${token}`);

        const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        if (!bytes)
            throw new Error('No response from Google Tasks server');

        if (message.status_code !== Soup.Status.OK) {
            try {
                const errData = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                if (errData.error?.message)
                    throw new Error(`Google Tasks: ${errData.error.message}`);
            } catch (e) {
                if (e.message?.startsWith('Google Tasks:'))
                    throw e;
            }
            throw new Error(`Google Tasks request failed (HTTP ${message.status_code})`);
        }

        const result = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        items.push(...(result.items || []));
        pageToken = result.nextPageToken || null;
    } while (pageToken);

    return items;
}

function sortTasksHierarchically(tasks) {
    const childrenByParent = new Map();
    for (const task of tasks) {
        const parentId = task.parent || null;
        if (!childrenByParent.has(parentId))
            childrenByParent.set(parentId, []);
        childrenByParent.get(parentId).push(task);
    }

    const comparePosition = (a, b) => {
        const posA = a.position || '';
        const posB = b.position || '';
        if (posA < posB) return -1;
        if (posA > posB) return 1;
        return 0;
    };

    for (const siblings of childrenByParent.values())
        siblings.sort(comparePosition);

    const ordered = [];
    function appendBranch(parentId, depth = 0) {
        const children = childrenByParent.get(parentId) || [];
        for (const child of children) {
            const prefix = depth > 0 ? `${'  '.repeat(depth)}└ ` : '';
            ordered.push({
                ...child,
                displayTitle: `${prefix}${child.title || 'Untitled task'}`,
            });
            appendBranch(child.id, depth + 1);
        }
    }

    appendBranch(null, 0);

    if (ordered.length < tasks.length) {
        const visited = new Set(ordered.map(t => t.id));
        const orphans = tasks.filter(t => !visited.has(t.id));
        orphans.sort(comparePosition);
        for (const orphan of orphans) {
            ordered.push({
                ...orphan,
                displayTitle: orphan.title || 'Untitled task',
            });
        }
    }

    return ordered;
}

export async function fetchTasks(button, { notifyResult = false } = {}) {
    if (button._isLoadingTasks || !button._cancellable || button._cancellable.is_cancelled())
        return;

    button._isLoadingTasks = true;
    button._buildMenu();

    try {
        const cancellable = button._cancellable;
        const token = await fetchAccessToken(button._session, cancellable);
        const lists = await getAllPages(button._session, TASKS_URL, token, cancellable);

        button._allLists = lists.map(l => ({ id: l.id, title: l.title || 'Untitled list' }));
        if (!button._selectedCustomListId && button._allLists.length > 0)
            button._selectedCustomListId = button._allLists[0].id;

        button._tasks = await Promise.all(lists.map(async list => {
            const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false`;
            const fetched = await getAllPages(button._session, url, token, cancellable);
            const ordered = sortTasksHierarchically(fetched);
            return {
                id: list.id,
                title: list.title || 'Untitled list',
                tasks: ordered.map(t => ({
                    id: t.id,
                    title: t.title || 'Untitled task',
                    displayTitle: t.displayTitle || t.title || 'Untitled task',
                    listId: list.id,
                })),
            };
        }));

        button._tasks = button._tasks.filter(list => list.tasks.length);

        if (button._selectedTask?.id?.startsWith('custom_')) {
            for (const list of button._tasks) {
                const match = list.tasks.find(t => t.id === button._selectedTask.id || t.title === button._selectedTask.title);
                if (match) {
                    button._selectedTask.id = match.id;
                    button._selectedTask.listId = list.id;
                    break;
                }
            }
        }

        if (notifyResult && button._cancellable && !button._cancellable.is_cancelled()) {
            const totalTasks = button._tasks.reduce((sum, l) => sum + l.tasks.length, 0);
            const msg = totalTasks > 0
                ? `${totalTasks} task${totalTasks === 1 ? '' : 's'} loaded from Google Tasks.`
                : 'Tasks refreshed. No uncompleted tasks found.';
            showNotification('Tasks Refreshed', msg);
        }
    } catch (error) {
        if (!button._cancellable || button._cancellable.is_cancelled() || error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            return;

        console.error('Focus Tasks error fetching tasks:', error.message || error);
        if (notifyResult)
            showNotification('Could not refresh tasks', error.message || 'Please check your preferences.');
    } finally {
        button._isLoadingTasks = false;
        if (button._cancellable && !button._cancellable.is_cancelled())
            button._buildMenu();
    }
}

export async function createGoogleTask(session, listId, title, cancellable = null, onComplete = null) {
    try {
        const token = await fetchAccessToken(session, cancellable);
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`;
        const message = Soup.Message.new('POST', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        const body = JSON.stringify({ title });
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body))
        );

        await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        if (message.status_code === Soup.Status.OK || message.status_code === 201) {
            if (onComplete) onComplete();
        } else {
            console.error('Focus Tasks: Google Tasks API returned status code', message.status_code);
        }
    } catch (error) {
        if (!cancellable || !cancellable.is_cancelled())
            console.error('Focus Tasks: Error creating task:', error.message);
    }
}

export async function completeGoogleTask(session, listId, taskId, cancellable = null) {
    if (!listId || !taskId || taskId.startsWith('custom_'))
        return;

    try {
        const token = await fetchAccessToken(session, cancellable);
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
        const message = Soup.Message.new('PATCH', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        const body = JSON.stringify({ status: 'completed' });
        message.set_request_body_from_bytes(
            'application/json',
            new GLib.Bytes(new TextEncoder().encode(body))
        );

        await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        if (message.status_code !== Soup.Status.OK && message.status_code !== 201)
            console.error('Focus Tasks: Google Tasks API returned status code', message.status_code);
    } catch (error) {
        if (!cancellable || !cancellable.is_cancelled())
            console.error('Focus Tasks: Error completing task:', error.message);
    }
}
