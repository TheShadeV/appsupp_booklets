(async () => {
  const APP_ID = "docx-grupal-converter-panel";

  const JSZIP_URL =
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

  // Ha már nyitva van a panel, ne hozzunk létre még egyet.
  if (document.getElementById(APP_ID)) {
    document.getElementById(APP_ID).scrollIntoView({
      behavior: "smooth",
      block: "center",
    });

    return;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find(
        (script) => script.src === src,
      );

      if (existing) {
        if (window.JSZip) {
          resolve();
          return;
        }

        existing.addEventListener("load", resolve, { once: true });

        existing.addEventListener("error", reject, { once: true });

        return;
      }

      const script = document.createElement("script");

      script.src = src;
      script.async = true;

      script.onload = resolve;

      script.onerror = () => {
        reject(new Error(`Nem sikerült betölteni: ${src}`));
      };

      document.head.appendChild(script);
    });
  }

  async function ensureJSZip() {
    if (window.JSZip) {
      return window.JSZip;
    }

    await loadScript(JSZIP_URL);

    if (!window.JSZip) {
      throw new Error("A JSZip betöltődött, de nem érhető el.");
    }

    return window.JSZip;
  }

  function escapeHtml(value = "") {
    return value
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value = "") {
    return escapeHtml(value);
  }

  function parseXml(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "application/xml");

    const parserError = doc.querySelector("parsererror");

    if (parserError) {
      throw new Error("A DOCX egyik XML fájlja nem olvasható.");
    }

    return doc;
  }

  function localName(element) {
    return element?.localName || element?.nodeName?.split(":").pop() || "";
  }

  function getWordAttribute(element, attributeName) {
    if (!element) {
      return null;
    }

    return (
      element.getAttribute(`w:${attributeName}`) ||
      element.getAttribute(attributeName) ||
      [...element.attributes].find(
        (attribute) => attribute.localName === attributeName,
      )?.value ||
      null
    );
  }

  function directChildren(element, name) {
    return [...element.children].filter((child) => localName(child) === name);
  }

  async function readRelationships(zip) {
    const file = zip.file("word/_rels/document.xml.rels");

    if (!file) {
      return new Map();
    }

    const xmlText = await file.async("text");

    const xml = parseXml(xmlText);

    const relationships = new Map();

    for (const relationship of xml.getElementsByTagName("*")) {
      if (localName(relationship) !== "Relationship") {
        continue;
      }

      const id = relationship.getAttribute("Id");

      const target = relationship.getAttribute("Target");

      const targetMode = relationship.getAttribute("TargetMode");

      if (id && target && targetMode === "External") {
        relationships.set(id, target);
      }
    }

    return relationships;
  }

  async function readStyles(zip) {
    const file = zip.file("word/styles.xml");

    const styles = new Map();

    if (!file) {
      return styles;
    }

    const xmlText = await file.async("text");

    const xml = parseXml(xmlText);

    for (const style of xml.getElementsByTagName("*")) {
      if (localName(style) !== "style") {
        continue;
      }

      const styleId = getWordAttribute(style, "styleId");

      const nameElement = directChildren(style, "name")[0];

      const styleName = getWordAttribute(nameElement, "val");

      if (styleId) {
        styles.set(styleId, styleName || styleId);
      }
    }

    return styles;
  }

  function getParagraphStyle(paragraph, styles) {
    const paragraphProperties = directChildren(paragraph, "pPr")[0];

    const paragraphStyle = paragraphProperties
      ? directChildren(paragraphProperties, "pStyle")[0]
      : null;

    const styleId = getWordAttribute(paragraphStyle, "val") || "";

    const styleName = styles.get(styleId) || styleId;

    return {
      styleId,
      styleName,
    };
  }

  function detectHeadingLevel(styleId, styleName) {
    const value = `${styleId} ${styleName}`.toLowerCase();

    const patterns = [
      /heading\s*1/,
      /heading\s*2/,
      /heading\s*3/,
      /heading\s*4/,
      /heading\s*5/,
      /heading\s*6/,

      /címsor\s*1/,
      /címsor\s*2/,
      /címsor\s*3/,
      /címsor\s*4/,
      /címsor\s*5/,
      /címsor\s*6/,
    ];

    for (let index = 0; index < patterns.length; index++) {
      if (patterns[index].test(value)) {
        return (index % 6) + 1;
      }
    }

    const compactMatch = value.match(/heading([1-6])/);

    if (compactMatch) {
      return Number(compactMatch[1]);
    }

    return null;
  }

  function runToHtml(run) {
    const runProperties = directChildren(run, "rPr")[0];

    const isBold = !!(runProperties && directChildren(runProperties, "b")[0]);

    const isItalic = !!(runProperties && directChildren(runProperties, "i")[0]);

    const isUnderline = !!(
      runProperties && directChildren(runProperties, "u")[0]
    );

    let html = "";

    for (const child of run.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "t") {
        html += escapeHtml(child.textContent || "");
      }

      if (name === "tab") {
        html += "    ";
      }

      if (name === "br" || name === "cr") {
        html += "<br>";
      }
    }

    if (!html) {
      return "";
    }

    if (isUnderline) {
      html = `<u>${html}</u>`;
    }

    if (isItalic) {
      html = `<em>${html}</em>`;
    }

    if (isBold) {
      html = `<strong>${html}</strong>`;
    }

    return html;
  }

  function inlineChildrenToHtml(parent, relationships) {
    let html = "";

    for (const child of parent.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "r") {
        html += runToHtml(child);

        continue;
      }

      if (name === "hyperlink") {
        const relationshipId =
          child.getAttribute("r:id") ||
          [...child.attributes].find(
            (attribute) => attribute.localName === "id",
          )?.value ||
          "";

        const href = relationships.get(relationshipId);

        const content = inlineChildrenToHtml(child, relationships);

        if (href) {
          html += `<a href="${escapeAttribute(href)}">` + content + "</a>";
        } else {
          html += content;
        }

        continue;
      }

      if (name === "smartTag" || name === "sdt" || name === "ins") {
        html += inlineChildrenToHtml(child, relationships);
      }
    }

    return html;
  }

  function paragraphToHtml(paragraph, styles, relationships) {
    const content = inlineChildrenToHtml(paragraph, relationships).trim();

    if (!content) {
      return "";
    }

    const { styleId, styleName } = getParagraphStyle(paragraph, styles);

    const headingLevel = detectHeadingLevel(styleId, styleName);

    if (headingLevel) {
      return `<h${headingLevel}>` + content + `</h${headingLevel}>`;
    }

    return `<p>${content}</p>`;
  }

  function tableCellToHtml(cell, styles, relationships) {
    const parts = [];

    for (const child of cell.children) {
      const name = localName(child);

      if (name === "p") {
        const html = paragraphToHtml(child, styles, relationships);

        if (html) {
          parts.push(html);
        }
      }

      if (name === "tbl") {
        parts.push(tableToHtml(child, styles, relationships));
      }
    }

    return "<td>" + parts.join("\n") + "</td>";
  }

  function tableToHtml(table, styles, relationships) {
    const rows = [];

    for (const row of directChildren(table, "tr")) {
      const cells = directChildren(row, "tc").map((cell) =>
        tableCellToHtml(cell, styles, relationships),
      );

      rows.push(`<tr>${cells.join("")}</tr>`);
    }

    return `
<table border="0" cellpadding="0" cellspacing="0">
${rows.join("\n")}
</table>
`.trim();
  }

  async function convertDocxToHtml(file) {
    const JSZip = await ensureJSZip();

    const zip = await JSZip.loadAsync(file);

    const documentFile = zip.file("word/document.xml");

    if (!documentFile) {
      throw new Error("Ez nem tűnik érvényes DOCX fájlnak.");
    }

    const [documentXmlText, styles, relationships] = await Promise.all([
      documentFile.async("text"),

      readStyles(zip),

      readRelationships(zip),
    ]);

    const xml = parseXml(documentXmlText);

    const body = [...xml.getElementsByTagName("*")].find(
      (element) => localName(element) === "body",
    );

    if (!body) {
      throw new Error("Nem található dokumentumtörzs.");
    }

    const output = [];

    for (const child of body.children) {
      const name = localName(child);

      if (name === "p") {
        const html = paragraphToHtml(child, styles, relationships);

        if (html) {
          output.push(html);
        }
      }

      if (name === "tbl") {
        output.push(tableToHtml(child, styles, relationships));
      }
    }

    return output.join("\n\n");
  }

  function createPanel() {
    const panel = document.createElement("div");

    panel.id = APP_ID;

    Object.assign(panel.style, {
      position: "fixed",

      top: "20px",

      right: "20px",

      width: "560px",

      maxWidth: "calc(100vw - 40px)",

      maxHeight: "calc(100vh - 40px)",

      zIndex: "2147483647",

      background: "#ffffff",

      color: "#222222",

      border: "1px solid #bbbbbb",

      borderRadius: "10px",

      boxShadow: "0 12px 40px rgba(0, 0, 0, .25)",

      padding: "16px",

      fontFamily: "Arial, sans-serif",

      fontSize: "14px",

      boxSizing: "border-box",

      overflow: "auto",
    });

    panel.innerHTML = `
            <div
                style="
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:12px;
                    margin-bottom:14px;
                "
            >
                <strong
                    style="
                        font-size:16px;
                    "
                >
                    DOCX → Grupal HTML
                </strong>

                <button
                    type="button"
                    data-action="close"
                    title="Bezárás"
                    style="
                        border:0;
                        background:transparent;
                        font-size:22px;
                        line-height:1;
                        cursor:pointer;
                        padding:0 4px;
                    "
                >
                    ×
                </button>
            </div>

            <label
                style="
                    display:block;
                    font-weight:600;
                    margin-bottom:6px;
                "
            >
                DOCX fájl
            </label>

            <input
                type="file"
                accept=".docx"
                data-role="file"
                style="
                    display:block;
                    width:100%;
                    box-sizing:border-box;
                    margin-bottom:12px;
                "
            >

            <div
                data-role="status"
                style="
                    min-height:20px;
                    margin-bottom:10px;
                    color:#555555;
                "
            >
                Válassz egy .docx fájlt.
            </div>

            <div
                style="
                    display:flex;
                    align-items:center;
                    justify-content:space-between;
                    gap:10px;
                    margin-bottom:6px;
                "
            >
                <label
                    style="
                        font-weight:600;
                    "
                >
                    HTML forrás
                </label>

                <button
                    type="button"
                    data-action="copy"
                    style="
                        border:1px solid #999999;
                        background:#f5f5f5;
                        border-radius:6px;
                        padding:6px 10px;
                        cursor:pointer;
                    "
                >
                    Másolás
                </button>
            </div>

            <textarea
                data-role="output"
                spellcheck="false"
                placeholder="Ide kerül a generált HTML..."
                style="
                    width:100%;
                    height:320px;
                    resize:vertical;
                    box-sizing:border-box;
                    border:1px solid #aaaaaa;
                    border-radius:6px;
                    padding:10px;
                    font-family:Consolas, Monaco, monospace;
                    font-size:12px;
                    line-height:1.45;
                "
            ></textarea>

            <div
                style="
                    margin-top:10px;
                    font-size:12px;
                    color:#777777;
                    line-height:1.4;
                "
            >
                Első verzió:
                bekezdések, címsorok,
                félkövér, dőlt és aláhúzott szöveg,
                külső linkek és egyszerű táblázatok.
            </div>
        `;

    document.body.appendChild(panel);

    const fileInput = panel.querySelector('[data-role="file"]');

    const output = panel.querySelector('[data-role="output"]');

    const status = panel.querySelector('[data-role="status"]');

    const closeButton = panel.querySelector('[data-action="close"]');

    const copyButton = panel.querySelector('[data-action="copy"]');

    closeButton.addEventListener("click", () => {
      panel.remove();
    });

    copyButton.addEventListener("click", async () => {
      if (!output.value.trim()) {
        status.textContent = "Nincs mit másolni.";

        return;
      }

      try {
        await navigator.clipboard.writeText(output.value);

        status.textContent = "HTML a vágólapra másolva.";
      } catch {
        output.focus();
        output.select();

        document.execCommand("copy");

        status.textContent = "HTML a vágólapra másolva.";
      }
    });

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];

      if (!file) {
        return;
      }

      if (!file.name.toLowerCase().endsWith(".docx")) {
        status.textContent = "Kérlek .docx fájlt válassz.";

        output.value = "";

        return;
      }

      status.textContent = "Feldolgozás...";

      output.value = "";

      try {
        const html = await convertDocxToHtml(file);

        output.value = html;

        if (html) {
          status.textContent = `Kész: ${file.name}`;
        } else {
          status.textContent = "Nem találtam konvertálható tartalmat.";
        }
      } catch (error) {
        console.error("[DOCX → Grupal]", error);

        status.textContent = `Hiba: ${error.message || error}`;
      }
    });
  }

  try {
    createPanel();
  } catch (error) {
    console.error("[DOCX → Grupal]", error);

    alert(
      "A Grupal converter nem tudott elindulni:\n\n" + (error.message || error),
    );
  }
})();
