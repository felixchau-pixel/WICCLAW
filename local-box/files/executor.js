const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const blockedCommandTokens = [
  'rm ',
  'shutdown',
  'reboot',
  'mkfs',
  'dd ',
  'kill ',
  'pkill',
  'sudo ',
  'curl ',
  'wget '
];

function getApprovedFolder(baseFolder) {
  return baseFolder || process.env.APPROVED_FOLDER || path.join(__dirname, 'approved');
}

function ensureApprovedFolder(baseFolder) {
  const approvedFolder = getApprovedFolder(baseFolder);
  fs.mkdirSync(approvedFolder, { recursive: true });
  return approvedFolder;
}

function resolveApprovedPath(filename, baseFolder) {
  const approvedFolder = ensureApprovedFolder(baseFolder);
  const normalized = path.normalize(String(filename || ''));

  if (
    !normalized ||
    normalized === '.' ||
    normalized.startsWith('..') ||
    path.isAbsolute(normalized)
  ) {
    throw new Error('Path traversal blocked');
  }

  return path.join(approvedFolder, normalized);
}

function writeApprovedFile(filename, content, options = {}) {
  const targetPath = resolveApprovedPath(filename, options.approvedFolder);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, String(content), 'utf8');

  return {
    ok: true,
    message: `File written: ${filename}`,
    path: targetPath
  };
}

function readApprovedFile(filename, options = {}) {
  const targetPath = resolveApprovedPath(filename, options.approvedFolder);
  return {
    ok: true,
    filename,
    path: targetPath,
    content: fs.readFileSync(targetPath, 'utf8')
  };
}

function deleteApprovedFile(filename, options = {}) {
  const targetPath = resolveApprovedPath(filename, options.approvedFolder);
  fs.unlinkSync(targetPath);

  return {
    ok: true,
    message: `File deleted: ${filename}`,
    path: targetPath
  };
}

function moveApprovedFile(from, to, options = {}) {
  const fromPath = resolveApprovedPath(from, options.approvedFolder);
  const toPath = resolveApprovedPath(to, options.approvedFolder);
  fs.mkdirSync(path.dirname(toPath), { recursive: true });
  fs.renameSync(fromPath, toPath);

  return {
    ok: true,
    message: `File moved: ${from} -> ${to}`,
    from: fromPath,
    to: toPath
  };
}

function listApprovedFiles(options = {}) {
  const approvedFolder = ensureApprovedFolder(options.approvedFolder);
  const files = [];

  function walk(currentFolder, prefix) {
    const entries = fs.readdirSync(currentFolder, { withFileTypes: true });

    for (const entry of entries) {
      const relative = prefix ? path.join(prefix, entry.name) : entry.name;
      const absolute = path.join(currentFolder, entry.name);

      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else {
        files.push(relative);
      }
    }
  }

  walk(approvedFolder, '');
  files.sort();

  return {
    ok: true,
    files
  };
}

function executeApprovedCommand(command, options = {}) {
  if (process.env.ALLOW_EXEC_CMD !== 'true') {
    return { ok: false, error: 'exec_cmd is disabled' };
  }

  if (blockedCommandTokens.some((token) => command.includes(token))) {
    return { ok: false, error: 'Blocked command' };
  }

  const approvedFolder = ensureApprovedFolder(options.approvedFolder);
  const child = spawnSync(command, {
    cwd: approvedFolder,
    shell: true,
    encoding: 'utf8',
    timeout: Number(process.env.EXEC_CMD_TIMEOUT_MS || 15000)
  });

  if (child.error) {
    return { ok: false, error: child.error.message };
  }

  return {
    ok: child.status === 0,
    code: child.status,
    stdout: String(child.stdout || '').trim(),
    stderr: String(child.stderr || '').trim()
  };
}

function executeTask(task, options = {}) {
  switch (task.type) {
    case 'write_file':
      return writeApprovedFile(task.payload.filename, task.payload.content, options);
    case 'read_file':
      return readApprovedFile(task.payload.filename, options);
    case 'delete_file':
      return deleteApprovedFile(task.payload.filename, options);
    case 'move_file':
      return moveApprovedFile(task.payload.from, task.payload.to, options);
    case 'list_files':
      return listApprovedFiles(options);
    case 'exec_cmd':
      return executeApprovedCommand(task.payload.command, options);
    default:
      return { ok: false, error: `Unsupported task type: ${task.type}` };
  }
}

module.exports = {
  getApprovedFolder,
  resolveApprovedPath,
  writeApprovedFile,
  readApprovedFile,
  deleteApprovedFile,
  moveApprovedFile,
  listApprovedFiles,
  executeApprovedCommand,
  executeTask
};
