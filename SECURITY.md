# Security Policy

## Supported Versions

Terminal Workspace is early-stage. Security fixes target the latest release.

## Reporting a Vulnerability

Please do not publish sensitive security details in a public issue.

Open a minimal issue asking for maintainer contact, or contact the repository owner through GitHub. Include only enough information to establish the affected area until a private channel is available.

Useful details once a private channel is established:

- Affected version or commit
- Reproduction steps
- Expected and actual behavior
- Whether the issue involves PTY lifecycle, local file access, clipboard access, release packaging, or project inspection

## Security Boundaries

Terminal Workspace is a local desktop developer tool. It can create local PTY sessions after explicit user action and can inspect files under the configured Project path. It should not fake running process state, auto-create PTYs on startup, or silently scan paths outside the selected project root.
