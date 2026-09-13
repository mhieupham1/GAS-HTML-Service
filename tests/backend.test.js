const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const code = fs.readFileSync(path.resolve(__dirname, '..', 'Code.gs'), 'utf8');
const context = { console };
vm.createContext(context);
vm.runInContext(code, context);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function ticket(ticketId, createdAt, service, priority, status, resolvedAt, resolutionHours, slaMet) {
  return {
    ticketId,
    createdAt,
    service,
    category: 'Bug',
    priority,
    status,
    assigneeTeam: 'Backend',
    resolvedAt,
    resolutionHours,
    slaMet
  };
}

const records = [
  ticket('INC-001', '2026-09-10', 'Payment API', 'Critical', 'Open', '', '', ''),
  ticket('INC-002', '2026-09-10', 'Mobile App', 'High', 'Resolved', '2026-09-10', 4, 'Yes'),
  ticket('INC-003', '2026-09-11', 'Payment API', 'Medium', 'Resolved', '2026-09-12', 20, 'No'),
  ticket('INC-004', '2026-09-12', 'Customer Portal', 'Low', 'In Progress', '', '', '')
];

test('buildDashboardData_ calculates KPI and urgent tickets', () => {
  const result = plain(context.buildDashboardData_(records, {}, 0));

  assert.deepEqual(result.kpis, {
    total: 4,
    open: 2,
    slaRate: 50,
    avgResolutionHours: 12
  });
  assert.equal(result.urgentTickets.length, 1);
  assert.equal(result.urgentTickets[0].ticketId, 'INC-001');
  assert.deepEqual(result.byService, [
    { label: 'Payment API', value: 2 },
    { label: 'Customer Portal', value: 1 },
    { label: 'Mobile App', value: 1 }
  ]);
  assert.deepEqual(result.byStatus, [
    { label: 'Open', value: 1 },
    { label: 'In Progress', value: 1 },
    { label: 'Resolved', value: 2 }
  ]);
});

test('buildDashboardData_ applies inclusive date, service and priority filters', () => {
  const result = plain(context.buildDashboardData_(records, {
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    service: 'Payment API',
    priority: 'Medium'
  }, 0));

  assert.equal(result.kpis.total, 1);
  assert.equal(result.meta.periodStart, '2026-09-11');
  assert.equal(result.meta.periodEnd, '2026-09-12');
  assert.deepEqual(result.trends, [{ label: '2026-09-11', value: 1 }]);
  assert.deepEqual(result.options.services, ['Customer Portal', 'Mobile App', 'Payment API']);
  assert.deepEqual(result.options.priorities, ['Critical', 'High', 'Medium', 'Low']);
});

test('buildDashboardData_ returns meaningful empty metrics', () => {
  const result = plain(context.buildDashboardData_(records, { service: 'Unknown' }, 2));

  assert.deepEqual(result.kpis, {
    total: 0,
    open: 0,
    slaRate: null,
    avgResolutionHours: null
  });
  assert.deepEqual(result.trends, []);
  assert.equal(result.meta.filteredCount, 0);
  assert.equal(result.meta.skippedRows, 2);
});

test('normalizeRows_ converts valid sheet rows and skips malformed rows', () => {
  const values = [
    [
      'ticket_id', 'created_at', 'service', 'category', 'priority',
      'status', 'assignee_team', 'resolved_at', 'resolution_hours', 'sla_met'
    ],
    ['INC-101', '2026-09-01', 'Payment API', 'Bug', 'High', 'Resolved', 'Backend', '2026-09-01', 6, 'Yes'],
    ['INC-102', 'bad-date', 'Mobile App', 'Bug', 'Low', 'Open', 'Frontend', '', '', ''],
    ['INC-103', '2026-09-02', 'Mobile App', 'Access', 'Medium', 'Open', 'Frontend', '', '', '']
  ];

  const result = plain(context.normalizeRows_(values));

  assert.equal(result.skippedRows, 1);
  assert.deepEqual(result.records, [
    {
      ticketId: 'INC-101',
      createdAt: '2026-09-01',
      service: 'Payment API',
      category: 'Bug',
      priority: 'High',
      status: 'Resolved',
      assigneeTeam: 'Backend',
      resolvedAt: '2026-09-01',
      resolutionHours: 6,
      slaMet: 'Yes'
    },
    {
      ticketId: 'INC-103',
      createdAt: '2026-09-02',
      service: 'Mobile App',
      category: 'Access',
      priority: 'Medium',
      status: 'Open',
      assigneeTeam: 'Frontend',
      resolvedAt: '',
      resolutionHours: null,
      slaMet: ''
    }
  ]);
});

test('normalizeRows_ reports all missing required columns', () => {
  assert.throws(
    () => context.normalizeRows_([['ticket_id', 'created_at']]),
    /Thiếu cột bắt buộc: service, category, priority, status, assignee_team, resolved_at, resolution_hours, sla_met/
  );
});

test('readTickets_ reports a missing Tickets sheet', () => {
  context.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({ getSheetByName: () => null })
  };

  assert.throws(
    () => context.readTickets_(),
    /Không tìm thấy sheet "Tickets"/
  );
});

test('getDashboardData reads and aggregates the active Tickets sheet', () => {
  const values = [
    [
      'ticket_id', 'created_at', 'service', 'category', 'priority',
      'status', 'assignee_team', 'resolved_at', 'resolution_hours', 'sla_met'
    ],
    ['INC-201', '2026-09-13', 'Payment API', 'Bug', 'Critical', 'Open', 'Backend', '', '', '']
  ];
  context.SpreadsheetApp = {
    getActiveSpreadsheet: () => ({
      getSheetByName: (name) => name === 'Tickets' ? {
        getDataRange: () => ({ getValues: () => values })
      } : null
    })
  };

  const result = plain(context.getDashboardData({ priority: 'Critical' }));

  assert.equal(result.kpis.total, 1);
  assert.equal(result.kpis.open, 1);
  assert.equal(result.urgentTickets[0].ticketId, 'INC-201');
});
