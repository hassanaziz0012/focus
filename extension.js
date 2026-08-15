import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import { fetchTasks } from './lib/googleTasks.js';
import { stopFocus } from './lib/focusTimer.js';
import { buildTimerView } from './lib/timerView.js';
import { buildStatsView } from './lib/statsView.js';

const FocusButton = GObject.registerClass(
class FocusButton extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, 'Focus Tasks');
        this._extension = extension;
        this._session = new Soup.Session();
        // Default timer duration is null (unselected). 0 represents Stopwatch, > 0 represents minutes.
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

        this._sessionModeId = Main.sessionMode.connect('updated', () => this._onSessionModeChanged());
        this._onSessionModeChanged();

        this._buildMenu();
        fetchTasks(this);
    }

    _onSessionModeChanged() {
        const isUnlocked = Main.sessionMode.currentMode === 'user' && !Main.sessionMode.isLocked;
        this.visible = isUnlocked;
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

    _buildMenu() {
        this._clearMenu();

        if (this._currentView === 'stats') {
            buildStatsView(this);
        } else {
            buildTimerView(this);
        }
    }

    destroy() {
        this._isDestroyed = true;
        if (this._sessionModeId) {
            Main.sessionMode.disconnect(this._sessionModeId);
            this._sessionModeId = 0;
        }
        stopFocus(this, { completed: false });
        this._stopLoadingAnimation();
        this._session.abort();
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
