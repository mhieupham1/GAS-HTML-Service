const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'Index.html'), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)];
const code = inlineScripts.map((match) => match[1]).join('\n');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPayload(overrides = {}) {
  const payload = {
    kpis: {
      total: 40,
      open: 16,
      slaRate: 79.2,
      avgResolutionHours: 12.8
    },
    trends: [{ label: '2026-09-13', value: 2 }],
    byService: [{ label: 'Payment API', value: 14 }],
    byStatus: [
      { label: 'Open', value: 9 },
      { label: 'In Progress', value: 7 },
      { label: 'Resolved', value: 24 }
    ],
    urgentTickets: [{
      ticketId: 'INC-002',
      createdAt: '2026-08-25',
      service: 'Payment API',
      category: 'Incident',
      priority: 'Critical',
      status: 'Open',
      assigneeTeam: 'Backend'
    }],
    options: {
      services: ['Customer Portal', 'Payment API'],
      priorities: ['Critical', 'High', 'Medium', 'Low']
    },
    meta: {
      periodStart: '2026-08-25',
      periodEnd: '2026-09-13',
      filteredCount: 40,
      skippedRows: 0,
      generatedAt: '2026-09-13T06:30:00.000Z',
      isSampleData: true
    }
  };

  return Object.assign(payload, overrides);
}

function createHarness({ payload = createPayload(), apiError = null } = {}) {
  const elements = Object.create(null);
  const documentListeners = Object.create(null);
  const windowListeners = Object.create(null);
  const apiCalls = [];
  const chartDraws = [];
  let timerId = 0;

  function flattenChildren(children) {
    return children.flatMap((child) => child && child.isFragment ? child.children : [child]);
  }

  function createElement(tagName = 'div', id = '') {
    const listeners = Object.create(null);
    const attributes = Object.create(null);
    const element = {
      id,
      tagName: String(tagName).toUpperCase(),
      value: '',
      textContent: '',
      hidden: ['error-state', 'empty-state', 'dashboard-state', 'report-details', 'demo-note', 'urgent-empty'].includes(id),
      disabled: false,
      className: '',
      children: [],
      customValidity: '',
      focused: false,
      appendChild(child) {
        this.children.push(...flattenChildren([child]));
        return child;
      },
      replaceChildren(...children) {
        this.children = flattenChildren(children);
      },
      addEventListener(type, handler) {
        if (!listeners[type]) listeners[type] = [];
        listeners[type].push(handler);
      },
      dispatch(type, event = {}) {
        (listeners[type] || []).forEach((handler) => handler(event));
      },
      setAttribute(name, value) {
        attributes[name] = String(value);
      },
      getAttribute(name) {
        return attributes[name];
      },
      setCustomValidity(message) {
        this.customValidity = String(message);
      },
      focus() {
        this.focused = true;
      },
      reset() {
        ['start-date', 'end-date', 'service-filter', 'priority-filter'].forEach((fieldId) => {
          getElement(fieldId).value = '';
        });
      }
    };
    return element;
  }

  function getElement(id) {
    if (!elements[id]) {
      const tagName = id.includes('button') ? 'button' : id.includes('filter') ? 'select' : 'div';
      elements[id] = createElement(tagName, id);
    }
    return elements[id];
  }

  const actionIds = ['apply-button', 'reset-button', 'empty-reset-button', 'retry-button'];
  const document = {
    addEventListener(type, handler) {
      documentListeners[type] = handler;
    },
    getElementById: getElement,
    createElement(tagName) {
      return createElement(tagName);
    },
    createDocumentFragment() {
      const fragment = createElement('fragment');
      fragment.isFragment = true;
      return fragment;
    },
    querySelectorAll(selector) {
      return selector === '[data-action]' ? actionIds.map(getElement) : [];
    }
  };

  let successHandler;
  let failureHandler;
  const runner = {
    withSuccessHandler(handler) {
      successHandler = handler;
      return runner;
    },
    withFailureHandler(handler) {
      failureHandler = handler;
      return runner;
    },
    getDashboardData(filters) {
      apiCalls.push(clone(filters));
      if (apiError) {
        failureHandler(apiError);
      } else {
        successHandler(clone(payload));
      }
    }
  };

  function Chart(type, container) {
    this.draw = (data, options) => {
      chartDraws.push({ type, containerId: container.id, data: clone(data), options: clone(options) });
    };
  }

  const google = {
    charts: {
      load() {},
      setOnLoadCallback(callback) {
        callback();
      }
    },
    visualization: {
      arrayToDataTable(rows) {
        return rows;
      },
      LineChart: function (container) { return new Chart('line', container); },
      BarChart: function (container) { return new Chart('bar', container); },
      ColumnChart: function (container) { return new Chart('column', container); }
    },
    script: { run: runner }
  };

  const window = {
    google,
    addEventListener(type, handler) {
      windowListeners[type] = handler;
    },
    setTimeout() {
      timerId += 1;
      return timerId;
    },
    clearTimeout() {}
  };

  const context = {
    console,
    document,
    window,
    google,
    Intl,
    Date
  };
  vm.createContext(context);
  vm.runInContext(code, context);

  return {
    elements,
    apiCalls,
    chartDraws,
    start() {
      assert.equal(typeof documentListeners.DOMContentLoaded, 'function');
      documentListeners.DOMContentLoaded();
    },
    dispatch(id, type, event = {}) {
      getElement(id).dispatch(type, event);
    },
    getElement,
    windowListeners
  };
}

test('initialization loads data and renders the current English dashboard', () => {
  const harness = createHarness();
  harness.start();

  assert.deepEqual(harness.apiCalls, [{ startDate: '', endDate: '', service: '', priority: '' }]);
  assert.equal(harness.getElement('kpi-total').textContent, '40');
  assert.equal(harness.getElement('kpi-open').textContent, '16');
  assert.equal(harness.getElement('kpi-sla').textContent, '79.2');
  assert.equal(harness.getElement('kpi-sla-unit').textContent, '%');
  assert.equal(harness.getElement('kpi-resolution').textContent, '12.8');
  assert.equal(harness.getElement('kpi-resolution-unit').textContent, 'hours');
  assert.equal(harness.getElement('dashboard-state').hidden, false);
  assert.equal(harness.getElement('report-details').hidden, false);
  assert.equal(harness.getElement('loading-state').hidden, true);
  assert.equal(harness.getElement('demo-note').hidden, false);
  assert.equal(harness.getElement('skipped-rows').textContent, '0');
});

test('initialization renders filters, urgent tickets, and all three charts', () => {
  const harness = createHarness();
  harness.start();

  assert.deepEqual(
    harness.getElement('service-filter').children.map((option) => option.textContent),
    ['All services', 'Customer Portal', 'Payment API']
  );
  assert.deepEqual(
    harness.getElement('priority-filter').children.map((option) => option.textContent),
    ['All priorities', 'Critical', 'High', 'Medium', 'Low']
  );
  assert.equal(harness.getElement('urgent-table-body').children.length, 1);
  assert.equal(harness.getElement('urgent-table-body').children[0].children[0].textContent, 'INC-002');
  assert.equal(harness.getElement('urgent-table-wrap').hidden, false);
  assert.equal(harness.getElement('urgent-empty').hidden, true);
  assert.deepEqual(harness.chartDraws.map((draw) => draw.type), ['line', 'bar', 'column']);
  assert.deepEqual(harness.chartDraws[0].data, [
    ['Date', 'Tickets'],
    ['09/13', 2]
  ]);
});

test('submitting valid filters sends exactly the supported values', () => {
  const harness = createHarness();
  harness.start();
  harness.getElement('start-date').value = '2026-09-01';
  harness.getElement('end-date').value = '2026-09-13';
  harness.getElement('service-filter').value = 'Payment API';
  harness.getElement('priority-filter').value = 'Critical';
  let prevented = false;

  harness.dispatch('filter-form', 'submit', {
    preventDefault() {
      prevented = true;
    }
  });

  assert.equal(prevented, true);
  assert.deepEqual(harness.apiCalls.at(-1), {
    startDate: '2026-09-01',
    endDate: '2026-09-13',
    service: 'Payment API',
    priority: 'Critical'
  });
});

test('an invalid date range is rejected before calling the backend', () => {
  const harness = createHarness();
  harness.start();
  harness.getElement('start-date').value = '2026-09-13';
  harness.getElement('end-date').value = '2026-09-01';
  const callsBeforeSubmit = harness.apiCalls.length;

  harness.dispatch('filter-form', 'submit', { preventDefault() {} });

  assert.equal(harness.apiCalls.length, callsBeforeSubmit);
  assert.equal(harness.getElement('date-error').hidden, false);
  assert.equal(
    harness.getElement('date-error').textContent,
    'The start date cannot be later than the end date.'
  );
  assert.equal(harness.getElement('start-date').customValidity, 'The start date cannot be later than the end date.');
  assert.equal(harness.getElement('start-date').getAttribute('aria-invalid'), 'true');
  assert.equal(harness.getElement('end-date').getAttribute('aria-invalid'), 'true');
});

test('an empty backend result exposes only the empty state and report details', () => {
  const payload = createPayload({
    kpis: { total: 0, open: 0, slaRate: null, avgResolutionHours: null },
    trends: [],
    byService: [],
    byStatus: [
      { label: 'Open', value: 0 },
      { label: 'In Progress', value: 0 },
      { label: 'Resolved', value: 0 }
    ],
    urgentTickets: [],
    meta: Object.assign(createPayload().meta, { filteredCount: 0 })
  });
  const harness = createHarness({ payload });
  harness.start();

  assert.equal(harness.getElement('empty-state').hidden, false);
  assert.equal(harness.getElement('dashboard-state').hidden, true);
  assert.equal(harness.getElement('loading-state').hidden, true);
  assert.equal(harness.getElement('error-state').hidden, true);
  assert.equal(harness.getElement('report-details').hidden, false);
  assert.equal(harness.chartDraws.length, 0);
});

test('a backend failure exposes the error message and re-enables actions', () => {
  const harness = createHarness({ apiError: { message: 'The "Tickets" sheet was not found.' } });
  harness.start();

  assert.equal(harness.getElement('error-state').hidden, false);
  assert.equal(harness.getElement('loading-state').hidden, true);
  assert.equal(harness.getElement('dashboard-state').hidden, true);
  assert.equal(harness.getElement('report-details').hidden, true);
  assert.equal(harness.getElement('error-message').textContent, 'The "Tickets" sheet was not found.');
  ['apply-button', 'reset-button', 'empty-reset-button', 'retry-button'].forEach((id) => {
    assert.equal(harness.getElement(id).disabled, false);
  });
});

test('missing KPI values are rendered without misleading units', () => {
  const payload = createPayload({
    kpis: { total: 0, open: 0, slaRate: null, avgResolutionHours: null }
  });
  const harness = createHarness({ payload });
  harness.start();

  assert.equal(harness.getElement('kpi-sla').textContent, '—');
  assert.equal(harness.getElement('kpi-sla-unit').textContent, '');
  assert.equal(harness.getElement('kpi-resolution').textContent, '—');
  assert.equal(harness.getElement('kpi-resolution-unit').textContent, '');
});
