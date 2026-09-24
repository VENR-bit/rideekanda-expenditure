/**
 * Rideekanda / Brother's Lands — Expenditure summary backend.
 *
 * ONE standalone Apps Script that reads the three Google Sheets by ID,
 * parses their (very irregular, Numbers-exported) tabs into clean line
 * items, and serves them as JSON for the dashboard webpage.
 *
 *   Site "Rideekanda"      -> Cacilia's Kuty   (sheet 1A_S8...)
 *                          -> Wall Constructions (sheet 1XlL45...)
 *   Site "Brother's Lands" -> Building Construction + the land tabs
 *                             (sheet 16iggc..., one sub-project per tab)
 *
 * Deploy:  Deploy > New deployment > Web app
 *          Execute as: Me      Who has access: Anyone
 * Then paste the /exec URL into the webpage (site/index.html).
 *
 * NOTE: this script only READS the sheets. It never writes.
 */

// ---- configuration ---------------------------------------------------------

var SOURCES = [
  // Library Cafe (deck, library, digital screen, donor donations).
  { id: '1A_S8aJV3_UKn9jD0atazr1elKibUfUmMQ3aJI1r6uRE',
    site: 'Rideekanda', project: 'Library Cafe', type: 'kuty' },

  // Wall Construction — single-table ledger:
  // [description, qty, unit price, total(D=3), note, TOTAL EXPENDITURE, INCOME(6), TOTAL INCOME].
  // Per-line expenses in col D (idx 3); a single INCOME total sits in col idx 6.
  // No per-row date, so undated rows are stamped defaultDate.
  { id: '19bDSzAcuBuoFeibXvVQzve-W_bhMDIy6dhI4KERYXE0',
    site: 'Rideekanda', project: 'Wall Construction', type: 'ledger',
    amountCol: 3, descCol: 0, dateCol: null, incomeCol: 6, defaultDate: '2026-06-01',
    // this spreadsheet has more than one tab — map each tab to its own project.
    tabProjects: { 'WALL constructions': 'Wall Construction',
                   'GENERAL Maintenance': 'General Maintenance' } },

  // Cacilia's Kuty — its BOQ sheet (1XlL45...) now has a proper "EXPENDITURE" block
  // with per-line totals plus a G/TOTAL and a DONATIONS column, so it is read LIVE.
  // parseCacilia() finds the EXPENDITURE section, sums the per-line expenses, and
  // reads the DONATIONS total. Undated rows are stamped defaultDate.
  { id: '1XlL45RkzzVIYQDt2v0GRlVrqq9jpAAaC4j-lbc4Qkhs',
    site: 'Rideekanda', project: "Cacilia's Kuty", type: 'cacilia', defaultDate: '2026-06-01' },

  // Road Construction — same ledger layout as Wall (expenses col D, INCOME col 6).
  { id: '12Ob_pV856_R2MDmj82HSscQEo8npLxadPF7NmNEmOFI',
    site: 'Rideekanda', project: 'Road Construction', type: 'ledger',
    amountCol: 3, descCol: 0, dateCol: null, incomeCol: 6, defaultDate: '2026-08-01' },

  { id: '16iggcw0Bgw9sW4eM5BNMkPPgqR2lJIYbWo6En7objrE',
    site: "Brother's Lands", project: null, type: 'brothers' }
];

// Readable English labels for the Sinhala land-tab headings.
var NAME_MAP = {
  'මාලිගාව ඉඩම': 'Maligawa Land',
  'සිනනක්කර ඉඩම': 'Sinnakkara Land',
  'Homagama Land': 'Homagama Land'
};

// ---- entry point -----------------------------------------------------------

function doGet(e) {
  var out;
  try {
    out = buildPayload();
  } catch (err) {
    out = { ok: false, error: String(err && err.stack || err), items: [], debug: [] };
  }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function buildPayload() {
  var items = [];
  var debug = [];

  SOURCES.forEach(function (src) {
    // fixed / manually-entered projects (no spreadsheet to read)
    if (src.type === 'fixed') {
      src.fixed.forEach(function (f) {
        push(items, src, src.project, 'expense', f.date, f.desc, f.amount, 'Fixed entry');
      });
      debug.push({ source: src.project, tab: '(fixed)', detectedAs: 'fixed',
                   itemsAdded: src.fixed.length });
      return;
    }
    var ss;
    try {
      ss = SpreadsheetApp.openById(src.id);
    } catch (err) {
      debug.push({ source: src.project || src.site, error: 'openById failed: ' + err });
      return;
    }
    var sheets = ss.getSheets();
    sheets.forEach(function (sh) {
      var rows;
      try {
        rows = sh.getDataRange().getValues();
      } catch (err) {
        return;
      }
      if (isCoverSheet(rows)) return;

      var before = items.length;
      var kind = 'skipped';
      if (src.type === 'kuty') { kind = 'kuty'; parseKuty(rows, src, items); }
      else if (src.type === 'ledger') { kind = 'ledger'; parseLedger(rows, src, items, sh.getName()); }
      else if (src.type === 'cacilia') { kind = 'cacilia'; parseCacilia(rows, src, items); }
      else { kind = parseBrothersTab(rows, sh.getName(), src, items); }

      debug.push({
        source: src.project || src.site,
        tab: sh.getName(),
        detectedAs: kind,
        itemsAdded: items.length - before
      });
    });
  });

  return {
    ok: true,
    currency: 'LKR',
    updated: new Date().toISOString(),
    generatedBy: 'Code.gs',
    items: items,
    debug: debug
  };
}

// ---- shared helpers --------------------------------------------------------

function txt(v) { return (v === null || v === undefined) ? '' : String(v).trim(); }

function low(v) { return txt(v).toLowerCase(); }

// Parse a currency-ish value. Returns a Number or null. Ignores pure text and
// negative "balance" values are kept as-is (caller decides).
function parseAmount(v) {
  if (typeof v === 'number') { return isFinite(v) ? v : null; }
  var s = txt(v);
  if (!s) return null;
  // strip currency words / stray chars, keep digits . , -
  var cleaned = s.replace(/[^0-9.,\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.' ) return null;
  cleaned = cleaned.replace(/,/g, '');
  // guard against strings that were really dates ("2024.2.16" -> 2024.2 ...)
  if ((cleaned.match(/\./g) || []).length > 1) return null;
  var n = parseFloat(cleaned);
  return isFinite(n) ? n : null;
}

// Find the first date anywhere in a value. Returns 'YYYY-MM-DD' or null.
// Handles Date objects and many messy string forms:
//   2023-06-01, 2024.2.16, 25..3.2026, 12.12.2024, 12.11.24,
//   "Paid on 8.7.2025", "10,000 paid 22.5.2025", "20.8.24"
function parseDateStr(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return fmt(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  var s = txt(v);
  if (!s) return null;
  s = s.replace(/\.{2,}/g, '.'); // "25..3.2026" -> "25.3.2026"
  var m = s.match(/(\d{1,4})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{2,4})/);
  if (!m) return null;
  var a = parseInt(m[1], 10), b = parseInt(m[2], 10), c = parseInt(m[3], 10);
  var y, mo, d;
  if (m[1].length === 4) {        // YYYY.M.D
    y = a; mo = b; d = c;
  } else {                        // D.M.YYYY  (or D.M.YY)
    d = a; mo = b; y = c;
    if (y < 100) y += 2000;
  }
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) d = 1;
  if (y < 2018 || y > 2035) return null; // sanity clamp
  return fmt(y, mo, d);
}

function fmt(y, mo, d) {
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return y + '-' + p(mo) + '-' + p(d);
}

// Scan every cell of a row for a date.
function rowDate(row) {
  for (var i = 0; i < row.length; i++) {
    var dt = parseDateStr(row[i]);
    if (dt) return dt;
  }
  return null;
}

function isCoverSheet(rows) {
  for (var r = 0; r < Math.min(rows.length, 15); r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var t = low(rows[r][c]);
      if (t.indexOf('exported from numbers') >= 0 ||
          t.indexOf('numbers sheet name') >= 0) return true;
    }
  }
  return false;
}

function isSubtotalLabel(s) {
  var t = low(s);
  return t.indexOf('total') >= 0 || t.indexOf('balance') >= 0 ||
         t.indexOf('settled') >= 0;
}

function push(items, src, tab, kind, date, desc, amount, note) {
  if (amount === null || !isFinite(amount)) return;
  items.push({
    site: src.site,
    project: src.project,   // may be overridden by caller for brothers
    tab: tab,
    kind: kind,             // expense | income | donation | estimate
    date: date,             // 'YYYY-MM-DD' or null
    month: date ? date.slice(0, 7) : null,
    desc: desc || '',
    amount: amount,
    note: note || ''
  });
}

// ---- parser: simple single-table ledger (e.g. Wall Construction) -----------
// Config on the source: amountCol (default 3), descCol (default 0),
// dateCol (or null), defaultDate (used when a row carries no date).
// Total / subtotal rows (blank description, or "TOTAL"/"Balance" text) are skipped.
function parseLedger(rows, src, items, tabName) {
  var amountCol = (src.amountCol != null) ? src.amountCol : 3;
  var descCol = (src.descCol != null) ? src.descCol : 0;
  var project = ledgerProject(src, tabName);   // one project per tab (see tabProjects)
  var proj = { site: src.site };
  for (var r = 0; r < rows.length; r++) {
    var row = rows[r];
    var desc = txt(row[descCol]);
    var amt = parseAmount(row[amountCol]);
    if (!desc || amt === null || amt <= 0) continue;   // blank-desc total row skipped here
    if (low(desc) === 'description' || low(desc) === 'item') continue; // header
    var date = (src.dateCol != null ? parseDateStr(row[src.dateCol]) : null)
      || rowDate(row) || src.defaultDate || null;
    pushProj(items, proj, src, project, 'expense', date, desc, amt, txt(row[4]));
  }

  // optional single INCOME total (first positive number in the income column)
  if (src.incomeCol != null) {
    for (var k = 0; k < rows.length; k++) {
      var iv = parseAmount(rows[k][src.incomeCol]);
      if (iv !== null && iv > 0) {
        pushProj(items, proj, src, project, 'income', null, 'Income (received)', iv, '');
        break;
      }
    }
  }
}

// Resolve which project a ledger tab belongs to. With src.tabProjects, each tab
// name maps to its own project; otherwise everything is src.project.
function ledgerProject(src, tabName) {
  if (src.tabProjects && tabName) {
    var tn = low(tabName), key;
    for (key in src.tabProjects) { if (low(key) === tn) return src.tabProjects[key]; }
    for (key in src.tabProjects) { if (tn.indexOf(low(key)) >= 0) return src.tabProjects[key]; }
  }
  return src.project;
}

// ---- parser: Cacilia's Kuty ------------------------------------------------
// The BOQ sheet has an "EXPENDITURE" section whose header row carries the labels
// G/TOTAL (the expenditure grand total), DONATIONS, and BALANCE. Per-line expense
// amounts sit in the column just left of G/TOTAL. We sum the line items (for
// per-item detail) and read the DONATIONS total once. A safety check compares the
// summed line items against the sheet's own G/TOTAL and reports both in debug.
function parseCacilia(rows, src, items) {
  // locate the EXPENDITURE marker
  var start = -1;
  for (var r = 0; r < rows.length && start < 0; r++) {
    for (var c = 0; c < rows[r].length; c++) {
      if (low(rows[r][c]) === 'expenditure') { start = r; break; }
    }
  }
  if (start < 0) return; // this tab has no expenditure block

  // header row is the next row; find the G/TOTAL, DONATIONS columns
  var head = rows[start + 1] || [];
  var gtotCol = -1, donCol = -1;
  for (var h = 0; h < head.length; h++) {
    var t = low(head[h]);
    if (t.indexOf('g/total') >= 0 || t === 'total') { if (gtotCol < 0) gtotCol = h; }
    if (t.indexOf('donation') >= 0) donCol = h;
  }
  var lineCol = (gtotCol > 0) ? gtotCol - 1 : 6;  // per-line total is left of G/TOTAL

  // read the single DONATIONS + G/TOTAL values (first numeric under those headers)
  var donation = null, gtotal = null;
  for (var r2 = start + 2; r2 < rows.length; r2++) {
    if (donation === null && donCol >= 0) { var dv = parseAmount(rows[r2][donCol]); if (dv !== null && dv > 0) donation = dv; }
    if (gtotal === null && gtotCol >= 0) { var gv = parseAmount(rows[r2][gtotCol]); if (gv !== null && gv > 0) gtotal = gv; }
    if (donation !== null && gtotal !== null) break;
  }

  // expense line items (until several blank rows end the block)
  var blanks = 0, lineSum = 0;
  for (var r3 = start + 2; r3 < rows.length; r3++) {
    var row = rows[r3];
    var amt = parseAmount(row[lineCol]);
    var desc = txt(row[0]);
    if (amt === null || amt <= 0) {
      if (!desc) { blanks++; if (blanks >= 4) break; }
      continue;
    }
    blanks = 0;
    if (low(desc).indexOf('requirement') >= 0) continue; // sub-header, not a line item
    var date = rowDate(row) || src.defaultDate || null;
    lineSum += amt;
    push(items, src, "Cacilia's Kuty", 'expense', date, desc || '(item)', amt, '');
  }

  if (donation !== null) {
    push(items, src, "Cacilia's Kuty", 'donation', null, 'Donations (collected)', donation, '');
  }
  // stash a reconciliation note in debug via a zero-amount marker is avoided; the
  // caller's per-tab debug already reports itemsAdded. Sheet G/TOTAL vs our sum:
  if (gtotal !== null && Math.abs(gtotal - lineSum) > 1) {
    push(items, src, "Cacilia's Kuty", 'expense', src.defaultDate,
         '(reconciliation to sheet G/TOTAL)', gtotal - lineSum, 'auto-adjust');
  }
}

// ---- parser: Library Cafe (donation/BOQ style sheet) -----------------------
// Header: Description | DofQ | Unit Price | Total Price | (date) |
//         Donation | Donor | Collected Donation | Balance | Approx Est Cost
function parseKuty(rows, src, items) {
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var desc = txt(row[0]);
    var total = parseAmount(row[3]);
    var date = parseDateStr(row[4]) || null;

    // expense line. NB: don't filter by isSubtotalLabel here — the sheet's own
    // total row has a blank description (already excluded by the `desc &&` check),
    // and a real item like "Balance payment for Carpenter" must NOT be dropped.
    if (desc && total !== null) {
      push(items, src, 'Kuty', 'expense', date, desc, total, txt(row[4]));
    }
    // donation (amount in col5, donor name col6) — independent of expense
    var dAmt = parseAmount(row[5]);
    var donor = txt(row[6]);
    if (dAmt !== null && donor) {
      push(items, src, 'Kuty', 'donation', null, donor, dAmt, 'Donation');
    }
    // one-off estimate figure
    var est = parseAmount(row[9]);
    if (est !== null && est > 0 && r === 1) {
      push(items, src, 'Kuty', 'estimate', null, 'Approx. estimated cost', est, '');
    }
  }
}

// ---- parser: Brother's Lands (sheet 1, one tab per sub-project) -------------
function parseBrothersTab(rows, sheetName, src, items) {
  var headText = topText(rows);          // merged heading / first cells
  var titleName = NAME_MAP[headText] || headText || sheetName;

  // detect tab type by scanning the first ~6 rows
  var hasAcc = scanHas(rows, ['accumulated expenditure']);
  var hasCostPaid = scanHas(rows, ['total cost paid']);
  var isIncome = /income/i.test(headText) && !hasCostPaid && !hasAcc;
  var isHomagama = /homagama/i.test(headText);

  // Owner's decision: the Brother's Land account counts ONLY the Building
  // (Income & Expenditure) sheet. Every other tab in this spreadsheet — the land
  // tabs (Maligawa / Sinnakkara / Homagama) and the INCOME tab — is ignored.
  if (hasAcc) { parseBuilding(rows, src, items); return 'building'; }
  if (hasCostPaid) { return 'land-ignored:' + titleName; }
  if (isIncome) { return 'income-tab-ignored'; }
  if (isHomagama) { return 'homagama-ignored'; }
  return 'ignored';
}

function topText(rows) {
  for (var r = 0; r < Math.min(rows.length, 4); r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var t = txt(rows[r][c]);
      if (t) return t;
    }
  }
  return '';
}

function scanHas(rows, needles) {
  for (var r = 0; r < Math.min(rows.length, 8); r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var t = low(rows[r][c]);
      for (var n = 0; n < needles.length; n++) {
        if (t.indexOf(needles[n]) >= 0) return true;
      }
    }
  }
  return false;
}

// LAND tabs: LABOUR | DAYS | COST PER DAY | TOTAL COST PAID | (date) ...
function parseLand(rows, projectName, src, items) {
  var proj = { site: src.site, project: projectName };
  // find header row + the "total cost paid" column
  var headerRow = -1, amtCol = -1, dateCol = -1;
  for (var r = 0; r < Math.min(rows.length, 6); r++) {
    for (var c = 0; c < rows[r].length; c++) {
      var t = low(rows[r][c]);
      if (t.indexOf('total cost paid') >= 0) { headerRow = r; amtCol = c; }
      if (headerRow === r && (t.indexOf('paid') >= 0) && c !== amtCol && dateCol < 0) dateCol = c;
    }
    if (headerRow >= 0) break;
  }
  if (amtCol < 0) amtCol = 3;
  if (dateCol < 0) dateCol = amtCol + 1;

  for (var i = headerRow + 1; i < rows.length; i++) {
    var row = rows[i];
    var desc = txt(row[0]);
    var amt = parseAmount(row[amtCol]);
    if (amt === null) continue;
    var midLabels = low(row[1]) + ' ' + low(row[2]);
    var isIncomeLine = midLabels.indexOf('income') >= 0;
    var isSub = (!desc && (midLabels.indexOf('total') >= 0 || midLabels.indexOf('balance') >= 0)) ||
                midLabels.indexOf('total') >= 0 || midLabels.indexOf('balance') >= 0;
    var date = parseDateStr(row[dateCol]) || rowDate(row);
    if (isIncomeLine) {
      // land-tab "Income (coconut harvest)" notes duplicate the Building cash book —
      // skip so they aren't double-counted.
    } else if (!isSub && desc) {
      pushProj(items, proj, src, projectName, 'expense', date, desc, amt);
    }
  }
}

// Simple 3-column ledgers: Description | Amount | Date
function parseSimpleLedger(rows, projectName, src, items, kind) {
  var proj = { site: src.site, project: projectName };
  for (var r = 1; r < rows.length; r++) {
    var row = rows[r];
    var desc = txt(row[0]);
    var amt = parseAmount(row[1]);
    if (!desc || amt === null) continue;
    if (isSubtotalLabel(desc)) continue;
    var date = parseDateStr(row[2]) || rowDate(row);
    pushProj(items, proj, src, projectName, kind, date, desc, amt);
  }
}

// BUILDING tab: Description|Qty|Price|Total|Invoice|AccExp|CashInHand|Income|note
// Blocks of items end with a "TOTAL ... BALANCE AS AT <date>" row whose date we
// use as a fallback for undated items in that block.
function parseBuilding(rows, src, items) {
  var proj = { site: src.site, project: 'Building Construction' };
  var headerRow = -1;
  for (var r = 0; r < Math.min(rows.length, 6); r++) {
    if (low(rows[r][0]).indexOf('description') >= 0) { headerRow = r; break; }
  }
  if (headerRow < 0) headerRow = 1;

  // pass 1: locate TOTAL/BALANCE rows and their dates (block boundaries)
  var boundaries = []; // {row, date}
  for (var i = headerRow + 1; i < rows.length; i++) {
    var midl = low(rows[i][1]) + ' ' + low(rows[i][2]);
    if (midl.indexOf('total') >= 0) {
      boundaries.push({ row: i, date: rowDate(rows[i]) });
    }
  }
  function blockDate(idx) {
    for (var b = 0; b < boundaries.length; b++) {
      if (boundaries[b].row >= idx && boundaries[b].date) return boundaries[b].date;
    }
    return null;
  }

  for (var j = headerRow + 1; j < rows.length; j++) {
    var row = rows[j];
    var midLabels = low(row[1]) + ' ' + low(row[2]);
    var isTotalRow = midLabels.indexOf('total') >= 0;

    // income (col 7) — capture regardless of whether it's a total row
    var inc = parseAmount(row[7]);
    if (inc !== null && inc > 0) {
      var incNote = txt(row[8]) || txt(row[6]) || 'Income';
      var incDate = parseDateStr(row[8]) || rowDate(row) || blockDate(j);
      pushProj(items, proj, src, 'Building Construction', 'income', incDate, incNote, inc);
    }

    if (isTotalRow) continue; // don't count subtotal rows as expenses

    var total = parseAmount(row[3]);
    if (total === null || total <= 0) continue;
    // some real payments have no description (e.g. the Rs 50,000 paid 4.3.2026) —
    // still count them so the total matches the sheet's own block subtotals.
    var desc = txt(row[0]) || '(unlabelled payment)';

    var ownDate = parseDateStr(row[4]) || parseDateStr(row[8]);
    var date = ownDate || blockDate(j);
    pushProj(items, proj, src, 'Building Construction', 'expense', date, desc, total);
  }
}

// like push(), but stamps a specific sub-project name (for Brother's Lands)
function pushProj(items, proj, src, projectName, kind, date, desc, amount, note) {
  if (amount === null || !isFinite(amount)) return;
  items.push({
    site: proj.site,
    project: projectName,
    tab: projectName,
    kind: kind,
    date: date,
    month: date ? date.slice(0, 7) : null,
    desc: desc || '',
    amount: amount,
    note: note || ''
  });
}
