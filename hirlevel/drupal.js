(async () => {
  const APP_ID = "docx-drupal-converter-panel";
  const JSZIP_URL =
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

  // =========================================================
  // SCRIPT LOADER
  // =========================================================

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

        existing.addEventListener("load", resolve, {
          once: true,
        });

        existing.addEventListener("error", reject, {
          once: true,
        });

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
      throw new Error("A JSZip betöltése sikertelen.");
    }

    return window.JSZip;
  }

  // =========================================================
  // BASIC HELPERS
  // =========================================================

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

  function firstDirectChild(element, name) {
    return directChildren(element, name)[0] || null;
  }

  function descendants(element, name) {
    if (!element) {
      return [];
    }

    return [...element.getElementsByTagName("*")].filter(
      (child) => localName(child) === name,
    );
  }

  function firstDescendant(element, name) {
    return descendants(element, name)[0] || null;
  }

  function getWordAttribute(element, attributeName) {
    if (!element) {
      return null;
    }

    return (
      element.getAttribute(`w:${attributeName}`) ||
      element.getAttribute(`r:${attributeName}`) ||
      element.getAttribute(attributeName) ||
      [...element.attributes].find(
        (attribute) => attribute.localName === attributeName,
      )?.value ||
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

  function mergeObjects(...objects) {
    const result = {};

    for (const object of objects) {
      if (!object) {
        continue;
      }

      for (const [key, value] of Object.entries(object)) {
        if (value !== undefined && value !== null) {
          result[key] = value;
        }
      }
    }

    return result;
  }

  function cssString(styles) {
    return Object.entries(styles)
      .filter(
        ([, value]) => value !== null && value !== undefined && value !== "",
      )
      .map(([property, value]) => `${property}:${value}`)
      .join(";");
  }

  function normalizeHexColor(value) {
    if (!value) {
      return null;
    }

    value = String(value).trim().replace(/^#/, "");

    if (value.toLowerCase() === "auto" || value.toLowerCase() === "none") {
      return null;
    }

    if (/^[0-9a-f]{6}$/i.test(value)) {
      return `#${value}`;
    }

    if (/^[0-9a-f]{3}$/i.test(value)) {
      return `#${value}`;
    }

    return null;
  }

  function twipsToPt(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    return `${number / 20}pt`;
  }

  function halfPointsToPt(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    return `${number / 2}pt`;
  }

  function percent50ToPercent(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
      return null;
    }

    return `${number / 50}%`;
  }

  // =========================================================
  // WORD COLORS
  // =========================================================

  function wordHighlightToCss(value) {
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

    return colors[value] || null;
  }

  // =========================================================
  // THEME
  // =========================================================

  async function readThemeFonts(zip) {
    const defaults = {
      major: null,
      minor: null,
    };

    const file = zip.file("word/theme/theme1.xml");

    if (!file) {
      return defaults;
    }

    try {
      const xml = parseXml(await file.async("text"));

      const majorFont = descendants(xml, "majorFont")[0];

      const minorFont = descendants(xml, "minorFont")[0];

      const majorLatin = majorFont ? descendants(majorFont, "latin")[0] : null;

      const minorLatin = minorFont ? descendants(minorFont, "latin")[0] : null;

      defaults.major = majorLatin?.getAttribute("typeface") || null;

      defaults.minor = minorLatin?.getAttribute("typeface") || null;
    } catch {
      // Nem kritikus.
    }

    return defaults;
  }

  // =========================================================
  // RUN PROPERTIES
  // =========================================================

  function parseRunProperties(rPr, themeFonts = {}) {
    if (!rPr) {
      return {};
    }

    const result = {};

    const bold = firstDirectChild(rPr, "b");

    const italic = firstDirectChild(rPr, "i");

    const underline = firstDirectChild(rPr, "u");

    const strike = firstDirectChild(rPr, "strike");

    const color = firstDirectChild(rPr, "color");

    const highlight = firstDirectChild(rPr, "highlight");

    const shading = firstDirectChild(rPr, "shd");

    const size = firstDirectChild(rPr, "sz");

    const fonts = firstDirectChild(rPr, "rFonts");

    const verticalAlign = firstDirectChild(rPr, "vertAlign");

    if (bold) {
      result.bold = isPropertyEnabled(bold);
    }

    if (italic) {
      result.italic = isPropertyEnabled(italic);
    }

    if (underline) {
      const value = getWordAttribute(underline, "val");

      result.underline = value !== "none" && value !== "0" && value !== "false";
    }

    if (strike) {
      result.strike = isPropertyEnabled(strike);
    }

    if (color) {
      const value = normalizeHexColor(getWordAttribute(color, "val"));

      if (value) {
        result.color = value;
      }
    }

    if (highlight) {
      const value = wordHighlightToCss(getWordAttribute(highlight, "val"));

      if (value) {
        result.backgroundColor = value;
      }
    }

    if (shading) {
      const value = normalizeHexColor(getWordAttribute(shading, "fill"));

      if (value) {
        result.backgroundColor = value;
      }
    }

    if (size) {
      const value = getWordAttribute(size, "val");

      if (value) {
        result.fontSize = halfPointsToPt(value);
      }
    }

    if (fonts) {
      let font =
        getWordAttribute(fonts, "ascii") || getWordAttribute(fonts, "hAnsi");

      if (!font) {
        const theme =
          getWordAttribute(fonts, "asciiTheme") ||
          getWordAttribute(fonts, "hAnsiTheme");

        if (theme && theme.toLowerCase().includes("major")) {
          font = themeFonts.major;
        }

        if (theme && theme.toLowerCase().includes("minor")) {
          font = themeFonts.minor;
        }
      }

      if (font) {
        result.fontFamily = font;
      }
    }

    if (verticalAlign) {
      const value = getWordAttribute(verticalAlign, "val");

      if (value === "superscript") {
        result.verticalAlign = "super";
      }

      if (value === "subscript") {
        result.verticalAlign = "sub";
      }
    }

    return result;
  }

  function runPropertiesToCss(properties) {
    const styles = {};

    if (properties.fontFamily) {
      styles["font-family"] = `"${String(properties.fontFamily).replaceAll(
        '"',
        '\\"',
      )}"`;
    }

    if (properties.fontSize) {
      styles["font-size"] = properties.fontSize;
    }

    if (properties.bold !== undefined) {
      styles["font-weight"] = properties.bold ? "700" : "400";
    }

    if (properties.italic !== undefined) {
      styles["font-style"] = properties.italic ? "italic" : "normal";
    }

    if (properties.color) {
      styles.color = properties.color;
    }

    if (properties.backgroundColor) {
      styles["background-color"] = properties.backgroundColor;
    }

    const decorations = [];

    if (properties.underline) {
      decorations.push("underline");
    }

    if (properties.strike) {
      decorations.push("line-through");
    }

    if (decorations.length) {
      styles["text-decoration"] = decorations.join(" ");
    }

    if (properties.verticalAlign) {
      styles["vertical-align"] = properties.verticalAlign;

      styles["font-size"] = properties.fontSize || "0.75em";
    }

    return styles;
  }

  // =========================================================
  // PARAGRAPH PROPERTIES
  // =========================================================

  function parseParagraphProperties(pPr) {
    if (!pPr) {
      return {};
    }

    const result = {};

    const justification = firstDirectChild(pPr, "jc");

    const shading = firstDirectChild(pPr, "shd");

    const indentation = firstDirectChild(pPr, "ind");

    const spacing = firstDirectChild(pPr, "spacing");

    if (justification) {
      const value = getWordAttribute(justification, "val");

      const map = {
        left: "left",
        start: "left",
        center: "center",
        right: "right",
        end: "right",
        both: "justify",
        distribute: "justify",
        thaiDistribute: "justify",
      };

      if (map[value]) {
        result.textAlign = map[value];
      }
    }

    if (shading) {
      const color = normalizeHexColor(getWordAttribute(shading, "fill"));

      if (color) {
        result.backgroundColor = color;
      }
    }

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
        result.marginLeft = twipsToPt(left);
      }

      if (right) {
        result.marginRight = twipsToPt(right);
      }

      if (firstLine) {
        result.textIndent = twipsToPt(firstLine);
      }

      if (hanging) {
        const value = Number(hanging);

        if (Number.isFinite(value)) {
          result.textIndent = `${-value / 20}pt`;
        }
      }
    }

    if (spacing) {
      const before = getWordAttribute(spacing, "before");

      const after = getWordAttribute(spacing, "after");

      const beforeLines = getWordAttribute(spacing, "beforeLines");

      const afterLines = getWordAttribute(spacing, "afterLines");

      const line = getWordAttribute(spacing, "line");

      const lineRule = getWordAttribute(spacing, "lineRule");

      if (before !== null) {
        result.spaceBefore = twipsToPt(before);
      }

      if (after !== null) {
        result.spaceAfter = twipsToPt(after);
      }

      if (beforeLines && before === null) {
        const value = Number(beforeLines);

        if (Number.isFinite(value)) {
          result.spaceBefore = `${value / 100}em`;
        }
      }

      if (afterLines && after === null) {
        const value = Number(afterLines);

        if (Number.isFinite(value)) {
          result.spaceAfter = `${value / 100}em`;
        }
      }

      if (line) {
        const value = Number(line);

        if (Number.isFinite(value)) {
          if (lineRule === "exact" || lineRule === "atLeast") {
            result.lineHeight = `${value / 20}pt`;
          } else {
            result.lineHeight = String(value / 240);
          }
        }
      }
    }

    return result;
  }

  function paragraphPropertiesToCss(properties) {
    const styles = {
      margin: "0",
      padding: "0",
      "box-sizing": "border-box",
      "white-space": "pre-wrap",
    };

    if (properties.textAlign) {
      styles["text-align"] = properties.textAlign;

      if (properties.textAlign === "justify") {
        styles["text-justify"] = "inter-word";
      }
    }

    if (properties.backgroundColor) {
      styles["background-color"] = properties.backgroundColor;
    }

    if (properties.marginLeft) {
      styles["margin-left"] = properties.marginLeft;
    }

    if (properties.marginRight) {
      styles["margin-right"] = properties.marginRight;
    }

    if (properties.textIndent) {
      styles["text-indent"] = properties.textIndent;
    }

    /*
     * paddingot használunk a Word before/after
     * térközhöz, így a CSS margin-collapse
     * nem nyeli el az értékeket.
     */
    if (properties.spaceBefore) {
      styles["padding-top"] = properties.spaceBefore;
    }

    if (properties.spaceAfter) {
      styles["padding-bottom"] = properties.spaceAfter;
    }

    if (properties.lineHeight) {
      styles["line-height"] = properties.lineHeight;
    }

    return styles;
  }

  // =========================================================
  // STYLE SYSTEM
  // =========================================================

  async function readStyleSystem(zip, themeFonts) {
    const file = zip.file("word/styles.xml");

    const system = {
      styles: new Map(),

      defaults: {
        paragraph: {},
        run: {},
      },
    };

    if (!file) {
      return system;
    }

    const xml = parseXml(await file.async("text"));

    const docDefaults = descendants(xml, "docDefaults")[0];

    if (docDefaults) {
      const pPrDefault = descendants(docDefaults, "pPrDefault")[0];

      const rPrDefault = descendants(docDefaults, "rPrDefault")[0];

      const pPr = pPrDefault ? firstDescendant(pPrDefault, "pPr") : null;

      const rPr = rPrDefault ? firstDescendant(rPrDefault, "rPr") : null;

      system.defaults.paragraph = parseParagraphProperties(pPr);

      system.defaults.run = parseRunProperties(rPr, themeFonts);
    }

    for (const style of descendants(xml, "style")) {
      const styleId = getWordAttribute(style, "styleId");

      if (!styleId) {
        continue;
      }

      const type = getWordAttribute(style, "type") || "";

      const nameElement = firstDirectChild(style, "name");

      const basedOnElement = firstDirectChild(style, "basedOn");

      const pPr = firstDirectChild(style, "pPr");

      const rPr = firstDirectChild(style, "rPr");

      system.styles.set(styleId, {
        id: styleId,

        type,

        name: getWordAttribute(nameElement, "val") || styleId,

        basedOn: getWordAttribute(basedOnElement, "val") || null,

        paragraph: parseParagraphProperties(pPr),

        run: parseRunProperties(rPr, themeFonts),
      });
    }

    return system;
  }

  function resolveStyle(styleSystem, styleId, visited = new Set()) {
    if (!styleId || visited.has(styleId)) {
      return {
        paragraph: {},
        run: {},
      };
    }

    visited.add(styleId);

    const style = styleSystem.styles.get(styleId);

    if (!style) {
      return {
        paragraph: {},
        run: {},
      };
    }

    let parent = {
      paragraph: {},
      run: {},
    };

    if (style.basedOn) {
      parent = resolveStyle(styleSystem, style.basedOn, visited);
    }

    return {
      paragraph: mergeObjects(parent.paragraph, style.paragraph),

      run: mergeObjects(parent.run, style.run),
    };
  }

  function getParagraphStyleId(paragraph) {
    const pPr = firstDirectChild(paragraph, "pPr");

    const pStyle = pPr ? firstDirectChild(pPr, "pStyle") : null;

    return getWordAttribute(pStyle, "val") || "";
  }

  function getRunStyleId(run) {
    const rPr = firstDirectChild(run, "rPr");

    const rStyle = rPr ? firstDirectChild(rPr, "rStyle") : null;

    return getWordAttribute(rStyle, "val") || "";
  }

  // =========================================================
  // RELATIONSHIPS
  // =========================================================

  async function readRelationships(zip) {
    const file = zip.file("word/_rels/document.xml.rels");

    const relationships = new Map();

    if (!file) {
      return relationships;
    }

    const xml = parseXml(await file.async("text"));

    for (const relationship of xml.getElementsByTagName("*")) {
      if (localName(relationship) !== "Relationship") {
        continue;
      }

      const id = relationship.getAttribute("Id");

      const target = relationship.getAttribute("Target");

      const targetMode = relationship.getAttribute("TargetMode");

      const type = relationship.getAttribute("Type");

      if (id) {
        relationships.set(id, {
          target,
          targetMode,
          type,
        });
      }
    }

    return relationships;
  }

  // =========================================================
  // RUN RENDERING
  // =========================================================

  function getEffectiveRunProperties(run, context) {
    const directRPr = firstDirectChild(run, "rPr");

    const runStyleId = getRunStyleId(run);

    const runStyle = resolveStyle(context.styleSystem, runStyleId);

    const directRun = parseRunProperties(directRPr, context.themeFonts);

    return mergeObjects(
      context.styleSystem.defaults.run,
      context.paragraphStyle.run,
      runStyle.run,
      directRun,
    );
  }

  function runToHtml(run, context) {
    let content = "";

    for (const child of run.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "t" || name === "delText") {
        content += escapeHtml(child.textContent || "");
      }

      if (name === "tab") {
        content += '<span style="display:inline-block;width:4em"></span>';
      }

      if (name === "br" || name === "cr") {
        content += "<br>";
      }

      if (name === "noBreakHyphen") {
        content += "&#8209;";
      }

      if (name === "softHyphen") {
        content += "&shy;";
      }
    }

    if (!content) {
      return "";
    }

    const properties = getEffectiveRunProperties(run, context);

    const styles = runPropertiesToCss(properties);

    const css = cssString(styles);

    if (!css) {
      return content;
    }

    return `<span style="${escapeAttribute(css)}">` + content + "</span>";
  }

  // =========================================================
  // LINKS + INLINE CONTENT
  // =========================================================

  function inlineChildrenToHtml(parent, context) {
    let html = "";

    for (const child of parent.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "r") {
        html += runToHtml(child, context);

        continue;
      }

      if (name === "hyperlink") {
        const relationshipId = getWordAttribute(child, "id");

        const anchor = getWordAttribute(child, "anchor");

        let href = null;

        if (relationshipId && context.relationships.has(relationshipId)) {
          href = context.relationships.get(relationshipId)?.target;
        }

        if (!href && anchor) {
          href = `#${anchor}`;
        }

        const content = inlineChildrenToHtml(child, context);

        if (href) {
          html += `<a href="${escapeAttribute(href)}">` + content + "</a>";
        } else {
          html += content;
        }

        continue;
      }

      if (name === "fldSimple") {
        const instruction = getWordAttribute(child, "instr") || "";

        const match = instruction.match(/HYPERLINK\s+"([^"]+)"/i);

        const content = inlineChildrenToHtml(child, context);

        if (match) {
          html += `<a href="${escapeAttribute(match[1])}">` + content + "</a>";
        } else {
          html += content;
        }

        continue;
      }

      if (
        name === "smartTag" ||
        name === "sdt" ||
        name === "sdtContent" ||
        name === "ins" ||
        name === "moveTo"
      ) {
        html += inlineChildrenToHtml(child, context);
      }
    }

    return html;
  }

  // =========================================================
  // PARAGRAPH
  // =========================================================

  function paragraphToHtml(paragraph, baseContext) {
    const paragraphStyleId = getParagraphStyleId(paragraph);

    const paragraphStyle = resolveStyle(
      baseContext.styleSystem,
      paragraphStyleId,
    );

    const directPPr = firstDirectChild(paragraph, "pPr");

    const directParagraph = parseParagraphProperties(directPPr);

    const paragraphProperties = mergeObjects(
      baseContext.styleSystem.defaults.paragraph,

      paragraphStyle.paragraph,

      directParagraph,
    );

    const baseRunProperties = mergeObjects(
      baseContext.styleSystem.defaults.run,

      paragraphStyle.run,
    );

    const context = {
      ...baseContext,
      paragraphStyle,
    };

    const content = inlineChildrenToHtml(paragraph, context);

    const paragraphCss = paragraphPropertiesToCss(paragraphProperties);

    /*
     * A paragraph saját betűbeállításait is
     * ráadjuk, mert üres sor esetén nincs run,
     * amiből a böngésző tudná a méretet.
     */
    Object.assign(paragraphCss, runPropertiesToCss(baseRunProperties));

    /*
     * Ha nincs Wordből fontméret,
     * adjunk egy ésszerű Word fallbacket.
     */
    if (!paragraphCss["font-size"]) {
      paragraphCss["font-size"] = "11pt";
    }

    if (!paragraphCss["line-height"]) {
      paragraphCss["line-height"] = "1.08";
    }

    const css = cssString(paragraphCss);

    const plainContent = content
      .replace(/<br\s*\/?>/gi, "")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, "")
      .replace(/&emsp;/gi, "")
      .trim();

    const isEmpty = plainContent === "";

    /*
     * Az üres Word bekezdéseket NEM dobjuk el.
     */
    if (isEmpty) {
      return `<p style="${escapeAttribute(css)}">` + "<br>" + "</p>";
    }

    return `<p style="${escapeAttribute(css)}">` + content + "</p>";
  }

  // =========================================================
  // TABLE HELPERS
  // =========================================================

  function getBorderCss(border) {
    if (!border) {
      return null;
    }

    const value = getWordAttribute(border, "val");

    if (!value || value === "nil" || value === "none") {
      return "none";
    }

    const size = Number(getWordAttribute(border, "sz") || 4);

    const color =
      normalizeHexColor(getWordAttribute(border, "color")) || "#000000";

    const width = Number.isFinite(size) ? `${size / 8}pt` : "0.5pt";

    let style = "solid";

    if (value.includes("dash")) {
      style = "dashed";
    }

    if (value.includes("dot")) {
      style = "dotted";
    }

    if (value === "double") {
      style = "double";
    }

    return `${width} ${style} ${color}`;
  }

  function getCellStyles(cell) {
    const tcPr = firstDirectChild(cell, "tcPr");

    const styles = {
      padding: "0",
      "vertical-align": "top",
    };

    if (!tcPr) {
      return styles;
    }

    const shading = firstDirectChild(tcPr, "shd");

    if (shading) {
      const color = normalizeHexColor(getWordAttribute(shading, "fill"));

      if (color) {
        styles["background-color"] = color;
      }
    }

    const verticalAlign = firstDirectChild(tcPr, "vAlign");

    if (verticalAlign) {
      const value = getWordAttribute(verticalAlign, "val");

      const map = {
        top: "top",
        center: "middle",
        bottom: "bottom",
      };

      if (map[value]) {
        styles["vertical-align"] = map[value];
      }
    }

    const width = firstDirectChild(tcPr, "tcW");

    if (width) {
      const value = getWordAttribute(width, "w");

      const type = getWordAttribute(width, "type");

      if (value && type === "dxa") {
        styles.width = twipsToPt(value);
      }

      if (value && type === "pct") {
        styles.width = percent50ToPercent(value);
      }
    }

    const margins = firstDirectChild(tcPr, "tcMar");

    if (margins) {
      const map = {
        top: "padding-top",
        bottom: "padding-bottom",
        left: "padding-left",
        right: "padding-right",
        start: "padding-left",
        end: "padding-right",
      };

      for (const [wordSide, cssSide] of Object.entries(map)) {
        const element = firstDirectChild(margins, wordSide);

        if (!element) {
          continue;
        }

        const value = getWordAttribute(element, "w");

        if (value) {
          styles[cssSide] = twipsToPt(value);
        }
      }
    }

    const borders = firstDirectChild(tcPr, "tcBorders");

    if (borders) {
      const map = {
        top: "border-top",
        bottom: "border-bottom",
        left: "border-left",
        right: "border-right",
        start: "border-left",
        end: "border-right",
      };

      for (const [wordSide, cssSide] of Object.entries(map)) {
        const border = firstDirectChild(borders, wordSide);

        const css = getBorderCss(border);

        if (css) {
          styles[cssSide] = css;
        }
      }
    }

    return styles;
  }

  function getCellColspan(cell) {
    const tcPr = firstDirectChild(cell, "tcPr");

    const gridSpan = tcPr ? firstDirectChild(tcPr, "gridSpan") : null;

    const value = getWordAttribute(gridSpan, "val");

    const number = Number(value);

    if (Number.isFinite(number) && number > 1) {
      return number;
    }

    return 1;
  }

  function tableCellToHtml(cell, context) {
    const content = [];

    for (const child of cell.children) {
      const name = localName(child);

      if (name === "p") {
        content.push(paragraphToHtml(child, context));
      }

      if (name === "tbl") {
        content.push(tableToHtml(child, context));
      }
    }

    const styles = getCellStyles(cell);

    const colspan = getCellColspan(cell);

    const colspanAttribute = colspan > 1 ? ` colspan="${colspan}"` : "";

    return (
      `<td${colspanAttribute} style="${escapeAttribute(cssString(styles))}">` +
      content.join("") +
      "</td>"
    );
  }

  function getTableStyles(table) {
    const tblPr = firstDirectChild(table, "tblPr");

    const styles = {
      "border-collapse": "collapse",
      "border-spacing": "0",
    };

    if (!tblPr) {
      return styles;
    }

    const width = firstDirectChild(tblPr, "tblW");

    if (width) {
      const value = getWordAttribute(width, "w");

      const type = getWordAttribute(width, "type");

      if (value && type === "dxa") {
        styles.width = twipsToPt(value);
      }

      if (value && type === "pct") {
        styles.width = percent50ToPercent(value);
      }
    }

    const alignment = firstDirectChild(tblPr, "jc");

    if (alignment) {
      const value = getWordAttribute(alignment, "val");

      if (value === "center") {
        styles["margin-left"] = "auto";

        styles["margin-right"] = "auto";
      }

      if (value === "right") {
        styles["margin-left"] = "auto";

        styles["margin-right"] = "0";
      }

      if (value === "left") {
        styles["margin-left"] = "0";

        styles["margin-right"] = "auto";
      }
    }

    const indent = firstDirectChild(tblPr, "tblInd");

    if (indent) {
      const value = getWordAttribute(indent, "w");

      if (value) {
        styles["margin-left"] = twipsToPt(value);
      }
    }

    return styles;
  }

  function tableToHtml(table, context) {
    const rows = [];

    for (const row of directChildren(table, "tr")) {
      const cells = directChildren(row, "tc").map((cell) =>
        tableCellToHtml(cell, context),
      );

      rows.push(`<tr>${cells.join("")}</tr>`);
    }

    const styles = getTableStyles(table);

    return (
      `<table cellpadding="0" cellspacing="0" border="0" style="${escapeAttribute(cssString(styles))}">` +
      rows.join("") +
      "</table>"
    );
  }

  // =========================================================
  // DOCUMENT CONVERSION
  // =========================================================

  async function convertDocxToHtml(file) {
    const JSZip = await ensureJSZip();

    const zip = await JSZip.loadAsync(file);

    const documentFile = zip.file("word/document.xml");

    if (!documentFile) {
      throw new Error("Ez nem érvényes DOCX fájl.");
    }

    const themeFonts = await readThemeFonts(zip);

    const [documentXmlText, styleSystem, relationships] = await Promise.all([
      documentFile.async("text"),

      readStyleSystem(zip, themeFonts),

      readRelationships(zip),
    ]);

    const xml = parseXml(documentXmlText);

    const body = descendants(xml, "body")[0];

    if (!body) {
      throw new Error("Nem található a dokumentum tartalma.");
    }

    const context = {
      zip,
      themeFonts,
      styleSystem,
      relationships,

      paragraphStyle: {
        paragraph: {},
        run: {},
      },
    };

    const output = [];

    for (const child of body.children) {
      const name = localName(child);

      if (name === "p") {
        output.push(paragraphToHtml(child, context));
      }

      if (name === "tbl") {
        output.push(tableToHtml(child, context));
      }
    }

    return output.join("\n");
  }

  // =========================================================
  // UI
  // =========================================================

  function createPanel() {
    if (document.getElementById(APP_ID)) {
      document.getElementById(APP_ID).remove();
    }

    const panel = document.createElement("div");

    panel.id = APP_ID;

    Object.assign(panel.style, {
      position: "fixed",
      top: "20px",
      right: "20px",

      width: "720px",
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
                    style="
                        font-size:17px;
                    "
                >
                    DOCX → Drupal HTML
                </strong>

                <button
                    type="button"
                    data-action="close"
                    style="
                        border:0;
                        background:transparent;
                        cursor:pointer;
                        font-size:24px;
                        line-height:1;
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
                Word dokumentum
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
                    min-height:22px;
                    margin-bottom:10px;
                    color:#555;
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
                <strong>
                    Drupal HTML
                </strong>

                <button
                    type="button"
                    data-action="copy"
                    style="
                        border:1px solid #999;
                        background:#f5f5f5;
                        border-radius:6px;
                        padding:7px 12px;
                        cursor:pointer;
                    "
                >
                    Másolás
                </button>
            </div>

            <textarea
                data-role="output"
                spellcheck="false"
                style="
                    width:100%;
                    height:500px;
                    resize:vertical;
                    box-sizing:border-box;
                    border:1px solid #aaa;
                    border-radius:6px;
                    padding:10px;
                    font-family:Consolas,Monaco,monospace;
                    font-size:12px;
                    line-height:1.4;
                    white-space:pre;
                "
            ></textarea>
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
        output.value = "";

        status.textContent = "Kérlek DOCX fájlt válassz.";

        return;
      }

      status.textContent = "Feldolgozás...";

      output.value = "";

      try {
        const html = await convertDocxToHtml(file);

        output.value = html;

        status.textContent = `Kész: ${file.name}`;
      } catch (error) {
        console.error("[DOCX → Drupal]", error);

        status.textContent = `Hiba: ${error?.message || error}`;
      }
    });
  }

  // =========================================================
  // START
  // =========================================================

  try {
    createPanel();
  } catch (error) {
    console.error("[DOCX → Drupal]", error);

    alert(
      "A DOCX converter nem tudott elindulni:\n\n" + (error?.message || error),
    );
  }
})();
