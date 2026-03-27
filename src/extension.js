const vscode = require("vscode");
const path = require("path");
const crypto = require("crypto");

// ─── Data Model ────────────────────────────────────────────────────────────────
// Note: { id, filePath, line, text, color, createdAt, reminder: { date, fired } }

const STORAGE_KEY = "stickyNotes.notes";

let notes = [];
let context_ref;
let decorationTypes = {};
let reminderTimers = {};
let treeDataProvider;
let statusBarItem;

// ─── Note Colors ───────────────────────────────────────────────────────────────
const NOTE_COLORS = [
  { label: "🟡 Yellow", value: "#FFD700", bg: "#FFF9C4" },
  { label: "🔵 Blue",   value: "#4FC3F7", bg: "#E1F5FE" },
  { label: "🟢 Green",  value: "#81C784", bg: "#E8F5E9" },
  { label: "🔴 Red",    value: "#E57373", bg: "#FFEBEE" },
  { label: "🟣 Purple", value: "#CE93D8", bg: "#F3E5F5" },
  { label: "🟠 Orange", value: "#FFB74D", bg: "#FFF3E0" },
];

// ─── Decoration Types ──────────────────────────────────────────────────────────
function createDecorations() {
  Object.values(decorationTypes).forEach((d) => d.dispose());
  decorationTypes = {};

  NOTE_COLORS.forEach(({ value, bg }) => {
    decorationTypes[value] = {
      normal: vscode.window.createTextEditorDecorationType({
        gutterIconPath: buildSvgIcon(value, false),
        gutterIconSize: "contain",
        isWholeLine: false,
        after: {
          margin: "0 0 0 16px",
          color: new vscode.ThemeColor("editorCodeLens.foreground"),
        },
      }),
      reminder: vscode.window.createTextEditorDecorationType({
        gutterIconPath: buildSvgIcon(value, true),
        gutterIconSize: "contain",
        isWholeLine: false,
        after: {
          margin: "0 0 0 16px",
          color: "#FF6B6B",
        },
      }),
    };
  });
}

function buildSvgIcon(color, hasReminder) {
  const badge = hasReminder
    ? `<circle cx="14" cy="4" r="4" fill="#FF6B6B"/><text x="14" y="7" text-anchor="middle" font-size="5" fill="white">!</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18">
    <rect x="2" y="1" width="13" height="13" rx="2" fill="${color}" opacity="0.9"/>
    <line x1="5" y1="5" x2="12" y2="5" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="5" y1="8" x2="12" y2="8" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <line x1="5" y1="11" x2="9"  y2="11" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <polygon points="15,10 12,14 15,14" fill="${color}" opacity="0.9"/>
    ${badge}
  </svg>`;
  return vscode.Uri.parse(
    "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64")
  );
}

// ─── Storage ───────────────────────────────────────────────────────────────────
function loadNotes() {
  notes = context_ref.workspaceState.get(STORAGE_KEY, []);
}

function saveNotes() {
  context_ref.workspaceState.update(STORAGE_KEY, notes);
}

function generateId() {
  return crypto.randomBytes(6).toString("hex");
}

// ─── Apply Decorations ─────────────────────────────────────────────────────────
function applyDecorations(editor) {
  if (!editor) return;

  const filePath = editor.document.uri.fsPath;
  const fileNotes = notes.filter((n) => n.filePath === filePath);
  const config = vscode.workspace.getConfiguration("stickyNotes");
  const showInline = config.get("showInlineText", true);

  // Group by color + type
  const buckets = {};
  NOTE_COLORS.forEach(({ value }) => {
    buckets[value] = { normal: [], reminder: [] };
  });

  fileNotes.forEach((note) => {
    const color = note.color || "#FFD700";
    if (!buckets[color]) buckets[color] = { normal: [], reminder: [] };
    const hasReminder = note.reminder && !note.reminder.fired;
    const kind = hasReminder ? "reminder" : "normal";

    const line = note.line;
    if (line < editor.document.lineCount) {
      const range = new vscode.Range(line, 0, line, 0);
      const preview = note.text.split("\n")[0].slice(0, 60);
      const reminderLabel = hasReminder
        ? `  ⏰ ${formatReminderDate(note.reminder.date)}`
        : "";

      buckets[color][kind].push({
        range,
        hoverMessage: new vscode.MarkdownString(
          `**📌 Sticky Note**\n\n${note.text}${
            hasReminder
              ? `\n\n---\n⏰ **Reminder:** ${formatReminderDate(note.reminder.date)}`
              : ""
          }\n\n*Created: ${new Date(note.createdAt).toLocaleString()}*`
        ),
        renderOptions: showInline
          ? {
              after: {
                contentText: `  📌 ${preview}${note.text.length > 60 ? "…" : ""}${reminderLabel}`,
                fontStyle: "italic",
                color: new vscode.ThemeColor("editorCodeLens.foreground"),
              },
            }
          : {},
      });
    }
  });

  NOTE_COLORS.forEach(({ value }) => {
    const dt = decorationTypes[value];
    if (!dt) return;
    editor.setDecorations(dt.normal, buckets[value]?.normal || []);
    editor.setDecorations(dt.reminder, buckets[value]?.reminder || []);
  });
}

function applyDecorationsAll() {
  vscode.window.visibleTextEditors.forEach(applyDecorations);
  updateStatusBar();
}

// ─── Status Bar ────────────────────────────────────────────────────────────────
function updateStatusBar() {
  const total = notes.length;
  const reminders = notes.filter((n) => n.reminder && !n.reminder.fired).length;
  if (total === 0) {
    statusBarItem.text = "$(pin) No sticky notes";
  } else {
    statusBarItem.text = `$(pin) ${total} note${total !== 1 ? "s" : ""}${
      reminders > 0 ? `  $(bell) ${reminders}` : ""
    }`;
  }
  statusBarItem.tooltip = "Click to show all sticky notes";
  statusBarItem.show();
}

// ─── Reminder System ───────────────────────────────────────────────────────────
function scheduleReminders() {
  // Clear existing
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};

  const now = Date.now();
  notes.forEach((note) => {
    if (!note.reminder || note.reminder.fired) return;
    const delay = new Date(note.reminder.date).getTime() - now;
    if (delay <= 0) {
      // Fire immediately if overdue
      fireReminder(note);
    } else {
      reminderTimers[note.id] = setTimeout(() => fireReminder(note), delay);
    }
  });
}

function fireReminder(note) {
  const fileName = path.basename(note.filePath);
  const preview = note.text.split("\n")[0].slice(0, 80);

  vscode.window
    .showInformationMessage(
      `⏰ Reminder — ${fileName}:${note.line + 1}\n"${preview}"`,
      "Open File",
      "Snooze 15min",
      "Dismiss"
    )
    .then((action) => {
      if (action === "Open File") {
        openNoteInEditor(note);
      } else if (action === "Snooze 15min") {
        const newDate = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        note.reminder = { date: newDate, fired: false };
        saveNotes();
        scheduleReminders();
        applyDecorationsAll();
        treeDataProvider?.refresh();
      } else {
        // Dismiss — mark fired
        note.reminder.fired = true;
        saveNotes();
        applyDecorationsAll();
        treeDataProvider?.refresh();
      }
    });
}

function formatReminderDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Navigation ────────────────────────────────────────────────────────────────
async function openNoteInEditor(note) {
  const uri = vscode.Uri.file(note.filePath);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const line = Math.min(note.line, doc.lineCount - 1);
  const pos = new vscode.Position(line, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdAddNote(noteToEdit) {
  const editor = vscode.window.activeTextEditor;
  let filePath, line;

  if (noteToEdit) {
    // Editing existing note
    filePath = noteToEdit.filePath;
    line = noteToEdit.line;
  } else if (editor) {
    filePath = editor.document.uri.fsPath;
    line = editor.selection.active.line;
  } else {
    vscode.window.showWarningMessage("Open a file to add a sticky note.");
    return;
  }

  // Pick color
  const colorPick = await vscode.window.showQuickPick(
    NOTE_COLORS.map((c) => ({ label: c.label, value: c.value })),
    { placeHolder: noteToEdit ? "Change color" : "Choose note color", title: "Sticky Note Color" }
  );
  if (!colorPick) return;

  // Enter text
  const existingText = noteToEdit ? noteToEdit.text : "";
  const text = await vscode.window.showInputBox({
    prompt: "Enter your sticky note (supports multiple lines with \\n)",
    value: existingText,
    placeHolder: "Note text...",
    title: noteToEdit ? "Edit Sticky Note" : "Add Sticky Note",
    validateInput: (v) => (v.trim() ? null : "Note cannot be empty"),
  });
  if (text === undefined) return;

  const finalText = text.replace(/\\n/g, "\n");

  if (noteToEdit) {
    noteToEdit.text = finalText;
    noteToEdit.color = colorPick.value;
  } else {
    const note = {
      id: generateId(),
      filePath,
      line,
      text: finalText,
      color: colorPick.value,
      createdAt: new Date().toISOString(),
      reminder: null,
    };
    notes.push(note);
  }

  saveNotes();
  applyDecorationsAll();
  treeDataProvider?.refresh();
  vscode.window.showInformationMessage(
    `📌 Note ${noteToEdit ? "updated" : "added"} on line ${line + 1}`
  );
}

async function cmdEditNote(treeItem) {
  let note = treeItem?.note;
  if (!note) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const line = editor.selection.active.line;
    const filePath = editor.document.uri.fsPath;
    note = notes.find((n) => n.filePath === filePath && n.line === line);
    if (!note) {
      vscode.window.showWarningMessage("No sticky note on this line.");
      return;
    }
  }
  await cmdAddNote(note);
}

async function cmdDeleteNote(treeItem) {
  let note = treeItem?.note;
  if (!note) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const line = editor.selection.active.line;
    const filePath = editor.document.uri.fsPath;
    const lineNotes = notes.filter(
      (n) => n.filePath === filePath && n.line === line
    );
    if (lineNotes.length === 0) {
      vscode.window.showWarningMessage("No sticky note on this line.");
      return;
    }
    if (lineNotes.length === 1) {
      note = lineNotes[0];
    } else {
      const pick = await vscode.window.showQuickPick(
        lineNotes.map((n) => ({
          label: n.text.split("\n")[0].slice(0, 60),
          note: n,
        })),
        { placeHolder: "Select note to delete" }
      );
      if (!pick) return;
      note = pick.note;
    }
  }

  const confirm = await vscode.window.showWarningMessage(
    `Delete this note? "${note.text.split("\n")[0].slice(0, 50)}"`,
    { modal: true },
    "Delete"
  );
  if (confirm !== "Delete") return;

  notes = notes.filter((n) => n.id !== note.id);
  if (reminderTimers[note.id]) {
    clearTimeout(reminderTimers[note.id]);
    delete reminderTimers[note.id];
  }
  saveNotes();
  applyDecorationsAll();
  treeDataProvider?.refresh();
  vscode.window.showInformationMessage("🗑️ Note deleted.");
}

async function cmdSetReminder(treeItem) {
  let note = treeItem?.note;
  if (!note) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const line = editor.selection.active.line;
    const filePath = editor.document.uri.fsPath;
    note = notes.find((n) => n.filePath === filePath && n.line === line);
    if (!note) {
      vscode.window.showWarningMessage(
        "No sticky note on this line. Add a note first."
      );
      return;
    }
  }

  const presets = [
    { label: "⏰ In 15 minutes",  ms: 15 * 60 * 1000 },
    { label: "⏰ In 1 hour",      ms: 60 * 60 * 1000 },
    { label: "⏰ In 4 hours",     ms: 4 * 60 * 60 * 1000 },
    { label: "⏰ Tomorrow morning", ms: null },
    { label: "📅 Custom date/time…", ms: "custom" },
    { label: "🚫 Remove reminder", ms: "remove" },
  ];

  const pick = await vscode.window.showQuickPick(presets, {
    placeHolder: "When should this reminder fire?",
    title: "Set Reminder",
  });
  if (!pick) return;

  let reminderDate;

  if (pick.ms === "remove") {
    note.reminder = null;
    if (reminderTimers[note.id]) {
      clearTimeout(reminderTimers[note.id]);
      delete reminderTimers[note.id];
    }
    saveNotes();
    applyDecorationsAll();
    treeDataProvider?.refresh();
    vscode.window.showInformationMessage("🔕 Reminder removed.");
    return;
  } else if (pick.ms === "custom") {
    const input = await vscode.window.showInputBox({
      prompt: "Enter date and time",
      placeHolder: "e.g. 2024-12-31 14:30",
      title: "Custom Reminder Date/Time",
      validateInput: (v) => {
        const d = new Date(v);
        if (isNaN(d.getTime())) return "Invalid date. Try format: YYYY-MM-DD HH:MM";
        if (d <= new Date()) return "Date must be in the future";
        return null;
      },
    });
    if (!input) return;
    reminderDate = new Date(input);
  } else if (pick.ms === null) {
    // Tomorrow 9am
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    reminderDate = tomorrow;
  } else {
    reminderDate = new Date(Date.now() + pick.ms);
  }

  note.reminder = { date: reminderDate.toISOString(), fired: false };
  saveNotes();
  scheduleReminders();
  applyDecorationsAll();
  treeDataProvider?.refresh();
  vscode.window.showInformationMessage(
    `⏰ Reminder set for ${formatReminderDate(reminderDate.toISOString())}`
  );
}

async function cmdClearAllNotes() {
  const confirm = await vscode.window.showWarningMessage(
    `Delete ALL ${notes.length} sticky notes in this workspace?`,
    { modal: true },
    "Delete All"
  );
  if (confirm !== "Delete All") return;
  Object.values(reminderTimers).forEach(clearTimeout);
  reminderTimers = {};
  notes = [];
  saveNotes();
  applyDecorationsAll();
  treeDataProvider?.refresh();
  vscode.window.showInformationMessage("🧹 All notes cleared.");
}

function cmdShowAllNotes() {
  vscode.commands.executeCommand("stickyNotesPanel.focus");
}

// ─── Tree View Provider ────────────────────────────────────────────────────────

class NoteTreeItem extends vscode.TreeItem {
  constructor(note, isFile = false, fileLabel = "", fileNotes = []) {
    if (isFile) {
      super(fileLabel, vscode.TreeItemCollapsibleState.Expanded);
      this.contextValue = "file";
      this.iconPath = new vscode.ThemeIcon("file-code");
      this.fileNotes = fileNotes;
      this.filePath = fileLabel;
    } else {
      const preview = note.text.split("\n")[0].slice(0, 50);
      super(
        `Line ${note.line + 1}: ${preview}${note.text.length > 50 ? "…" : ""}`,
        vscode.TreeItemCollapsibleState.None
      );
      this.note = note;
      this.contextValue = "note";
      this.description = note.reminder && !note.reminder.fired
        ? `⏰ ${formatReminderDate(note.reminder.date)}`
        : new Date(note.createdAt).toLocaleDateString();
      this.tooltip = new vscode.MarkdownString(
        `**Line ${note.line + 1}**\n\n${note.text}${
          note.reminder && !note.reminder.fired
            ? `\n\n---\n⏰ **Reminder:** ${formatReminderDate(note.reminder.date)}`
            : ""
        }`
      );
      this.command = {
        command: "stickyNotes.openNote",
        title: "Open Note",
        arguments: [note],
      };
      // Color badge in gutter icon
      const color = note.color || "#FFD700";
      const hasBell = note.reminder && !note.reminder.fired;
      this.iconPath = vscode.Uri.parse(
        "data:image/svg+xml;base64," +
          Buffer.from(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
              <rect x="1" y="1" width="11" height="11" rx="2" fill="${color}"/>
              ${hasBell ? '<circle cx="13" cy="3" r="3" fill="#FF6B6B"/>' : ""}
            </svg>`
          ).toString("base64")
      );
    }
  }
}

class StickyNotesTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  getChildren(element) {
    if (!element) {
      // Group by file
      const fileMap = {};
      notes.forEach((note) => {
        if (!fileMap[note.filePath]) fileMap[note.filePath] = [];
        fileMap[note.filePath].push(note);
      });

      if (Object.keys(fileMap).length === 0) {
        const empty = new vscode.TreeItem(
          "No sticky notes yet. Right-click in editor to add one!",
          vscode.TreeItemCollapsibleState.None
        );
        empty.iconPath = new vscode.ThemeIcon("info");
        return [empty];
      }

      return Object.entries(fileMap).map(([filePath, fileNotes]) => {
        const label = path.basename(filePath);
        return new NoteTreeItem(null, true, label, fileNotes.sort((a, b) => a.line - b.line));
      });
    }

    // File element — return its notes
    if (element.fileNotes) {
      return element.fileNotes.map((note) => new NoteTreeItem(note));
    }

    return [];
  }
}

// ─── Activation ────────────────────────────────────────────────────────────────
function activate(context) {
  context_ref = context;
  loadNotes();
  createDecorations();

  treeDataProvider = new StickyNotesTreeProvider();
  const treeView = vscode.window.createTreeView("stickyNotesPanel", {
    treeDataProvider,
    showCollapseAll: true,
  });

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusBarItem.command = "stickyNotes.showAllNotes";
  context.subscriptions.push(statusBarItem);
  updateStatusBar();

  // Register commands
  const cmds = [
    ["stickyNotes.addNote", cmdAddNote],
    ["stickyNotes.editNote", cmdEditNote],
    ["stickyNotes.deleteNote", cmdDeleteNote],
    ["stickyNotes.setReminder", cmdSetReminder],
    ["stickyNotes.showAllNotes", cmdShowAllNotes],
    ["stickyNotes.clearAllNotes", cmdClearAllNotes],
    ["stickyNotes.refreshNotes", () => { applyDecorationsAll(); treeDataProvider.refresh(); }],
    ["stickyNotes.openNote", openNoteInEditor],
  ];
  cmds.forEach(([id, fn]) => {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  });

  // Events
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor) applyDecorations(editor);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === e.document) {
        // Adjust note line numbers on edit
        const changes = e.contentChanges;
        changes.forEach((change) => {
          const startLine = change.range.start.line;
          const endLine = change.range.end.line;
          const addedLines = (change.text.match(/\n/g) || []).length;
          const removedLines = endLine - startLine;
          const delta = addedLines - removedLines;

          if (delta !== 0) {
            const filePath = e.document.uri.fsPath;
            notes.forEach((note) => {
              if (note.filePath === filePath && note.line > startLine) {
                note.line = Math.max(0, note.line + delta);
              }
            });
            saveNotes();
          }
        });
        applyDecorations(editor);
      }
    }),
    vscode.workspace.onDidRenameFiles((e) => {
      e.files.forEach(({ oldUri, newUri }) => {
        const oldPath = oldUri.fsPath;
        const newPath = newUri.fsPath;
        notes.forEach((note) => {
          if (note.filePath === oldPath) note.filePath = newPath;
        });
        saveNotes();
        treeDataProvider.refresh();
      });
    })
  );

  // Apply to all visible editors on start
  applyDecorationsAll();
  scheduleReminders();

  vscode.window.showInformationMessage(
    `📌 Sticky Notes & Reminders loaded — ${notes.length} note${notes.length !== 1 ? "s" : ""} in this workspace.`
  );
}

function deactivate() {
  Object.values(reminderTimers).forEach(clearTimeout);
  Object.values(decorationTypes).forEach((d) => {
    if (d.normal) d.normal.dispose();
    if (d.reminder) d.reminder.dispose();
  });
}

module.exports = { activate, deactivate };
