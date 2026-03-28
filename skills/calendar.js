function calendarMock() {
  return [
    'Calendar workflow started.',
    '',
    'Mode: mock',
    'Automation: disabled',
    'Output:',
    '- Review bookings manually',
    '- Confirm the next available slot with the customer',
    '- Record the final appointment in your real calendar system'
  ].join('\n');
}

module.exports = { calendarMock };
