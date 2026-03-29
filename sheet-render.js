function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function parseTSV(tsvText) {
  return tsvText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line.split("\t"))
    .filter(row => row.some(cell => String(cell ?? "").trim() !== ""));
}

function normalizeRows(rows) {
  const maxCols = Math.max(0, ...rows.map(row => row.length));
  return rows.map(row => {
    const padded = [...row];
    while (padded.length < maxCols) padded.push("");
    return padded.map(cell => String(cell ?? "").trim());
  });
}

function isEmptyRow(row) {
  return row.every(cell => cell === "");
}

function nonEmptyIndexes(row) {
  const indexes = [];
  for (let i = 0; i < row.length; i++) {
    if (row[i] !== "") indexes.push(i);
  }
  return indexes;
}

function detectTextColumn(rows) {
  let bestIndex = 0;
  let bestScore = -1;

  for (let col = 0; col < (rows[0]?.length || 0); col++) {
    let score = 0;
    for (const row of rows) {
      const value = row[col] || "";
      if (!value) continue;
      if (!/^[\d.,]+$/.test(value) && !/^(€|eur|l|cl|ml|st\.?|stk\.?|je)$/i.test(value)) {
        score++;
      }
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
      result.push({ type: "empty", row });
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

    const hasAnyMeta = row.some((cell, index) => index !== textCol && cell !== "");

    if (onlyTextColumnFilled && previousMeaningfulType === "item") {
      result.push({
        type: "description",
        text: row[textCol]
      });
      previousMeaningfulType = "description";
      continue;
    }

    if (row[textCol] !== "" && hasAnyMeta) {
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

    result.push({ type: "empty", row });
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

      html += `
        <div class="menu-item-block">
          <div class="menu-item">
            <div class="menu-title">${escapeHtml(row.title)}</div>
            <div class="menu-amount">${escapeHtml(row.amount)}</div>
            <div class="menu-unit">${escapeHtml(row.unit)}</div>
            <div class="menu-price">${escapeHtml(row.price)}</div>
            <div class="menu-currency">${escapeHtml(row.currency)}</div>
          </div>
      `;
      itemOpen = true;
      continue;
    }

    if (row.type === "description" && itemOpen) {
      html += `<div class="menu-description">${escapeHtml(row.text)}</div>`;
    }
  }

  if (itemOpen) {
    html += `</div>`;
  }
  if (groupOpen) {
    html += `</div></section>`;
  }

  html += `</div>`;
  return html;
}

async function renderGoogleTSVMenu({ targetId, tsvUrl }) {
  const target = document.getElementById(targetId);
  if (!target) return;

  target.innerHTML = `<p class="menu-loading">Lade Karte …</p>`;

  try {
    const response = await fetch(tsvUrl, {
      method: "GET",
      mode: "cors",
      cache: "no-store"
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const raw = await response.text();
    const rows = normalizeRows(parseTSV(raw));

    if (!rows.length) {
      target.innerHTML = `<p class="menu-error">Keine Daten vorhanden.</p>`;
      return;
    }

    const textCol = detectTextColumn(rows);
    const classified = classifyRows(rows, textCol);
    target.innerHTML = buildMenuHtml(classified);

    if (window.matchMedia("(max-width: 700px)").matches) {
      for (const item of target.querySelectorAll(".menu-item")) {
        const amount = item.querySelector(".menu-amount")?.textContent?.trim() || "";
        const unit = item.querySelector(".menu-unit")?.textContent?.trim() || "";
        const price = item.querySelector(".menu-price")?.textContent?.trim() || "";
        const currency = item.querySelector(".menu-currency")?.textContent?.trim() || "";

        if (amount || unit || price || currency) {
          const meta = document.createElement("div");
          meta.className = "menu-meta";
          meta.textContent = [amount, unit, price, currency].filter(Boolean).join(" ");
          item.appendChild(meta);
        }
      }
    }
  } catch (error) {
    console.error(error);
    target.innerHTML = `<p class="menu-error">Die Karte konnte aktuell nicht geladen werden.</p>`;
  }
}