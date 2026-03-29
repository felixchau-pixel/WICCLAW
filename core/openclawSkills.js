const APPROVED_OPENCLAW_SKILLS = Object.freeze([
  'weather',
  'healthcheck',
  'node-connect',
  'gog',
  'himalaya',
  'word-docx',
  'excel-xlsx',
  'productivity'
]);

function getApprovedOpenClawSkills() {
  return [...APPROVED_OPENCLAW_SKILLS];
}

module.exports = {
  APPROVED_OPENCLAW_SKILLS,
  getApprovedOpenClawSkills
};
