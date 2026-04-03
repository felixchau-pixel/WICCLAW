const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { summarizeApprovedFile } = require('../services/fileSummary');

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
  const approvedFolder = baseFolder || process.env.APPROVED_FOLDER || path.join(__dirname, 'approved');
  fs.mkdirSync(approvedFolder, { recursive: true });
  return approvedFolder;
}

function resolveApprovedPath(filename, baseFolder) {
  const approvedFolder = getApprovedFolder(baseFolder);
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

function executeTask(task, options = {}) {
  const approvedFolder = getApprovedFolder(options.approvedFolder);

  switch (task.type) {
    case 'write_file': {
      const targetPath = resolveApprovedPath(task.payload.filename, approvedFolder);
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, String(task.payload.content), 'utf8');
      return { ok: true, path: targetPath };
    }

    case 'read_file': {
      const targetPath = resolveApprovedPath(task.payload.filename, approvedFolder);
      return { ok: true, content: fs.readFileSync(targetPath, 'utf8'), path: targetPath };
    }

    case 'delete_file': {
      const targetPath = resolveApprovedPath(task.payload.filename, approvedFolder);
      fs.unlinkSync(targetPath);
      return { ok: true, path: targetPath };
    }

    case 'move_file': {
      const fromPath = resolveApprovedPath(task.payload.from, approvedFolder);
      const toPath = resolveApprovedPath(task.payload.to, approvedFolder);
      fs.mkdirSync(path.dirname(toPath), { recursive: true });
      fs.renameSync(fromPath, toPath);
      return { ok: true, from: fromPath, to: toPath };
    }

    case 'list_files': {
      const files = [];

      function walk(currentFolder, prefix) {
        for (const entry of fs.readdirSync(currentFolder, { withFileTypes: true })) {
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
      return { ok: true, files };
    }

    case 'pwd':
      return { ok: true, cwd: approvedFolder };

    case 'summarize_file': {
      const targetPath = resolveApprovedPath(task.payload.filename, approvedFolder);
      return summarizeApprovedFile(targetPath);
    }

    case 'exec_cmd': {
      if (process.env.ALLOW_EXEC_CMD !== 'true') {
        return { ok: false, error: 'exec_cmd is disabled' };
      }

      if (blockedCommandTokens.some((token) => task.payload.command.includes(token))) {
        return { ok: false, error: 'Blocked command' };
      }

      const child = spawnSync(task.payload.command, {
        cwd: approvedFolder,
        shell: true,
        encoding: 'utf8',
        timeout: Number(process.env.EXEC_CMD_TIMEOUT_MS || 15000)
      });

      return {
        ok: child.status === 0,
        code: child.status,
        stdout: String(child.stdout || '').trim(),
        stderr: String(child.stderr || '').trim()
      };
    }

    default:
      return { ok: false, error: `Unsupported task type: ${task.type}` };
  }
}

module.exports = {
  executeTask,
  getApprovedFolder
};
