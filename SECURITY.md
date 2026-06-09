# Security Policy

## Supported versions

pw-ui-review is pre-1.0. Fixes are applied to the latest published release on
npm. Please make sure you are on the newest version before reporting an issue.

## Reporting an issue

Please do **not** open a public GitHub issue for security-sensitive reports.

Instead, email **vaikar.abhijeet@gmail.com** with:

- a description of the issue and its impact,
- steps to reproduce, and
- the version of pw-ui-review and Node.js you are using.

You can expect an initial acknowledgement within a few days. Once a fix is
available, a new version will be published to npm and the issue noted in the
changelog.

## Scope notes

pw-ui-review is a **local-first** developer tool: it runs a web server bound to
localhost and reads/writes files in the project you point it at. It does not send
data anywhere. Reports that depend on an attacker already having local shell
access to the developer's machine are generally considered out of scope.
