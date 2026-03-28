# Guardrails

- `/run` is the only command path for device execution requests.
- `/agent` is admin-only and does not execute actions directly.
- `/ask` is scoped to the paired device context only.
- `core/taskValidator.js` rejects unsupported task types.
- Relative traversal and absolute path writes are rejected.
- File operations are restricted to the approved folder.
- `core/permissions.js` blocks unpaired devices and unauthorized users.
- `exec_cmd` is disabled unless `ALLOW_EXEC_CMD=true`.
- Blocked shell tokens include destructive and network-fetch commands.
- Secrets stay in env files only.
- Placeholder env values are treated as unconfigured and are rejected at runtime.
- Device registry state persists in `data/devices.json`.
- Device polling, result upload, and manifest sync require both the master token and the device secret.
- Mini sync state is stored only under `device/runtime/sync` and `device/runtime/state`.
- OpenClaw is attempted first; fallback queue is used only when OpenClaw is not ready.
- OpenClaw may propose actions for the master agent, but execution still requires explicit validated dispatch.
