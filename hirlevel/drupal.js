(async () => {
  const APP_ID = "docx-drupal-converter-panel";

  const JSZIP_URL =
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

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
    return String(value)
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

  function directChildren(element, name) {
    if (!element) {
      return [];
    }

    return [...element.children].filter((child) => localName(child) === name);
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

  function getRelationshipId(element) {
    if (!element) {
      return null;
    }

    return (
      element.getAttribute("r:id") ||
      [...element.attributes].find((attribute) => attribute.localName === "id")
        ?.value ||
      null
    );
  }

  function isPropertyEnabled(element) {
    if (!element) {
      return false;
    }

    const value = getWordAttribute(element, "val");

    if (value === null) {
      return true;
    }

    return !["0", "false", "off", "none"].includes(String(value).toLowerCase());
  }

  function normalizeHexColor(value) {
    if (!value) {
      return null;
    }

    value = String(value).trim();

    if (
      !value ||
      value.toLowerCase() === "auto" ||
      value.toLowerCase() === "none"
    ) {
      return null;
    }

    value = value.replace(/^#/, "");

    if (/^[0-9a-f]{6}$/i.test(value)) {
      return `#${value}`;
    }

    if (/^[0-9a-f]{3}$/i.test(value)) {
      return `#${value}`;
    }

    return null;
  }

  function wordHighlightToCss(value) {
    if (!value) {
      return null;
    }

    const colors = {
      black: "#000000",
      blue: "#0000ff",
      cyan: "#00ffff",
      green: "#008000",
      magenta: "#ff00ff",
      red: "#ff0000",
      yellow: "#ffff00",
      white: "#ffffff",

      darkBlue: "#00008b",
      darkCyan: "#008b8b",
      darkGreen: "#006400",
      darkMagenta: "#8b008b",
      darkRed: "#8b0000",
      darkYellow: "#808000",

      darkGray: "#a9a9a9",
      lightGray: "#d3d3d3",
    };

    if (value === "none" || value === "auto") {
      return null;
    }

    return colors[value] || null;
  }

  function cssString(styles) {
    return Object.entries(styles)
      .filter(
        ([, value]) => value !== null && value !== undefined && value !== "",
      )
      .map(([property, value]) => `${property}:${value}`)
      .join(";");
  }

  function twipsToPx(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    return `${number / 15}px`;
  }

  async function readRelationships(zip) {
    const file = zip.file("word/_rels/document.xml.rels");

    const relationships = new Map();

    if (!file) {
      return relationships;
    }

    const xmlText = await file.async("text");

    const xml = parseXml(xmlText);

    for (const relationship of xml.getElementsByTagName("*")) {
      if (localName(relationship) !== "Relationship") {
        continue;
      }

      const id = relationship.getAttribute("Id");

      const target = relationship.getAttribute("Target");

      if (id && target) {
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
    const pPr = directChildren(paragraph, "pPr")[0];

    const pStyle = pPr ? directChildren(pPr, "pStyle")[0] : null;

    const styleId = getWordAttribute(pStyle, "val") || "";

    const styleName = styles.get(styleId) || styleId;

    return {
      styleId,
      styleName,
    };
  }

  function detectHeadingLevel(styleId, styleName) {
    const value = `${styleId} ${styleName}`.toLowerCase();

    const headingMatch = value.match(/heading\s*([1-6])/);

    if (headingMatch) {
      return Number(headingMatch[1]);
    }

    const headingCompactMatch = value.match(/heading([1-6])/);

    if (headingCompactMatch) {
      return Number(headingCompactMatch[1]);
    }

    const hungarianMatch = value.match(/címsor\s*([1-6])/);

    if (hungarianMatch) {
      return Number(hungarianMatch[1]);
    }

    return null;
  }

  function getParagraphCss(paragraph) {
    const pPr = directChildren(paragraph, "pPr")[0];

    if (!pPr) {
      return "";
    }

    const styles = {};

    /*
     * Szövegigazítás
     */
    const justification = directChildren(pPr, "jc")[0];

    const justificationValue = getWordAttribute(justification, "val");

    const alignmentMap = {
      left: "left",
      start: "left",
      center: "center",
      right: "right",
      end: "right",

      both: "justify",
      distribute: "justify",
      numTab: "left",
    };

    if (justificationValue && alignmentMap[justificationValue]) {
      styles["text-align"] = alignmentMap[justificationValue];
    }

    /*
     * Bekezdés háttérszíne
     */
    const shading = directChildren(pPr, "shd")[0];

    const shadingColor = normalizeHexColor(getWordAttribute(shading, "fill"));

    if (shadingColor) {
      styles["background-color"] = shadingColor;
    }

    /*
     * Behúzások
     */
    const indentation = directChildren(pPr, "ind")[0];

    if (indentation) {
      const left =
        getWordAttribute(indentation, "left") ||
        getWordAttribute(indentation, "start");

      const right =
        getWordAttribute(indentation, "right") ||
        getWordAttribute(indentation, "end");

      const firstLine = getWordAttribute(indentation, "firstLine");

      const hanging = getWordAttribute(indentation, "hanging");

      if (left) {
        styles["margin-left"] = twipsToPx(left);
      }

      if (right) {
        styles["margin-right"] = twipsToPx(right);
      }

      if (firstLine) {
        styles["text-indent"] = twipsToPx(firstLine);
      }

      if (hanging) {
        const px = Number(hanging) / 15;

        styles["text-indent"] = `${-px}px`;
      }
    }

    /*
     * Térköz / sorköz
     */
    const spacing = directChildren(pPr, "spacing")[0];

    if (spacing) {
      const before = getWordAttribute(spacing, "before");

      const after = getWordAttribute(spacing, "after");

      const line = getWordAttribute(spacing, "line");

      const lineRule = getWordAttribute(spacing, "lineRule");

      if (before) {
        styles["margin-top"] = twipsToPx(before);
      }

      if (after) {
        styles["margin-bottom"] = twipsToPx(after);
      }

      if (line) {
        if (lineRule === "exact" || lineRule === "atLeast") {
          styles["line-height"] = twipsToPx(line);
        } else {
          const number = Number(line);

          if (Number.isFinite(number)) {
            styles["line-height"] = String(number / 240);
          }
        }
      }
    }

    return cssString(styles);
  }

  function getRunCss(run) {
    const rPr = directChildren(run, "rPr")[0];

    if (!rPr) {
      return "";
    }

    const styles = {};

    /*
     * Szövegszín
     */
    const colorElement = directChildren(rPr, "color")[0];

    const color = normalizeHexColor(getWordAttribute(colorElement, "val"));

    if (color) {
      styles.color = color;
    }

    /*
     * Szövegkiemelés / highlight
     */
    const highlightElement = directChildren(rPr, "highlight")[0];

    const highlightValue = getWordAttribute(highlightElement, "val");

    const highlightColor = wordHighlightToCss(highlightValue);

    if (highlightColor) {
      styles["background-color"] = highlightColor;
    }

    /*
     * Run shading.
     * Ez is lehet Word háttérszín.
     */
    const shading = directChildren(rPr, "shd")[0];

    const shadingColor = normalizeHexColor(getWordAttribute(shading, "fill"));

    if (shadingColor) {
      styles["background-color"] = shadingColor;
    }

    /*
     * Betűméret.
     * Word fél pontban tárolja.
     *
     * 24 = 12pt
     */
    const sizeElement = directChildren(rPr, "sz")[0];

    const sizeValue = getWordAttribute(sizeElement, "val");

    if (sizeValue) {
      const size = Number(sizeValue);

      if (Number.isFinite(size)) {
        styles["font-size"] = `${size / 2}pt`;
      }
    }

    /*
     * Betűtípus
     */
    const fonts = directChildren(rPr, "rFonts")[0];

    if (fonts) {
      const font =
        getWordAttribute(fonts, "ascii") ||
        getWordAttribute(fonts, "hAnsi") ||
        getWordAttribute(fonts, "eastAsia");

      if (font) {
        styles["font-family"] = `"${font.replaceAll('"', '\\"')}"`;
      }
    }

    return cssString(styles);
  }

  function runToHtml(run) {
    const rPr = directChildren(run, "rPr")[0];

    const boldElement = rPr ? directChildren(rPr, "b")[0] : null;

    const italicElement = rPr ? directChildren(rPr, "i")[0] : null;

    const underlineElement = rPr ? directChildren(rPr, "u")[0] : null;

    const strikeElement = rPr ? directChildren(rPr, "strike")[0] : null;

    const isBold = isPropertyEnabled(boldElement);

    const isItalic = isPropertyEnabled(italicElement);

    const isUnderline =
      underlineElement && getWordAttribute(underlineElement, "val") !== "none";

    const isStrike = isPropertyEnabled(strikeElement);

    let html = "";

    for (const child of run.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "t" || name === "instrText") {
        html += escapeHtml(child.textContent || "");
      }

      if (name === "tab") {
        html += "&emsp;";
      }

      if (name === "br" || name === "cr") {
        html += "<br>";
      }
    }

    if (!html) {
      return "";
    }

    /*
     * Word CSS formázás
     */
    const runCss = getRunCss(run);

    if (runCss) {
      html = `<span style="${escapeAttribute(runCss)}">` + html + "</span>";
    }

    /*
     * Szemantikus formázások
     */
    if (isUnderline) {
      html = `<u>${html}</u>`;
    }

    if (isItalic) {
      html = `<em>${html}</em>`;
    }

    if (isBold) {
      html = `<strong>${html}</strong>`;
    }

    if (isStrike) {
      html = `<s>${html}</s>`;
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

      /*
       * Normál Word run.
       */
      if (name === "r") {
        html += runToHtml(child);

        continue;
      }

      /*
       * Drupal számára normál HTML linket generálunk:
       *
       * <a href="...">...</a>
       */
      if (name === "hyperlink") {
        const relationshipId = getRelationshipId(child);

        const anchor = getWordAttribute(child, "anchor");

        let href = null;

        if (relationshipId && relationships.has(relationshipId)) {
          href = relationships.get(relationshipId);
        } else if (anchor) {
          href = `#${anchor}`;
        }

        const content = inlineChildrenToHtml(child, relationships);

        if (href) {
          html += `<a href="${escapeAttribute(href)}">` + content + "</a>";
        } else {
          html += content;
        }

        continue;
      }

      /*
       * Word wrapper elemek.
       */
      if (
        name === "smartTag" ||
        name === "sdt" ||
        name === "sdtContent" ||
        name === "ins"
      ) {
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

    const paragraphCss = getParagraphCss(paragraph);

    const styleAttribute = paragraphCss
      ? ` style="${escapeAttribute(paragraphCss)}"`
      : "";

    if (headingLevel) {
      return (
        `<h${headingLevel}${styleAttribute}>` + content + `</h${headingLevel}>`
      );
    }

    return `<p${styleAttribute}>` + content + "</p>";
  }

  function getTableCellCss(cell) {
    const tcPr = directChildren(cell, "tcPr")[0];

    if (!tcPr) {
      return "";
    }

    const styles = {};

    /*
     * Cella háttérszín
     */
    const shading = directChildren(tcPr, "shd")[0];

    const background = normalizeHexColor(getWordAttribute(shading, "fill"));

    if (background) {
      styles["background-color"] = background;
    }

    /*
     * Vertikális igazítás
     */
    const verticalAlign = directChildren(tcPr, "vAlign")[0];

    const verticalAlignValue = getWordAttribute(verticalAlign, "val");

    if (verticalAlignValue) {
      const verticalMap = {
        top: "top",
        center: "middle",
        bottom: "bottom",
      };

      if (verticalMap[verticalAlignValue]) {
        styles["vertical-align"] = verticalMap[verticalAlignValue];
      }
    }

    /*
     * Cella szélesség
     */
    const widthElement = directChildren(tcPr, "tcW")[0];

    const width = getWordAttribute(widthElement, "w");

    const widthType = getWordAttribute(widthElement, "type");

    if (width && widthType === "dxa") {
      styles.width = twipsToPx(width);
    }

    return cssString(styles);
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

    const cellCss = getTableCellCss(cell);

    const styleAttribute = cellCss
      ? ` style="${escapeAttribute(cellCss)}"`
      : "";

    return `<td${styleAttribute}>` + parts.join("\n") + "</td>";
  }

  function tableToHtml(table, styles, relationships) {
    const rows = [];

    for (const row of directChildren(table, "tr")) {
      const cells = directChildren(row, "tc").map((cell) =>
        tableCellToHtml(cell, styles, relationships),
      );

      rows.push("<tr>" + cells.join("") + "</tr>");
    }

    return [
      '<table border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">',
      ...rows,
      "</table>",
    ].join("\n");
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

      width: "650px",
      maxWidth: "calc(100vw - 40px)",

      maxHeight: "calc(100vh - 40px)",

      zIndex: "2147483647",

      background: "#ffffff",

      color: "#222222",

      border: "1px solid #bbbbbb",

      borderRadius: "10px",

      boxShadow: "0 12px 40px rgba(0,0,0,.25)",

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
                    style="font-size:16px;"
                >
                    DOCX → Drupal HTML
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
                    style="font-weight:600;"
                >
                    Drupal HTML forrás
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
                    height:400px;
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
                    line-height:1.5;
                "
            >
                Megtartja többek között a címsorokat,
                igazítást, sorkizárást, félkövér/dőlt/aláhúzott
                formázást, szövegszínt, háttérszínt,
                betűméretet, linkeket és egyszerű táblázatokat.
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
        console.error("[DOCX → Drupal]", error);

        status.textContent = `Hiba: ${error.message || error}`;
      }
    });
  }

  createPanel();
})();
