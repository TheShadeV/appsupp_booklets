(async () => {
  const normalize = (value) =>
    String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("hu-HU");
  const normalizeLabel = (value) => normalize(value).replace(/[-–—]/g, "");
  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[char],
    );
  const hostname = location.hostname.toLowerCase().replace(/^www\./, "");
  const configs = {
    "ekop.pte.hu": {
      stateField: "TenderSearch[state]",
      otherStateField: "TenderSearch[status]",
      detailPath: /^\/tender\/\d+\/?$/,
      siteName: "EKOP",
    },
    "kitep.pte.hu": {
      stateField: "TenderSearch[status]",
      otherStateField: "TenderSearch[state]",
      detailPath: /^\/tender\/view\/\d+\/?$/,
      siteName: "KITEP",
    },
  };
  const config = configs[hostname];
  if (!config) {
    alert(
      "Ez a bookmarklet jelenleg csak az ekop.pte.hu és a kitep.pte.hu oldalakon használható.",
    );
    return;
  }
  const stateSelect =
    document.querySelector(`select[name="${config.stateField}"]`) ||
    document.querySelector(
      'select[name="TenderSearch[state]"], select[name="TenderSearch[status]"]',
    );
  const defaultLabel =
    stateSelect?.selectedOptions?.[0]?.textContent?.trim() ||
    "Pályázat Tartaléklistán";
  const requestedLabel = prompt(
    "Melyik pályázati státuszra keressek?",
    defaultLabel,
  );
  if (!requestedLabel) return;
  const fallbackStates = {
    "pályázat tartaléklistán": "TenderWorkflow/spare-list",
  };
  let stateValue = "";
  let stateLabel = requestedLabel.trim();
  if (stateSelect) {
    const options = [...stateSelect.options];
    const exact = options.find(
      (option) => normalize(option.textContent) === normalize(requestedLabel),
    );
    const partial = options.find((option) =>
      normalize(option.textContent).includes(normalize(requestedLabel)),
    );
    const match = exact || partial;
    if (match) {
      stateValue = match.value;
      stateLabel = match.textContent.trim();
    }
  }
  if (!stateValue) {
    stateValue =
      fallbackStates[normalize(requestedLabel)] ||
      (requestedLabel.includes("/") ? requestedLabel.trim() : "");
  }
  if (!stateValue) {
    alert(
      "Nem találtam ilyen státuszt. Írd be pontosan a legördülő listában szereplő nevet.",
    );
    return;
  }
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  const listHeaders = {
    accept: "text/html, */*; q=0.01",
    "x-requested-with": "XMLHttpRequest",
    "x-pjax": "true",
    "x-pjax-container": "#p0",
  };
  if (csrfToken) listHeaders["x-csrf-token"] = csrfToken;
  const firstUrl = new URL(location.href);
  firstUrl.pathname = "/tender/index";
  firstUrl.searchParams.set(config.stateField, stateValue);
  firstUrl.searchParams.delete(config.otherStateField);
  firstUrl.searchParams.set("_pjax", "#p0");
  firstUrl.searchParams.delete("page");
  firstUrl.searchParams.delete("p0-page");
  const seenUrls = new Set();
  const collectedRows = [];
  let columnHeaders = [];
  let nextUrl = firstUrl;
  let pageCount = 0;
  while (nextUrl && pageCount < 100) {
    const urlKey = nextUrl.href;
    if (seenUrls.has(urlKey)) break;
    seenUrls.add(urlKey);
    pageCount += 1;
    const response = await fetch(nextUrl.href, {
      method: "GET",
      credentials: "include",
      headers: listHeaders,
    });
    if (!response.ok) {
      throw new Error(`Lista lekérése sikertelen: HTTP ${response.status}`);
    }
    const html = await response.text();
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const root = parsed.querySelector("#p0") || parsed.body;
    if (!columnHeaders.length) {
      columnHeaders = [...root.querySelectorAll("table thead th")].map((th) =>
        th.textContent.replace(/\s+/g, " ").trim(),
      );
    }
    const rows = [...root.querySelectorAll("table tbody tr")].filter(
      (row) => !row.querySelector("td.empty"),
    );
    for (const row of rows) {
      const cells = [...row.querySelectorAll("th, td")].map((cell) =>
        cell.textContent.replace(/\s+/g, " ").trim(),
      );
      const detailAnchor = [...row.querySelectorAll("a[href]")].find(
        (anchor) => {
          try {
            const url = new URL(anchor.getAttribute("href"), location.origin);
            return (
              url.origin === location.origin &&
              config.detailPath.test(url.pathname)
            );
          } catch {
            return false;
          }
        },
      );
      const detailUrl = detailAnchor
        ? new URL(detailAnchor.getAttribute("href"), location.href).href
        : "";
      collectedRows.push({ cells, detailUrl, email: "" });
    }
    const nextLink = root.querySelector(
      'ul.pagination li.next:not(.disabled) a, .pagination li.next:not(.disabled) a, a[rel="next"]',
    );
    if (!nextLink?.getAttribute("href")) {
      nextUrl = null;
    } else {
      nextUrl = new URL(nextLink.getAttribute("href"), location.href);
      nextUrl.searchParams.set("_pjax", "#p0");
    }
  }
  document.getElementById("ekop-kitep-bookmarklet-results")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "ekop-kitep-bookmarklet-results";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif;";
  const panel = document.createElement("div");
  panel.style.cssText =
    "background:#fff;color:#111;width:min(1500px,96vw);max-height:92vh;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;";
  const toolbar = document.createElement("div");
  toolbar.style.cssText =
    "display:flex;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid #ddd;";
  const statusText = document.createElement("strong");
  statusText.style.cssText = "flex:1";
  statusText.textContent = `${config.siteName}: ${stateLabel} — ${collectedRows.length} találat (${pageCount} oldal) — e-mailek lekérése...`;
  const copyButton = document.createElement("button");
  copyButton.textContent = "Másolás TSV-ként";
  copyButton.disabled = true;
  copyButton.style.cssText = "padding:8px 12px;cursor:pointer;";
  const closeButton = document.createElement("button");
  closeButton.textContent = "Bezárás";
  closeButton.style.cssText = "padding:8px 12px;cursor:pointer;";
  closeButton.onclick = () => overlay.remove();
  toolbar.append(statusText, copyButton, closeButton);
  const content = document.createElement("div");
  content.style.cssText = "overflow:auto;padding:0 16px 16px;";
  panel.append(toolbar, content);
  overlay.append(panel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.append(overlay);
  const extractEmail = (html) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const contactSection = [...parsed.querySelectorAll("section")].find(
      (section) =>
        [...section.querySelectorAll("h1,h2,h3,h4,h5,h6")].some(
          (heading) => normalize(heading.textContent) === "elérhetőségek",
        ),
    );
    const searchRoot = contactSection || parsed;
    const emailRow = [...searchRoot.querySelectorAll("tr")].find((row) => {
      const heading = row.querySelector("th");
      return heading && normalizeLabel(heading.textContent) === "email";
    });
    const mailto =
      emailRow?.querySelector('a[href^="mailto:"]') ||
      searchRoot.querySelector('a[href^="mailto:"]');
    if (mailto) {
      return decodeURIComponent(
        mailto
          .getAttribute("href")
          .replace(/^mailto:/i, "")
          .split("?")[0],
      ).trim();
    }
    const emailCellText =
      emailRow?.querySelector("td")?.textContent?.trim() || "";
    const emailMatch = emailCellText.match(
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
    );
    return emailMatch?.[0] || "";
  };
  const detailCache = new Map();
  const fetchEmail = async (detailUrl) => {
    if (!detailUrl) return "";
    if (detailCache.has(detailUrl)) return detailCache.get(detailUrl);
    const promise = fetch(detailUrl, {
      method: "GET",
      credentials: "include",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(extractEmail)
      .catch((error) => {
        console.warn("E-mail lekérése sikertelen:", detailUrl, error);
        return "";
      });
    detailCache.set(detailUrl, promise);
    return promise;
  };
  let completed = 0;
  const queue = collectedRows.map((row) => row);
  const worker = async () => {
    while (queue.length) {
      const row = queue.shift();
      if (!row) return;
      row.email = await fetchEmail(row.detailUrl);
      completed += 1;
      statusText.textContent = `${config.siteName}: ${stateLabel} — ${collectedRows.length} találat (${pageCount} oldal) — e-mailek: ${completed}/${collectedRows.length}`;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(4, collectedRows.length || 1) }, () =>
      worker(),
    ),
  );
  const finalHeaders = [...columnHeaders, "E-mail"];
  const finalRows = collectedRows.map((row) => [...row.cells, row.email]);
  const foundEmailCount = collectedRows.filter((row) => row.email).length;
  statusText.textContent = `${config.siteName}: ${stateLabel} — ${collectedRows.length} találat (${pageCount} oldal) — ${foundEmailCount} e-mail cím`;
  copyButton.disabled = false;
  copyButton.onclick = async () => {
    const lines = [finalHeaders, ...finalRows]
      .map((row) => row.join("\t"))
      .join("\n");
    await navigator.clipboard.writeText(lines);
    copyButton.textContent = "Kimásolva";
    setTimeout(() => {
      copyButton.textContent = "Másolás TSV-ként";
    }, 1200);
  };
  if (!finalRows.length) {
    content.innerHTML =
      '<p style="padding:18px 0">Nincs találat ehhez a státuszhoz.</p>';
    return;
  }
  const head = `<thead><tr>${finalHeaders.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>`;
  const body = finalRows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  content.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px"><style>#ekop-kitep-bookmarklet-results th,#ekop-kitep-bookmarklet-results td{border:1px solid #ddd;padding:7px 9px;text-align:left;vertical-align:top}#ekop-kitep-bookmarklet-results th{position:sticky;top:0;background:#f5f5f5}</style>${head}<tbody>${body}</tbody></table>`;
})().catch((error) => {
  console.error(error);
  alert(`Hiba történt: ${error.message}`);
});
void 0;
