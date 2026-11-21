# Security policy

Roamies reads your AI provider API keys and OAuth tokens from your machine (`~/.gg/auth.json`) and runs a
local agent that can take screenshots, read windows and read files, and, if you turn
them on, click and type in other apps, write files and run commands. Security reports are taken seriously.

## Supported versions

Only the latest release gets security fixes: [latest GitHub release](https://github.com/KenKaiii/Roamies/releases/latest).

## Reporting a vulnerability

Please **do not open a public issue**. Report privately through [GitHub security advisories](https://github.com/KenKaiii/Roamies/security/advisories/new).

Include:

- what an attacker can do, and what they need first (e.g. "a malicious web page", "a file the user opens", "local access")
- steps to reproduce, or a proof of concept
- affected version and OS

You'll get an acknowledgement within 7 days. Once a fix ships, the advisory will be published with credit to you unless you'd rather stay anonymous.

## In scope

- the agent sidecar and its tools: file access, commands, screenshots, app control
- the safety switches for writing files and running commands
- the Tauri shell and its commands
- the macOS helpers (voice and hands)
- memory, settings and session files in `~/Roamies/Data/`

## Out of scope

- an AI model choosing to do something you asked for or that your settings allow
- attacks that need an already-compromised user account or machine
