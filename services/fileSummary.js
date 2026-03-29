const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function clip(value, limit = 800) {
  const text = normalizeWhitespace(value);
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3)}...`;
}

function summarizeText(text) {
  const normalized = String(text || '').replace(/\r/g, '').trim();
  const lines = normalized
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const headings = lines.filter((line) => line.length <= 80 && /^[A-Z0-9][A-Za-z0-9\s:()\-/#&]+$/.test(line)).slice(0, 8);
  const bodyPreview = clip(lines.slice(0, 12).join(' '), 1200);

  return {
    ok: true,
    kind: 'text',
    lineCount: lines.length,
    headings,
    preview: bodyPreview
  };
}

async function summarizeDocx(targetPath) {
  const result = await mammoth.extractRawText({ path: targetPath });
  const textSummary = summarizeText(result.value || '');
  return {
    ok: true,
    kind: 'docx',
    path: targetPath,
    warnings: Array.isArray(result.messages) ? result.messages.map((entry) => entry.message).filter(Boolean) : [],
    text: textSummary
  };
}

function summarizeSpreadsheet(targetPath) {
  const workbook = XLSX.readFile(targetPath, { cellDates: true });
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const headers = Array.isArray(rows[0]) ? rows[0].map((cell) => clip(cell, 80)) : [];
    const sampleRows = rows
      .slice(1, 4)
      .map((row) => Array.isArray(row) ? row.map((cell) => clip(cell, 120)) : []);
    return {
      name: sheetName,
      rowCount: Math.max(rows.length - 1, 0),
      columnCount: headers.length,
      headers,
      sampleRows
    };
  });

  return {
    ok: true,
    kind: 'spreadsheet',
    path: targetPath,
    sheetCount: workbook.SheetNames.length,
    sheets
  };
}

function summarizeDelimited(targetPath) {
  const workbook = XLSX.readFile(targetPath, { raw: false, defval: '' });
  return summarizeSpreadsheet(targetPath, workbook);
}

async function summarizeApprovedFile(targetPath) {
  const extension = path.extname(targetPath).toLowerCase();

  if (extension === '.docx') {
    return summarizeDocx(targetPath);
  }

  if (['.xlsx', '.xls', '.xlsm', '.csv', '.tsv'].includes(extension)) {
    return summarizeDelimited(targetPath);
  }

  const stat = fs.statSync(targetPath);
  if (stat.size > 1024 * 1024) {
    throw new Error('File is too large to summarize safely');
  }

  const content = fs.readFileSync(targetPath, 'utf8');
  return {
    ok: true,
    kind: 'text',
    path: targetPath,
    text: summarizeText(content)
  };
}

module.exports = {
  summarizeApprovedFile
};
