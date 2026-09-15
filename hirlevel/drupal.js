(async () => {
  const APP_ID = "docx-drupal-converter-panel";
  const JSZIP_URL =
    "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";

  const FLOAT_ROW_MIN_TOLERANCE_EMU = 127000;
  const FLOAT_ROW_MAX_TOLERANCE_EMU = 381000;

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

      script.onerror = () =>
        reject(new Error(`Nem sikerült betölteni: ${src}`));

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

    if (["auto", "none"].includes(value.toLowerCase())) {
      return null;
    }

    if (/^[0-9a-f]{6}$/i.test(value) || /^[0-9a-f]{3}$/i.test(value)) {
      return `#${value}`;
    }

    return null;
  }

  function twipsToPt(value) {
    const number = Number(value);

    return Number.isFinite(number) ? `${number / 20}pt` : null;
  }

  function halfPointsToPt(value) {
    const number = Number(value);

    return Number.isFinite(number) ? `${number / 2}pt` : null;
  }

  function percent50ToPercent(value) {
    const number = Number(value);

    return Number.isFinite(number) ? `${number / 50}%` : null;
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

    return Number.isFinite(points) ? points * 20 : 0;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, decimals = 2) {
    const multiplier = 10 ** decimals;

    return Math.round(value * multiplier) / multiplier;
  }

  function emuToPt(emu) {
    const value = Number(emu);

    return Number.isFinite(value) ? value / 12700 : 0;
  }

  function emuToTwips(emu) {
    const value = Number(emu);

    return Number.isFinite(value) ? value / 635 : 0;
  }

  function twipsToEmu(twips) {
    const value = Number(twips);

    return Number.isFinite(value) ? value * 635 : 0;
  }

  function hasAncestorLocalName(node, name, stopNode = null) {
    let parent = node?.parentNode;

    while (parent && parent !== stopNode) {
      if (localName(parent) === name) {
        return true;
      }

      parent = parent.parentNode;
    }

    return false;
  }

  function getTopLevelDescendants(element, name, excludedAncestorName) {
    return descendants(element, name).filter(
      (node) => !hasAncestorLocalName(node, excludedAncestorName, element),
    );
  }

  // =========================================================
  // PAGE METRICS
  // =========================================================

  function readPageMetrics(documentXml) {
    const body = descendants(documentXml, "body")[0];

    let sectPr = body ? firstDirectChild(body, "sectPr") : null;

    if (!sectPr && body) {
      const sections = descendants(body, "sectPr");

      sectPr = sections[sections.length - 1] || null;
    }

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

    return {
      pageWidthTwips,
      pageHeightTwips,

      marginLeftTwips,
      marginRightTwips,
      marginTopTwips,
      marginBottomTwips,

      textWidthTwips: Math.max(
        1,
        pageWidthTwips - marginLeftTwips - marginRightTwips,
      ),
    };
  }

  function getEffectiveContainerWidthTwips(context) {
    let width =
      context.currentContainerWidthTwips ||
      context.pageMetrics?.textWidthTwips ||
      9360;

    const paragraph = context.currentParagraphProperties || {};

    width -= Math.max(0, ptValueToTwips(paragraph.marginLeft));

    width -= Math.max(0, ptValueToTwips(paragraph.marginRight));

    return Math.max(1, width);
  }

  // =========================================================
  // COLORS / MIME
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

      result.underline = !["none", "0", "false"].includes(value);
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

        if (theme?.toLowerCase().includes("major")) {
          font = themeFonts.major;
        }

        if (theme?.toLowerCase().includes("minor")) {
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

        levels.set(ilvl, {
          level: ilvl,

          start,

          numFmt,

          lvlText,

          paragraph: parseParagraphProperties(firstDirectChild(level, "pPr")),

          run: parseRunProperties(firstDirectChild(level, "rPr"), themeFonts),
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

    const levelNumber = Number(level || 0);

    const base = abstract.levels.get(levelNumber) || abstract.levels.get(0);

    if (!base) {
      return null;
    }

    const override = number.overrides.get(levelNumber);

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

    return (
      `<${listStyle.tag}${startAttribute}` +
      ` style="${escapeAttribute(cssString(styles))}">`
    );
  }

  function closeListTag(listInfo) {
    return `</${listStyleFromNumbering(listInfo).tag}>`;
  }

  function renderListItems(items) {
    if (!items.length) {
      return "";
    }

    let html = "";
    let previousLevel = -1;

    const stack = [];

    for (const item of items) {
      const level = Math.max(0, Number(item.listLevel || 0));

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
        html += closeListTag(stack.pop());

        html += "</li>";

        previousLevel--;
      }

      html += `<li style="${escapeAttribute(cssString(item.listCss))}">`;

      html += item.content || "<br>";
    }

    html += "</li>";

    while (stack.length) {
      html += closeListTag(stack.pop());
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
  // UPLOAD
  // =========================================================

  function getDrupalCsrfToken() {
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

    const match = responseText.match(
      /callFunction\s*\(\s*\d+\s*,\s*(['"])(.*?)\1/s,
    );

    if (match?.[2]) {
      const url = match[2]
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'");

      return decodeHtmlEntities(url);
    }

    throw new Error(
      "A kép feltöltődött, de a szerver válaszából nem sikerült kiolvasni az URL-t.",
    );
  }

  async function uploadImageToDrupal(blob, filename) {
    const formData = new FormData();

    formData.append("upload", blob, filename);

    formData.append("_csrf", getDrupalCsrfToken());

    formData.append("ckCsrfToken", getCkeditorCsrfToken());

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

      const uploadedUrl = await uploadImageToDrupal(blob, filename);

      uploaded.set(relationId, uploadedUrl);
    }

    return uploaded;
  }

  // =========================================================
  // DRAWING HELPERS
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
    const extent = firstDescendant(drawing, "extent");

    if (extent) {
      const cx = Number(extent.getAttribute("cx"));

      const cy = Number(extent.getAttribute("cy"));

      if (Number.isFinite(cx) && cx > 0) {
        return {
          widthEmu: cx,

          heightEmu: Number.isFinite(cy) && cy > 0 ? cy : null,

          widthTwips: cx / 635,

          heightTwips: Number.isFinite(cy) && cy > 0 ? cy / 635 : null,
        };
      }
    }

    const shape = firstDescendant(drawing, "shape");

    if (shape) {
      const style = shape.getAttribute("style") || "";

      const widthMatch = style.match(/(?:^|;)\s*width\s*:\s*([\d.]+)(pt|px)/i);

      const heightMatch = style.match(
        /(?:^|;)\s*height\s*:\s*([\d.]+)(pt|px)/i,
      );

      function cssDimensionToTwips(match) {
        if (!match) {
          return null;
        }

        const number = Number(match[1]);

        const unit = match[2].toLowerCase();

        if (!Number.isFinite(number)) {
          return null;
        }

        if (unit === "pt") {
          return number * 20;
        }

        if (unit === "px") {
          return number * 15;
        }

        return null;
      }

      const widthTwips = cssDimensionToTwips(widthMatch);

      const heightTwips = cssDimensionToTwips(heightMatch);

      return {
        widthEmu: widthTwips ? twipsToEmu(widthTwips) : null,

        heightEmu: heightTwips ? twipsToEmu(heightTwips) : null,

        widthTwips,

        heightTwips,
      };
    }

    return {
      widthEmu: null,

      heightEmu: null,

      widthTwips: null,

      heightTwips: null,
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

  function countImagesInElement(element) {
    let count = 0;

    count += descendants(element, "blip").filter((node) =>
      getWordAttribute(node, "embed"),
    ).length;

    count += descendants(element, "imagedata").filter((node) =>
      getWordAttribute(node, "id"),
    ).length;

    return count;
  }

  function hasRealTextInElement(element) {
    for (const textNode of descendants(element, "t")) {
      if ((textNode.textContent || "").trim()) {
        return true;
      }
    }

    return false;
  }

  function analyzeTableRow(row) {
    const imageCount = countImagesInElement(row);

    const hasText = hasRealTextInElement(row);

    return {
      imageCount,

      hasText,

      useHeightReference: imageCount >= 2 || (imageCount >= 1 && hasText),
    };
  }

  function calculateWidthBasedImagePercent(drawing, context) {
    const dimensions = getDrawingDimensions(drawing);

    const containerWidthTwips = getEffectiveContainerWidthTwips(context);

    if (!dimensions.widthTwips || !containerWidthTwips) {
      return 100;
    }

    let percent = (dimensions.widthTwips / containerWidthTwips) * 100;

    if (percent >= 97) {
      percent = 100;
    }

    return round(clamp(percent, 1, 100), 2);
  }

  function getHeightReferenceCss(drawing, context) {
    const dimensions = getDrawingDimensions(drawing);

    if (!dimensions.heightTwips || !dimensions.widthTwips) {
      return {
        width: "100%",

        "max-width": "100%",

        height: "auto",
      };
    }

    const heightPt = dimensions.heightTwips / 20;

    const widthPt = dimensions.widthTwips / 20;

    const containerWidthPt = getEffectiveContainerWidthTwips(context) / 20;

    if (widthPt > containerWidthPt) {
      return {
        width: "100%",

        "max-width": "100%",

        height: "auto",
      };
    }

    return {
      width: "auto",

      "max-width": "100%",

      height: `${round(heightPt, 2)}pt`,
    };
  }

  // =========================================================
  // FLOATING LAYOUT
  // =========================================================

  function getAnchorPosition(anchor, context) {
    const dimensions = getDrawingDimensions(anchor);

    const containerWidthEmu = twipsToEmu(
      getEffectiveContainerWidthTwips(context),
    );

    let x = 0;
    let y = 0;

    const positionH = firstDirectChild(anchor, "positionH");

    const positionV = firstDirectChild(anchor, "positionV");

    if (positionH) {
      const offset = Number(
        firstDirectChild(positionH, "posOffset")?.textContent,
      );

      const align = firstDirectChild(positionH, "align")?.textContent?.trim();

      if (Number.isFinite(offset)) {
        x = offset;
      } else if (align) {
        const width = dimensions.widthEmu || 0;

        if (["center", "inside", "outside"].includes(align)) {
          x = Math.max(0, (containerWidthEmu - width) / 2);
        } else if (align === "right") {
          x = Math.max(0, containerWidthEmu - width);
        } else {
          x = 0;
        }
      }
    }

    if (positionV) {
      const offset = Number(
        firstDirectChild(positionV, "posOffset")?.textContent,
      );

      if (Number.isFinite(offset)) {
        y = offset;
      }
    }

    return {
      x,

      y,

      width: dimensions.widthEmu || containerWidthEmu,

      height: dimensions.heightEmu || 0,
    };
  }

  function getOuterParagraphPlainText(paragraph) {
    const parts = [];

    for (const textNode of descendants(paragraph, "t")) {
      if (hasAncestorLocalName(textNode, "txbxContent", paragraph)) {
        continue;
      }

      parts.push(textNode.textContent || "");
    }

    return parts.join("").trim();
  }

  function extractFloatingLayoutItems(paragraph, context) {
    const anchors = getTopLevelDescendants(paragraph, "anchor", "txbxContent");

    if (!anchors.length) {
      return [];
    }

    const items = [];

    for (const anchor of anchors) {
      const position = getAnchorPosition(anchor, context);

      const txbxContent = firstDescendant(anchor, "txbxContent");

      const relationId = getDrawingRelationId(anchor);

      if (txbxContent) {
        items.push({
          type: "textbox",

          source: anchor,

          txbxContent,

          ...position,
        });

        continue;
      }

      if (relationId) {
        items.push({
          type: "image",

          source: anchor,

          relationId,

          alt: getDrawingAltText(anchor),

          ...position,
        });
      }
    }

    const inlines = getTopLevelDescendants(paragraph, "inline", "txbxContent");

    let inlineX = 0;

    for (const inline of inlines) {
      const relationId = getDrawingRelationId(inline);

      if (!relationId) {
        continue;
      }

      const dimensions = getDrawingDimensions(inline);

      items.push({
        type: "image",

        source: inline,

        relationId,

        alt: getDrawingAltText(inline),

        x: inlineX,

        y: 0,

        width:
          dimensions.widthEmu ||
          twipsToEmu(getEffectiveContainerWidthTwips(context)),

        height: dimensions.heightEmu || 0,
      });

      inlineX += dimensions.widthEmu || 0;
    }

    return items;
  }

  function shouldRenderFloatingLayout(paragraph, context) {
    const items = extractFloatingLayoutItems(paragraph, context);

    if (!items.length) {
      return false;
    }

    const outerText = getOuterParagraphPlainText(paragraph);

    return !outerText || items.length >= 2;
  }

  function floatingItemsSameRow(item, row) {
    const baseHeight = Math.max(
      1,
      Math.min(
        item.height || FLOAT_ROW_MAX_TOLERANCE_EMU,

        row.maxHeight || FLOAT_ROW_MAX_TOLERANCE_EMU,
      ),
    );

    const adaptiveTolerance = clamp(
      baseHeight * 0.25,

      FLOAT_ROW_MIN_TOLERANCE_EMU,

      FLOAT_ROW_MAX_TOLERANCE_EMU,
    );

    return Math.abs(item.y - row.averageY) <= adaptiveTolerance;
  }

  function groupFloatingItemsIntoRows(items) {
    const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);

    const rows = [];

    for (const item of sorted) {
      let matchingRow = null;

      for (const row of rows) {
        if (floatingItemsSameRow(item, row)) {
          matchingRow = row;

          break;
        }
      }

      if (!matchingRow) {
        matchingRow = {
          items: [],

          averageY: item.y,

          maxHeight: item.height || 0,
        };

        rows.push(matchingRow);
      }

      matchingRow.items.push(item);

      matchingRow.averageY =
        matchingRow.items.reduce((sum, current) => sum + current.y, 0) /
        matchingRow.items.length;

      matchingRow.maxHeight = Math.max(
        matchingRow.maxHeight,

        item.height || 0,
      );
    }

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);

      row.top = Math.min(...row.items.map((item) => item.y));

      row.bottom = Math.max(
        ...row.items.map((item) => item.y + (item.height || 0)),
      );
    }

    rows.sort((a, b) => a.top - b.top);

    return rows;
  }

  function getFloatingCellBoundaries(items, containerWidthEmu) {
    if (items.length === 1) {
      return [0, containerWidthEmu];
    }

    const boundaries = [0];

    for (let index = 0; index < items.length - 1; index++) {
      const current = items[index];

      const next = items[index + 1];

      const currentRight = current.x + current.width;

      const nextLeft = next.x;

      let boundary;

      if (nextLeft >= currentRight) {
        boundary = (currentRight + nextLeft) / 2;
      } else {
        boundary = (current.x + next.x) / 2;
      }

      boundary = clamp(
        boundary,

        boundaries[boundaries.length - 1] + 1,

        containerWidthEmu - 1,
      );

      boundaries.push(boundary);
    }

    boundaries.push(containerWidthEmu);

    return boundaries;
  }

  function getObjectAlignmentInsideCell(item, cellStart, cellEnd) {
    const cellWidth = Math.max(1, cellEnd - cellStart);

    const leftGap = Math.max(0, item.x - cellStart);

    const rightGap = Math.max(0, cellEnd - (item.x + item.width));

    const tolerance = cellWidth * 0.08;

    if (Math.abs(leftGap - rightGap) <= tolerance) {
      return "center";
    }

    return leftGap < rightGap ? "left" : "right";
  }

  function getFloatingObjectWidthPercent(item, cellStart, cellEnd) {
    const cellWidth = Math.max(1, cellEnd - cellStart);

    const availableFromObjectStart = Math.max(
      1,
      cellEnd - Math.max(cellStart, item.x),
    );

    const effectiveWidth = Math.min(
      item.width || cellWidth,

      availableFromObjectStart,
    );

    return round(
      clamp(
        (effectiveWidth / cellWidth) * 100,

        1,
        100,
      ),
      2,
    );
  }

  function renderFloatingImageItem(item, cellStart, cellEnd, context) {
    const url = context.imageUrls.get(item.relationId);

    if (!url) {
      return "";
    }

    const widthPercent = getFloatingObjectWidthPercent(
      item,
      cellStart,
      cellEnd,
    );

    const styles = {
      display: "inline-block",

      width: `${widthPercent}%`,

      "max-width": "100%",

      height: "auto",

      border: "0",

      margin: "0",

      padding: "0",

      "vertical-align": "top",
    };

    return (
      `<img` +
      ` src="${escapeAttribute(url)}"` +
      ` alt="${escapeAttribute(item.alt || "")}"` +
      ` style="${escapeAttribute(cssString(styles))}"` +
      `>`
    );
  }

  function renderFloatingTextboxItem(item, cellStart, cellEnd, context) {
    const widthPercent = getFloatingObjectWidthPercent(
      item,
      cellStart,
      cellEnd,
    );

    const textboxWidthTwips = Math.max(1, emuToTwips(item.width));

    const textboxContext = {
      ...context,

      currentContainerWidthTwips: textboxWidthTwips,

      currentTableRowAnalysis: null,

      currentParagraphProperties: {},
    };

    const content = renderElements(
      [...item.txbxContent.children],
      textboxContext,
    );

    const styles = {
      display: "inline-block",

      width: `${widthPercent}%`,

      "max-width": "100%",

      "vertical-align": "top",

      "text-align": "left",

      margin: "0",

      padding: "0",
    };

    return (
      `<div style="${escapeAttribute(cssString(styles))}">` + content + `</div>`
    );
  }

  function renderFloatingRow(row, context) {
    const containerWidthEmu = Math.max(
      1,
      twipsToEmu(getEffectiveContainerWidthTwips(context)),
    );

    const items = row.items.map((item) => ({
      ...item,

      x: clamp(item.x, 0, containerWidthEmu),

      width: Math.max(1, item.width || containerWidthEmu),
    }));

    const boundaries = getFloatingCellBoundaries(items, containerWidthEmu);

    const cells = [];

    for (let index = 0; index < items.length; index++) {
      const item = items[index];

      const cellStart = boundaries[index];

      const cellEnd = boundaries[index + 1];

      const cellWidth = Math.max(1, cellEnd - cellStart);

      const cellPercent = round((cellWidth / containerWidthEmu) * 100, 2);

      const align = getObjectAlignmentInsideCell(item, cellStart, cellEnd);

      let innerHtml = "";

      if (item.type === "image") {
        innerHtml = renderFloatingImageItem(item, cellStart, cellEnd, context);
      } else if (item.type === "textbox") {
        innerHtml = renderFloatingTextboxItem(
          item,
          cellStart,
          cellEnd,
          context,
        );
      }

      const tdStyles = {
        width: `${cellPercent}%`,

        "vertical-align": "top",

        "text-align": align,

        padding: "0",

        margin: "0",
      };

      cells.push(
        `<td` +
          ` width="${round(cellPercent, 0)}%"` +
          ` valign="top"` +
          ` style="${escapeAttribute(cssString(tdStyles))}"` +
          `>` +
          innerHtml +
          `</td>`,
      );
    }

    return (
      `<table` +
      ` width="100%"` +
      ` cellpadding="0"` +
      ` cellspacing="0"` +
      ` border="0"` +
      ` style="width:100%;border-collapse:collapse;table-layout:fixed;"` +
      `>` +
      `<tbody>` +
      `<tr>` +
      cells.join("") +
      `</tr>` +
      `</tbody>` +
      `</table>`
    );
  }

  function renderFloatingParagraphLayout(
    paragraph,
    baseContext,
    paragraphState,
  ) {
    const context = {
      ...baseContext,

      paragraphStyle: paragraphState.paragraphStyle,

      currentParagraphProperties: paragraphState.paragraphProperties,
    };

    const items = extractFloatingLayoutItems(paragraph, context);

    const rows = groupFloatingItemsIntoRows(items);

    if (!rows.length) {
      return "";
    }

    const wrapperStyles = paragraphPropertiesToCss(
      paragraphState.paragraphProperties,
    );

    delete wrapperStyles["text-indent"];

    delete wrapperStyles["white-space"];

    wrapperStyles.width = "100%";

    let body = "";
    let previousBottom = null;

    for (const row of rows) {
      if (previousBottom !== null) {
        const gapEmu = Math.max(0, row.top - previousBottom);

        const gapPt = emuToPt(gapEmu);

        if (gapPt > 1) {
          body +=
            `<div style="height:${round(gapPt, 2)}pt;` +
            `line-height:${round(gapPt, 2)}pt;` +
            `font-size:1px;">` +
            `&nbsp;` +
            `</div>`;
        }
      }

      body += renderFloatingRow(row, context);

      previousBottom = Math.max(previousBottom || 0, row.bottom);
    }

    return (
      `<div style="${escapeAttribute(cssString(wrapperStyles))}">` +
      body +
      `</div>`
    );
  }

  // =========================================================
  // DRAWING RENDERER
  // =========================================================

  function drawingToHtml(drawing, context) {
    const txbxContent = firstDescendant(drawing, "txbxContent");

    if (txbxContent) {
      const dimensions = getDrawingDimensions(drawing);

      const textboxContext = {
        ...context,

        currentContainerWidthTwips:
          dimensions.widthTwips || getEffectiveContainerWidthTwips(context),

        currentTableRowAnalysis: null,
      };

      return renderElements([...txbxContent.children], textboxContext);
    }

    const relationId = getDrawingRelationId(drawing);

    if (!relationId) {
      return "";
    }

    const url = context.imageUrls.get(relationId);

    if (!url) {
      return "";
    }

    const alt = getDrawingAltText(drawing);

    const styles = {
      display: "inline-block",

      border: "0",

      margin: "0",

      padding: "0",

      "vertical-align": "middle",
    };

    if (context.currentTableRowAnalysis?.useHeightReference) {
      Object.assign(styles, getHeightReferenceCss(drawing, context));
    } else {
      const percent = calculateWidthBasedImagePercent(drawing, context);

      Object.assign(styles, {
        width: `${percent}%`,

        "max-width": "100%",

        height: "auto",
      });
    }

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

      context.currentParagraphRunProperties,

      runStyle.run,

      directRun,
    );
  }

  function renderRunContainerNode(node, context) {
    const name = localName(node);

    if (name === "t" || name === "delText") {
      return escapeHtml(node.textContent || "");
    }

    if (name === "tab") {
      return '<span style="display:inline-block;width:4em"></span>';
    }

    if (name === "br" || name === "cr") {
      return "<br>";
    }

    if (name === "noBreakHyphen") {
      return "&#8209;";
    }

    if (name === "softHyphen") {
      return "&shy;";
    }

    if (name === "drawing" || name === "pict" || name === "object") {
      return drawingToHtml(node, context);
    }

    if (name === "AlternateContent") {
      const choice = firstDirectChild(node, "Choice");

      const fallback = firstDirectChild(node, "Fallback");

      const selected = choice || fallback;

      if (!selected) {
        return "";
      }

      return [...selected.childNodes]
        .filter((child) => child.nodeType === Node.ELEMENT_NODE)
        .map((child) => renderRunContainerNode(child, context))
        .join("");
    }

    if (name === "Choice" || name === "Fallback") {
      return [...node.childNodes]
        .filter((child) => child.nodeType === Node.ELEMENT_NODE)
        .map((child) => renderRunContainerNode(child, context))
        .join("");
    }

    return "";
  }

  function runToHtml(run, context) {
    let content = "";

    for (const child of run.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      if (localName(child) === "rPr") {
        continue;
      }

      content += renderRunContainerNode(child, context);
    }

    if (!content) {
      return "";
    }

    const css = cssString(
      runPropertiesToCss(getEffectiveRunProperties(run, context)),
    );

    if (!css) {
      return content;
    }

    return `<span style="${escapeAttribute(css)}">` + content + `</span>`;
  }

  function inlineChildrenToHtml(parent, context) {
    let html = "";

    for (const child of parent.childNodes) {
      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      const name = localName(child);

      if (name === "pPr") {
        continue;
      }

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

        html += href
          ? `<a href="${escapeAttribute(href)}">${content}</a>`
          : content;

        continue;
      }

      if (name === "fldSimple") {
        const instruction = getWordAttribute(child, "instr") || "";

        const match = instruction.match(/HYPERLINK\s+"([^"]+)"/i);

        const content = inlineChildrenToHtml(child, context);

        html += match
          ? `<a href="${escapeAttribute(match[1])}">${content}</a>`
          : content;

        continue;
      }

      if (["smartTag", "sdt", "sdtContent", "ins", "moveTo"].includes(name)) {
        html += inlineChildrenToHtml(child, context);
      }
    }

    return html;
  }

  // =========================================================
  // PARAGRAPH
  // =========================================================

  function resolveParagraphState(paragraph, baseContext) {
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

    const paragraphRunProperties = parseRunProperties(
      directPPr ? firstDirectChild(directPPr, "rPr") : null,

      baseContext.themeFonts,
    );

    const baseRunProperties = mergeObjects(
      baseContext.styleSystem.defaults.run,

      paragraphStyle.run,

      listInfo?.run,

      paragraphRunProperties,
    );

    return {
      paragraphStyle,

      paragraphProperties,

      paragraphRunProperties,

      baseRunProperties,

      listInfo,
    };
  }

  function buildParagraphDescriptor(paragraph, baseContext) {
    const state = resolveParagraphState(paragraph, baseContext);

    const floatingContext = {
      ...baseContext,

      paragraphStyle: state.paragraphStyle,

      currentParagraphProperties: state.paragraphProperties,
    };

    if (shouldRenderFloatingLayout(paragraph, floatingContext)) {
      return {
        html: renderFloatingParagraphLayout(paragraph, baseContext, state),

        content: "",

        isEmpty: false,

        numId: null,

        listLevel: 0,

        listInfo: null,

        listCss: {},
      };
    }

    const context = {
      ...baseContext,

      paragraphStyle: state.paragraphStyle,

      currentParagraphProperties: state.paragraphProperties,

      currentParagraphRunProperties: state.paragraphRunProperties,
    };

    const content = inlineChildrenToHtml(paragraph, context);

    const paragraphCss = paragraphPropertiesToCss(state.paragraphProperties);

    Object.assign(paragraphCss, runPropertiesToCss(state.baseRunProperties));

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
      `</p>`;

    const listCss = {
      ...paragraphCss,
    };

    if (state.listInfo) {
      delete listCss["text-indent"];

      listCss["list-style-position"] = "outside";
    }

    return {
      html,

      content,

      isEmpty,

      numId: state.paragraphProperties.numId || null,

      listLevel: Number(state.paragraphProperties.listLevel || 0),

      listInfo: state.listInfo,

      listCss,
    };
  }

  // =========================================================
  // TABLES
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
        const css = getBorderCss(firstDirectChild(borders, wordSide));

        if (css) {
          styles[cssSide] = css;
        }
      }
    }

    return styles;
  }

  function getCellPaddingTwips(cell) {
    const tcPr = firstDirectChild(cell, "tcPr");

    const margins = tcPr ? firstDirectChild(tcPr, "tcMar") : null;

    let left = 0;
    let right = 0;

    if (margins) {
      const leftElement =
        firstDirectChild(margins, "left") || firstDirectChild(margins, "start");

      const rightElement =
        firstDirectChild(margins, "right") || firstDirectChild(margins, "end");

      const leftValue = Number(getWordAttribute(leftElement, "w"));

      const rightValue = Number(getWordAttribute(rightElement, "w"));

      if (Number.isFinite(leftValue)) {
        left = leftValue;
      }

      if (Number.isFinite(rightValue)) {
        right = rightValue;
      }
    }

    return {
      left,
      right,
    };
  }

  function getCellColspan(cell) {
    const tcPr = firstDirectChild(cell, "tcPr");

    const gridSpan = tcPr ? firstDirectChild(tcPr, "gridSpan") : null;

    const value = Number(getWordAttribute(gridSpan, "val"));

    return Number.isFinite(value) && value > 1 ? value : 1;
  }

  function getTableGridWidths(table) {
    const tblGrid = firstDirectChild(table, "tblGrid");

    if (!tblGrid) {
      return [];
    }

    return directChildren(tblGrid, "gridCol").map((col) => {
      const width = Number(getWordAttribute(col, "w"));

      return Number.isFinite(width) && width > 0 ? width : 0;
    });
  }

  function getTableWidthTwips(table, context) {
    const tblPr = firstDirectChild(table, "tblPr");

    const tblW = tblPr ? firstDirectChild(tblPr, "tblW") : null;

    if (tblW) {
      const value = Number(getWordAttribute(tblW, "w"));

      const type = getWordAttribute(tblW, "type");

      if (Number.isFinite(value) && value > 0) {
        if (type === "dxa") {
          return value;
        }

        if (type === "pct") {
          return getEffectiveContainerWidthTwips(context) * (value / 5000);
        }
      }
    }

    const gridWidth = getTableGridWidths(table).reduce(
      (sum, width) => sum + width,
      0,
    );

    if (gridWidth > 0) {
      return gridWidth;
    }

    return getEffectiveContainerWidthTwips(context);
  }

  function getCellWidthTwips(cell, context, gridWidths, gridIndex) {
    const tcPr = firstDirectChild(cell, "tcPr");

    const tcW = tcPr ? firstDirectChild(tcPr, "tcW") : null;

    let width = null;

    if (tcW) {
      const value = Number(getWordAttribute(tcW, "w"));

      const type = getWordAttribute(tcW, "type");

      if (Number.isFinite(value) && value > 0) {
        if (type === "dxa") {
          width = value;
        }

        if (type === "pct") {
          width = context.currentTableWidthTwips * (value / 5000);
        }
      }
    }

    if (!width && gridWidths.length) {
      const span = getCellColspan(cell);

      let gridWidth = 0;

      for (let index = 0; index < span; index++) {
        gridWidth += gridWidths[gridIndex + index] || 0;
      }

      if (gridWidth > 0) {
        width = gridWidth;
      }
    }

    if (!width) {
      width =
        context.currentTableWidthTwips ||
        getEffectiveContainerWidthTwips(context);
    }

    const padding = getCellPaddingTwips(cell);

    return Math.max(1, width - padding.left - padding.right);
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

  function tableCellToHtml(cell, context, gridWidths, gridIndex) {
    const cellWidthTwips = getCellWidthTwips(
      cell,
      context,
      gridWidths,
      gridIndex,
    );

    const cellContext = {
      ...context,

      currentContainerWidthTwips: cellWidthTwips,
    };

    const content = renderElements([...cell.children], cellContext);

    const styles = getCellStyles(cell);

    const colspan = getCellColspan(cell);

    const colspanAttribute = colspan > 1 ? ` colspan="${colspan}"` : "";

    return (
      `<td${colspanAttribute}` +
      ` style="${escapeAttribute(cssString(styles))}">` +
      content +
      `</td>`
    );
  }

  function tableToHtml(table, context) {
    const rows = [];

    const tableWidthTwips = getTableWidthTwips(table, context);

    const gridWidths = getTableGridWidths(table);

    for (const row of directChildren(table, "tr")) {
      const rowAnalysis = analyzeTableRow(row);

      const rowContext = {
        ...context,

        currentTableWidthTwips: tableWidthTwips,

        currentTableRowAnalysis: rowAnalysis,
      };

      const cells = [];

      let gridIndex = 0;

      for (const cell of directChildren(row, "tc")) {
        cells.push(tableCellToHtml(cell, rowContext, gridWidths, gridIndex));

        gridIndex += getCellColspan(cell);
      }

      rows.push(`<tr>${cells.join("")}</tr>`);
    }

    const styles = getTableStyles(table);

    return (
      `<table` +
      ` cellpadding="0"` +
      ` cellspacing="0"` +
      ` border="0"` +
      ` style="${escapeAttribute(cssString(styles))}"` +
      `>` +
      `<tbody>` +
      rows.join("") +
      `</tbody>` +
      `</table>`
    );
  }

  // =========================================================
  // CLEANUP
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

      for (const span of [...root.querySelectorAll("span")]) {
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

      for (const span of [...root.querySelectorAll("span")]) {
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
  // CONVERT
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

    const pageMetrics = readPageMetrics(documentXml);

    progress?.("Word stílusok feldolgozása...");

    const themeFonts = await readThemeFonts(zip);

    const [styleSystem, numberingSystem, relationships] = await Promise.all([
      readStyleSystem(zip, themeFonts),

      readNumberingSystem(zip, themeFonts),

      readRelationships(zip),
    ]);

    progress?.("Képek keresése és feltöltése...");

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

      currentContainerWidthTwips: pageMetrics.textWidthTwips,

      currentTableWidthTwips: null,

      currentTableRowAnalysis: null,

      currentParagraphProperties: {},

      currentParagraphRunProperties: {},

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
    document.getElementById(APP_ID)?.remove();

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
        const html = await convertDocxToHtml(file, (message) => {
          status.textContent = message;
        });

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
