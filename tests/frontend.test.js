const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'Index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
const code = inlineScripts.map((match) => match[1]).join('\n');

function createElement(id) {
  return {
    id,
    value: '',
    textContent: '',
    hidden: false,
    disabled: false,
    className: '',
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; },
    addEventListener() {},
    setAttribute() {}
  };
}

const elements = {};
const document = {
  getElementById(id) {
    if (!elements[id]) elements[id] = createElement(id);
    return elements[id];
  },
  createElement(tag) {
    return createElement(tag);
  }
};

const context = {
  console,
  document,
  window: { addEventListener() {} },
  setTimeout,
  clearTimeout,
  Intl,
  google: {
    charts: { load() {}, setOnLoadCallback() {} },
    visualization: {
      arrayToDataTable(rows) { return rows; },
      LineChart: function () { this.draw = function () {}; },
      BarChart: function () { this.draw = function () {}; },
      ColumnChart: function () { this.draw = function () {}; }
    },
    script: { run: {} }
  }
};
vm.createContext(context);
vm.runInContext(code, context);

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('formatKpiValue_ presents missing, percentage and hour values clearly', () => {
  assert.equal(context.formatKpiValue_(null, 'percent'), '—');
  assert.equal(context.formatKpiValue_(87.5, 'percent'), '87,5%');
  assert.equal(context.formatKpiValue_(12, 'hours'), '12 giờ');
  assert.equal(context.formatKpiValue_(1250, 'number'), '1.250');
});

test('formatShortDate_ keeps chart labels compact and unambiguous', () => {
  assert.equal(context.formatShortDate_('2026-09-13'), '13/09');
});

test('collectFilters reads only the four supported filter values', () => {
  elements['start-date'] = { value: '2026-09-01' };
  elements['end-date'] = { value: '2026-09-13' };
  elements.service = { value: 'Payment API' };
  elements.priority = { value: 'Critical' };

  assert.deepEqual(plain(context.collectFilters()), {
    startDate: '2026-09-01',
    endDate: '2026-09-13',
    service: 'Payment API',
    priority: 'Critical'
  });
});

test('renderKpis writes all four decision metrics', () => {
  context.renderKpis({ total: 40, open: 16, slaRate: 79.2, avgResolutionHours: 12.5 });

  assert.equal(elements['kpi-total'].textContent, '40');
  assert.equal(elements['kpi-open'].textContent, '16');
  assert.equal(elements['kpi-sla'].textContent, '79,2%');
  assert.equal(elements['kpi-resolution'].textContent, '12,5 giờ');
});

test('setView exposes exactly one loading, error, empty or dashboard state', () => {
  ['loading', 'error', 'empty', 'dashboard'].forEach((id) => {
    elements[id] = createElement(id);
  });

  context.setView('empty');

  assert.equal(elements.loading.hidden, true);
  assert.equal(elements.error.hidden, true);
  assert.equal(elements.empty.hidden, false);
  assert.equal(elements.dashboard.hidden, true);
});
