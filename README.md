# IT Ticket & SLA Dashboard with Google Apps Script

A sample dashboard built with Google Apps Script (GAS) HTML Service and Google Sheets. It reads ticket data from a bound spreadsheet, validates and aggregates the rows on the server, then renders KPIs, charts, filters, and an urgent-ticket table in a responsive web interface.

The included dataset contains 40 fictional tickets and no production or company data.

## Features

- Four KPIs: total tickets, unresolved tickets, SLA compliance rate, and average resolution time
- Ticket charts by creation date, service, and status
- A priority table for unresolved High and Critical tickets
- Inclusive date-range, service, and priority filters
- Loading, empty, validation, and backend-error states
- Reporting period, data source, update time, sample-data notice, and skipped-row count
- Responsive layouts for desktop, tablet, and mobile screens

## Expected results

Using the complete sample dataset without filters should produce:

| Metric | Expected value |
| --- | ---: |
| Total tickets | 40 |
| Unresolved tickets | 16 |
| SLA compliance rate | 79.2% |
| Average resolution time | 12.8 hours |
| Service with the most tickets | Payment API — 14 |
| Unresolved High/Critical tickets | 10 |

## Project files

| Path | Purpose |
| --- | --- |
| `sample-data.csv` | Fictional dataset containing 40 tickets |
| `Code.gs` | GAS backend for reading, validating, filtering, and aggregating ticket data |
| `Index.html` | Responsive dashboard interface and Google Charts integration |
| `package.json` | Local Node.js test command |
| `tests/` | Local backend, frontend, and sample-data checks |

## Data schema

The Google Sheet must contain a worksheet named exactly `Tickets`. Its first row must contain these 10 headers without renaming, translating, or adding spaces:

```text
ticket_id | created_at | service | category | priority | status | assignee_team | resolved_at | resolution_hours | sla_met
```

The two date columns may contain Google Sheets `Date` values or strings in `YYYY-MM-DD` format.

Supported values are:

- `priority`: `Critical`, `High`, `Medium`, or `Low`
- `status`: `Open`, `In Progress`, or `Resolved`
- `sla_met`: `Yes` or `No` for resolved tickets; blank for unresolved tickets

Malformed rows are skipped and included in the dashboard's skipped-row count.

## Set up the Google Sheet

1. Open [Google Sheets](https://sheets.google.com) and create a spreadsheet, for example `IT Ticket Dashboard`.
2. Select **File → Import → Upload** and upload `sample-data.csv`.
3. Choose **Insert new sheet(s)** so that existing worksheets are not overwritten.
4. Rename the imported worksheet to exactly `Tickets`.
5. Confirm that the header row matches the schema above.

## Create the bound Apps Script project

1. Open the spreadsheet and select **Extensions → Apps Script**. Opening Apps Script from the spreadsheet is important because this project uses the active bound spreadsheet.
2. Replace the default script with the contents of `Code.gs`.
3. Select **+ → HTML**, name the file exactly `Index`, and paste in the contents of `Index.html`.
4. Save the Apps Script project.

The source sets `IS_SAMPLE_DATA` to `true`, which displays a demonstration-data notice. Change it to `false` only after replacing the sample rows with an appropriate real dataset.

## Authorize the script

1. Select `getDashboardData` from the function list in the Apps Script editor.
2. Click **Run**.
3. Select the Google account that owns or can access the spreadsheet.
4. Approve the requested permission to read the current spreadsheet.

If the run completes without an exception, the backend can read the `Tickets` worksheet.

## Deploy as a web app

1. Select **Deploy → New deployment**.
2. Choose **Web app** as the deployment type.
3. Enter a description such as `IT Ticket Dashboard v1`.
4. Set **Execute as** to `Me` for a personal demonstration.
5. Start with **Who has access** set to `Only myself`.
6. Click **Deploy**, finish authorization if requested, and open the generated Web App URL.

Do not enable public access when the spreadsheet contains real, personal, or internal company data.

## Verify the dashboard

Run these checks after deployment:

1. Open the unfiltered dashboard and compare all six values with the expected-results table.
2. Select `Payment API`; the total ticket count should be 14.
3. Select priority `Critical`; the priority table should contain only unresolved Critical tickets.
4. Choose a date range with no matching rows; the dashboard should show its empty state instead of misleading charts.
5. Set the start date after the end date; the dashboard should show a clear validation message.
6. Resize the browser to a phone-sized viewport; KPI cards, charts, and report details should switch to a single-column layout without causing full-page horizontal overflow.

## Updating an existing deployment

Saving code does not update an existing Web App deployment automatically.

After changing `Code.gs` or `Index.html`, select **Deploy → Manage deployments → Edit**, choose **New version**, and deploy again. Then reload the existing Web App URL.

## Local tests

Node.js is used only for local checks; the deployed Web App does not require Node.js, npm, or a separate server.

```bash
npm test
```

The suite covers backend aggregation and validation, the expected sample-data metrics, frontend rendering and filters, empty and error states, and Google Charts integration behavior.

## Troubleshooting

### The `Tickets` worksheet cannot be found

Check the worksheet tab name at the bottom of Google Sheets. The spreadsheet file itself may have a different name, but the worksheet must be named exactly `Tickets`.

### Required columns are missing

Compare the first row with the 10 required headers. Do not translate the headers or add leading/trailing spaces.

### The page remains in the loading state

Open **Executions** in Apps Script and inspect authorization failures or backend exceptions. Also confirm that the latest code was deployed as a new version.

### Charts do not appear

Google Charts loads from `gstatic.com`. The browser needs network access, and an organizational network policy must not block that domain.

### Saved changes do not appear in the Web App

Create and deploy a **New version** under **Manage deployments**. Saving the project alone does not update an existing deployment.

## Replacing the sample dataset

Keep the same 10 headers when importing data from Jira, GitHub Issues, or another ticketing system. Before using real operational data, define the SLA rules, timezone, access policy, personal-data handling, and refresh schedule.

Never place API tokens, credentials, or other secrets in `Index.html`.
