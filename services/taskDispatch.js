const { executeTaskViaOpenClaw, getOpenClawStatus } = require('./openclawAdapter');
const { enqueueTask, saveTaskResult, getDeviceById } = require('./deviceRegistry');

async function dispatchTask({ deviceId, task, source = 'telegram' }) {
  const device = getDeviceById(deviceId);

  if (!device) {
    return { ok: false, error: 'Device not found' };
  }

  const taskId = `task_${Date.now()}`;
  const openclawStatus = getOpenClawStatus();

  if (openclawStatus.ready) {
    const openclawResult = await executeTaskViaOpenClaw({ deviceId, taskId, task });

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
      saveTaskResult(deviceId, taskId, openclawResult);
      return {
        ok: false,
        mode: 'openclaw',
        taskId,
        source,
        error: openclawResult.error || 'OpenClaw execution failed',
        result: openclawResult
      };
    }
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
