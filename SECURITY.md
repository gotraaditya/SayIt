# Security Policy

## Supported Versions

Security fixes are applied to the latest source on the default branch. Until the
first stable release, older development snapshots are not supported separately.

## Reporting a Vulnerability

Please do not report a suspected vulnerability in a public issue, discussion,
pull request, or log attachment.

Use GitHub's private vulnerability reporting feature:

1. Open the repository's **Security** tab.
2. Select **Advisories**.
3. Select **Report a vulnerability**.
4. Include the affected version or commit, impact, reproduction steps, and any
   suggested mitigation.

If private vulnerability reporting is temporarily unavailable, contact the
repository owner privately through the contact method on their GitHub profile.
Do not send real user text, credentials, signing keys, or other sensitive data.

The maintainer will acknowledge a complete report when practical, investigate
it privately, and coordinate disclosure after a fix is available. Please allow
reasonable time for investigation before public disclosure.

## Security Properties

Changes should preserve these core properties:

- Selected text and synthesized audio remain on the local machine.
- The backend listens only on loopback and requires its per-process token.
- Release dependencies, models, and build tools are version- and hash-pinned.
- Signing certificates and updater private keys never enter source control.
- Release artifacts remain traceable to a reviewed Git commit and generated
  audit/SBOM evidence.
