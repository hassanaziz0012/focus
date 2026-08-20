import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { AUTH_SCOPE, AUTH_URL, CONFIG_PATH, REDIRECT_URI, TOKEN_URL } from './lib/constants.js';

function loadConfig() {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        if (!file.query_exists(null))
            return {};
        const [ok, bytes] = file.load_contents(null);
        if (!ok || !bytes)
            return {};
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_) {
        return {};
    }
}

function saveConfig(config) {
    try {
        const file = Gio.File.new_for_path(CONFIG_PATH);
        const parent = file.get_parent();
        if (parent && !parent.query_exists(null))
            parent.make_directory_with_parents(null);
        const data = JSON.stringify(config, null, 2) + '\n';
        file.replace_contents(
            new TextEncoder().encode(data),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
        return true;
    } catch (err) {
        console.error('Focus Tasks: Failed saving credentials:', err.message);
        return false;
    }
}

async function exchangeAuthCode(session, clientId, clientSecret, code) {
    const form = `client_id=${encodeURIComponent(clientId)}&client_secret=${encodeURIComponent(clientSecret)}&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&grant_type=authorization_code`;
    const message = Soup.Message.new('POST', TOKEN_URL);
    message.set_request_body_from_bytes(
        'application/x-www-form-urlencoded',
        new GLib.Bytes(new TextEncoder().encode(form))
    );

    const bytes = await session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
    if (message.status_code !== Soup.Status.OK) {
        throw new Error(data.error_description || data.error || `HTTP ${message.status_code}`);
    }
    return data;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Focus Tasks - Connected</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      background: #0f172a;
      color: #f8fafc;
    }
    .card {
      text-align: center;
      max-width: 460px;
      padding: 40px;
      background: #1e293b;
      border-radius: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 48px;
      color: #38bdf8;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      margin: 0 0 12px;
      font-weight: 600;
    }
    p {
      font-size: 15px;
      color: #94a3b8;
      line-height: 1.5;
      margin: 0;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>Account Connected!</h1>
    <p>Focus Tasks is now authenticated with Google Tasks. You can close this tab and return to GNOME Shell.</p>
  </div>
</body>
</html>`;

export default class FocusTasksPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        let config = loadConfig();
        const session = new Soup.Session();
        let activeAuthServer = null;

        const cleanupAuthServer = () => {
            if (activeAuthServer) {
                try {
                    activeAuthServer.disconnect();
                } catch (_) {}
                activeAuthServer = null;
            }
        };

        window.connect('destroy', cleanupAuthServer);
        window.connect('close-request', cleanupAuthServer);

        // 1. Google Account Page
        const accountPage = new Adw.PreferencesPage({
            title: 'Google Account',
            icon_name: 'dialog-password-symbolic',
        });
        window.add(accountPage);

        // Status Group
        const statusGroup = new Adw.PreferencesGroup({
            title: 'Connection Status',
        });
        accountPage.add(statusGroup);

        const statusRow = new Adw.ActionRow({
            title: 'Status',
        });
        const statusIcon = new Gtk.Image({
            icon_name: config.refresh_token ? 'emblem-ok-symbolic' : 'dialog-warning-symbolic',
            valign: Gtk.Align.CENTER,
        });
        statusRow.add_prefix(statusIcon);

        const disconnectBtn = new Gtk.Button({
            label: 'Disconnect',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
            visible: Boolean(config.refresh_token),
        });
        statusRow.add_suffix(disconnectBtn);
        statusGroup.add(statusRow);

        const updateStatusUI = () => {
            config = loadConfig();
            const hasToken = Boolean(config.refresh_token);
            const hasClient = Boolean(config.client_id && config.client_secret);

            if (hasToken) {
                statusRow.subtitle = 'Connected to Google Tasks';
                statusIcon.icon_name = 'emblem-ok-symbolic';
                disconnectBtn.visible = true;
            } else if (hasClient) {
                statusRow.subtitle = 'Credentials entered — click Sign in with Google below';
                statusIcon.icon_name = 'dialog-warning-symbolic';
                disconnectBtn.visible = false;
            } else {
                statusRow.subtitle = 'Not connected — enter Client ID &amp; Secret below';
                statusIcon.icon_name = 'dialog-warning-symbolic';
                disconnectBtn.visible = false;
            }
        };
        updateStatusUI();

        // OAuth Group
        const authGroup = new Adw.PreferencesGroup({
            title: 'Google OAuth Setup',
            description: 'Enter your Google Cloud credentials, then click Sign in with Google.',
        });
        accountPage.add(authGroup);

        const clientIdRow = new Adw.EntryRow({
            title: 'Client ID',
            text: config.client_id || '',
        });
        authGroup.add(clientIdRow);

        const clientSecretRow = new Adw.PasswordEntryRow({
            title: 'Client Secret',
            text: config.client_secret || '',
        });
        authGroup.add(clientSecretRow);

        const signInActionRow = new Adw.ActionRow({
            title: 'Authenticate Account',
            subtitle: 'Opens Google sign-in in your browser and connects securely',
        });

        const authControlsBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 8,
            valign: Gtk.Align.CENTER,
        });

        const spinner = new Gtk.Spinner({
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        authControlsBox.append(spinner);

        const cancelBtn = new Gtk.Button({
            label: 'Cancel',
            valign: Gtk.Align.CENTER,
            visible: false,
        });
        authControlsBox.append(cancelBtn);

        const signInBtn = new Gtk.Button({
            label: 'Sign in with Google',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        authControlsBox.append(signInBtn);
        signInActionRow.add_suffix(authControlsBox);
        authGroup.add(signInActionRow);

        const setAuthProgress = (inProgress, message = null) => {
            spinner.visible = inProgress;
            if (inProgress) spinner.start();
            else spinner.stop();
            cancelBtn.visible = inProgress;
            signInBtn.sensitive = !inProgress;
            clientIdRow.sensitive = !inProgress;
            clientSecretRow.sensitive = !inProgress;
            if (message) {
                signInActionRow.subtitle = message;
            }
        };

        cancelBtn.connect('clicked', () => {
            cleanupAuthServer();
            setAuthProgress(false, 'Sign-in cancelled.');
        });

        // Advanced Manual Token Entry (Expander)
        const advancedGroup = new Adw.PreferencesGroup({
            title: 'Advanced',
        });
        accountPage.add(advancedGroup);

        const advancedExpander = new Adw.ExpanderRow({
            title: 'Manual Credentials &amp; Storage',
            subtitle: 'Directly view or manually edit stored tokens (~/.config/focus-tasks/config.json)',
        });
        advancedGroup.add(advancedExpander);

        const refreshTokenRow = new Adw.PasswordEntryRow({
            title: 'Refresh Token',
            text: config.refresh_token || '',
        });
        advancedExpander.add_row(refreshTokenRow);

        const manualSaveRow = new Adw.ActionRow({
            title: 'Save Manually',
            subtitle: 'Save text inputs above directly to disk',
        });
        const manualSaveBtn = new Gtk.Button({
            label: 'Save',
            valign: Gtk.Align.CENTER,
        });
        manualSaveBtn.connect('clicked', () => {
            const updated = {
                ...loadConfig(),
                client_id: clientIdRow.get_text().trim(),
                client_secret: clientSecretRow.get_text().trim(),
                refresh_token: refreshTokenRow.get_text().trim(),
            };
            const success = saveConfig(updated);
            updateStatusUI();
            if (success) {
                manualSaveRow.subtitle = 'Credentials saved successfully.';
            } else {
                manualSaveRow.subtitle = 'Error saving credentials to disk.';
            }
        });
        manualSaveRow.add_suffix(manualSaveBtn);
        advancedExpander.add_row(manualSaveRow);

        signInBtn.connect('clicked', () => {
            const clientId = clientIdRow.get_text().trim();
            const clientSecret = clientSecretRow.get_text().trim();

            if (!clientId || !clientSecret) {
                signInActionRow.subtitle = 'Please enter both Client ID and Client Secret first.';
                return;
            }

            // Save client ID and secret first
            saveConfig({
                ...loadConfig(),
                client_id: clientId,
                client_secret: clientSecret,
            });

            cleanupAuthServer();

            try {
                const server = new Soup.Server();
                const state = GLib.uuid_string_random ? GLib.uuid_string_random() : `${Date.now()}_${Math.random().toString(36).slice(2)}`;

                server.add_handler('/callback', (_server, msg, _path, query) => {
                    const queryMap = query || {};
                    const receivedState = queryMap.state;
                    const code = queryMap.code;
                    const error = queryMap.error;

                    if (error) {
                        msg.set_status(Soup.Status.OK, null);
                        msg.get_response_headers().set_content_type('text/html; charset=utf-8', null);
                        msg.get_response_body().append_bytes(new GLib.Bytes(new TextEncoder().encode(`<h1>Authentication failed</h1><p>${error}</p>`)));
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            cleanupAuthServer();
                            setAuthProgress(false, `Google authentication error: ${error}`);
                            return GLib.SOURCE_REMOVE;
                        });
                        return;
                    }

                    if (!receivedState || receivedState !== state || !code) {
                        msg.set_status(Soup.Status.BAD_REQUEST, null);
                        msg.get_response_headers().set_content_type('text/html; charset=utf-8', null);
                        msg.get_response_body().append_bytes(new GLib.Bytes(new TextEncoder().encode('<h1>Invalid callback state</h1>')));
                        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                            cleanupAuthServer();
                            setAuthProgress(false, 'Authorization state mismatch.');
                            return GLib.SOURCE_REMOVE;
                        });
                        return;
                    }

                    msg.set_status(Soup.Status.OK, null);
                    msg.get_response_headers().set_content_type('text/html; charset=utf-8', null);
                    msg.get_response_body().append_bytes(new GLib.Bytes(new TextEncoder().encode(SUCCESS_HTML)));

                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                        (async () => {
                            try {
                                setAuthProgress(true, 'Exchanging authorization code with Google…');
                                const tokenData = await exchangeAuthCode(session, clientId, clientSecret, code);

                                if (!tokenData.refresh_token) {
                                    throw new Error('No refresh token returned by Google (was offline access granted?)');
                                }

                                const updated = {
                                    ...loadConfig(),
                                    client_id: clientId,
                                    client_secret: clientSecret,
                                    refresh_token: tokenData.refresh_token,
                                };
                                saveConfig(updated);

                                refreshTokenRow.set_text(tokenData.refresh_token);
                                updateStatusUI();
                                cleanupAuthServer();
                                setAuthProgress(false, 'Connected successfully! Google Tasks is ready.');
                            } catch (err) {
                                cleanupAuthServer();
                                setAuthProgress(false, `Token exchange failed: ${err.message}`);
                            }
                        })();
                        return GLib.SOURCE_REMOVE;
                    });
                });

                server.listen_local(8765, Soup.ServerListenOptions.IPV4_ONLY);
                activeAuthServer = server;

                const authParams = `client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(AUTH_SCOPE)}&access_type=offline&prompt=consent&state=${encodeURIComponent(state)}`;
                const authUrl = `${AUTH_URL}?${authParams}`;

                Gtk.show_uri(window, authUrl, 0);
                setAuthProgress(true, 'Waiting for sign-in approval in your browser…');
            } catch (err) {
                cleanupAuthServer();
                setAuthProgress(false, `Could not start local auth server: ${err.message}`);
            }
        });

        disconnectBtn.connect('clicked', () => {
            const current = loadConfig();
            delete current.refresh_token;
            saveConfig(current);
            refreshTokenRow.set_text('');
            updateStatusUI();
            signInActionRow.subtitle = 'Disconnected. Click Sign in with Google to reconnect.';
        });

        // Help Group
        const helpGroup = new Adw.PreferencesGroup({
            title: 'Google Cloud Setup Help',
            description: '1. Create a project in Google Cloud Console.\n' +
                         '2. Enable the "Google Tasks API" in APIs &amp; Services.\n' +
                         '3. In OAuth Consent Screen, configure as Desktop App (or external).\n' +
                         '4. Under Credentials, create an OAuth Client ID (Desktop application).\n' +
                         '5. Copy your Client ID and Client Secret into the fields above and click "Sign in with Google".',
        });
        accountPage.add(helpGroup);

        const openConsoleRow = new Adw.ActionRow({
            title: 'Google Cloud Console',
            subtitle: 'Open credentials page in default web browser',
        });
        const openConsoleBtn = new Gtk.Button({
            label: 'Open Console',
            valign: Gtk.Align.CENTER,
        });
        openConsoleBtn.connect('clicked', () => {
            Gtk.show_uri(window, 'https://console.cloud.google.com/apis/credentials', 0);
        });
        openConsoleRow.add_suffix(openConsoleBtn);
        helpGroup.add(openConsoleRow);

        // 2. Timer Preferences Page
        const timerPage = new Adw.PreferencesPage({
            title: 'Timer',
            icon_name: 'preferences-other-symbolic',
        });
        window.add(timerPage);

        const timerGroup = new Adw.PreferencesGroup({
            title: 'Timer Defaults',
            description: 'Configure default behavior for focus sessions.',
        });
        timerPage.add(timerGroup);

        const durationRow = new Adw.SpinRow({
            title: 'Default Duration (Minutes)',
            subtitle: 'Default time when launching a custom task without selecting a timer',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 480,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('default-duration-minutes'),
            }),
        });

        settings.bind(
            'default-duration-minutes',
            durationRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );
        timerGroup.add(durationRow);
    }
}
