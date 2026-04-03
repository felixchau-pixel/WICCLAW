const SUPPORTED_TASK_TYPES = new Set([
  'write_file',
  'read_file',
  'delete_file',
  'move_file',
  'list_files',
  'pwd',
  'summarize_file',
  'get_result',
  'exec_cmd'
]);

const BLOCKED_COMMAND_TOKENS = [
  'rm ',
  ' shutdown',
  'reboot',
  'mkfs',
  'dd ',
  'kill ',
  'pkill',
  'sudo ',
  'chmod 777',
  'curl ',
  'wget '
];

function hasTraversal(candidate) {
  return String(candidate || '').includes('..');
}

function isAbsolute(candidate) {
  return String(candidate || '').startsWith('/');
}

function validatePath(candidate, fieldName) {
  if (!candidate || typeof candidate !== 'string') {
    return { ok: false, error: `${fieldName} must be a non-empty string` };
  }

  if (hasTraversal(candidate) || isAbsolute(candidate)) {
    return { ok: false, error: `${fieldName} must stay inside the approved folder` };
  }

  return { ok: true };
}

function validateTask(task) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    return { ok: false, error: 'Task must be an object' };
  }

  if (!SUPPORTED_TASK_TYPES.has(task.type)) {
    return { ok: false, error: `Unsupported task type: ${task?.type || 'unknown'}` };
  }

  const payload = task.payload || {};

  switch (task.type) {
    case 'write_file': {
      const filename = validatePath(payload.filename, 'filename');
      if (!filename.ok) {
        return filename;
      }

      if (typeof payload.content !== 'string') {
        return { ok: false, error: 'content must be a string' };
      }

      return { ok: true };
    }

    case 'read_file':
    case 'delete_file': {
      return validatePath(payload.filename, 'filename');
    }

    case 'summarize_file': {
      return validatePath(payload.filename, 'filename');
    }

    case 'move_file': {
      const from = validatePath(payload.from, 'from');
      if (!from.ok) {
        return from;
      }

      return validatePath(payload.to, 'to');
    }

    case 'list_files':
    case 'pwd':
      return { ok: true };

    case 'get_result':
      return typeof payload.taskId === 'string' && payload.taskId.trim()
        ? { ok: true }
        : { ok: false, error: 'taskId must be a non-empty string' };

    case 'exec_cmd': {
      if (typeof payload.command !== 'string' || !payload.command.trim()) {
        return { ok: false, error: 'command must be a non-empty string' };
      }

      if (payload.command.length > 160) {
        return { ok: false, error: 'command is too long' };
      }

      if (BLOCKED_COMMAND_TOKENS.some((token) => payload.command.includes(token))) {
        return { ok: false, error: 'Blocked command' };
      }

      return { ok: true };
    }

    default:
      return { ok: false, error: `Unsupported task type: ${task.type}` };
  }
}

module.exports = {
  SUPPORTED_TASK_TYPES,
  validateTask
};
