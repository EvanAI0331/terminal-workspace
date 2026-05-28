# Release Checklist

Terminal Workspace publishes macOS `.dmg` and `.zip` builds through GitHub Releases. Use this checklist before publishing a public release.

## Release Goals

- Make the app easy to try in under one minute.
- Show the multi-project workflow clearly.
- Keep release notes honest about current limitations.

## Before Release

- Run `npm run lint`.
- Run `npm run build`.
- Run `npm run pack:mac`.
- Test `npm run desktop` on macOS.
- Verify a fresh install can rebuild `node-pty`.
- Verify no terminal PTY is auto-created on app restart.
- Verify inactive terminals stay lightweight.
- Verify project settings persist after restart.
- Verify launch-command copy uses the active terminal's saved command.

## Assets

Prepare:

- A short GIF showing project switching, terminal creation, Launch Command copy, and Project Inspector.
- One clean screenshot for the GitHub README.
- A release screenshot for the GitHub release page.

## Packaging Targets

Current:

- macOS `.zip`
- macOS `.dmg`

Planned:

- Signed and notarized builds

Suggested tooling:

- Electron Builder (`npm run pack:mac`)
- Electron Forge

## Current Signing Status

The current packaging flow sets `CSC_IDENTITY_AUTO_DISCOVERY=false`, so release builds are ad-hoc signed and not notarized. This keeps community test builds available while signed/notarized distribution is still pending.

## Release Notes Template

```markdown
## Terminal Workspace vX.Y.Z

### Highlights

- ...

### Fixes

- ...

### Known Limits

- Source install still requires Node.js, npm, and Xcode Command Line Tools.
- Packaged releases are not notarized yet.
```
