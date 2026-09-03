# Security Policy

## Supported Versions

Archprint is pre-1.0. Security fixes are released against the latest published `0.x` version.

| Version      | Supported |
| ------------ | --------- |
| latest `0.x` | ✅        |
| older        | ❌        |

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Report privately through GitHub's [private vulnerability reporting](https://github.com/Tommkruix/archprint/security/advisories/new)
(Security → Report a vulnerability). If that is unavailable, contact the maintainer
([@Tommkruix](https://github.com/Tommkruix)) directly.

Please include: a description of the issue, steps to reproduce, the affected version, and the potential impact.
You can expect an initial response within a few days. Once a fix is available, it will be released and the
advisory published with credit to the reporter (unless anonymity is requested).

## Scope

Archprint is a static-analysis CLI that reads a repository's source and emits config files. It does not execute
your code or send data anywhere. Reports of most interest: unsafe file writes outside the intended output
directory, path-traversal in resolution or the wire/eject commands, or a way for a scanned repository to cause
code execution.
