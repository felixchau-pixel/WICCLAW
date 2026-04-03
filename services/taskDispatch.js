const { executeTaskViaOpenClaw, getOpenClawStatus } = require('./openclawAdapter');
const { enqueueTask, saveTaskResult, getDeviceById } = require('./deviceRegistry');

async function withTimeout(promise, timeoutMs) {
  let timer = null;

  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`OpenClaw task attempt timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function dispatchTask({ deviceId, task, source = 'telegram' }) {
  const device = getDeviceById(deviceId);

  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  const taskId = `task_${Date.now()}`;

  if (task.type === 'summarize_file') {
    const queued = enqueueTask(deviceId, task, { taskId });
    if (!queued) {
      return { ok: false, error: 'Device not found' };
    }

    return {
      ok: true,
      mode: 'fallback',
      source,
      task: queued
    };
  }

  const openclawStatus = await getOpenClawStatus();

  if (openclawStatus.ready) {
    const openclawTimeoutMs = Number(process.env.OPENCLAW_TASK_ATTEMPT_TIMEOUT_MS || 8000);

    try {
      const openclawResult = await withTimeout(
        executeTaskViaOpenClaw({ deviceId, taskId, task }),
        openclawTimeoutMs
      );

      if (openclawResult.ok) {
        saveTaskResult(deviceId, taskId, openclawResult.result);
        return {
          ok: true,
          mode: 'openclaw',
          taskId,
          source,
          result: openclawResult.result
        };
      }

      if (openclawResult.available) {
        // Fall through to the device queue without persisting a synthetic result
        // for the same task id. The queued device result should be the first
        // visible result for fallback execution.
      }
    } catch {}
  }

  const queued = enqueueTask(deviceId, task, { taskId });
  if (!queued) {
    return { ok: false, error: 'Device not found' };
  }

  return {
    ok: true,
    mode: 'fallback',
    source,
    task: queued
  };
}

module.exports = { dispatchTask };
