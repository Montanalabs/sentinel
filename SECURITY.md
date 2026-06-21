# Security Policy

Sentinel is a security-critical action-gate. We take vulnerabilities seriously and appreciate
responsible disclosure.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, report privately to **security@montanalabs.ai** (or use GitHub's
[private vulnerability reporting](https://github.com/montanalabs/sentinel/security/advisories/new)).

Please include:

- A description of the issue and its impact.
- Steps to reproduce (a proof-of-concept where possible).
- The affected version/commit and configuration (store backend, provider, etc.).

We aim to acknowledge a report within **3 business days** and to provide a remediation timeline
after triage. We will coordinate a disclosure date with you and credit you in the advisory unless
you prefer to remain anonymous.

## Scope

In scope — issues in **this repository** that affect the integrity or safety of the gate, for
example:

- Forging, altering, or replaying provenance records so the chain still verifies.
- Bypassing a policy/check to obtain an unintended `ALLOW` (fail-open).
- Injection (SQL, prompt, template/config), or remote crash/DoS reachable from the sidecar API.
- Leakage of secrets (signing seed, API keys) or credentials in logs/errors.
- Defects in the agent-side SDK that let a malicious or compromised sidecar response be trusted.

Out of scope — your own deployment's hardening choices: network exposure of the sidecar, the
`failMode: 'open'` setting, secrets you place in your own `.env`, and your database/OS hardening.
See the security notes in the [README](./README.md) and [self-hosting docs](./docs/self-hosting.md).

## Supported Versions

Security fixes are applied to the latest `1.0.x` release and to `main`. Pre-1.0 releases are no longer
supported — upgrade to 1.0.0 (note the breaking changes in [CHANGELOG.md](./CHANGELOG.md)).

| Version | Supported |
| ------- | --------- |
| 1.0.x   | Yes       |
| < 1.0   | No        |
