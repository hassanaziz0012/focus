import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { CONFIG_PATH } from './lib/constants.js';
import { fetchTasks } from './lib/googleTasks.js';
import { stopFocus } from './lib/focusTimer.js';
import { buildTimerView } from './lib/timerView.js';
import { buildStatsView } from './lib/statsView.js';

const FocusButton = GObject.registerClass(
class FocusButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Focus Tasks');
        this._extension = extension;
        this._settings = extension.getSettings();
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();

        this._duration = null;
        this._selectedTask = null;
        this._tasks = [];
        this._allLists = [];
        this._selectedCustomListId = null;
        this._taskSearchText = '';
        this._customTaskText = '';
        this._customMinutesText = '';
        this._tickId = 0;
        this._focus = null;
        this._isLoadingTasks = false;
        this._currentView = 'timer';
        this._statsFilter = 'week';

        this._panelBox = new St.BoxLayout({ style_class: 'panel-status-menu-box' });
        this._icon = new St.Icon({ icon_name: 'alarm-symbolic', style_class: 'system-status-icon' });
        this._panelLabel = new St.Label({ text: '', y_align: Clutter.ActorAlign.CENTER });
        this._panelBox.add_child(this._icon);
        this._panelBox.add_child(this._panelLabel);
        this.add_child(this._panelBox);

        this._buildMenu();
        fetchTasks(this);

        this.menu.connect('open-state-changed', (_menu, isOpen) => {
            if (isOpen && this._tasks.length === 0 && !this._isLoadingTasks) {
                fetchTasks(this);
            }
        });

        try {
            const configFile = Gio.File.new_for_path(CONFIG_PATH);
            const configParent = configFile.get_parent();
            if (configParent && !configParent.query_exists(null)) {
                configParent.make_directory_with_parents(null);
            }
            this._configMonitor = configFile.monitor_file(Gio.FileMonitorFlags.NONE, this._cancellable);
            this._configMonitorId = this._configMonitor.connect('changed', (_mon, _file, _otherFile, eventType) => {
                if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT || eventType === Gio.FileMonitorEvent.CREATED) {
                    fetchTasks(this);
                }
            });
        } catch (_) {}
    }

    _clearMenu() {
        this.menu.removeAll();
    }

    _buildMenu() {
        this._clearMenu();

        if (this._currentView === 'stats') {
            buildStatsView(this);
        } else {
            buildTimerView(this);
        }
    }

    destroy() {
        if (this._configMonitor) {
            if (this._configMonitorId) {
                this._configMonitor.disconnect(this._configMonitorId);
                this._configMonitorId = 0;
            }
            this._configMonitor.cancel();
            this._configMonitor = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        stopFocus(this, { completed: false });
        this._session.abort();
        this._settings = null;
        super.destroy();
    }
});

export default class FocusTasksExtension extends Extension {
    enable() {
        this._button = new FocusButton(this);
        Main.panel.addToStatusArea(this.uuid, this._button);
    }

    disable() {
        this._button.destroy();
        this._button = null;
    }
}
