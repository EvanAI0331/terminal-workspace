# Terminal Workspace

Terminal Workspace is a cross-project multi-terminal desktop app for developers who move between many local repos, services, and task runners.

It is built for the workflow where one project is never enough: frontend, backend, scripts, logs, workers, docs, and probes all need separate shells, but they should still live in one coherent workspace.

## Why

Wrap is polished, but this project is optimized for cross-project terminal management:

- Manage multiple projects from one desktop window.
- Keep separate real PTY terminals per project.
- Restore terminal state and recent command context.
- Probe project services, env files, tasks, workflows, docs, and subproject roots.
- Resize each terminal panel independently.
- Keep per-terminal up-arrow recall scoped to that terminal, not another shell session.
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
- macOS app icon and desktop launcher assets

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
