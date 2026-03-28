function canExecute({ chatId, device, task }) {
  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  if (!device.pairedTelegramUser) {
    return { ok: false, error: 'Device not paired' };
  }

  if (chatId !== undefined && String(device.pairedTelegramUser) !== String(chatId)) {
    return { ok: false, error: 'Not authorized for this device' };
  }

  if (task.type === 'exec_cmd' && process.env.ALLOW_EXEC_CMD !== 'true') {
    return { ok: false, error: 'exec_cmd is disabled' };
  }

  switch (task.type) {
    case 'write_file':
    case 'read_file':
    case 'delete_file':
    case 'move_file':
    case 'list_files':
    case 'get_result':
    case 'exec_cmd':
      return { ok: true };
    default:
      return { ok: false, error: `Blocked task type: ${task.type}` };
  }
}

module.exports = { canExecute };
