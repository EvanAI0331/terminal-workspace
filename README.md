# Terminal Workspace

Terminal Workspace is a cross-project multi-terminal desktop app for developers who move between many local repos, services, and task runners.

It is built for the workflow where one project is never enough: frontend, backend, scripts, logs, workers, docs, and probes all need separate shells, but they should still live in one coherent workspace.

![Terminal Workspace running](./terminal-workspace-1440.png)

## Why

Warp is polished, but Terminal Workspace is optimized for cross-project terminal management:

- Manage multiple projects from one desktop window.
- Keep separate real PTY terminals per project.
- Restore terminal state and recent command context.
- Probe project services, env files, tasks, workflows, docs, and subproject roots.
- Resize each terminal panel independently.
- Keep per-terminal up-arrow recall scoped to that terminal, not another shell session.
- Save and copy each terminal's launch command without mixing commands across projects.
- Use a native macOS-style desktop shell with xterm.js and Electron.

## Features

- Real local PTY sessions through `node-pty`
- Project sidebar with terminals and recent sessions
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
  - Green: terminal has an active child process
  - Yellow: terminal is idle, stopped, or waiting to be started
  - Red: terminal exited with an error
- macOS app icon and desktop launcher assets

## User Manual

### 1. Create Or Select A Project

Use **New Project** to create a workspace entry, or select an existing project from the sidebar.

Each project has two editable fields at the top-left:

- **Project name**: the display name shown in the sidebar.
- **Project path**: the real local root directory for that project.

Project inspection and launch-command validation use the **Project path** field as the source of truth. They do not follow a terminal's temporary `cwd` after you run `cd`.

### 2. Add A Terminal

Click **Add Terminal** to create a real interactive shell for the selected project.

New terminals are ready for input immediately. Each terminal has its own PTY session, transcript, status, height, and command context.

### 3. Use Terminal Input

Type normally in the terminal input area. Input is forwarded to the real PTY.

The up-arrow key is scoped to the active terminal. It recalls that terminal's own recent command context and does not pull commands from another project or terminal.

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

When the desktop app restarts, previous terminals are restored as idle entries. A new real PTY is created only when you start or select a terminal again; the app does not fake a running process after restart.

## Operation Guide

### Recommended Daily Workflow

1. Create one project entry per local repo.
2. Set the top-left **Project path** to the repo root.
3. Add terminals for frontend, backend, workers, logs, and scripts.
4. Save each terminal's launch command in the right-side **Launch Command** field.
5. Use Project Inspector to discover scripts, services, docs, env files, and workflows.
6. Restart the app when needed; the workspace layout and saved commands should remain available.

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

- **Green dot**: the terminal shell has an active child process.
- **Yellow dot**: the terminal is idle, stopped, or waiting for a real PTY.
- **Red dot**: the terminal process failed or exited with an error code.

If a launch command is blank, check that the saved command belongs to the current project path. Commands with an absolute `cd` path outside the project root are hidden instead of reused across projects.

## Getting Started

Requirements:

- macOS
- Node.js
- npm
- Xcode Command Line Tools for rebuilding `node-pty`

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
- `electron/main.cjs` owns the Electron window, PTY lifecycle, state persistence, and project inspection.
- `electron/preload.cjs` exposes the safe renderer bridge.
- `scripts/create-launcher-icon.swift` generates the macOS app icon.
- `assets/` contains desktop icon resources.

## Distribution Notes

This repository currently ships source-first. Packaging into a signed `.dmg` or `.zip` release can be added with Electron Builder or Forge.

## License

MIT
