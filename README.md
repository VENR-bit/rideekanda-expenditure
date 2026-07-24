# Expenditure Summary — Rideekanda & Brother's Land

**Live site:** https://venr-bit.github.io/rideekanda-expenditure/

A live dashboard of ongoing construction expenditure, read directly from Google
Sheets. Rideekanda and Brother's Land are shown as **two separate accounts** (one
tab each). When you add rows to a sheet, the page shows the new numbers on refresh.

Hosted on GitHub Pages from the `docs/` folder (main branch).

## What it shows
- **Total expenditure** (all projects), income + donations, and net balance.
- **Monthly expenditure** bar chart, filterable per project.
- **Per-site / per-project** cards: spent, income, donations, balance, estimate.
- **Monthly × project** breakdown table.
- **Line-item audit** table per project so every figure is traceable.

## Sites & sources
| Site | Project | Google Sheet |
|------|---------|--------------|
| Rideekanda | Library Cafe | `1A_S8aJV3_UKn9jD0atazr1elKibUfUmMQ3aJI1r6uRE` |
| Rideekanda | Wall Construction | `19bDSzAcuBuoFeibXvVQzve-W_bhMDIy6dhI4KERYXE0` (live, done June 2026) |
| Rideekanda | Cacilia's Kuty | fixed Rs 900,082 (June 2026) — see note below; clean sheet pending |
| Brother's Lands | Building Construction + Maligawa / Sinnakkara / Homagama lands | `16iggcw0Bgw9sW4eM5BNMkPPgqR2lJIYbWo6En7objrE` |

## How it works
`apps-script/Code.gs` is a Google Apps Script web app. Its `doGet` opens the
three sheets by ID, parses the (irregular, Numbers-exported) tabs into clean
line items, and returns JSON. `docs/index.html` fetches that JSON and renders
everything in the browser — no server, no build step.

## Setup (once)

### 1. Deploy the backend
1. Go to <https://script.google.com> → **New project**.
2. Delete the default code, paste the contents of `apps-script/Code.gs`, save.
3. The account you use must have at least **view** access to all three sheets
   (they're already shared "anyone with the link", so your own Google account is
   fine).
4. **Deploy → New deployment → Web app.**
   - Description: `expenditure`
   - Execute as: **Me**
   - Who has access: **Anyone**
5. **Authorize** when prompted (allow it to read your spreadsheets).
6. Copy the **Web app URL** (ends in `/exec`).

> Redeploys: after editing `Code.gs`, use **Deploy → Manage deployments → Edit
> (pencil) → Version: New version** so the change goes live.

### 2. Point the webpage at it
Open `docs/index.html` and either:
- paste the `/exec` URL into the on-page **setup box** (saved in your browser), or
- hard-code it once: set `var ENDPOINT = "...";` near the top of the `<script>`.

Then host `docs/index.html` anywhere static (GitHub Pages, Netlify, or just open
the file). It reloads live data every time you open or hit **Refresh**.

## Notes on the data
- **Dates** are messy in the sheets (`2024.2.16`, `12.11.24`, `Paid on 8.7.25`,
  …). The parser handles these; anything genuinely undated is grouped under
  **"Undated"** in the monthly views (still counted in totals).
- **Library Cafe** (`1A_S8…`) — the deck / library / digital-screen sheet with
  donor donations. Shows expenditure, donations, and balance.
- **Wall Construction** (`19bDSz…`) — its own clean sheet, read live. Simple
  ledger (description / qty / price / total); total column is D. The sheet has no
  date column, so its rows are stamped **June 2026** (`defaultDate` in `SOURCES`).
  Currently **Rs 383,000** (hardware 188,000 + rubble 55,000 + labour 28,000 +
  labour 112,000).
- **Cacilia's Kuty** — its source (`1XlL45…`) is a mixed estimate/BOQ that can't
  be totalled reliably, so it is entered in `Code.gs` as a **fixed Rs 900,082**
  (the sheet's "EXPENDITURE" block, expenditure only), dated June 2026. **When you
  create a clean dedicated sheet for it**, replace the fixed block in `SOURCES`
  with the commented `ledger` entry right above it (paste the new sheet id) and it
  will update live like Wall Construction.
- The Building tab's payments are grouped into blocks that end with a
  "BALANCE AS AT <date>" row; undated items in a block inherit that block's date.
  Real payments with no description (e.g. Rs 50,000 on 4.3.2026) are still counted.
- **Income (Brother's Lands)** is taken **only** from the Building sheet's Income
  column (the master cash book — includes capital, a returned loan, and produce
  income transferred in). The separate INCOME tab and the land tabs' inline
  "Income (coconut harvest)" notes are **deliberately not counted**, because the
  same produce sales appear in the Building column and would double-count.
  Donations (Library Cafe) are counted separately and don't overlap.
- If a figure looks off, open the **Line items (audit)** section — every number
  traces back to a sheet row. The JSON also carries a `debug` array showing how
  each tab was classified.

## Files
```
apps-script/Code.gs   backend (deploy to Google Apps Script)
docs/index.html       the dashboard (host statically)
```
