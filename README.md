# Terminal Workspace

**A cross-project terminal workspace for developers running many local apps.**

Terminal Workspace helps full-stack, AI, Electron, and local-first developers keep frontend servers, backends, workers, tunnels, logs, and scripts in one desktop workspace without mixing project context.

If your daily workflow involves 10+ terminal windows across several repos, this project is built for you. Star the repo to follow packaged releases, terminal groups, project templates, and command-palette work.

![Terminal Workspace running](./terminal-workspace-1440.png)

## Why Developers Use It

Most terminal apps optimize the shell prompt. Terminal Workspace optimizes the **workspace around many terminals**:

- Keep multiple local repos in one sidebar.
- Create real local PTY terminals only when you need them.
- Save multiline launch commands per terminal and copy them reliably.
- Inspect project scripts, services, env files, docs, and workflows from the configured project path.
- Keep up-arrow command recall scoped to the active terminal.
- Persist project paths, deleted projects, layout choices, terminal metadata, and launch commands.
- Avoid fake running states after restart: stopped terminals stay stopped until you click Start.

## Who It Is For

- Full-stack developers running frontend, API, queue, worker, tunnel, and log shells.
- AI app builders juggling local model servers, web apps, data scripts, and docs.
- Electron and desktop-app developers who need repeatable local launch commands.
- Local-first developers working across several repos every day.
- Anyone who keeps many Terminal/iTerm windows open and loses track of which shell belongs to which project.

## How It Differs

| Tool | Best at | Gap Terminal Workspace targets |
| --- | --- | --- |
| Terminal / iTerm2 | Lightweight shell windows | Weak cross-project organization and launch-command memory |
| Warp | Polished terminal experience | Not primarily a multi-project terminal workspace |
| tmux | Terminal multiplexing | Terminal-native, less visual project metadata and desktop UX |
| Terminal Workspace | Multi-project terminal management | Heavier than native terminals because it uses Electron and xterm.js |

Terminal Workspace is not trying to replace your shell. It is a desktop control surface for many local development shells.

## Highlights

- Real local PTY sessions through `node-pty`
- macOS desktop shell built with Electron, React, and xterm.js
- Project sidebar with terminals and recent sessions
- Grid, list, and split terminal views
- Per-terminal height resizing
- Lightweight inactive terminal cards: xterm is created only for running terminals
- Tail-only in-memory transcript storage to reduce long-session pressure
- Manual Project Inspector, scoped to the configured **Project path**
- Project inspection for:
  - `package.json` scripts
  - `pyproject.toml` scripts
  - Docker Compose services
  - `.env*` files
  - GitHub workflows
  - Taskfile, justfile, Makefile
  - Cargo, Go, Maven, and Gradle markers
  - README, NOTES, and docs markdown files
- Structured parsing for JSON, YAML, and TOML
- Per-terminal multiline Launch Command editor with save and copy support
- Status indicators:
  - Green: terminal has an active process
  - Yellow: terminal is idle, stopped, or waiting to be started
  - Red: terminal exited with an error

## Quick Start

Requirements:

- macOS
- Node.js
- npm
- Xcode Command Line Tools for rebuilding `node-pty`

Run from source:

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

## Daily Workflow

1. Create one project entry per local repo.
2. Set **Project path** to the real repo root.
3. Add terminals for frontend, backend, workers, logs, tunnels, and scripts.
4. Save each terminal's Launch Command in the right-side details panel.
5. Use Project Inspector only when you want to scan the configured project path.
6. Restart the app when needed; project layout and saved commands remain available.

Example:

```text
Finance Desktop
  Terminal 1: cd /path/to/apps/desktop && npm run start
  Terminal 2: cd /path/to/apps/api && npm run dev

Music Tools
  Terminal 1: cd /path/to/music && npm run desktop

PPT Pipeline
  Terminal 1: cd /path/to/ppt && python app.py
```

## User Manual

### Create Or Select A Project

Use **New Project** to create a workspace entry, or select an existing project from the sidebar.

Each project has two editable fields at the top-left:

- **Project name**: the display name shown in the sidebar.
- **Project path**: the real local root directory for that project.

Project inspection and launch-command validation use **Project path** as the source of truth. They do not follow a terminal's temporary `cwd` after you run `cd`.

### Add A Terminal

Click **Add Terminal** to create a real interactive shell for the selected project.

New terminals are ready for input immediately. Existing stopped terminals stay lightweight until you click **Start Terminal**.

### Use Terminal Input

Type normally in the terminal input area. Input is forwarded to the real PTY.

The up-arrow key is scoped to the active terminal. It recalls that terminal's own recent command context and does not pull commands from another project or terminal.

### Resize Terminal Areas

Drag the resize handle at the bottom of a terminal panel to change that terminal's height. The layout keeps the right-side details panel visible while the middle terminal area can be adjusted per terminal.

### Save A Launch Command

Open the right-side **Details** panel and use **Process -> Launch Command**.

The Launch Command field is a multiline text area. Enter the exact command you want to keep for that terminal:

```bash
cd /Users/you/Desktop/my-app
npm run dev
```

Click **Save** below the input field. The app stores the full multiline command for that terminal.

Launch commands are validated against the selected project's **Project path**. This prevents a terminal in one project from accidentally showing or copying a command that belongs to another project.

### Copy A Launch Command

Click the copy icon below the Launch Command field. The app writes the saved command to the macOS clipboard and verifies the copied text.

The full command remains visible in the text area, so you can also select it manually and copy it yourself.

### Inspect A Project

Open **Project Inspector** under a project in the sidebar. Inspection scans the configured **Project path** and reports detected project files and runnable entry points.

Project scanning is manual. It does not run automatically when you edit a path or when a terminal changes directories.

### Delete A Project

Click the delete button next to a project name in the sidebar. This removes the project and its terminal entries from the persisted workspace state.

### Persistence

Terminal Workspace saves workspace state under:

```text
~/Library/Application Support/Terminal Workspace/terminal-workspace-state.json
```

The saved state includes project paths, project deletion, active project, active terminal, terminal metadata, launch commands, layout choices, and sidebar expansion.

When the desktop app restarts, previous terminals are restored as stopped entries. A new real PTY is created only when you click **Start Terminal**; the app does not fake a running process after restart.

## Roadmap

- Packaged macOS `.zip` / `.dmg` releases
- Signed and notarized builds
- Command palette
- Terminal groups and project templates
- Import launch commands from shell scripts
- Log-tail mode for long-running services
- Optional lightweight web mode for lower CPU usage
- Health checks for ports and local services
- Better screenshots and short demo GIFs for GitHub and social sharing

## Contributing

Issues and pull requests are welcome. Good first contributions include:

- Packaging and release automation
- Better terminal grouping UX
- Project Inspector support for more frameworks
- Accessibility and keyboard navigation
- Performance profiling with many inactive terminals
- Docs, screenshots, and demo GIFs

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## Architecture

- `src/` contains the React UI.
- `electron/main.cjs` owns the Electron window, PTY lifecycle, state persistence, clipboard access, and project inspection.
- `electron/preload.cjs` exposes the safe renderer bridge.
- `scripts/create-launcher-icon.swift` generates the macOS app icon.
- `assets/` contains desktop icon resources.

## Distribution Status

This repository is currently source-first. Packaged releases are planned. See [docs/RELEASE.md](./docs/RELEASE.md) for the release checklist.

## License

MIT
