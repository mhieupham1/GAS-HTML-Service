const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const HEADERS = [
  'ticket_id',
  'created_at',
  'service',
  'category',
  'priority',
  'status',
  'assignee_team',
  'resolved_at',
  'resolution_hours',
  'sla_met'
];

function parseCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = lines.slice(1).map((line) => {
    const values = line.split(',');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
  });
  return { headers, rows };
}

test('sample CSV represents 40 valid tickets', () => {
  const { headers, rows } = parseCsv(path.join(ROOT, 'sample-data.csv'));

  assert.deepEqual(headers, HEADERS);
  assert.equal(rows.length, 40);
  assert.equal(new Set(rows.map((row) => row.ticket_id)).size, 40);

  const statusCounts = Object.fromEntries(
    ['Resolved', 'Open', 'In Progress'].map((status) => [
      status,
      rows.filter((row) => row.status === status).length
    ])
  );
  assert.deepEqual(statusCounts, { Resolved: 24, Open: 9, 'In Progress': 7 });

  const serviceCounts = Object.fromEntries(
    ['Payment API', 'Customer Portal', 'Mobile App', 'Internal Network'].map((service) => [
      service,
      rows.filter((row) => row.service === service).length
    ])
  );
  assert.deepEqual(serviceCounts, {
    'Payment API': 14,
    'Customer Portal': 11,
    'Mobile App': 9,
    'Internal Network': 6
  });

  const ticketsPerDay = Object.values(rows.reduce((counts, row) => {
    counts[row.created_at] = (counts[row.created_at] || 0) + 1;
    return counts;
  }, {}));
  assert.deepEqual([...new Set(ticketsPerDay)].sort(), [1, 2, 3]);

  rows.forEach((row) => {
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(['Low', 'Medium', 'High', 'Critical'].includes(row.priority));
    assert.ok(['Open', 'In Progress', 'Resolved'].includes(row.status));
    assert.ok(['Yes', 'No', ''].includes(row.sla_met));

    if (row.status === 'Resolved') {
      assert.match(row.resolved_at, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(Number(row.resolution_hours) > 0);
      assert.ok(['Yes', 'No'].includes(row.sla_met));
    } else {
      assert.equal(row.resolved_at, '');
      assert.equal(row.resolution_hours, '');
      assert.equal(row.sla_met, '');
    }
  });
});
