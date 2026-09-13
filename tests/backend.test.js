const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const code = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');
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

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseCsv(file) {
  return fs.readFileSync(file, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.split(','));
}

function createSpreadsheet(values, timeZone = 'Asia/Ho_Chi_Minh') {
  return {
    getSheetByName(name) {
      return name === 'Tickets'
        ? { getDataRange: () => ({ getValues: () => values }) }
        : null;
    },
    getSpreadsheetTimeZone() {
      return timeZone;
    }
  };
}

function createContext(spreadsheet) {
  const context = {
    console,
    Date,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => spreadsheet
    },
    Session: {
      getScriptTimeZone: () => 'UTC'
    },
    Utilities: {
      formatDate(date, _timeZone, pattern) {
        assert.equal(pattern, 'yyyy-MM-dd');
        return date.toISOString().slice(0, 10);
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

const SMALL_DATASET = [
  HEADERS,
  ['INC-001', '2026-09-10', 'Payment API', 'Incident', 'Critical', 'Open', 'Backend', '', '', ''],
  ['INC-002', '2026-09-10', 'Mobile App', 'Bug', 'High', 'Resolved', 'Mobile', '2026-09-10', 4, 'Yes'],
  ['INC-003', '2026-09-11', 'Payment API', 'Bug', 'Medium', 'Resolved', 'Backend', '2026-09-12', 20, 'No'],
  ['INC-004', '2026-09-12', 'Customer Portal', 'Access', 'Low', 'In Progress', 'Support', '', '', '']
];

test('getDashboardData calculates KPIs, series, options, and urgent tickets', () => {
  const context = createContext(createSpreadsheet(SMALL_DATASET));
  const result = plain(context.getDashboardData({}));

  assert.deepEqual(result.kpis, {
    total: 4,
    open: 2,
    slaRate: 50,
    avgResolutionHours: 12
  });
  assert.deepEqual(result.trends, [
    { label: '2026-09-10', value: 2 },
    { label: '2026-09-11', value: 1 },
    { label: '2026-09-12', value: 1 }
  ]);
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
  assert.deepEqual(result.options, {
    services: ['Customer Portal', 'Mobile App', 'Payment API'],
    priorities: ['Critical', 'High', 'Medium', 'Low']
  });
  assert.equal(result.urgentTickets.length, 1);
  assert.equal(result.urgentTickets[0].ticketId, 'INC-001');
  assert.equal(result.meta.periodStart, '2026-09-10');
  assert.equal(result.meta.periodEnd, '2026-09-12');
  assert.equal(result.meta.filteredCount, 4);
  assert.equal(result.meta.skippedRows, 0);
  assert.equal(result.meta.isSampleData, true);
  assert.ok(Number.isFinite(Date.parse(result.meta.generatedAt)));
});

test('getDashboardData matches all expected metrics for sample-data.csv', () => {
  const values = parseCsv(path.join(ROOT, 'sample-data.csv'));
  const context = createContext(createSpreadsheet(values));
  const result = plain(context.getDashboardData({}));

  assert.deepEqual(result.kpis, {
    total: 40,
    open: 16,
    slaRate: 79.2,
    avgResolutionHours: 12.8
  });
  assert.deepEqual(result.byService[0], { label: 'Payment API', value: 14 });
  assert.equal(result.urgentTickets.length, 10);
  assert.equal(result.meta.skippedRows, 0);
});

test('filters are exact and date boundaries are inclusive', () => {
  const context = createContext(createSpreadsheet(SMALL_DATASET));
  const result = plain(context.getDashboardData({
    startDate: '2026-09-11',
    endDate: '2026-09-12',
    service: 'Payment API',
    priority: 'Medium'
  }));

  assert.equal(result.kpis.total, 1);
  assert.deepEqual(result.trends, [{ label: '2026-09-11', value: 1 }]);
  assert.equal(result.meta.periodStart, '2026-09-11');
  assert.equal(result.meta.periodEnd, '2026-09-12');
  assert.deepEqual(result.options.services, ['Customer Portal', 'Mobile App', 'Payment API']);
});

test('a filter with no matches returns meaningful empty metrics', () => {
  const context = createContext(createSpreadsheet(SMALL_DATASET));
  const result = plain(context.getDashboardData({ service: 'Unknown Service' }));

  assert.deepEqual(result.kpis, {
    total: 0,
    open: 0,
    slaRate: null,
    avgResolutionHours: null
  });
  assert.deepEqual(result.trends, []);
  assert.deepEqual(result.byService, []);
  assert.deepEqual(result.byStatus, [
    { label: 'Open', value: 0 },
    { label: 'In Progress', value: 0 },
    { label: 'Resolved', value: 0 }
  ]);
  assert.deepEqual(result.urgentTickets, []);
  assert.equal(result.meta.filteredCount, 0);
});

test('invalid ticket rows are skipped and reported', () => {
  const values = [
    HEADERS,
    ['INC-101', '2026-09-01', 'Payment API', 'Bug', 'High', 'Resolved', 'Backend', '2026-09-01', 6, 'Yes'],
    ['INC-102', 'bad-date', 'Mobile App', 'Bug', 'Low', 'Open', 'Mobile', '', '', ''],
    ['INC-103', '2026-09-02', 'Mobile App', 'Access', 'Medium', 'Open', 'Support', '', '', ''],
    ['INC-104', '2026-09-03', 'Mobile App', 'Bug', 'Low', 'Open', 'Mobile', '', 5, '']
  ];
  const context = createContext(createSpreadsheet(values));
  const result = plain(context.getDashboardData({}));

  assert.equal(result.kpis.total, 2);
  assert.equal(result.meta.skippedRows, 2);
  assert.deepEqual(result.trends, [
    { label: '2026-09-01', value: 1 },
    { label: '2026-09-02', value: 1 }
  ]);
});

test('Google Sheets Date values are normalized to YYYY-MM-DD', () => {
  const values = [
    HEADERS,
    ['INC-201', new Date('2026-09-13T00:00:00.000Z'), 'Payment API', 'Bug', 'Critical', 'Open', 'Backend', '', '', '']
  ];
  const context = createContext(createSpreadsheet(values, 'UTC'));
  const result = plain(context.getDashboardData({}));

  assert.deepEqual(result.trends, [{ label: '2026-09-13', value: 1 }]);
  assert.equal(result.urgentTickets[0].createdAt, '2026-09-13');
});

test('invalid filters and date ranges return clear English errors', () => {
  const context = createContext(createSpreadsheet(SMALL_DATASET));

  assert.throws(
    () => context.getDashboardData({ startDate: '2026-02-30' }),
    /Start date is invalid\. Use the YYYY-MM-DD format\./
  );
  assert.throws(
    () => context.getDashboardData({ startDate: '2026-09-12', endDate: '2026-09-11' }),
    /The start date cannot be later than the end date\./
  );
});

test('missing spreadsheet, sheet, header row, and columns return clear errors', async (t) => {
  await t.test('active spreadsheet', () => {
    const context = createContext(null);
    assert.throws(
      () => context.getDashboardData({}),
      /No active spreadsheet was found\./
    );
  });

  await t.test('Tickets sheet', () => {
    const spreadsheet = {
      getSheetByName: () => null,
      getSpreadsheetTimeZone: () => 'UTC'
    };
    const context = createContext(spreadsheet);
    assert.throws(
      () => context.getDashboardData({}),
      /The "Tickets" sheet was not found\./
    );
  });

  await t.test('header row', () => {
    const context = createContext(createSpreadsheet([]));
    assert.throws(
      () => context.getDashboardData({}),
      /The "Tickets" sheet does not have a header row\./
    );
  });

  await t.test('required columns', () => {
    const context = createContext(createSpreadsheet([['ticket_id', 'created_at']]));
    assert.throws(
      () => context.getDashboardData({}),
      /Missing required columns in the "Tickets" sheet: service, category, priority, status, assignee_team, resolved_at, resolution_hours, sla_met\./
    );
  });
});
