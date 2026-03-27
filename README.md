# 📌 Sticky Notes & Reminders for VS Code

Pin sticky notes directly onto lines of code and set time-based reminders — without leaving your editor.

---

## ✨ Features

### 📌 Sticky Notes
- Add color-coded notes to **any line** of any file
- Notes display as **inline preview text** right next to the code
- **Gutter icons** (colored pins) show where notes live at a glance
- Notes persist across sessions — stored in your workspace
- Notes **auto-adjust** when you add or remove lines above them
- Full **multi-line** note support (use `\n` to add line breaks in the input box)

### ⏰ Reminders
- Set reminders on any sticky note
- Quick presets: 15 minutes, 1 hour, 4 hours, Tomorrow morning
- Custom date/time input
- VS Code notification fires when reminder triggers, with options to:
  - **Open File** — jump straight to the note
  - **Snooze 15 min** — push it back
  - **Dismiss** — mark reminder done

### 🗂️ Sidebar Panel
- Dedicated **Activity Bar panel** showing all notes grouped by file
- Click any note to jump to it instantly
- Inline action buttons: Edit ✏️, Set Reminder ⏰, Delete 🗑️
- Status bar counter shows total notes and pending reminders

---

## 🚀 Installation

### Option A — Install from VSIX
1. Download or build the `.vsix` file
2. Open VS Code → Extensions → `...` menu → **Install from VSIX...**
3. Select the file and reload

### Option B — Development mode
1. Open this folder in VS Code
2. Press `F5` to launch the Extension Development Host

---

## ⌨️ Commands & Shortcuts

| Action              | Shortcut               | Right-click menu |
|---------------------|------------------------|------------------|
| Add Sticky Note     | `Ctrl+Shift+N`         | ✅               |
| Edit Note           | —                      | ✅               |
| Delete Note         | —                      | ✅               |
| Set Reminder        | —                      | ✅               |
| Show All Notes      | `Ctrl+Shift+M`         | —                |

All commands are also accessible via the **Command Palette** (`Ctrl+Shift+P`) — search for `Sticky Notes`.

---

## ⚙️ Settings

| Setting                      | Default     | Description                              |
|------------------------------|-------------|------------------------------------------|
| `stickyNotes.noteColor`      | `#FFD700`   | Default note gutter color               |
| `stickyNotes.reminderColor`  | `#FF6B6B`   | Reminder indicator color                |
| `stickyNotes.showInlineText` | `true`      | Show note preview inline in the editor  |

---

## 🎨 Note Colors

Choose from 6 colors when adding a note:
🟡 Yellow · 🔵 Blue · 🟢 Green · 🔴 Red · 🟣 Purple · 🟠 Orange

---

## 💡 Tips

- Notes are **workspace-scoped** — each project has its own set of notes
- Renaming files? Notes follow automatically
- Notes adjust when you add/delete lines
- Use the sidebar to quickly review all outstanding notes before a commit

---

## 📦 Building the VSIX

```bash
npm install -g @vscode/vsce
cd sticky-notes-vscode
vsce package
```

This produces a `sticky-notes-reminders-1.0.0.vsix` you can install anywhere.
