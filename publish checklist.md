# GNOME Shell Extensions (EGO) Publish Checklist & Fix Guide

This document lists all required changes, best practices, and submission guidelines needed before publishing **Focus Tasks** to [extensions.gnome.org (EGO)](https://extensions.gnome.org/).

Reference documentation:
- [Official GNOME Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html)
- [Official GNOME Extension Best Practices](https://gjs.guide/extensions/review-guidelines/best-practices.html)

---

## 1. Critical Review Guideline Fixes

### 🟢 1.1. `metadata.json` Cleanup & Corrections
File: [`metadata.json`](file:///home/hassan/Desktop/programming/focus/metadata.json)

- [x] **Fix UUID Namespace**
  - **Status:** Completed. Updated to `"uuid": "focus-tasks@hassandev.me"`.
- [x] **Supported `shell-version`s**
  - **Status:** Completed. Set to `["45", "46", "47", "48", "49", "50"]`.
- [x] **Remove `session-modes` & `unlock-dialog`**
  - **Status:** Completed. Dropped `session-modes` entirely so GNOME defaults to clean `user` session mode.
- [x] **Remove Deprecated `"version"` Key**
  - **Status:** Completed. Dropped from `metadata.json`.

---

### 🟢 1.2. Local User Storage (No `/var/log`)
File: [`lib/sessionLogger.js`](file:///home/hassan/Desktop/programming/focus/lib/sessionLogger.js)

- [x] **Use Standard XDG State Directory**
  - **Status:** Completed. Writes session history to `GLib.get_user_state_dir()/focus-tasks/focus.log` with legacy fallback support.

---

### 🟢 1.3. Eliminate Excessive Logging & Use `console.error`
Files: [`lib/sessionLogger.js`](file:///home/hassan/Desktop/programming/focus/lib/sessionLogger.js), [`lib/googleTasks.js`](file:///home/hassan/Desktop/programming/focus/lib/googleTasks.js)

- [x] **Remove Informational `log()` Calls**
  - **Status:** Completed. Removed all informational `log()` statements; errors now use `console.error()`.

---

### 🟢 1.4. Async Lifecycle Management with `Gio.Cancellable`
Files: [`extension.js`](file:///home/hassan/Desktop/programming/focus/extension.js), [`lib/googleTasks.js`](file:///home/hassan/Desktop/programming/focus/lib/googleTasks.js)

- [x] **Eliminate `this._isDestroyed` Flag Anti-Pattern**
  - **Status:** Completed. Initialized `this._cancellable = new Gio.Cancellable()`, passed through all async network requests, and cancelled cleanly in `destroy()`.

---

## 2. Best Practice & UI Improvements

### 🟢 2.1. Replace Emojis with Standard GNOME UI Icons
Files: [`lib/timerView.js`](file:///home/hassan/Desktop/programming/focus/lib/timerView.js), [`lib/statsView.js`](file:///home/hassan/Desktop/programming/focus/lib/statsView.js)

- [x] **Use `St.Icon` and Clean Labels**
  - **Status:** Completed. Stats button uses `view-paged-symbolic`, search entry uses standard clean placeholder text, and status messages avoid emoji characters.

---

### 🟢 2.2. GSettings Schema Integration
Files: [`schemas/org.gnome.shell.extensions.focus-tasks.gschema.xml`](file:///home/hassan/Desktop/programming/focus/schemas/org.gnome.shell.extensions.focus-tasks.gschema.xml), [`extension.js`](file:///home/hassan/Desktop/programming/focus/extension.js), [`lib/timerView.js`](file:///home/hassan/Desktop/programming/focus/lib/timerView.js)

- [x] **Connected GSettings to Extension & Timer**
  - **Status:** Completed. Extension loads `this.getSettings()`, passes default duration to `timerView.js`, and binds to `prefs.js`.

---

### 🟢 2.3. Native Preferences Window
File: [`prefs.js`](file:///home/hassan/Desktop/programming/focus/prefs.js)

- [x] **Implemented Adwaita Preferences Window (`Adw.PreferencesWindow`)**
  - **Status:** Completed. Provides GTK4/Adwaita settings for Google OAuth credentials (Client ID, Client Secret, Refresh Token) and default timer duration.

---

### 🟢 2.4. Cleaned Code & AI Artifacts
Files: All `lib/*.js`

- [x] **Removed Numbered / LLM-style Step Comments**
  - **Status:** Completed.

---

## 3. Extension Packaging

- [x] **Created Automated Packaging Script**: [`package.sh`](file:///home/hassan/Desktop/programming/focus/package.sh)
  - Compiles schemas using `glib-compile-schemas`.
  - Packages only required files (`metadata.json`, `extension.js`, `prefs.js`, `lib/`, `schemas/`).
  - Output file: `focus-tasks@hassandev.me.shell-extension.zip`.

Run anytime before publishing:
```bash
./package.sh
```
