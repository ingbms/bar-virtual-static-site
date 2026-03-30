google.charts.load("current");
google.charts.setOnLoadCallback(initMenus);

const SPREADSHEET_ID = "1zw5c-IHcMCcERlPjHGmOkaS6EUEACBC-Ls44LACVfis";

const MENU_CONFIGS = [
  { targetId: "menu-bierwein",    gid: "0",          range: "A1:G120" },
  { targetId: "menu-cocktails",   gid: "2047228110", range: "A1:G120" },
  { targetId: "menu-alkoholfrei", gid: "105662338",  range: "A1:G120" },
  { targetId: "menu-speisen",     gid: "3728547",    range: "A1:G120" }
];

const EVENT_CONFIG = {
  targetId: "events-target",
  sheet: "Events",
  range: "A1:Z200"
};

function initMenus() {
  MENU_CONFIGS.forEach(loadMenu);
  loadEvents(EVENT_CONFIG);
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

function buildEventJsonpUrl({ sheet, range, handler }) {
  const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq`;
  const params = new URLSearchParams({
    sheet,
    range,
    tqx: `out:json;responseHandler:${handler}`
  });
  return `${base}?${params.toString()}`;
}

function loadEvents(cfg) {
  const targetId = cfg.targetId;
  const callbackName = `eventsJsonpCallback_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  const script = document.createElement("script");

  const cleanup = () => {
    if (window[callbackName]) {
      try {
        delete window[callbackName];
      } catch {
        window[callbackName] = undefined;
      }
    }
    if (script.parentNode) {
      script.parentNode.removeChild(script);
    }
  };

  const timeout = setTimeout(() => {
    cleanup();
    setStatus(targetId, "Die Events konnten aktuell nicht geladen werden (Zeitüberschreitung).");
  }, 12000);

  window[callbackName] = (response) => {
    clearTimeout(timeout);
    cleanup();
    handleEventsJsonResponse(targetId, response);
  };

  script.async = true;
  script.src = buildEventJsonpUrl({ ...cfg, handler: callbackName });
  script.onerror = () => {
    clearTimeout(timeout);
    cleanup();
    setStatus(targetId, "Die Events konnten aktuell nicht geladen werden.");
  };

  document.head.appendChild(script);
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

function handleEventsJsonResponse(targetId, response) {
  if (!response || response.status !== "ok" || !response.table) {
    const errorMessage = response && response.errors && response.errors.length
      ? cleanCell(response.errors[0].detailed_message || response.errors[0].reason)
      : "Unbekannter Fehler";
    setStatus(targetId, `Die Events konnten aktuell nicht geladen werden: ${errorMessage}`);
    return;
  }

  const eventPayload = tableToEventPayload(response.table);
  if (!eventPayload.length) {
    setStatus(targetId, "Aktuell sind keine Events eingetragen.");
    return;
  }

  document.getElementById(targetId).innerHTML = buildEventsHtml(eventPayload);
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

function tableToEventPayload(table) {
  const cols = Array.isArray(table.cols) ? table.cols : [];
  const rows = Array.isArray(table.rows) ? table.rows : [];
  const columns = [];
  for (let c = 0; c < cols.length; c++) {
    const label = cleanCell(cols[c] && cols[c].label);
    columns.push({
      id: c,
      label: label || `Info ${c + 1}`
    });
  }

  const events = [];
  for (const row of rows) {
    const cells = Array.isArray(row && row.c) ? row.c : [];
    const details = [];

    for (let c = 0; c < columns.length; c++) {
      const cell = cells[c];
      const formatted = cell && cell.f;
      const raw = cell && cell.v;
      const value = cleanCell(formatted || raw);
      if (!value) continue;

      details.push({
        label: columns[c].label,
        value
      });
    }

    if (!details.length) continue;
    events.push(eventDetailsToEvent(details));
  }

  return events;
}

function eventDetailsToEvent(details) {
  const getByLabel = (patterns) => {
    for (const detail of details) {
      const label = detail.label.toLowerCase();
      for (const pattern of patterns) {
        if (label.includes(pattern)) return detail.value;
      }
    }
    return "";
  };

  const title = getByLabel(["titel", "event", "name"]);
  const date = getByLabel(["datum"]);
  const time = getByLabel(["uhrzeit", "zeit"]);
  const deadline = getByLabel(["anmeldung"]);
  const explicitEmail = getByLabel(["mail", "e-mail"]);
  const mailMatch = details
    .map((detail) => detail.value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i))
    .find(Boolean);
  const email = explicitEmail || (mailMatch ? mailMatch[0] : "");

  return {
    title,
    date,
    time,
    deadline,
    email,
    details
  };
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

function buildEventsHtml(events) {
  let html = `<div class="event-list">`;

  for (const event of events) {
    html += `<article class="event-card">`;

    if (event.title) {
      html += `<h4 class="event-title">${escapeHtml(event.title)}</h4>`;
    }

    for (const detail of event.details) {
      if (event.title && detail.label.toLowerCase().includes("titel")) continue;
      html += `
        <p class="event-detail">
          <span class="event-label">${escapeHtml(detail.label)}:</span>
          ${escapeHtml(detail.value)}
        </p>
      `;
    }

    const mailto = buildEventMailto(event);
    if (mailto) {
      html += `
        <p class="event-cta">
          <a class="event-link" href="${escapeHtml(mailto)}">Jetzt per E-Mail anmelden</a>
        </p>
      `;
    }

    html += `</article>`;
  }

  html += `</div>`;
  return html;
}

function buildEventMailto(event) {
  if (!event.email) return "";

  const subjectParts = ["Anmeldung"];
  if (event.title) subjectParts.push(`für ${event.title}`);
  if (event.date) subjectParts.push(`am ${event.date}`);
  const subject = subjectParts.join(" ");

  const body = [
    "Hallo,",
    "",
    event.title
      ? `hiermit melde ich mich für das Event "${event.title}" an.`
      : "hiermit melde ich mich für das Event an.",
    [event.date, event.time].filter(Boolean).length
      ? `Termin: ${[event.date, event.time].filter(Boolean).join(" | ")}`
      : "",
    event.deadline ? `Anmeldung bis: ${event.deadline}` : "",
    "",
    "Name: ",
    "Anzahl Personen: ",
    "Telefon (optional): ",
    "Nachricht (optional): ",
    "",
    "Viele Grüße"
  ]
    .filter(Boolean)
    .join("\n");

  return `mailto:${event.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
