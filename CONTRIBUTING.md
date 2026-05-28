# Contributing

Thanks for helping improve Terminal Workspace.

This project is a desktop workspace for developers who run many local terminal sessions across multiple repos. Keep contributions focused on real workflow improvements, performance, reliability, and clear developer ergonomics.

## Development

```bash
npm install
npm run dev
```

Run checks before opening a pull request:

```bash
npm run lint
npm run build
```

## Good First Areas

- Improve Project Inspector coverage for common frameworks.
- Add terminal grouping and filtering.
- Improve keyboard navigation.
- Profile xterm rendering with many inactive terminals.
- Improve macOS packaging and release automation.
- Add screenshots, demo GIFs, and documentation.

## Pull Request Guidelines

- Keep changes scoped.
- Include screenshots or recordings for UI changes.
- Include reproduction steps for bug fixes.
- Do not fake running terminal state after app restart.
- Do not auto-create PTY sessions on startup.
- Do not persist full terminal transcripts.
- Keep project detection scoped to the configured Project path.

## Architecture Notes

- `electron/main.cjs` owns PTY lifecycle, persistence, clipboard, and project inspection.
- `electron/preload.cjs` exposes the renderer bridge.
- `src/App.tsx` owns workspace state and UI behavior.
- `src/App.css` owns visual layout and responsive behavior.

## Reporting Security Issues

Please do not publish sensitive security details in a public issue. Open a minimal issue asking for maintainer contact first.
