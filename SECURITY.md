# Security Policy

## Reporting a Vulnerability

Report vulnerabilities through one of these channels:

- **GitHub Security Advisories** (preferred): [Submit a report](https://github.com/esau-morais/grind/security/advisories/new)
- **Email**: [security@grindxp.app](mailto:security@grindxp.app)

### Required in Reports

1. Summary of the vulnerability
2. Steps to reproduce
3. Impact assessment
4. Affected component and version
5. Environment details (OS, Bun/Node version)

You will receive a response within **72 hours**. If confirmed, a patch will be released as soon as possible.

## Supported Versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

## Security Model

Grind is local-first by default:

- **Vault** is encrypted at rest (AES via libsql). The encryption key lives in `~/.grind/config.json` (owner-readable only). If you lose it, your vault is unrecoverable.
- **Companion trust ladder** controls what the AI can do. At trust level 4 (Sovereign), the agent can run arbitrary shell commands without approval — treat this like root access.
- **Gateway** binds to `127.0.0.1` by default. Exposing it to the network without signature verification is a risk.
- **No telemetry** is sent anywhere. Quest data, skill trees, and streaks never leave your machine unless you enable Turso sync or use a cloud AI provider.

For the full security model (trust levels, gateway hardening, WhatsApp Web caveats, Turso sync): [Security docs](https://docs.grindxp.app/reference/security)

## Out of Scope

- AI provider security (Anthropic, OpenAI, Google, Ollama)
- WhatsApp Web protocol (Baileys) vulnerabilities
- Issues requiring physical access to the machine
- Social engineering attacks

## Disclosure Policy

1. Patch developed and validated
2. Patch released with a security warning in release notes
3. 2-4 week waiting period
4. Public advisory published
