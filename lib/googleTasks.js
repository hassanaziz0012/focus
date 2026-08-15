import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { TASKS_URL, TOKEN_URL } from './constants.js';
import { readConfig } from './utils.js';

export async function fetchAccessToken(session) {
    const config = readConfig();
    if (!config?.client_id || !config?.client_secret || !config?.refresh_token)
        throw new Error('Google account is not configured');
    const form = `client_id=${encodeURIComponent(config.client_id)}&client_secret=${encodeURIComponent(config.client_secret)}&refresh_token=${encodeURIComponent(config.refresh_token)}&grant_type=refresh_token`;
    const message = Soup.Message.new('POST', TOKEN_URL);
    message.set_request_body_from_bytes('application/x-www-form-urlencoded', new GLib.Bytes(new TextEncoder().encode(form)));
    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    if (message.status_code !== Soup.Status.OK)
        throw new Error('Could not refresh Google access token');
    return JSON.parse(new TextDecoder().decode(bytes.get_data())).access_token;
}

export async function getAllPages(session, url, token) {
    const items = [];
    let pageToken = null;
    do {
        const separator = url.includes('?') ? '&' : '?';
        const message = Soup.Message.new('GET', pageToken ? `${url}${separator}pageToken=${encodeURIComponent(pageToken)}` : url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.status_code !== Soup.Status.OK) throw new Error('Google Tasks request failed');
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
    if (button._isLoadingTasks)
        return;

    button._isLoadingTasks = true;
    button._startLoadingAnimation();
    button._buildMenu();
    try {
        const token = await fetchAccessToken(button._session);
        const lists = await getAllPages(button._session, TASKS_URL, token);
        button._allLists = lists.map(l => ({ id: l.id, title: l.title || 'Untitled list' }));
        if (!button._selectedCustomListId && button._allLists.length > 0)
            button._selectedCustomListId = button._allLists[0].id;
        button._tasks = await Promise.all(lists.map(async list => {
            const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?showCompleted=false&showHidden=false`;
            const fetched = await getAllPages(button._session, url, token);
            const ordered = sortTasksHierarchically(fetched);
            return {
                id: list.id,
                title: list.title,
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
        if (notifyResult && !button._isDestroyed)
            Main.notify('Tasks refreshed', 'Your Google Tasks list is up to date.');
    } catch (error) {
        log(`Focus Tasks: ${error.message}`);
        if (notifyResult && !button._isDestroyed)
            Main.notify('Could not refresh tasks', error.message || 'Please try again.');
    } finally {
        button._isLoadingTasks = false;
        button._stopLoadingAnimation();
        if (!button._isDestroyed)
            button._buildMenu();
    }
}

export async function createGoogleTask(session, listId, title, onComplete) {
    try {
        const token = await fetchAccessToken(session);
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`;
        const message = Soup.Message.new('POST', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        const body = JSON.stringify({ title });
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
        const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.status_code === Soup.Status.OK || message.status_code === 201) {
            log(`Focus Tasks: Custom task "${title}" created successfully in Google Tasks.`);
            if (onComplete) onComplete();
        } else {
            log(`Focus Tasks: Google Tasks API returned status code ${message.status_code} when creating task.`);
        }
    } catch (error) {
        log(`Focus Tasks: Error creating task in Google Tasks: ${error.message}`);
    }
}

export async function completeGoogleTask(session, listId, taskId) {
    if (!listId || !taskId || taskId.startsWith('custom_')) {
        log(`Focus Tasks: Cannot complete task without valid listId and taskId (${listId}, ${taskId})`);
        return;
    }
    try {
        const token = await fetchAccessToken(session);
        const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`;
        const message = Soup.Message.new('PATCH', url);
        message.request_headers.append('Authorization', `Bearer ${token}`);
        const body = JSON.stringify({ status: 'completed' });
        message.set_request_body_from_bytes('application/json', new GLib.Bytes(new TextEncoder().encode(body)));
        const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
        if (message.status_code === Soup.Status.OK || message.status_code === 201) {
            log(`Focus Tasks: Task "${taskId}" marked completed in Google Tasks.`);
        } else {
            log(`Focus Tasks: Google Tasks API returned status code ${message.status_code} when completing task.`);
        }
    } catch (error) {
        log(`Focus Tasks: Error completing task in Google Tasks: ${error.message}`);
    }
}
