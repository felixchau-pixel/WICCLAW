# WicClaw Operating Guide

## Fixed Architecture
- Telegram is the control interface.
- `server.js` is the master orchestrator entrypoint.
- `device/mini-agent.js` is the mini execution agent.
- OpenClaw is the master-side execution brain and runs first on every `/run` request.
- If OpenClaw is unavailable, dispatch falls back to the device queue.
- Validation and permissions are mandatory before dispatch.
- Heartbeat, registry persistence, queue polling, and result tracking are mandatory.

## Non-Negotiable Rules
- Do not remove or bypass `/run`.
- Do not remove or bypass `core/taskValidator.js`.
- Do not remove or bypass `core/permissions.js`.
- Do not remove or bypass OpenClaw-first dispatch in `services/taskDispatch.js`.
- Do not remove or bypass device heartbeat, queue polling, or result storage.
- Do not write outside the approved folder for file tasks.
- Do not hardcode secrets or print secrets in logs.

## Extension Rules
- Keep new skills deterministic and contract-based.
- Add new business workflows under `skills/` with explicit prompts, required inputs, and bounded outputs.
- Keep device-safe execution inside `device/executor.js` and `local-box/files/executor.js`.
- Preserve the registry JSON schema compatibility in `services/deviceRegistry.js`.
- Keep Anthropic optional. The business workflows must still return usable non-AI output when the key is absent.

## OpenClaw Rules
- Keep OpenClaw config under the project-local `.openclaw` path.
- Use environment-variable substitution for provider secrets.
- Keep writable paths restricted to the approved folder unless requirements explicitly change.
- Treat OpenClaw unavailability as a fallback condition, not as permission to bypass validation or permissions.
