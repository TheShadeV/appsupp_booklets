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

    const error = doc.querySelector("parsererror");

    if (error) {
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

  function ptValueToTwips(value) {
    if (!value) {
      return 0;
    }

    const match = String(value)
      .trim()
      .match(/^(-?[\d.]+)pt$/i);

    if (!match) {
      return 0;
    }

    const points = Number(match[1]);

    if (!Number.isFinite(points)) {
      return 0;
    }

    return points * 20;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  // =========================================================
  // WORD PAGE / TEXT BODY DIMENSIONS
  // =========================================================

  function readPageMetrics(documentXml) {
    const body = descendants(documentXml, "body")[0];

    /*
     * A body közvetlen sectPr-je az alap /
     * utolsó section page setupja.
     */
    let sectPr = body ? firstDirectChild(body, "sectPr") : null;

    if (!sectPr && body) {
      const sections = descendants(body, "sectPr");

      sectPr = sections[sections.length - 1] || null;
    }

    /*
     * Word fallback:
     * Letter méret + 1" margó.
     *
     * Normál DOCX-nél ezek ténylegesen benne
     * lesznek a sectPr-ben.
     */
    let pageWidthTwips = 12240;

    let pageHeightTwips = 15840;

    let marginLeftTwips = 1440;

    let marginRightTwips = 1440;

    let marginTopTwips = 1440;

    let marginBottomTwips = 1440;

    if (sectPr) {
      const pgSz = firstDirectChild(sectPr, "pgSz");

      const pgMar = firstDirectChild(sectPr, "pgMar");

      if (pgSz) {
        const width = Number(getWordAttribute(pgSz, "w"));

        const height = Number(getWordAttribute(pgSz, "h"));

        if (Number.isFinite(width) && width > 0) {
          pageWidthTwips = width;
        }

        if (Number.isFinite(height) && height > 0) {
          pageHeightTwips = height;
        }
      }

      if (pgMar) {
        const left = Number(getWordAttribute(pgMar, "left"));

        const right = Number(getWordAttribute(pgMar, "right"));

        const top = Number(getWordAttribute(pgMar, "top"));

        const bottom = Number(getWordAttribute(pgMar, "bottom"));

        if (Number.isFinite(left)) {
          marginLeftTwips = left;
        }

        if (Number.isFinite(right)) {
          marginRightTwips = right;
        }

        if (Number.isFinite(top)) {
          marginTopTwips = top;
        }

        if (Number.isFinite(bottom)) {
          marginBottomTwips = bottom;
        }
      }
    }

    const textWidthTwips = Math.max(
      1,
      pageWidthTwips - marginLeftTwips - marginRightTwips,
    );

    return {
      pageWidthTwips,
      pageHeightTwips,

      marginLeftTwips,
      marginRightTwips,
      marginTopTwips,
      marginBottomTwips,

      textWidthTwips,
    };
  }

  function getEffectiveTextWidthTwips(context) {
    let width = context.pageMetrics?.textWidthTwips || 9360;

    const paragraph = context.currentParagraphProperties || {};

    const left = ptValueToTwips(paragraph.marginLeft);

    const right = ptValueToTwips(paragraph.marginRight);

    /*
     * Ha a bekezdés be van húzva, a kép
     * a tényleges rendelkezésre álló
     * bekezdésszélességhez igazodjon.
     */
    width -= Math.max(0, left) + Math.max(0, right);

    return Math.max(width, 1);
  }

  // =========================================================
  // COLORS
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
  // MIME
  // =========================================================

  function getMimeType(filename) {
    const extension = filename.split(".").pop()?.toLowerCase();

    const map = {
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      webp: "image/webp",
      bmp: "image/bmp",
      svg: "image/svg+xml",
      tif: "image/tiff",
      tiff: "image/tiff",
    };

    return map[extension] || "application/octet-stream";
  }

  // =========================================================
  // THEME
  // =========================================================

  async function readThemeFonts(zip) {
    const result = {
      major: null,
      minor: null,
    };

    const file = zip.file("word/theme/theme1.xml");

    if (!file) {
      return result;
    }

    try {
      const xml = parseXml(await file.async("text"));

      const majorFont = descendants(xml, "majorFont")[0];

      const minorFont = descendants(xml, "minorFont")[0];

      const majorLatin = majorFont ? descendants(majorFont, "latin")[0] : null;

      const minorLatin = minorFont ? descendants(minorFont, "latin")[0] : null;

      result.major = majorLatin?.getAttribute("typeface") || null;

      result.minor = minorLatin?.getAttribute("typeface") || null;
    } catch {
      // Nem kritikus.
    }

    return result;
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

      if (!properties.fontSize) {
        styles["font-size"] = "0.75em";
      }
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

    const numPr = firstDirectChild(pPr, "numPr");

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

    if (numPr) {
      const numIdElement = firstDirectChild(numPr, "numId");

      const levelElement = firstDirectChild(numPr, "ilvl");

      const numId = getWordAttribute(numIdElement, "val");

      const level = getWordAttribute(levelElement, "val");

      if (numId !== null && numId !== "0") {
        result.numId = String(numId);

        result.listLevel = Number(level || 0);
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

      const nameElement = firstDirectChild(style, "name");

      const basedOnElement = firstDirectChild(style, "basedOn");

      const pPr = firstDirectChild(style, "pPr");

      const rPr = firstDirectChild(style, "rPr");

      system.styles.set(styleId, {
        id: styleId,

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
  // NUMBERING / LISTS
  // =========================================================

  async function readNumberingSystem(zip, themeFonts) {
    const result = {
      abstractNumbers: new Map(),

      numbers: new Map(),
    };

    const file = zip.file("word/numbering.xml");

    if (!file) {
      return result;
    }

    const xml = parseXml(await file.async("text"));

    for (const abstractNum of descendants(xml, "abstractNum")) {
      const abstractNumId = getWordAttribute(abstractNum, "abstractNumId");

      if (abstractNumId === null) {
        continue;
      }

      const levels = new Map();

      for (const level of directChildren(abstractNum, "lvl")) {
        const ilvl = Number(getWordAttribute(level, "ilvl") || 0);

        const start = Number(
          getWordAttribute(firstDirectChild(level, "start"), "val") || 1,
        );

        const numFmt =
          getWordAttribute(firstDirectChild(level, "numFmt"), "val") ||
          "bullet";

        const lvlText =
          getWordAttribute(firstDirectChild(level, "lvlText"), "val") || "";

        const pPr = firstDirectChild(level, "pPr");

        const rPr = firstDirectChild(level, "rPr");

        levels.set(ilvl, {
          level: ilvl,

          start,

          numFmt,

          lvlText,

          paragraph: parseParagraphProperties(pPr),

          run: parseRunProperties(rPr, themeFonts),
        });
      }

      result.abstractNumbers.set(String(abstractNumId), {
        id: String(abstractNumId),

        levels,
      });
    }

    for (const num of descendants(xml, "num")) {
      const numId = getWordAttribute(num, "numId");

      if (numId === null) {
        continue;
      }

      const abstractNumId = getWordAttribute(
        firstDirectChild(num, "abstractNumId"),
        "val",
      );

      const overrides = new Map();

      for (const override of directChildren(num, "lvlOverride")) {
        const level = Number(getWordAttribute(override, "ilvl") || 0);

        const startOverride = getWordAttribute(
          firstDirectChild(override, "startOverride"),
          "val",
        );

        if (startOverride !== null) {
          overrides.set(level, {
            start: Number(startOverride),
          });
        }
      }

      result.numbers.set(String(numId), {
        id: String(numId),

        abstractNumId: String(abstractNumId),

        overrides,
      });
    }

    return result;
  }

  function getNumberingLevel(numberingSystem, numId, level) {
    if (!numId || !numberingSystem) {
      return null;
    }

    const number = numberingSystem.numbers.get(String(numId));

    if (!number) {
      return null;
    }

    const abstract = numberingSystem.abstractNumbers.get(number.abstractNumId);

    if (!abstract) {
      return null;
    }

    const base =
      abstract.levels.get(Number(level || 0)) || abstract.levels.get(0);

    if (!base) {
      return null;
    }

    const override = number.overrides.get(Number(level || 0));

    return {
      ...base,

      start: override?.start ?? base.start,
    };
  }

  function listStyleFromNumbering(listInfo) {
    const format = listInfo?.numFmt || "bullet";

    const text = listInfo?.lvlText || "";

    if (format === "bullet") {
      if (text.includes("○") || text.includes("◦")) {
        return {
          tag: "ul",

          type: "circle",
        };
      }

      if (text.includes("■") || text.includes("▪") || text.includes("◼")) {
        return {
          tag: "ul",

          type: "square",
        };
      }

      return {
        tag: "ul",

        type: "disc",
      };
    }

    const map = {
      decimal: "decimal",

      decimalZero: "decimal-leading-zero",

      lowerLetter: "lower-alpha",

      upperLetter: "upper-alpha",

      lowerRoman: "lower-roman",

      upperRoman: "upper-roman",
    };

    return {
      tag: "ol",

      type: map[format] || "decimal",
    };
  }

  function openListTag(listInfo) {
    const listStyle = listStyleFromNumbering(listInfo);

    const styles = {
      margin: "0",
      "padding-top": "0",
      "padding-bottom": "0",
      "padding-left": "1.4em",
      "list-style-type": listStyle.type,
    };

    const startAttribute =
      listStyle.tag === "ol" && listInfo?.start && listInfo.start !== 1
        ? ` start="${listInfo.start}"`
        : "";

    return `<${listStyle.tag}${startAttribute} style="${escapeAttribute(cssString(styles))}">`;
  }

  function closeListTag(listInfo) {
    const listStyle = listStyleFromNumbering(listInfo);

    return `</${listStyle.tag}>`;
  }

  function renderListItems(items) {
    if (!items.length) {
      return "";
    }

    let html = "";
    let previousLevel = -1;

    const stack = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      let level = Math.max(0, Number(item.listLevel || 0));

      if (previousLevel < 0) {
        html += openListTag(item.listInfo);

        stack.push(item.listInfo);

        html += `<li style="${escapeAttribute(cssString(item.listCss))}">`;

        html += item.content || "<br>";

        previousLevel = level;

        continue;
      }

      if (level > previousLevel) {
        while (previousLevel < level) {
          html += openListTag(item.listInfo);

          stack.push(item.listInfo);

          previousLevel++;
        }

        html += `<li style="${escapeAttribute(cssString(item.listCss))}">`;

        html += item.content || "<br>";

        continue;
      }

      if (level === previousLevel) {
        html += "</li>";

        html += `<li style="${escapeAttribute(cssString(item.listCss))}">`;

        html += item.content || "<br>";

        continue;
      }

      html += "</li>";

      while (previousLevel > level) {
        const current = stack.pop();

        html += closeListTag(current);

        html += "</li>";

        previousLevel--;
      }

      html += `<li style="${escapeAttribute(cssString(item.listCss))}">`;

      html += item.content || "<br>";
    }

    html += "</li>";

    while (stack.length) {
      const current = stack.pop();

      html += closeListTag(current);
    }

    return html;
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
  // DRUPAL / CKEDITOR IMAGE UPLOAD
  // =========================================================

  function getDrupalCsrfToken() {
    /*
     * Mindig az AKTUÁLIS tokent olvassuk ki.
     * Semmilyen CSRF token nincs beégetve.
     */

    if (window.yii && typeof window.yii.getCsrfToken === "function") {
      const token = window.yii.getCsrfToken();

      if (token) {
        return token;
      }
    }

    const input = document.querySelector('input[name="_csrf"]');

    if (input?.value) {
      return input.value;
    }

    const meta = document.querySelector('meta[name="csrf-token"]');

    if (meta?.content) {
      return meta.content;
    }

    throw new Error("Nem található az aktuális _csrf token.");
  }

  function getCkeditorCsrfToken() {
    /*
     * Ezt is minden upload hívásnál
     * az aktuális CKEditor példányból kérjük.
     */

    if (
      window.CKEDITOR &&
      window.CKEDITOR.tools &&
      typeof window.CKEDITOR.tools.getCsrfToken === "function"
    ) {
      const token = window.CKEDITOR.tools.getCsrfToken();

      if (token) {
        return token;
      }
    }

    const input = document.querySelector('input[name="ckCsrfToken"]');

    if (input?.value) {
      return input.value;
    }

    throw new Error("Nem sikerült lekérni az aktuális CKEditor CSRF tokent.");
  }

  function getCkeditorInstanceName() {
    if (window.CKEDITOR?.instances?.["newsletters-message"]) {
      return "newsletters-message";
    }

    const names = Object.keys(window.CKEDITOR?.instances || {});

    return names[0] || "newsletters-message";
  }

  function findUploadUrl() {
    const instanceName = getCkeditorInstanceName();

    const instance = window.CKEDITOR?.instances?.[instanceName];

    const candidates = [
      instance?.config?.filebrowserImageUploadUrl,

      instance?.config?.filebrowserUploadUrl,

      window.CKEDITOR?.config?.filebrowserImageUploadUrl,

      window.CKEDITOR?.config?.filebrowserUploadUrl,
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (String(candidate).includes("upload.php")) {
        return new URL(candidate, location.origin).href;
      }
    }

    for (const element of document.querySelectorAll("[src],[href],[action]")) {
      const value =
        element.getAttribute("src") ||
        element.getAttribute("href") ||
        element.getAttribute("action");

      if (value && value.includes("upload.php") && value.includes("ckeditor")) {
        return new URL(value, location.origin).href;
      }
    }

    /*
     * Végső fallback a jelenlegi rendszerhez.
     */
    return new URL("/assets/27d12b5/upload.php", location.origin).href;
  }

  function buildUploadUrl() {
    const instanceName = getCkeditorInstanceName();

    const url = new URL(findUploadUrl());

    if (!url.searchParams.has("opener")) {
      url.searchParams.set("opener", "ckeditor");
    }

    if (!url.searchParams.has("type")) {
      url.searchParams.set("type", "files");
    }

    if (!url.searchParams.has("CKEditor")) {
      url.searchParams.set("CKEditor", instanceName);
    }

    if (!url.searchParams.has("CKEditorFuncNum")) {
      url.searchParams.set("CKEditorFuncNum", "1");
    }

    if (!url.searchParams.has("langCode")) {
      url.searchParams.set("langCode", "hu");
    }

    return url.href;
  }

  function decodeHtmlEntities(value) {
    const textarea = document.createElement("textarea");

    textarea.innerHTML = value;

    return textarea.value;
  }

  function parseUploadResponse(responseText) {
    try {
      const json = JSON.parse(responseText);

      if (json.url) {
        return json.url;
      }

      if (json.file?.url) {
        return json.file.url;
      }

      if (json.uploadedUrl) {
        return json.uploadedUrl;
      }
    } catch {
      // Nem JSON.
    }

    /*
     * CKEditor 4:
     *
     * window.parent.CKEDITOR.tools.callFunction(
     *     1,
     *     "/image.jpg",
     *     ""
     * );
     */

    const match = responseText.match(
      /callFunction\s*\(\s*\d+\s*,\s*(['"])(.*?)\1/s,
    );

    if (match?.[2]) {
      let url = match[2];

      url = url.replace(/\\\//g, "/").replace(/\\"/g, '"').replace(/\\'/g, "'");

      return decodeHtmlEntities(url);
    }

    throw new Error(
      "A kép feltöltődött, de a szerver válaszából nem sikerült kiolvasni az URL-t.",
    );
  }

  async function uploadImageToDrupal(blob, filename) {
    /*
     * FONTOS:
     * itt, közvetlenül upload előtt
     * kérjük le az aktuális tokeneket.
     */

    const csrfToken = getDrupalCsrfToken();

    const ckCsrfToken = getCkeditorCsrfToken();

    const formData = new FormData();

    formData.append("upload", blob, filename);

    formData.append("_csrf", csrfToken);

    formData.append("ckCsrfToken", ckCsrfToken);

    const response = await fetch(buildUploadUrl(), {
      method: "POST",

      credentials: "include",

      body: formData,
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Képfeltöltési hiba (${filename}): HTTP ${response.status}`,
      );
    }

    const uploadedUrl = parseUploadResponse(responseText);

    return new URL(uploadedUrl, location.origin).href;
  }

  function resolveZipPath(baseDirectory, target) {
    if (!target) {
      return null;
    }

    if (target.startsWith("/")) {
      return target.replace(/^\/+/, "");
    }

    const parts = `${baseDirectory}/${target}`.split("/");

    const output = [];

    for (const part of parts) {
      if (!part || part === ".") {
        continue;
      }

      if (part === "..") {
        output.pop();
        continue;
      }

      output.push(part);
    }

    return output.join("/");
  }

  async function uploadDocumentImages(
    zip,
    documentXml,
    relationships,
    progress,
  ) {
    const relationIds = new Set();

    for (const blip of descendants(documentXml, "blip")) {
      const id = getWordAttribute(blip, "embed");

      if (id) {
        relationIds.add(id);
      }
    }

    for (const imageData of descendants(documentXml, "imagedata")) {
      const id = getWordAttribute(imageData, "id");

      if (id) {
        relationIds.add(id);
      }
    }

    const ids = [...relationIds];

    const uploaded = new Map();

    if (!ids.length) {
      return uploaded;
    }

    for (let index = 0; index < ids.length; index++) {
      const relationId = ids[index];

      const relationship = relationships.get(relationId);

      if (!relationship?.target) {
        continue;
      }

      if (relationship.targetMode === "External") {
        uploaded.set(relationId, relationship.target);

        continue;
      }

      const zipPath = resolveZipPath("word", relationship.target);

      const imageFile = zip.file(zipPath);

      if (!imageFile) {
        console.warn("A DOCX-ben hivatkozott kép nem található:", zipPath);

        continue;
      }

      const filename = zipPath.split("/").pop() || `image-${index + 1}.png`;

      progress?.(`Kép feltöltése ${index + 1}/${ids.length}: ${filename}`);

      const arrayBuffer = await imageFile.async("arraybuffer");

      const blob = new Blob([arrayBuffer], {
        type: getMimeType(filename),
      });

      try {
        const uploadedUrl = await uploadImageToDrupal(blob, filename);

        uploaded.set(relationId, uploadedUrl);
      } catch (error) {
        throw new Error(
          `A(z) "${filename}" kép feltöltése sikertelen: ${error.message || error}`,
        );
      }
    }

    return uploaded;
  }

  // =========================================================
  // RESPONSIVE IMAGE RENDERING
  // =========================================================

  function getDrawingRelationId(drawing) {
    const blip = firstDescendant(drawing, "blip");

    if (blip) {
      const id = getWordAttribute(blip, "embed");

      if (id) {
        return id;
      }
    }

    const imageData = firstDescendant(drawing, "imagedata");

    if (imageData) {
      return getWordAttribute(imageData, "id") || null;
    }

    return null;
  }

  function getDrawingDimensions(drawing) {
    /*
     * Modern DrawingML.
     *
     * cx / cy EMU.
     *
     * 1 twip = 635 EMU
     */
    const extent = firstDescendant(drawing, "extent");

    if (extent) {
      const cx = Number(extent.getAttribute("cx"));

      const cy = Number(extent.getAttribute("cy"));

      if (Number.isFinite(cx) && cx > 0) {
        return {
          widthEmu: cx,

          heightEmu: Number.isFinite(cy) ? cy : null,

          widthPt: null,

          heightPt: null,
        };
      }
    }

    /*
     * Régi VML.
     *
     * style="width:123pt;height:50pt"
     */
    const shape = firstDescendant(drawing, "shape");

    if (shape) {
      const style = shape.getAttribute("style") || "";

      const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)pt/i);

      const heightMatch = style.match(/(?:^|;)\s*height\s*:\s*([\d.]+)pt/i);

      const widthPt = widthMatch ? Number(widthMatch[1]) : null;

      const heightPt = heightMatch ? Number(heightMatch[1]) : null;

      return {
        widthEmu: null,

        heightEmu: null,

        widthPt: Number.isFinite(widthPt) ? widthPt : null,

        heightPt: Number.isFinite(heightPt) ? heightPt : null,
      };
    }

    return {
      widthEmu: null,

      heightEmu: null,

      widthPt: null,

      heightPt: null,
    };
  }

  function calculateResponsiveImageWidth(drawing, context) {
    const dimensions = getDrawingDimensions(drawing);

    const availableWidthTwips = getEffectiveTextWidthTwips(context);

    let imageWidthTwips = null;

    if (dimensions.widthEmu) {
      /*
       * 1 twip = 635 EMU
       */
      imageWidthTwips = dimensions.widthEmu / 635;
    }

    if (!imageWidthTwips && dimensions.widthPt) {
      imageWidthTwips = dimensions.widthPt * 20;
    }

    if (!imageWidthTwips || !availableWidthTwips) {
      return {
        percent: 100,

        dimensions,
      };
    }

    let percent = (imageWidthTwips / availableWidthTwips) * 100;

    /*
     * Ha Wordben gyakorlatilag teljes
     * szövegszélességű a kép, legyen
     * valóban 100%.
     *
     * Így néhány twip eltérés miatt nem
     * 99.16%-ot kapunk.
     */
    if (percent >= 97) {
      percent = 100;
    }

    percent = clamp(percent, 1, 100);

    /*
     * 2 tizedes bőven elegendő.
     */
    percent = Math.round(percent * 100) / 100;

    return {
      percent,
      dimensions,
    };
  }

  function getDrawingAltText(drawing) {
    const docPr = firstDescendant(drawing, "docPr");

    if (!docPr) {
      return "";
    }

    return (
      docPr.getAttribute("descr") ||
      docPr.getAttribute("title") ||
      docPr.getAttribute("name") ||
      ""
    );
  }

  function drawingToHtml(drawing, context) {
    const relationId = getDrawingRelationId(drawing);

    if (!relationId) {
      return "";
    }

    const url = context.imageUrls.get(relationId);

    if (!url) {
      return "";
    }

    const { percent } = calculateResponsiveImageWidth(drawing, context);

    const alt = getDrawingAltText(drawing);

    /*
     * A Word relatív méretét százalékosan
     * visszük át.
     *
     * Példák:
     *
     * Word teljes szélesség -> 100%
     * Word fél szélesség    -> ~50%
     * Word 1/3 szélesség    -> ~33%
     *
     * Így ha a Drupal HTML-t egy 600px-es
     * newsletter parentbe másolod, automatikusan
     * annak a méretéhez fog igazodni.
     */

    const styles = {
      display: "inline-block",

      width: `${percent}%`,

      "max-width": "100%",

      height: "auto",

      border: "0",

      margin: "0",

      padding: "0",

      "vertical-align": "middle",
    };

    return (
      `<img` +
      ` src="${escapeAttribute(url)}"` +
      ` alt="${escapeAttribute(alt)}"` +
      ` style="${escapeAttribute(cssString(styles))}"` +
      `>`
    );
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

        continue;
      }

      if (name === "tab") {
        content += '<span style="display:inline-block;width:4em"></span>';

        continue;
      }

      if (name === "br" || name === "cr") {
        content += "<br>";

        continue;
      }

      if (name === "noBreakHyphen") {
        content += "&#8209;";

        continue;
      }

      if (name === "softHyphen") {
        content += "&shy;";

        continue;
      }

      if (name === "drawing" || name === "pict" || name === "object") {
        content += drawingToHtml(child, context);
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
  // LINKS / INLINE CONTENT
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

  function buildParagraphDescriptor(paragraph, baseContext) {
    const paragraphStyleId = getParagraphStyleId(paragraph);

    const paragraphStyle = resolveStyle(
      baseContext.styleSystem,
      paragraphStyleId,
    );

    const directPPr = firstDirectChild(paragraph, "pPr");

    const directParagraph = parseParagraphProperties(directPPr);

    const preliminary = mergeObjects(
      baseContext.styleSystem.defaults.paragraph,

      paragraphStyle.paragraph,

      directParagraph,
    );

    const listInfo = preliminary.numId
      ? getNumberingLevel(
          baseContext.numberingSystem,

          preliminary.numId,

          preliminary.listLevel || 0,
        )
      : null;

    const paragraphProperties = mergeObjects(
      baseContext.styleSystem.defaults.paragraph,

      paragraphStyle.paragraph,

      listInfo?.paragraph,

      directParagraph,
    );

    const baseRunProperties = mergeObjects(
      baseContext.styleSystem.defaults.run,

      paragraphStyle.run,
    );

    /*
     * A paragraph property-ket átadjuk a
     * kép renderernek is.
     *
     * Így ha a Word bekezdés például be van
     * húzva 2 cm-rel, a kép százalékos mérete
     * nem a teljes oldalhoz, hanem a tényleges
     * rendelkezésre álló törzsszélességhez
     * számolódik.
     */
    const context = {
      ...baseContext,

      paragraphStyle,

      currentParagraphProperties: paragraphProperties,
    };

    const content = inlineChildrenToHtml(paragraph, context);

    const paragraphCss = paragraphPropertiesToCss(paragraphProperties);

    Object.assign(paragraphCss, runPropertiesToCss(baseRunProperties));

    if (!paragraphCss["font-size"]) {
      paragraphCss["font-size"] = "11pt";
    }

    if (!paragraphCss["line-height"]) {
      paragraphCss["line-height"] = "1.08";
    }

    const plainContent = content
      .replace(/<br\s*\/?>/gi, "")
      .replace(/<img\b[^>]*>/gi, "IMAGE")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/gi, "")
      .replace(/&emsp;/gi, "")
      .trim();

    const isEmpty = plainContent === "";

    const css = cssString(paragraphCss);

    const html =
      `<p style="${escapeAttribute(css)}">` +
      (isEmpty ? "<br>" : content) +
      "</p>";

    const listCss = {
      ...paragraphCss,
    };

    if (listInfo) {
      delete listCss["text-indent"];

      listCss["list-style-position"] = "outside";
    }

    return {
      html,
      content,
      isEmpty,

      numId: paragraphProperties.numId || null,

      listLevel: Number(paragraphProperties.listLevel || 0),

      listInfo,

      listCss,
    };
  }

  // =========================================================
  // TABLE
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

    return styles;
  }

  // =========================================================
  // BLOCK RENDERING
  // =========================================================

  function renderElements(elements, context) {
    const output = [];

    let index = 0;

    while (index < elements.length) {
      const child = elements[index];

      const name = localName(child);

      if (name === "p") {
        const paragraph = buildParagraphDescriptor(child, context);

        if (paragraph.listInfo && paragraph.numId) {
          const listItems = [paragraph];

          let nextIndex = index + 1;

          while (nextIndex < elements.length) {
            const next = elements[nextIndex];

            if (localName(next) !== "p") {
              break;
            }

            const nextParagraph = buildParagraphDescriptor(next, context);

            if (
              !nextParagraph.listInfo ||
              nextParagraph.numId !== paragraph.numId
            ) {
              break;
            }

            listItems.push(nextParagraph);

            nextIndex++;
          }

          output.push(renderListItems(listItems));

          index = nextIndex;

          continue;
        }

        output.push(paragraph.html);

        index++;

        continue;
      }

      if (name === "tbl") {
        output.push(tableToHtml(child, context));

        index++;

        continue;
      }

      index++;
    }

    return output.join("");
  }

  function tableCellToHtml(cell, context) {
    const content = renderElements([...cell.children], context);

    const styles = getCellStyles(cell);

    const colspan = getCellColspan(cell);

    const colspanAttribute = colspan > 1 ? ` colspan="${colspan}"` : "";

    return (
      `<td${colspanAttribute} style="${escapeAttribute(cssString(styles))}">` +
      content +
      "</td>"
    );
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
  // SAFE CLEANUP
  // =========================================================

  const SAFE_INHERITED_PROPERTIES = new Set([
    "color",
    "font-family",
    "font-size",
    "font-style",
    "font-weight",
    "line-height",
  ]);

  function parseInlineStyle(styleText) {
    const result = new Map();

    if (!styleText) {
      return result;
    }

    for (const declaration of styleText.split(";")) {
      const index = declaration.indexOf(":");

      if (index < 0) {
        continue;
      }

      const property = declaration.slice(0, index).trim().toLowerCase();

      const value = declaration.slice(index + 1).trim();

      if (!property || !value) {
        continue;
      }

      result.set(property, value);
    }

    return result;
  }

  function serializeInlineStyle(styles) {
    return [...styles.entries()]
      .map(([property, value]) => `${property}:${value}`)
      .join(";");
  }

  function normalizeCssValue(value) {
    if (value === null) {
      return null;
    }

    return String(value).trim().replace(/\s+/g, " ").toLowerCase();
  }

  function getInheritedInlineValue(element, property) {
    let parent = element.parentElement;

    while (parent) {
      const style = parseInlineStyle(parent.getAttribute("style") || "");

      if (style.has(property)) {
        return style.get(property);
      }

      parent = parent.parentElement;
    }

    return null;
  }

  function normalizeStyleAttributes(root) {
    for (const element of root.querySelectorAll("[style]")) {
      const styles = parseInlineStyle(element.getAttribute("style"));

      if (styles.size === 0) {
        element.removeAttribute("style");

        continue;
      }

      element.setAttribute("style", serializeInlineStyle(styles));
    }
  }

  function removeInheritedSpanStyles(root) {
    const spans = [...root.querySelectorAll("span[style]")];

    for (const span of spans) {
      const styles = parseInlineStyle(span.getAttribute("style"));

      for (const property of [...styles.keys()]) {
        if (!SAFE_INHERITED_PROPERTIES.has(property)) {
          continue;
        }

        const inherited = getInheritedInlineValue(span, property);

        if (inherited === null) {
          continue;
        }

        if (
          normalizeCssValue(styles.get(property)) ===
          normalizeCssValue(inherited)
        ) {
          styles.delete(property);
        }
      }

      if (styles.size === 0) {
        span.removeAttribute("style");
      } else {
        span.setAttribute("style", serializeInlineStyle(styles));
      }
    }
  }

  function unwrapRedundantSpans(root) {
    let changed = true;

    while (changed) {
      changed = false;

      const spans = [...root.querySelectorAll("span")];

      for (const span of spans) {
        /*
         * A tabot adó üres span nem
         * redundant, mert layoutot tart.
         */
        if (span.hasAttribute("style")) {
          continue;
        }

        if (span.attributes.length !== 0) {
          continue;
        }

        span.replaceWith(...span.childNodes);

        changed = true;
      }
    }
  }

  function sameAttributes(first, second) {
    if (first.attributes.length !== second.attributes.length) {
      return false;
    }

    for (const attribute of first.attributes) {
      if (second.getAttribute(attribute.name) !== attribute.value) {
        return false;
      }
    }

    return true;
  }

  function mergeAdjacentSpans(root) {
    let changed = true;

    while (changed) {
      changed = false;

      const spans = [...root.querySelectorAll("span")];

      for (const span of spans) {
        const next = span.nextSibling;

        if (
          !next ||
          next.nodeType !== Node.ELEMENT_NODE ||
          next.tagName !== "SPAN"
        ) {
          continue;
        }

        if (!sameAttributes(span, next)) {
          continue;
        }

        while (next.firstChild) {
          span.appendChild(next.firstChild);
        }

        next.remove();

        changed = true;
      }
    }
  }

  function cleanupHtml(html) {
    const template = document.createElement("template");

    template.innerHTML = html;

    const root = template.content;

    normalizeStyleAttributes(root);

    removeInheritedSpanStyles(root);

    unwrapRedundantSpans(root);

    mergeAdjacentSpans(root);

    normalizeStyleAttributes(root);

    return template.innerHTML.trim();
  }

  // =========================================================
  // DOCUMENT CONVERSION
  // =========================================================

  async function convertDocxToHtml(file, progress) {
    progress?.("DOCX megnyitása...");

    const JSZip = await ensureJSZip();

    const zip = await JSZip.loadAsync(file);

    const documentFile = zip.file("word/document.xml");

    if (!documentFile) {
      throw new Error("Ez nem érvényes DOCX fájl.");
    }

    const documentXmlText = await documentFile.async("text");

    const documentXml = parseXml(documentXmlText);

    /*
     * Itt számoljuk ki a Word valódi
     * szövegtörzs-szélességét.
     *
     * Ez lesz a százalékos képméretezés
     * referenciaértéke.
     */
    const pageMetrics = readPageMetrics(documentXml);

    progress?.("Word stílusok feldolgozása...");

    const themeFonts = await readThemeFonts(zip);

    const [styleSystem, numberingSystem, relationships] = await Promise.all([
      readStyleSystem(zip, themeFonts),

      readNumberingSystem(zip, themeFonts),

      readRelationships(zip),
    ]);

    progress?.("Képek keresése...");

    const imageUrls = await uploadDocumentImages(
      zip,
      documentXml,
      relationships,
      progress,
    );

    progress?.("HTML generálása...");

    const body = descendants(documentXml, "body")[0];

    if (!body) {
      throw new Error("Nem található a dokumentum tartalma.");
    }

    const context = {
      zip,

      themeFonts,

      styleSystem,

      numberingSystem,

      relationships,

      imageUrls,

      pageMetrics,

      currentParagraphProperties: {},

      paragraphStyle: {
        paragraph: {},
        run: {},
      },
    };

    const rawHtml = renderElements([...body.children], context);

    progress?.("HTML tisztítása...");

    return cleanupHtml(rawHtml);
  }

  // =========================================================
  // UI
  // =========================================================

  function createPanel() {
    const existing = document.getElementById(APP_ID);

    if (existing) {
      existing.remove();
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

      output.value = "";

      try {
        const html = await convertDocxToHtml(
          file,

          (message) => {
            status.textContent = message;
          },
        );

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
