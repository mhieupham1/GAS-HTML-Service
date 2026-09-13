var TICKETS_SHEET_NAME = 'Tickets';
var REQUIRED_HEADERS = [
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
var VALID_PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
var VALID_STATUSES = ['Open', 'In Progress', 'Resolved'];
// Set to true only when the Tickets sheet intentionally contains demonstration data.
var IS_SAMPLE_DATA = false;

/**
 * Serves the dashboard UI from Index.html.
 *
 * @return {HtmlOutput}
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('IT Ticket & SLA Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Reads, validates, filters, and aggregates ticket data for the dashboard.
 *
 * @param {Object=} filters Dashboard filters.
 * @return {Object} Dashboard payload containing no Date objects.
 */
function getDashboardData(filters) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Không tìm thấy bảng tính đang hoạt động. Hãy liên kết dự án Apps Script với Google Sheet chứa dữ liệu.');
  }

  var sheet = spreadsheet.getSheetByName(TICKETS_SHEET_NAME);

  if (!sheet) {
    throw new Error('Không tìm thấy trang tính "Tickets".');
  }

  var values = sheet.getDataRange().getValues();
  if (values.length === 0 || values[0].length === 0) {
    throw new Error('Trang tính "Tickets" không có hàng tiêu đề.');
  }

  var headerMap = buildHeaderMap_(values[0]);
  assertRequiredHeaders_(headerMap);

  var timeZone = spreadsheet.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  var normalizedFilters = normalizeFilters_(filters, timeZone);
  var parsed = parseTicketRows_(values.slice(1), headerMap, timeZone);
  var allTickets = parsed.tickets;
  var filteredTickets = filterTickets_(allTickets, normalizedFilters);
  var dataBounds = getDateBounds_(allTickets);

  return {
    kpis: buildKpis_(filteredTickets),
    trends: buildTrends_(filteredTickets),
    byService: buildCountSeries_(filteredTickets, 'service'),
    byStatus: buildStatusSeries_(filteredTickets),
    urgentTickets: buildUrgentTickets_(filteredTickets),
    options: buildOptions_(allTickets),
    meta: {
      periodStart: normalizedFilters.startDate || (normalizedFilters.endDate ? null : dataBounds.start),
      periodEnd: normalizedFilters.endDate || (normalizedFilters.startDate ? null : dataBounds.end),
      filteredCount: filteredTickets.length,
      skippedRows: parsed.skippedRows,
      generatedAt: new Date().toISOString(),
      isSampleData: IS_SAMPLE_DATA
    }
  };
}

/**
 * Builds a header-name-to-column-index lookup.
 *
 * @param {Array<*>} headerRow
 * @return {Object}
 */
function buildHeaderMap_(headerRow) {
  var headerMap = {};

  headerRow.forEach(function(header, index) {
    var name = String(header == null ? '' : header).trim();
    if (name && !Object.prototype.hasOwnProperty.call(headerMap, name)) {
      headerMap[name] = index;
    }
  });

  return headerMap;
}

/**
 * Ensures that every required source column exists.
 *
 * @param {Object} headerMap
 */
function assertRequiredHeaders_(headerMap) {
  var missingHeaders = REQUIRED_HEADERS.filter(function(header) {
    return !Object.prototype.hasOwnProperty.call(headerMap, header);
  });

  if (missingHeaders.length > 0) {
    throw new Error('Thiếu cột bắt buộc trong trang tính "Tickets": ' + missingHeaders.join(', ') + '.');
  }
}

/**
 * Normalizes client filters and validates the requested date range.
 *
 * @param {Object=} filters
 * @param {string} timeZone
 * @return {Object}
 */
function normalizeFilters_(filters, timeZone) {
  var source = filters && typeof filters === 'object' ? filters : {};
  var startDate = parseOptionalFilterDate_(source.startDate, 'Ngày bắt đầu', timeZone);
  var endDate = parseOptionalFilterDate_(source.endDate, 'Ngày kết thúc', timeZone);

  if (startDate && endDate && startDate > endDate) {
    throw new Error('Ngày bắt đầu không được sau ngày kết thúc.');
  }

  return {
    startDate: startDate,
    endDate: endDate,
    service: cleanString_(source.service),
    priority: cleanString_(source.priority)
  };
}

/**
 * Converts an optional date filter to YYYY-MM-DD.
 *
 * @param {*} value
 * @param {string} label
 * @param {string} timeZone
 * @return {string}
 */
function parseOptionalFilterDate_(value, label, timeZone) {
  if (isEmpty_(value)) {
    return '';
  }

  var parsed = parseDateValue_(value, timeZone);
  if (!parsed) {
    throw new Error(label + ' không hợp lệ. Vui lòng dùng định dạng YYYY-MM-DD.');
  }

  return parsed;
}

/**
 * Normalizes valid sheet rows and counts rejected rows.
 *
 * @param {Array<Array<*>>} rows
 * @param {Object} headerMap
 * @param {string} timeZone
 * @return {{tickets: Array<Object>, skippedRows: number}}
 */
function parseTicketRows_(rows, headerMap, timeZone) {
  var tickets = [];
  var skippedRows = 0;

  rows.forEach(function(row) {
    var ticket = normalizeTicketRow_(row, headerMap, timeZone);
    if (ticket) {
      tickets.push(ticket);
    } else {
      skippedRows += 1;
    }
  });

  return {tickets: tickets, skippedRows: skippedRows};
}

/**
 * Converts one source row to the dashboard's camelCase ticket shape.
 * Returns null when any business rule is violated.
 *
 * @param {Array<*>} row
 * @param {Object} headerMap
 * @param {string} timeZone
 * @return {?Object}
 */
function normalizeTicketRow_(row, headerMap, timeZone) {
  var ticketId = cleanString_(row[headerMap.ticket_id]);
  var createdAt = parseDateValue_(row[headerMap.created_at], timeZone);
  var service = cleanString_(row[headerMap.service]);
  var category = cleanString_(row[headerMap.category]);
  var priority = cleanString_(row[headerMap.priority]);
  var status = cleanString_(row[headerMap.status]);
  var assigneeTeam = cleanString_(row[headerMap.assignee_team]);
  var rawResolvedAt = row[headerMap.resolved_at];
  var rawResolutionHours = row[headerMap.resolution_hours];
  var rawSlaMet = row[headerMap.sla_met];

  if (!ticketId || !createdAt || !service || !category || !assigneeTeam) {
    return null;
  }

  if (VALID_PRIORITIES.indexOf(priority) === -1 || VALID_STATUSES.indexOf(status) === -1) {
    return null;
  }

  var resolvedAt = '';
  var resolutionHours = null;
  var slaMet = '';

  if (status === 'Resolved') {
    resolvedAt = parseDateValue_(rawResolvedAt, timeZone);
    resolutionHours = parseNonNegativeNumber_(rawResolutionHours);
    slaMet = cleanString_(rawSlaMet);

    if (!resolvedAt || resolvedAt < createdAt || resolutionHours === null ||
        (slaMet !== 'Yes' && slaMet !== 'No')) {
      return null;
    }
  } else if (!isEmpty_(rawResolvedAt) || !isEmpty_(rawResolutionHours) || !isEmpty_(rawSlaMet)) {
    return null;
  }

  return {
    ticketId: ticketId,
    createdAt: createdAt,
    service: service,
    category: category,
    priority: priority,
    status: status,
    assigneeTeam: assigneeTeam,
    resolvedAt: resolvedAt,
    resolutionHours: resolutionHours,
    slaMet: slaMet
  };
}

/**
 * Accepts a Date object or a strict YYYY-MM-DD string and returns YYYY-MM-DD.
 *
 * @param {*} value
 * @param {string} timeZone
 * @return {string}
 */
function parseDateValue_(value, timeZone) {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) {
      return '';
    }
    return Utilities.formatDate(value, timeZone, 'yyyy-MM-dd');
  }

  if (typeof value !== 'string') {
    return '';
  }

  var text = value.trim();
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) {
    return '';
  }

  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (!isValidCalendarDate_(year, month, day)) {
    return '';
  }

  return text;
}

/**
 * Checks a calendar date without relying on timezone-sensitive string parsing.
 *
 * @param {number} year
 * @param {number} month
 * @param {number} day
 * @return {boolean}
 */
function isValidCalendarDate_(year, month, day) {
  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  var daysInMonth = [31, isLeapYear_(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

/**
 * @param {number} year
 * @return {boolean}
 */
function isLeapYear_(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * Converts a numeric sheet value to a non-negative finite number.
 *
 * @param {*} value
 * @return {?number}
 */
function parseNonNegativeNumber_(value) {
  if (typeof value === 'number') {
    return isFinite(value) && value >= 0 ? value : null;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    var numberValue = Number(value.trim());
    return isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
  }

  return null;
}

/**
 * Applies an inclusive date range and exact service/priority filters.
 *
 * @param {Array<Object>} tickets
 * @param {Object} filters
 * @return {Array<Object>}
 */
function filterTickets_(tickets, filters) {
  return tickets.filter(function(ticket) {
    if (filters.startDate && ticket.createdAt < filters.startDate) {
      return false;
    }
    if (filters.endDate && ticket.createdAt > filters.endDate) {
      return false;
    }
    if (filters.service && ticket.service !== filters.service) {
      return false;
    }
    if (filters.priority && ticket.priority !== filters.priority) {
      return false;
    }
    return true;
  });
}

/**
 * Calculates the four headline metrics.
 *
 * @param {Array<Object>} tickets
 * @return {Object}
 */
function buildKpis_(tickets) {
  var open = 0;
  var slaYes = 0;
  var slaNo = 0;
  var resolutionTotal = 0;
  var resolvedCount = 0;

  tickets.forEach(function(ticket) {
    if (ticket.status !== 'Resolved') {
      open += 1;
    } else {
      resolutionTotal += ticket.resolutionHours;
      resolvedCount += 1;
    }

    if (ticket.slaMet === 'Yes') {
      slaYes += 1;
    } else if (ticket.slaMet === 'No') {
      slaNo += 1;
    }
  });

  var slaTotal = slaYes + slaNo;
  return {
    total: tickets.length,
    open: open,
    slaRate: slaTotal > 0 ? roundToOneDecimal_(slaYes / slaTotal * 100) : null,
    avgResolutionHours: resolvedCount > 0 ? roundToOneDecimal_(resolutionTotal / resolvedCount) : null
  };
}

/**
 * Counts tickets by creation date in ascending date order.
 *
 * @param {Array<Object>} tickets
 * @return {Array<{label: string, value: number}>}
 */
function buildTrends_(tickets) {
  var counts = Object.create(null);
  tickets.forEach(function(ticket) {
    counts[ticket.createdAt] = (counts[ticket.createdAt] || 0) + 1;
  });

  return Object.keys(counts).sort().map(function(label) {
    return {label: label, value: counts[label]};
  });
}

/**
 * Counts tickets by a string property, highest count first then label A-Z.
 *
 * @param {Array<Object>} tickets
 * @param {string} propertyName
 * @return {Array<{label: string, value: number}>}
 */
function buildCountSeries_(tickets, propertyName) {
  var counts = Object.create(null);
  tickets.forEach(function(ticket) {
    var label = ticket[propertyName];
    counts[label] = (counts[label] || 0) + 1;
  });

  return Object.keys(counts).map(function(label) {
    return {label: label, value: counts[label]};
  }).sort(function(left, right) {
    return right.value - left.value || compareLabels_(left.label, right.label);
  });
}

/**
 * Counts all supported statuses in the required display order.
 *
 * @param {Array<Object>} tickets
 * @return {Array<{label: string, value: number}>}
 */
function buildStatusSeries_(tickets) {
  var counts = {Open: 0, 'In Progress': 0, Resolved: 0};
  tickets.forEach(function(ticket) {
    counts[ticket.status] += 1;
  });

  return VALID_STATUSES.map(function(status) {
    return {label: status, value: counts[status]};
  });
}

/**
 * Selects unresolved Critical/High tickets in urgency and age order.
 *
 * @param {Array<Object>} tickets
 * @return {Array<Object>}
 */
function buildUrgentTickets_(tickets) {
  var priorityRank = {Critical: 0, High: 1};

  return tickets.filter(function(ticket) {
    return ticket.status !== 'Resolved' && Object.prototype.hasOwnProperty.call(priorityRank, ticket.priority);
  }).sort(function(left, right) {
    return priorityRank[left.priority] - priorityRank[right.priority] ||
      compareLabels_(left.createdAt, right.createdAt) ||
      compareLabels_(left.ticketId, right.ticketId);
  }).map(function(ticket) {
    return {
      ticketId: ticket.ticketId,
      createdAt: ticket.createdAt,
      service: ticket.service,
      category: ticket.category,
      priority: ticket.priority,
      status: ticket.status,
      assigneeTeam: ticket.assigneeTeam
    };
  });
}

/**
 * Builds filter options from all valid rows before filters are applied.
 *
 * @param {Array<Object>} tickets
 * @return {{services: Array<string>, priorities: Array<string>}}
 */
function buildOptions_(tickets) {
  var serviceSet = Object.create(null);
  var prioritySet = Object.create(null);

  tickets.forEach(function(ticket) {
    serviceSet[ticket.service] = true;
    prioritySet[ticket.priority] = true;
  });

  return {
    services: Object.keys(serviceSet).sort(compareLabels_),
    priorities: VALID_PRIORITIES.filter(function(priority) {
      return Boolean(prioritySet[priority]);
    })
  };
}

/**
 * Finds the full valid dataset's creation-date bounds.
 *
 * @param {Array<Object>} tickets
 * @return {{start: ?string, end: ?string}}
 */
function getDateBounds_(tickets) {
  if (tickets.length === 0) {
    return {start: null, end: null};
  }

  var dates = tickets.map(function(ticket) {
    return ticket.createdAt;
  }).sort();

  return {start: dates[0], end: dates[dates.length - 1]};
}

/**
 * @param {*} value
 * @return {string}
 */
function cleanString_(value) {
  return value == null ? '' : String(value).trim();
}

/**
 * @param {*} value
 * @return {boolean}
 */
function isEmpty_(value) {
  return value == null || (typeof value === 'string' && value.trim() === '');
}

/**
 * Deterministic, locale-independent ascending string comparison.
 *
 * @param {string} left
 * @param {string} right
 * @return {number}
 */
function compareLabels_(left, right) {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

/**
 * @param {number} value
 * @return {number}
 */
function roundToOneDecimal_(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
