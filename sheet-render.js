google.charts.load("current", { packages: ["table"] });
google.charts.setOnLoadCallback(initMenus);

/*
  WICHTIG:
  Hier die normale Tabellen-ID aus der üblichen Sheets-URL einsetzen:
  https://docs.google.com/spreadsheets/d/DIESE_ID/edit#gid=0

  NICHT die veröffentlichte /d/e/.../pubhtml-ID.
*/
const SPREADSHEET_ID = "DEINE_TABELLEN_ID_HIER";

const MENU_CONFIGS = [
  {
    targetId: "menu-bierwein",
    gid: "0",
    range: "A1:H24"
  },
  {
    targetId: "menu-cocktails",
    gid: "2047228110",
    range: "A1:H33"
  },
  {
    targetId: "menu-alkoholfrei",
    gid: "105662338",
    range: "A2:H15"
  },
  {
    targetId: "menu-speisen",
    gid: "3728547",
    range: "A1:H15"
  }
];

function initMenus() {
  if (!SPREADSHEET_ID || SPREADSHEET_ID === "DEINE_TABELLEN_ID_HIER") {
    for (const cfg of MENU_CONFIGS) {
      setStatus(cfg.targetId, "Bitte zuerst die normale Google-Sheets-ID in sheet-render.js eintragen.");
    }
    return;
  }

  MENU_CONFIGS.forEach(loadMenu);
}

function buildQueryUrl({ gid, range }) {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(SPREADSHEET_ID)}/gviz/tq`;
  const params = new URLSearchParams({
    gid,
    range,
    headers: "0"
  });
  return `${base}?${params.toString()}`;
}

function loadMenu(cfg) {
  const query = new google.visualization.Query(buildQueryUrl(cfg));
  query.setRefreshInterval(300);
  query.send((response) => handleMenuResponse(cfg.targetId, response));
}

function handleMenuResponse(targetId, response) {
  if (response.isError()) {
    setStatus(
      targetId,
      `Die Karte konnte aktuell nicht geladen werden. (${response.getMessage()})`
    );
    return;
  }

  const data = response.getDataTable();
  const rows = dataTableToRows(data);
  const normalized = normalizeRows(rows);
  const textCol = detectTextColumn(normalized);
  const classified = classifyRows(normalized, textCol);
  document.getElementById(targetId).innerHTML = buildMenuHtml(classified);
}

function setStatus(targetId, message) {
  const el = document.getElementById(targetId);
  if (!el) return;
  el.innerHTML = `<p class="menu-status">${escapeHtml(message)}</p>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dataTableToRows(data) {
  const rows = [];
  const rowCount = data.getNumberOfRows();
  const colCount = data.getNumberOfColumns();

  for (let r = 0; r < rowCount; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      const formatted = data.getFormattedValue(r, c);
      const raw = data.getValue(r, c);
      row.push(String(formatted ?? raw ?? "").trim());
    }
    rows.push(row);
  }
  return rows;
}

function normalizeRows(rows) {
  const maxCols = Math.max(...rows.map(r => r.length), 0);
  return rows.map(row => {
    const out = [...row];
    while (out.length < maxCols) out.push("");
    return out.map(cell => String(cell ?? "").trim());
  });
}

function isEmptyRow(row) {
  return row.every(cell => cell === "");
}

function nonEmptyIndexes(row) {
  const out = [];
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== "") out.push(i);
  }
  return out;
}

function detectTextColumn(rows) {
  let bestIndex = 0;
  let bestScore = -1;

  for (let col = 0; col < (rows[0]?.length || 0); col++) {
    let score = 0;

    for (const row of rows) {
      const value = row[col];
      if (!value) continue;

      const numericish = /^[\d.,]+$/.test(value);
      const unitish = /^(€|eur|l|cl|ml|st\.?|stk\.?|je)$/i.test(value);

      if (!numericish && !unitish) score++;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIndex = col;
    }
  }

  return bestIndex;
}

function classifyRows(rows, textCol) {
  const result = [];
  let previousMeaningfulType = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const prevRow = i > 0 ? rows[i - 1] : null;
    const filled = nonEmptyIndexes(row);

    if (filled.length === 0) {
      result.push({ type: "empty" });
      continue;
    }

    const onlyTextColumnFilled = filled.length === 1 && filled[0] === textCol;
    const prevIsEmpty = !!prevRow && isEmptyRow(prevRow);

    if (onlyTextColumnFilled && (i === 0 || prevIsEmpty)) {
      result.push({
        type: "group",
        title: row[textCol]
      });
      previousMeaningfulType = "group";
      continue;
    }

    const hasMeta = row.some((cell, index) => index !== textCol && cell !== "");

    if (onlyTextColumnFilled && previousMeaningfulType === "item") {
      result.push({
        type: "description",
        text: row[textCol]
      });
      previousMeaningfulType = "description";
      continue;
    }

    if (row[textCol] !== "" && hasMeta) {
      result.push({
        type: "item",
        title: row[textCol],
        amount: row[2] || "",
        unit: row[3] || "",
        price: row[4] || "",
        currency: row[5] || ""
      });
      previousMeaningfulType = "item";
      continue;
    }

    if (row[textCol] !== "") {
      result.push({
        type: "item",
        title: row[textCol],
        amount: "",
        unit: "",
        price: row[4] || "",
        currency: row[5] || ""
      });
      previousMeaningfulType = "item";
      continue;
    }

    result.push({ type: "empty" });
  }

  return result;
}

function buildMenuHtml(classifiedRows) {
  let html = `<div class="menu-sheet">`;
  let groupOpen = false;
  let itemOpen = false;

  for (const row of classifiedRows) {
    if (row.type === "empty") {
      continue;
    }

    if (row.type === "group") {
      if (itemOpen) {
        html += `</div>`;
        itemOpen = false;
      }
      if (groupOpen) {
        html += `</div></section>`;
      }

      html += `
        <section class="menu-group">
          <h4 class="menu-group-title">${escapeHtml(row.title)}</h4>
          <div class="menu-group-items">
      `;
      groupOpen = true;
      continue;
    }

    if (row.type === "item") {
      if (itemOpen) {
        html += `</div>`;
      }

      const mobileMeta = [row.amount, row.unit, row.price, row.currency]
        .filter(Boolean)
        .join(" ");

      html += `
        <div class="menu-item-block">
          <div class="menu-item">
            <div class="menu-title">${escapeHtml(row.title)}</div>
            <div class="menu-amount">${escapeHtml(row.amount)}</div>
            <div class="menu-unit">${escapeHtml(row.unit)}</div>
            <div class="menu-price">${escapeHtml(row.price)}</div>
            <div class="menu-currency">${escapeHtml(row.currency)}</div>
            ${mobileMeta ? `<div class="menu-mobile-meta">${escapeHtml(mobileMeta)}</div>` : ``}
          </div>
      `;
      itemOpen = true;
      continue;
    }

    if (row.type === "description" && itemOpen) {
      html += `<div class="menu-description">${escapeHtml(row.text)}</div>`;
    }
  }

  if (itemOpen) html += `</div>`;
  if (groupOpen) html += `</div></section>`;
  html += `</div>`;

  return html;
}