# Why I Built Terminal Workspace

Most terminal apps focus on the shell prompt. My daily problem was different: I had too many terminal windows open across too many local projects.

A typical local dev stack is not one terminal anymore. It is a frontend server, an API server, a worker, a tunnel, a log tail, a database script, and a few one-off commands across multiple repos. Terminal, iTerm, Warp, tmux, and shell scripts can all help, but I still wanted a visual workspace that remembered which terminal belonged to which project.

Terminal Workspace is an open-source macOS desktop app for that workflow.

It is not trying to replace your shell. It wraps the shells you already use with a project-aware desktop workspace.

## What It Does

- Keeps multiple projects in one sidebar.
- Creates real local PTY terminals only when you start them.
- Saves multiline launch commands per terminal.
- Copies the saved command for the selected terminal.
- Restores project and terminal metadata after restart without faking running processes.
- Keeps inactive terminals lightweight until you click Start.
- Scans the configured Project path only when you manually open Project Inspector.

The Project Inspector detects common local-dev entry points: `package.json` scripts, Docker Compose services, env files, GitHub workflows, Taskfile, justfile, Makefile, Cargo, Go, Maven, Gradle markers, README files, and docs markdown.

## Why Not Just Use tmux?

tmux is excellent inside the terminal. Terminal Workspace is aimed at a different layer: cross-project desktop organization.

The goal is to make it easier to answer questions like:

- Which repo is this terminal for?
- What command starts this service?
- Which terminals are stopped vs actually running?
- What scripts and docs exist for this project?
- Can I restart this local stack without rebuilding the context from memory?

## Current Status

The current release includes macOS arm64 `.dmg` and `.zip` downloads.

The builds are ad-hoc signed and not notarized yet. If macOS blocks the first launch, open **System Settings -> Privacy & Security** and approve Terminal Workspace.

## Links

- Landing page: https://evanai0331.github.io/terminal-workspace/
- GitHub: https://github.com/EvanAI0331/terminal-workspace
- Release: https://github.com/EvanAI0331/terminal-workspace/releases/latest
- Discussion: https://github.com/EvanAI0331/terminal-workspace/discussions/6

If your local development workflow involves many repos and too many terminal windows, try it and star the repo if you want to follow the roadmap.
