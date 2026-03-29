google.charts.load("current");
google.charts.setOnLoadCallback(initMenus);

const SPREADSHEET_ID = "1zw5c-IHcMCcERlPjHGmOkaS6EUEACBC-Ls44LACVfis";

const MENU_CONFIGS = [
  { targetId: "menu-bierwein",    gid: "0",          range: "A1:G120" },
  { targetId: "menu-cocktails",   gid: "2047228110", range: "A1:G120" },
  { targetId: "menu-alkoholfrei", gid: "105662338",  range: "A1:G120" },
  { targetId: "menu-speisen",     gid: "3728547",    range: "A1:G120" }
];

function initMenus() {
  MENU_CONFIGS.forEach(loadMenu);
}

function buildQueryUrl({ gid, range }) {
  const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    gid,
    range,
    headers: "0"
  });
  return `${base}?${params.toString()}`;
}

function loadMenu(cfg) {
  const query = new google.visualization.Query(buildQueryUrl(cfg));
  query.send((response) => handleMenuResponse(cfg.targetId, response));
}

function handleMenuResponse(targetId, response) {
  if (response.isError()) {
    setStatus(
      targetId,
      `Die Karte konnte aktuell nicht geladen werden: ${response.getMessage()}`
    );
    return;
  }

  const data = response.getDataTable();

  if (!data || data.getNumberOfRows() === 0) {
    setStatus(targetId, "Keine Daten im angegebenen Bereich gefunden.");
    return;
  }

  const rows = dataTableToRows(data);
  const structured = rowsToStructured(rows);
  document.getElementById(targetId).innerHTML = buildMenuHtml(structured);
}

function setStatus(targetId, message) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = `<p class="menu-status">${escapeHtml(message)}</p>`;
}

function cleanCell(value) {
  if (value === null || value === undefined) return "";
  const s = String(value).replace(/\u00A0/g, " ").trim();
  if (s.toLowerCase() === "null") return "";
  return s;
}

function dataTableToRows(data) {
  const out = [];
  const rowCount = data.getNumberOfRows();
  const colCount = data.getNumberOfColumns();

  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      const formatted = data.getFormattedValue(r, c);
      const raw = data.getValue(r, c);
      row.push(cleanCell(formatted ?? raw));
    }
    out.push(row);
  }

  return out;
}

function normalizeRow(row, minLength = 7) {
  const out = [...row];
  while (out.length < minLength) out.push("");
  return out.map(cleanCell);
}

function isSeparatorRow(row) {
  // Relevant sind B-G. A wird ignoriert.
  for (let i = 1; i <= 6; i++) {
    if (cleanCell(row[i]) !== "") {
      return false;
    }
  }
  return true;
}

function rowsToStructured(rows) {
  const normalized = rows.map(row => normalizeRow(row, 7));

  const groups = [];
  let currentGroup = null;
  let lastItem = null;

  let separatorCount = 0;
  let previousType = "start"; // start | separator | item | text

  for (const row of normalized) {
    const colB = cleanCell(row[1]);
    const colC = cleanCell(row[2]);
    const colD = cleanCell(row[3]);
    const colE = cleanCell(row[4]);
    const colF = cleanCell(row[5]);
    const colG = cleanCell(row[6]);

    const separator = isSeparatorRow(row);

    if (separator) {
      separatorCount += 1;

      if (separatorCount >= 2) {
        break;
      }

      previousType = "separator";
      lastItem = null;
      continue;
    }

    separatorCount = 0;

    const title = colB;
    const amount = colC;
    const unit = colD;
    const price = colE;
    const currency = colF;
    const extra = colG;

    const onlyTitleFilled =
      title !== "" &&
      amount === "" &&
      unit === "" &&
      price === "" &&
      currency === "" &&
      extra === "";

    // Reine Textzeile am Anfang => Gruppe
    if (onlyTitleFilled && previousType === "start") {
      currentGroup = {
        title,
        items: []
      };
      groups.push(currentGroup);
      lastItem = null;
      previousType = "text";
      continue;
    }

    // Reine Textzeile nach Trenner => Gruppe
    if (onlyTitleFilled && previousType === "separator") {
      currentGroup = {
        title,
        items: []
      };
      groups.push(currentGroup);
      lastItem = null;
      previousType = "text";
      continue;
    }

    // Reine Textzeile nach Artikel => Beschreibung
    if (onlyTitleFilled && previousType === "item" && lastItem) {
      lastItem.description = lastItem.description
        ? `${lastItem.description} ${title}`
        : title;
      previousType = "text";
      continue;
    }

    // Normale Artikelzeile
    if (!currentGroup) {
      currentGroup = {
        title: "",
        items: []
      };
      groups.push(currentGroup);
    }

    const item = {
      title,
      amount,
      unit,
      price,
      currency,
      description: ""
    };

    currentGroup.items.push(item);
    lastItem = item;
    previousType = "item";
  }

  return groups;
}

function buildMenuHtml(groups) {
  if (!groups.length) {
    return `<p class="menu-status">Keine Daten vorhanden.</p>`;
  }

  let html = `<div class="menu-sheet">`;

  for (const group of groups) {
    html += `<section class="menu-group">`;

    if (group.title) {
      html += `<h4 class="menu-group-title">${escapeHtml(group.title)}</h4>`;
    }

    for (const item of group.items) {
      const mobileMeta = [item.amount, item.unit, item.price, item.currency]
        .filter(Boolean)
        .join(" ");

      html += `
        <div class="menu-item-block">
          <div class="menu-item">
            <div class="menu-title">${escapeHtml(item.title)}</div>
            <div class="menu-amount">${escapeHtml(item.amount)}</div>
            <div class="menu-unit">${escapeHtml(item.unit)}</div>
            <div class="menu-price">${escapeHtml(item.price)}</div>
            <div class="menu-currency">${escapeHtml(item.currency)}</div>
            ${mobileMeta ? `<div class="menu-mobile-meta">${escapeHtml(mobileMeta)}</div>` : ``}
          </div>
          ${item.description ? `<div class="menu-description">${escapeHtml(item.description)}</div>` : ``}
        </div>
      `;
    }

    html += `</section>`;
  }

  html += `</div>`;
  return html;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
