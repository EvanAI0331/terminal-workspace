# Terminal Workspace

Terminal Workspace is a cross-project multi-terminal desktop app for developers who move between many local repos, services, and task runners.

It is built for the workflow where one project is never enough: frontend, backend, scripts, logs, workers, docs, and probes all need separate shells, but they should still live in one coherent workspace.

![Terminal Workspace running](./terminal-workspace-1440.png)

## Why

Warp is polished, but Terminal Workspace is optimized for cross-project terminal management:

- Manage multiple projects from one desktop window.
- Keep separate external macOS Terminal windows organized by project.
- Restore terminal state and recent command context.
- Probe project services, env files, tasks, workflows, docs, and subproject roots.
- Resize each terminal panel independently.
- Save and copy each terminal's launch command without mixing commands across projects.
- Use a native macOS-style Electron shell as a lightweight terminal launcher and command dashboard.

## Features

- External macOS Terminal launching without process ownership
- Project sidebar with terminal shell entries and recent sessions
- Multi-terminal grid, list, and split views
- Per-terminal height resizing
- Project inspection for:
  - `package.json` scripts
  - `pyproject.toml` scripts
  - Docker Compose services
  - `.env*` files
  - GitHub workflows
  - Taskfile, justfile, Makefile
  - Cargo, Go, Maven, and Gradle project markers
  - README, NOTES, and docs markdown
- Structured parsing for JSON, YAML, and TOML
- Per-project persisted settings, including project paths, deleted projects, terminals, layout, and launch commands
- Per-terminal launch command editor with multiline save and copy support
- Status indicators:
  - Green: an external Terminal window was opened for this shell entry
  - Yellow: shell entry is idle or not process-managed
  - Red: opening the external Terminal window failed
- macOS app icon and desktop launcher assets

## User Manual

### 1. Create Or Select A Project

Use **New Project** to create a workspace entry, or select an existing project from the sidebar.

Each project has two editable fields at the top-left:

- **Project name**: the display name shown in the sidebar.
- **Project path**: the real local root directory for that project.

Project inspection and launch-command validation use the **Project path** field as the source of truth. They do not follow a terminal's temporary `cwd` after you run `cd`.

### 2. Add A Terminal

Click **Add Terminal** to create a shell entry for the selected project.

The app does not host terminal input. Click **Open in Terminal** to open a real macOS Terminal window at that shell entry's directory. That external window is owned by macOS Terminal, not by Terminal Workspace.

### 3. Open External Terminals

Use the external macOS Terminal window for typing, history, shell shortcuts, and process control. Terminal Workspace does not intercept input, share command history, or kill those external processes.

### 4. Resize Terminal Areas

Drag the resize handle at the bottom of a terminal panel to change that terminal's height. The layout keeps the right-side details panel visible while the middle terminal area can be adjusted per terminal.

### 5. Save A Launch Command

Open the right-side **Details** panel and use **Process -> Launch Command**.

The Launch Command field is a multiline text area. Enter the exact command you want to keep for that terminal, for example:

```bash
cd /Users/you/Desktop/my-app
npm run dev
```

Click **Save** below the input field. The app stores the full multiline command for that terminal.

Launch commands are validated against the selected project's **Project path**. This prevents a terminal in one project from accidentally showing or copying a command that belongs to another project.

### 6. Copy A Launch Command

Click the copy icon below the Launch Command field. The app writes the saved command to the macOS clipboard and verifies the copied text.

The full command remains visible in the text area, so you can also select it manually and copy it yourself.

### 7. Inspect A Project

Open **Project Inspector** under a project in the sidebar. Inspection scans the configured **Project path** and reports detected project files and runnable entry points, including:

- `package.json` scripts
- `pyproject.toml` scripts
- Docker Compose services
- `.env*` files
- GitHub workflows
- `Taskfile`, `justfile`, and `Makefile`
- Cargo, Go, Maven, and Gradle markers
- README, NOTES, and docs markdown files

### 8. Delete A Project

Click the delete button next to a project name in the sidebar. This removes the project and its terminal entries from the persisted workspace state.

### 9. Persistence

Terminal Workspace saves workspace state under the app data directory:

```text
~/Library/Application Support/Terminal Workspace/terminal-workspace-state.json
```

The saved state includes project paths, project deletion, active project, active terminal, terminal metadata, launch commands, layout choices, and sidebar expansion.

When the desktop app restarts, previous terminal shell entries are restored as idle entries. External Terminal windows remain independent of Terminal Workspace.

## Operation Guide

### Recommended Daily Workflow

1. Create one project entry per local repo.
2. Set the top-left **Project path** to the repo root.
3. Add terminals for frontend, backend, workers, logs, and scripts.
4. Save each terminal's launch command in the right-side **Launch Command** field.
5. Click **Open Launch Command** or **Open in Terminal** when you want a real Terminal window.
6. Use Project Inspector to discover scripts, services, docs, env files, and workflows.
7. Restart the app when needed; the workspace layout and saved commands should remain available.

### Example Multi-Project Setup

```text
Finance Desktop
  Terminal 1: cd /path/to/apps/desktop && npm run start
  Terminal 2: cd /path/to/apps/api && npm run dev

Music Tools
  Terminal 1: cd /path/to/music && npm run dev

PPT Pipeline
  Terminal 1: cd /path/to/ppt && python app.py
```

### Status Troubleshooting

- **Green dot**: an external Terminal window was opened for this shell entry.
- **Yellow dot**: the shell entry is idle or not process-managed.
- **Red dot**: opening the external Terminal window failed.

If a launch command is blank, check that the saved command belongs to the current project path. Commands with an absolute `cd` path outside the project root are hidden instead of reused across projects.

## Getting Started

Requirements:

- macOS
- Node.js
- npm

Install and run:

```bash
npm install
npm run dev
```

Build and launch the desktop app:

```bash
npm run desktop
```

Run checks:

```bash
npm run lint
npm run build
```

## Architecture

- `src/` contains the React UI.
- `electron/main.cjs` owns the Electron window, external Terminal launching, state persistence, and project inspection.
- `electron/preload.cjs` exposes the safe renderer bridge.
- `scripts/create-launcher-icon.swift` generates the macOS app icon.
- `assets/` contains desktop icon resources.

## Distribution Notes

This repository currently ships source-first. Packaging into a signed `.dmg` or `.zip` release can be added with Electron Builder or Forge.

## License

MIT
