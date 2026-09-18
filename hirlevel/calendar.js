(async () => {
  "use strict";

  // ============================================================
  // PTE HÍRLEVÉL NAPTÁR SEGÉD
  //
  // ✓ 15 perces drag & drop
  // ✓ automatikus sending_time mentés
  // ✓ redirect-hiba tolerálása
  // ✓ szerveroldali mentés-visszaellenőrzés
  // ✓ Shift + bal klikk extra menü
  // ✓ +/- 15 perc
  // ✓ +/- 1 hét
  // ✓ pontos időpont megadása
  // ✓ teszt levél küldése
  // ✓ szerkesztőoldal megnyitása
  // ✓ ID másolása
  // ✓ dinamikus FullCalendar magasság
  // ✓ dinamikus 0–24 órás időrács
  // ✓ drag közben teljes layout-freeze
  // ✓ méretezés induláskor és window resize esetén
  // ============================================================

  // ============================================================
  // CONFIG
  // ============================================================

  const CONFIG = {
    calendarSelector: "#w0",

    verifyAttempts: 4,
    verifyDelayMs: 300,

    refreshIntervalMs: 60_000,
    refreshTimeoutMs: 30_000,
    calendarIndexUrl: "/calendar/index",

    bottomGap: 8,

    // Teljes FullCalendar minimum magassága
    minCalendarHeight: 380,

    // Minimum félórás sormagasság.
    // Ha ennél kisebb lenne, inkább belső scroll lesz.
    minHalfHourRowHeight: 18,
  };

  // ============================================================
  // JQUERY / FULLCALENDAR
  // ============================================================

  const jq = window.jQuery;

  if (!jq || !jq.fn || typeof jq.fn.fullCalendar !== "function") {
    alert("Nem található az oldal jQuery / FullCalendar példánya.");

    return;
  }

  const $calendar = jq(CONFIG.calendarSelector);

  if (!$calendar.length) {
    alert(`Nem található a ${CONFIG.calendarSelector} naptár.`);

    return;
  }

  // ============================================================
  // DUPLA FUTTATÁS ELLEN
  // ============================================================

  if (window.__PTE_CALENDAR_TOOLS_ACTIVE__) {
    alert(
      "A PTE naptársegéd már aktív.\n\n" + "Újraindításhoz nyomj előbb F5-öt.",
    );

    return;
  }

  window.__PTE_CALENDAR_TOOLS_ACTIVE__ = true;

  // ============================================================
  // ÁLLAPOTOK
  // ============================================================

  let isCalendarDragging = false;
  let isCalendarLayouting = false;

  let pendingEventSaves = 0;
  let eventMutationVersion = 0;
  let pendingEventRefresh = false;
  let eventRefreshInFlight = false;
  let eventRefreshFlushTimer = null;

  let resizeTimer = null;
  let pendingCalendarFit = false;

  let lastViewportWidth = window.innerWidth;
  let lastViewportHeight = window.innerHeight;

  let lastCalendarHeight = null;
  let lastAppliedRowHeight = null;

  // ============================================================
  // SEGÉDEK
  // ============================================================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ------------------------------------------------------------
  // "7629text" -> "7629"
  // ------------------------------------------------------------

  function getNewsletterId(event) {
    const raw = String(event?.id ?? "");

    const match = raw.match(/^(\d+)/);

    return match ? match[1] : null;
  }

  // ------------------------------------------------------------
  // URL-ek
  // ------------------------------------------------------------

  function getUpdateUrl(id) {
    return (
      "https://hirlevel.pte.hu/" +
      "news-letters/update?id=" +
      encodeURIComponent(id)
    );
  }

  function getTestUrl(id) {
    return (
      "https://hirlevel.pte.hu/" +
      "news-letters/test?id=" +
      encodeURIComponent(id)
    );
  }

  // ------------------------------------------------------------
  // Dátum -> YYYY-MM-DD HH:mm
  // ------------------------------------------------------------

  function formatSendingTime(value) {
    if (!value) {
      throw new Error("Hiányzik az esemény kezdési időpontja.");
    }

    if (typeof value.format === "function") {
      return value.format("YYYY-MM-DD HH:mm");
    }

    const d = new Date(value);

    const pad = (n) => String(n).padStart(2, "0");

    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      " " +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  // ------------------------------------------------------------
  // 2026-09-20T13:15
  // 2026-09-20 13:15
  //
  // ->
  //
  // 2026-09-20 13:15
  // ------------------------------------------------------------

  function normalizeSendingTime(value) {
    return String(value ?? "")
      .trim()
      .replace("T", " ")
      .slice(0, 16);
  }

  // ============================================================
  // FORM -> URLSearchParams
  // ============================================================

  function formToParams(form) {
    const params = new URLSearchParams();

    const controls = form.querySelectorAll(
      "input[name], textarea[name], select[name]",
    );

    for (const control of controls) {
      if (control.disabled || !control.name) {
        continue;
      }

      const name = control.name;

      const type = String(control.type || "").toLowerCase();

      // File input
      if (type === "file") {
        params.append(name, "");

        continue;
      }

      // Checkbox / radio
      if ((type === "checkbox" || type === "radio") && !control.checked) {
        continue;
      }

      // Multiple select
      if (control.tagName === "SELECT" && control.multiple) {
        for (const option of control.options) {
          if (option.selected) {
            params.append(name, option.value);
          }
        }

        continue;
      }

      params.append(name, control.value ?? "");
    }

    return params;
  }

  // ============================================================
  // TOAST
  // ============================================================

  function toast(message, type = "normal", duration = 2500) {
    const existing = document.getElementById("__pte_calendar_toast");

    if (existing) {
      existing.remove();
    }

    const el = document.createElement("div");

    el.id = "__pte_calendar_toast";

    el.textContent = message;

    let background = "#333";

    if (type === "success") {
      background = "#218838";
    }

    if (type === "error") {
      background = "#b52b27";
    }

    if (type === "loading") {
      background = "#1769aa";
    }

    Object.assign(el.style, {
      position: "fixed",

      right: "20px",

      bottom: "20px",

      zIndex: "2147483647",

      maxWidth: "440px",

      padding: "12px 16px",

      borderRadius: "8px",

      boxShadow: "0 4px 20px rgba(0,0,0,.35)",

      fontFamily: "Arial, sans-serif",

      fontSize: "14px",

      lineHeight: "1.4",

      whiteSpace: "pre-line",

      color: "#fff",

      background,
    });

    document.body.appendChild(el);

    setTimeout(() => {
      if (el.isConnected) {
        el.remove();
      }
    }, duration);
  }

  // ============================================================
  // HÍRLEVÉL FORM BETÖLTÉSE
  // ============================================================

  async function loadNewsletterForm(id) {
    const url = getUpdateUrl(id);

    const response = await fetch(url, {
      method: "GET",

      credentials: "include",

      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        "A szerkesztőoldal lekérése sikertelen. " + `HTTP ${response.status}`,
      );
    }

    const html = await response.text();

    const doc = new DOMParser().parseFromString(html, "text/html");

    const sendingTimeInput = doc.querySelector(
      '[name="NewsLetters[sending_time]"]',
    );

    if (!sendingTimeInput) {
      throw new Error("A NewsLetters[sending_time] mező nem található.");
    }

    const form = sendingTimeInput.closest("form");

    if (!form) {
      throw new Error("Nem található a hírlevél szerkesztő űrlap.");
    }

    return {
      url,
      doc,
      form,
      sendingTimeInput,
    };
  }

  // ============================================================
  // MENTÉS ELLENŐRZÉSE
  // ============================================================

  async function verifySendingTime(id, expectedTime) {
    const baseUrl = getUpdateUrl(id);

    const expected = normalizeSendingTime(expectedTime);

    let lastActual = null;

    for (let attempt = 1; attempt <= CONFIG.verifyAttempts; attempt++) {
      const verifyUrl = baseUrl + "&_pte_verify=" + Date.now() + "_" + attempt;

      const response = await fetch(verifyUrl, {
        method: "GET",

        credentials: "include",

        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error(
          "A mentés ellenőrzése sikertelen. " + `HTTP ${response.status}`,
        );
      }

      const html = await response.text();

      const doc = new DOMParser().parseFromString(html, "text/html");

      const input = doc.querySelector('[name="NewsLetters[sending_time]"]');

      if (!input) {
        throw new Error(
          "Az ellenőrzéskor nem található " + "a sending_time mező.",
        );
      }

      const rawValue = String(input.value || "");

      const actual = normalizeSendingTime(rawValue);

      lastActual = actual;

      console.log(`[PTE] Ellenőrzés ${attempt}/${CONFIG.verifyAttempts}:`, {
        id,
        expected,
        actual,
        rawServerValue: rawValue,
      });

      if (actual === expected) {
        return {
          success: true,

          actual,
        };
      }

      if (attempt < CONFIG.verifyAttempts) {
        await sleep(CONFIG.verifyDelayMs);
      }
    }

    throw new Error(
      "A szerveren nem az új időpont szerepel.\n\n" +
        `Kért időpont: ${expected}\n` +
        `Szerver: ${lastActual ?? "ismeretlen"}`,
    );
  }

  // ============================================================
  // IDŐPONT MENTÉS
  // ============================================================

  async function saveEvent(event) {
    const id = getNewsletterId(event);

    if (!id) {
      throw new Error(`Nem sikerült ID-t kinyerni ebből: ${event?.id}`);
    }

    const sendingTime = normalizeSendingTime(formatSendingTime(event.start));

    const { url, form } = await loadNewsletterForm(id);

    const params = formToParams(form);

    params.set("NewsLetters[id]", id);

    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: mentés → ${sendingTime}`);

    // --------------------------------------------------------
    // POST
    //
    // A backend sikeres mentés után HTTP redirectet küldhet.
    // A redirect hibája nem jelenti, hogy a mentés sikertelen.
    // --------------------------------------------------------

    try {
      const response = await fetch(url, {
        method: "POST",

        credentials: "include",

        redirect: "manual",

        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",

          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },

        body: params.toString(),
      });

      console.log("[PTE] POST válasz:", {
        status: response.status,

        type: response.type,

        redirected: response.redirected,
      });
    } catch (error) {
      console.warn(
        "[PTE] POST / redirect hiba. " +
          "A tényleges mentést külön ellenőrizzük.",
        error,
      );
    }

    await sleep(CONFIG.verifyDelayMs);

    await verifySendingTime(id, sendingTime);

    console.log(
      `%c✓ #${id} mentve: ${sendingTime}`,
      "color:#00a000;font-weight:bold",
    );

    return {
      id,
      sendingTime,
    };
  }

  // ============================================================
  // IDŐPONT ELTOLÁS
  // ============================================================

  async function shiftEvent(event, amount, unit, description) {
    if (!event || !event.start) {
      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

    beginCalendarAction();

    try {
      event.start = event.start.clone().add(amount, unit);

      if (event.end) {
        event.end = event.end.clone().add(amount, unit);
      }

      $calendar.fullCalendar("updateEvent", event);

      toast(`${description}\nMentés...`, "loading", 10000);

      const result = await saveEvent(event);

      toast(`✓ Mentve\n${result.sendingTime}`, "success", 3000);
    } catch (error) {
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      console.error("[PTE] Áthelyezési hiba:", error);

      toast("Mentési hiba.\n\n" + error.message, "error", 7000);
    } finally {
      finishCalendarAction();
    }
  }

  // ============================================================
  // PONTOS IDŐPONT
  // ============================================================

  async function setExactTime(event) {
    const current = formatSendingTime(event.start);

    const input = prompt(
      "Új időpont:\n\n" +
        "Formátum: YYYY-MM-DD HH:mm\n\n" +
        "Csak :00, :15, :30 vagy :45 perc használható.",
      current,
    );

    if (input === null) {
      return;
    }

    const value = input.trim();

    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(value)) {
      alert("Hibás formátum.\n\n" + "Példa:\n" + "2026-09-22 08:15");

      return;
    }

    if (typeof window.moment !== "function") {
      alert("A Moment.js nem található.");

      return;
    }

    const newStart = window.moment(value, "YYYY-MM-DD HH:mm", true);

    if (!newStart.isValid()) {
      alert("Érvénytelen dátum vagy idő.");

      return;
    }

    if (newStart.minute() % 15 !== 0) {
      alert(
        "Az időpontnak 15 perces lépésre kell esnie.\n\n" +
          ":00\n:15\n:30\n:45",
      );

      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

    const durationMs = event.end ? event.end.diff(event.start) : null;

    beginCalendarAction();

    try {
      event.start = newStart;

      if (durationMs !== null) {
        event.end = newStart.clone().add(durationMs, "milliseconds");
      }

      $calendar.fullCalendar("updateEvent", event);

      toast("Új időpont mentése...", "loading", 10000);

      const result = await saveEvent(event);

      toast(`✓ Mentve\n${result.sendingTime}`, "success", 3000);
    } catch (error) {
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      console.error("[PTE] Pontos időpont mentési hiba:", error);

      toast("Mentési hiba.\n\n" + error.message, "error", 7000);
    } finally {
      finishCalendarAction();
    }
  }

  // ============================================================
  // TESZT LEVÉL
  // ============================================================

  async function sendTestNewsletter(event) {
    const id = getNewsletterId(event);

    if (!id) {
      alert("Nem található a hírlevél ID.");

      return;
    }

    const title = String(event.title || "Hírlevél");

    const confirmed = confirm(
      "Biztosan szeretnél TESZT levelet küldeni?\n\n" + title + "\n\nID: " + id,
    );

    if (!confirmed) {
      return;
    }

    const url = getTestUrl(id);

    toast("Teszt levél küldése...", "loading", 15000);

    beginCalendarAction();

    try {
      const response = await fetch(url, {
        method: "GET",

        credentials: "include",

        cache: "no-store",

        redirect: "manual",

        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });

      console.log("[PTE] Tesztküldés válasz:", {
        status: response.status,

        type: response.type,

        redirected: response.redirected,
      });

      if (
        response.ok ||
        response.type === "opaqueredirect" ||
        response.status === 0 ||
        (response.status >= 300 && response.status < 400)
      ) {
        toast(`✓ Tesztküldési kérés elküldve\n#${id}`, "success", 4000);

        return;
      }

      throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      console.warn("[PTE] Tesztküldés / redirect hiba:", error);

      toast(
        "A tesztküldési kérés elindult, " +
          "de a válasz nem volt ellenőrizhető.\n\n" +
          "Lehetséges, hogy a szerver redirectje blokkolódott.",
        "error",
        7000,
      );
    } finally {
      finishCalendarAction();
    }
  }

  // ============================================================
  // SZERKESZTÉS
  // ============================================================

  function openEditor(event) {
    const id = getNewsletterId(event);

    if (!id) {
      alert("Nem található a hírlevél ID.");

      return;
    }

    window.open(getUpdateUrl(id), "_blank");
  }

  // ============================================================
  // ID MÁSOLÁSA
  // ============================================================

  async function copyId(event) {
    const id = getNewsletterId(event);

    if (!id) {
      return;
    }

    try {
      await navigator.clipboard.writeText(id);

      toast(`✓ ID másolva: ${id}`, "success");
    } catch (_) {
      prompt("Hírlevél ID:", id);
    }
  }

  // ============================================================
  // SHIFT MENÜ
  // ============================================================

  const menu = document.createElement("div");

  menu.id = "__pte_calendar_menu";

  Object.assign(menu.style, {
    display: "none",

    position: "fixed",

    minWidth: "285px",

    maxWidth: "430px",

    zIndex: "2147483646",

    background: "#20272b",

    color: "#fff",

    border: "1px solid rgba(255,255,255,.18)",

    borderRadius: "8px",

    boxShadow: "0 8px 30px rgba(0,0,0,.5)",

    padding: "6px 0",

    fontFamily: "Arial, sans-serif",

    fontSize: "14px",

    userSelect: "none",
  });

  document.body.appendChild(menu);

  let selectedEvent = null;

  function hideMenu() {
    menu.style.display = "none";

    selectedEvent = null;

    if (pendingEventRefresh) scheduleEventRefresh();
  }

  function addSeparator() {
    const separator = document.createElement("div");

    Object.assign(separator.style, {
      height: "1px",

      margin: "5px 0",

      background: "rgba(255,255,255,.15)",
    });

    menu.appendChild(separator);
  }

  function makeMenuItem(label, action) {
    const item = document.createElement("div");

    item.textContent = label;

    Object.assign(item.style, {
      padding: "9px 14px",

      cursor: "pointer",

      whiteSpace: "nowrap",
    });

    item.addEventListener("mouseenter", () => {
      item.style.background = "rgba(255,255,255,.12)";
    });

    item.addEventListener("mouseleave", () => {
      item.style.background = "";
    });

    item.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const event = selectedEvent;

      hideMenu();

      if (!event) {
        return;
      }

      try {
        await action(event);
      } catch (error) {
        console.error("[PTE] Menü művelet hiba:", error);

        toast(error.message, "error", 5000);
      } finally {
        requestCalendarRefresh();
      }
    });

    menu.appendChild(item);
  }

  function buildMenu(event) {
    menu.innerHTML = "";

    const id = getNewsletterId(event);

    const title = String(event.title || "Hírlevél");

    // --------------------------------------------------------
    // Fejléc
    // --------------------------------------------------------

    const header = document.createElement("div");

    header.textContent = `${title} (#${id || "?"})`;

    Object.assign(header.style, {
      padding: "8px 14px 5px",

      fontWeight: "bold",

      overflow: "hidden",

      textOverflow: "ellipsis",

      whiteSpace: "nowrap",
    });

    menu.appendChild(header);

    // --------------------------------------------------------
    // Időpont
    // --------------------------------------------------------

    const time = document.createElement("div");

    time.textContent = formatSendingTime(event.start);

    Object.assign(time.style, {
      padding: "0 14px 8px",

      fontSize: "12px",

      opacity: ".65",
    });

    menu.appendChild(time);

    addSeparator();

    makeMenuItem(
      "＋ 15 perccel később",

      (event) => shiftEvent(event, 15, "minutes", "+15 perc"),
    );

    makeMenuItem(
      "− 15 perccel korábban",

      (event) => shiftEvent(event, -15, "minutes", "-15 perc"),
    );

    addSeparator();

    makeMenuItem(
      "➡ 1 héttel később",

      (event) => shiftEvent(event, 1, "week", "+1 hét"),
    );

    makeMenuItem(
      "⬅ 1 héttel korábban",

      (event) => shiftEvent(event, -1, "week", "-1 hét"),
    );

    makeMenuItem(
      "🕒 Pontos időpont megadása…",

      (event) => setExactTime(event),
    );

    addSeparator();

    makeMenuItem(
      "🧪 Teszt levél küldése",

      (event) => sendTestNewsletter(event),
    );

    makeMenuItem(
      "✏️ Szerkesztés",

      (event) => openEditor(event),
    );

    addSeparator();

    makeMenuItem(
      "📋 Hírlevél ID másolása",

      (event) => copyId(event),
    );
  }

  function showMenu(event, clientX, clientY) {
    selectedEvent = event;

    buildMenu(event);

    menu.style.display = "block";

    menu.style.left = `${clientX}px`;

    menu.style.top = `${clientY}px`;

    const rect = menu.getBoundingClientRect();

    let x = clientX;

    let y = clientY;

    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }

    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }

    menu.style.left = `${Math.max(8, x)}px`;

    menu.style.top = `${Math.max(8, y)}px`;
  }

  // ============================================================
  // SHIFT + BAL KLIKK
  // ============================================================

  const originalEventClick = $calendar.fullCalendar("option", "eventClick");

  $calendar.fullCalendar(
    "option",
    "eventClick",

    function (event, jsEvent, view) {
      if (jsEvent.shiftKey) {
        jsEvent.preventDefault();
        jsEvent.stopPropagation();

        showMenu(event, jsEvent.clientX, jsEvent.clientY);

        return false;
      }

      if (typeof originalEventClick === "function") {
        return originalEventClick.call(this, event, jsEvent, view);
      }
    },
  );

  // ============================================================
  // MENÜ BEZÁRÁSA
  // ============================================================

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!menu.contains(e.target)) {
        hideMenu();
      }
    },
    true,
  );

  window.addEventListener("blur", hideMenu);

  window.addEventListener("resize", hideMenu);

  window.addEventListener("scroll", hideMenu, true);

  // ============================================================
  // A szerveroldali Yii-widget JSON eseményeit olvassuk ki. A letöltött
  // oldal JavaScript-kódját soha nem futtatjuk le.
  function extractCalendarEvents(html) {
    const marker = /"events"\s*:/.exec(html);

    if (!marker) {
      throw new Error("Nem található az events tömb.");
    }

    const valueStart = marker.index + marker[0].length;
    const arrayStart = valueStart + html.slice(valueStart).search(/\S/);

    if (html[arrayStart] !== "[") {
      throw new Error("Nem található az events tömb kezdete.");
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = arrayStart; i < html.length; i++) {
      const char = html[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === '"') {
          inString = false;
        }
        continue;
      }

      if (char === '"') {
        inString = true;
      } else if (char === "[") {
        depth++;
      } else if (char === "]" && --depth === 0) {
        const events = JSON.parse(html.slice(arrayStart, i + 1));

        if (
          events.some(
            (event) =>
              !event ||
              typeof event !== "object" ||
              Array.isArray(event) ||
              !(
                (typeof event.start === "string" && event.start.trim()) ||
                (typeof event.start === "number" &&
                  Number.isFinite(event.start))
              ),
          )
        ) {
          throw new Error(
            "Érvénytelen esemény érkezett a naptár frissítésekor.",
          );
        }

        return events;
      }
    }

    throw new Error("Az events tömb vége nem található.");
  }

  async function fetchCalendarEvents(signal) {
    const response = await fetch(CONFIG.calendarIndexUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Naptár lekérése sikertelen: ${response.status}`);
    }

    return extractCalendarEvents(await response.text());
  }

  // ============================================================
  // ESEMÉNYADATOK FRISSÍTÉSE PERCENKÉNT
  // ============================================================

  function makeEventEditable(event) {
    if (!event || typeof event !== "object") {
      return event;
    }

    return {
      ...event,
      editable: true,
      startEditable: true,
      durationEditable: false,
    };
  }

  let indexEvents = [];
  let indexSourceInstalled = false;
  let refreshErrorShown = false;
  let lastEventsSignature = null;
  let lastRenderedTimingSignature = null;

  // A JSON objektumkulcsok és az események sorrendje nem adatváltozás.
  // A mezőkön belüli tömbök sorrendjét viszont megőrizzük.
  function stableJson(value) {
    if (Array.isArray(value)) {
      return "[" + value.map(stableJson).join(",") + "]";
    }
    if (value !== null && typeof value === "object") {
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + stableJson(value[key]))
          .join(",") +
        "}"
      );
    }
    return JSON.stringify(value);
  }

  function eventsSignature(events) {
    return JSON.stringify(events.map(stableJson).sort());
  }

  function renderedTimingSignature() {
    // A helyben elmozgatott időpontot akkor is helyre kell állítani,
    // ha a szerver az előző lekéréssel azonos adatot ad vissza.
    return eventsSignature(
      $calendar.fullCalendar("clientEvents").map((event) => ({
        id: event.id ?? null,
        start: event.start?.format?.() ?? event.start ?? null,
        end: event.end?.format?.() ?? event.end ?? null,
        allDay: event.allDay ?? false,
      })),
    );
  }

  // A friss HTML az összes levelet tartalmazza. A naptár nézetváltáskor is
  // ebből a pillanatképből dolgozik, nem az induláskori statikus tömbből.
  const indexEventSource = {
    id: "__pte_calendar_index",
    events(start, end, timezone, callback) {
      callback(indexEvents.map(makeEventEditable));
    },
    eventDataTransform: makeEventEditable,
  };

  function beginCalendarAction() {
    pendingEventSaves++;
    eventMutationVersion++;
  }

  function finishCalendarAction() {
    pendingEventSaves--;
    requestCalendarRefresh();
  }

  function calendarRefreshBlocked() {
    return (
      isCalendarDragging ||
      isCalendarLayouting ||
      pendingEventSaves > 0 ||
      Boolean(selectedEvent)
    );
  }

  function requestCalendarRefresh() {
    pendingEventRefresh = true;
    scheduleEventRefresh();
  }

  function scheduleEventRefresh() {
    if (eventRefreshFlushTimer !== null) return;

    eventRefreshFlushTimer = setTimeout(() => {
      eventRefreshFlushTimer = null;
      void flushCalendarRefresh();
    }, 0);
  }

  function applyCalendarEvents(events) {
    // A felhasználó lekérés közben is lapozhat: a válasz alkalmazásakor
    // aktuális nézetet és görgetést őrizzük meg, nem egy korábbi állapotot.
    const scroller = $calendar[0].querySelector(".fc-time-grid-container");
    const scrollTop = scroller?.scrollTop;
    const scrollLeft = scroller?.scrollLeft;
    const view = $calendar.fullCalendar("getView");
    const date = $calendar.fullCalendar("getDate").valueOf();

    indexEvents = events;

    if (!indexSourceInstalled) {
      $calendar.fullCalendar("removeEventSources");
      $calendar.fullCalendar("addEventSource", indexEventSource);
      indexSourceInstalled = true;
    } else {
      $calendar.fullCalendar("refetchEventSources", [indexEventSource.id]);
    }

    const restoreScroll = () => {
      if (
        scroller?.isConnected &&
        $calendar.fullCalendar("getView") === view &&
        $calendar.fullCalendar("getDate").valueOf() === date
      ) {
        scroller.scrollTop = scrollTop;
        scroller.scrollLeft = scrollLeft;
      }
    };
    restoreScroll();
    requestAnimationFrame(restoreScroll);
  }

  async function flushCalendarRefresh() {
    if ($calendar[0]?.isConnected === false) {
      clearInterval(eventRefreshTimer);
      pendingEventRefresh = false;
      return;
    }

    if (
      !pendingEventRefresh ||
      eventRefreshInFlight ||
      calendarRefreshBlocked()
    )
      return;

    pendingEventRefresh = false;
    eventRefreshInFlight = true;
    const version = eventMutationVersion;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      CONFIG.refreshTimeoutMs,
    );

    try {
      const events = await fetchCalendarEvents(controller.signal);

      if ($calendar[0]?.isConnected === false) return;

      if (version !== eventMutationVersion || calendarRefreshBlocked()) {
        // Mentés/mozgatás indult azóta: a régi válasz nem írhatja felül.
        pendingEventRefresh = true;
        return;
      }

      const signature = eventsSignature(events);
      if (
        signature !== lastEventsSignature ||
        renderedTimingSignature() !== lastRenderedTimingSignature
      ) {
        applyCalendarEvents(events);
        lastEventsSignature = signature;
        lastRenderedTimingSignature = renderedTimingSignature();
        console.log(
          `[PTE] Naptár frissítve az indexoldalról: ${events.length} esemény`,
        );
      }
      refreshErrorShown = false;
    } catch (error) {
      console.error("[PTE] A naptáresemények frissítése sikertelen:", error);
      if (!refreshErrorShown) {
        refreshErrorShown = true;
        toast(
          "A naptár frissítése sikertelen; az eddigi események láthatók.\n" +
            error.message,
          "error",
          7000,
        );
      }
    } finally {
      clearTimeout(timeout);
      eventRefreshInFlight = false;
      if (pendingEventRefresh && !calendarRefreshBlocked())
        scheduleEventRefresh();
    }
  }

  const eventRefreshTimer = setInterval(
    requestCalendarRefresh,
    CONFIG.refreshIntervalMs,
  );

  // A külön lapon megnyitott szerkesztőből visszatérve is friss adat kell.
  window.addEventListener("focus", requestCalendarRefresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") requestCalendarRefresh();
  });

  // ============================================================
  // FULLCALENDAR ALAPBEÁLLÍTÁSOK
  // ============================================================

  $calendar.fullCalendar("option", "snapDuration", "00:15:00");

  $calendar.fullCalendar("option", "editable", true);

  $calendar.fullCalendar("option", "eventStartEditable", true);

  $calendar.fullCalendar("option", "eventDurationEditable", false);

  // ============================================================
  // DRAG FREEZE
  // ============================================================

  $calendar.fullCalendar(
    "option",
    "eventDragStart",

    function () {
      isCalendarDragging = true;
      eventMutationVersion++;

      clearTimeout(resizeTimer);

      hideMenu();

      console.log("[PTE] Drag start - layout befagyasztva");
    },
  );

  $calendar.fullCalendar(
    "option",
    "eventDragStop",

    function () {
      isCalendarDragging = false;

      console.log("[PTE] Drag stop - layout feloldva");

      // Csak a húzás alatt elhalasztott ablakméretezést pótoljuk.
      if (pendingCalendarFit) {
        scheduleCalendarFit();
      }

      // A drop/mentés ugyanebben a körben még elindulhat, ezért sorba állítjuk.
      requestCalendarRefresh();
    },
  );

  // ============================================================
  // DRAG + MENTÉS
  // ============================================================

  $calendar.fullCalendar(
    "option",
    "eventDrop",

    async function (event, delta, revertFunc) {
      const newTime = formatSendingTime(event.start);

      toast(`Mentés...\n${newTime}`, "loading", 10000);

      beginCalendarAction();

      try {
        const result = await saveEvent(event);

        toast(`✓ Mentve\n${result.sendingTime}`, "success", 3000);
      } catch (error) {
        console.error("[PTE] Valódi mentési hiba:", error);

        if (typeof revertFunc === "function") {
          revertFunc();
        }

        toast(
          "Nem sikerült elmenteni.\n\n" +
            error.message +
            "\n\n" +
            "Az esemény vissza lett helyezve.",
          "error",
          7000,
        );
      } finally {
        finishCalendarAction();
      }
    },
  );

  // ============================================================
  // EVENTEK SZERKESZTHETŐVÉ TÉTELE
  // ============================================================

  const events = $calendar.fullCalendar("clientEvents");

  for (const event of events) {
    event.editable = true;

    event.startEditable = true;

    event.durationEditable = false;
  }

  $calendar.fullCalendar("rerenderEvents");

  // ============================================================
  // DINAMIKUS LAYOUT
  // ============================================================

  // Lapozáskor az új DOM is ugyanazokat a már kiszámolt méreteket kapja.
  // Ehhez nincs szükség új mérésre vagy újraméretezési időzítőre.
  const timeGridStyle = document.createElement("style");
  document.head.appendChild(timeGridStyle);

  function findFooter() {
    return document.querySelector(
      "footer.main-footer, .main-footer, footer, .footer",
    );
  }

  // ------------------------------------------------------------
  // 48 félórás sor méretezése
  // ------------------------------------------------------------

  function stretchTimeGrid(force = false) {
    if (isCalendarDragging || isCalendarLayouting) {
      return;
    }

    const calendarElement = $calendar[0];

    if (!calendarElement) {
      return;
    }

    const scroller = calendarElement.querySelector(".fc-time-grid-container");

    const slats = calendarElement.querySelector(".fc-slats");

    const slatsTable = slats?.querySelector("table");

    if (!scroller || !slats || !slatsTable) {
      // pl. Month nézet
      return;
    }

    const rows = Array.from(slats.querySelectorAll("tbody > tr"));

    if (!rows.length) {
      return;
    }

    const availableHeight = scroller.clientHeight;

    if (!availableHeight || availableHeight <= 0) {
      return;
    }

    const naturalRowHeight = availableHeight / rows.length;

    const needsScroll = naturalRowHeight < CONFIG.minHalfHourRowHeight;

    const rowHeight = needsScroll
      ? CONFIG.minHalfHourRowHeight
      : naturalRowHeight;

    const totalGridHeight = rowHeight * rows.length;

    // --------------------------------------------------------
    // Csak akkor kell komoly újralayout,
    // ha ténylegesen változott a sormagasság.
    // --------------------------------------------------------

    const firstRowHeight = parseFloat(rows[0].style.height || "0");

    const rowChanged =
      force ||
      Math.abs(firstRowHeight - rowHeight) > 0.25 ||
      lastAppliedRowHeight === null;

    // Scroll mód ettől függetlenül helyes legyen.
    scroller.style.overflowY = needsScroll ? "auto" : "hidden";

    if (!rowChanged) {
      return;
    }

    isCalendarLayouting = true;

    try {
      lastAppliedRowHeight = rowHeight;

      timeGridStyle.textContent = `
        ${CONFIG.calendarSelector} .fc-time-grid-container {
          overflow-y: ${needsScroll ? "auto" : "hidden"} !important;
        }
        ${CONFIG.calendarSelector} .fc-slats,
        ${CONFIG.calendarSelector} .fc-slats > table {
          height: ${totalGridHeight}px;
        }
        ${CONFIG.calendarSelector} .fc-slats tbody > tr,
        ${CONFIG.calendarSelector} .fc-slats tbody > tr > td {
          height: ${rowHeight}px;
          min-height: ${rowHeight}px;
        }
      `;

      for (const row of rows) {
        row.style.height = `${rowHeight}px`;

        row.style.minHeight = `${rowHeight}px`;

        for (const cell of row.children) {
          cell.style.height = `${rowHeight}px`;

          cell.style.minHeight = `${rowHeight}px`;
        }
      }

      slats.style.height = `${totalGridHeight}px`;

      slatsTable.style.height = `${totalGridHeight}px`;

      console.log("[PTE] TimeGrid:", {
        rowCount: rows.length,

        availableHeight,

        rowHeight,

        totalGridHeight,

        needsScroll,
      });

      // FONTOS:
      // a DOM sorok magassága megváltozott.
      // A FullCalendarnak újra kell számolnia
      // a drag koordinátákat is.
      $calendar.fullCalendar("updateSize");

      $calendar.fullCalendar("rerenderEvents");
    } finally {
      requestAnimationFrame(() => {
        isCalendarLayouting = false;

        if (pendingCalendarFit && !isCalendarDragging) {
          scheduleCalendarFit();
        }

        if (pendingEventRefresh) scheduleEventRefresh();
      });
    }
  }

  // ------------------------------------------------------------
  // Teljes FullCalendar magassága
  // ------------------------------------------------------------

  function fitCalendarToViewport(force = false) {
    // Drag közben SEMMI.
    if (isCalendarDragging || isCalendarLayouting) {
      return;
    }

    const calendarElement = $calendar[0];

    if (!calendarElement) {
      return;
    }

    const calendarRect = calendarElement.getBoundingClientRect();

    const calendarTop = Math.max(0, calendarRect.top);

    let bottomLimit = window.innerHeight - CONFIG.bottomGap;

    // --------------------------------------------------------
    // Footer
    // --------------------------------------------------------

    const footer = findFooter();

    if (footer) {
      const style = window.getComputedStyle(footer);

      if (style.display !== "none" && style.visibility !== "hidden") {
        const footerRect = footer.getBoundingClientRect();

        if (
          footerRect.top > calendarTop &&
          footerRect.top < window.innerHeight
        ) {
          bottomLimit = Math.min(
            bottomLimit,

            footerRect.top - CONFIG.bottomGap,
          );
        }
      }
    }

    let availableHeight = Math.floor(bottomLimit - calendarTop);

    availableHeight = Math.max(CONFIG.minCalendarHeight, availableHeight);

    const heightChanged = availableHeight !== lastCalendarHeight;

    // --------------------------------------------------------
    // FullCalendar külső magasság
    // --------------------------------------------------------

    if (heightChanged || force) {
      lastCalendarHeight = availableHeight;

      isCalendarLayouting = true;

      try {
        $calendar.fullCalendar("option", "height", availableHeight);

        $calendar.fullCalendar("updateSize");
      } finally {
        isCalendarLayouting = false;
      }

      console.log("[PTE] Calendar height:", availableHeight);
    }

    // --------------------------------------------------------
    // A FullCalendar saját layoutja után nyújtjuk a sorokat.
    // --------------------------------------------------------

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (isCalendarDragging) {
          pendingCalendarFit = true;
          return;
        }

        stretchTimeGrid(force);
      });
    });
  }

  // ============================================================
  // DEBOUNCE
  // ============================================================

  function scheduleCalendarFit() {
    pendingCalendarFit = true;

    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(() => {
      resizeTimer = null;

      if (!isCalendarDragging && !isCalendarLayouting) {
        pendingCalendarFit = false;
        fitCalendarToViewport(true);
      }
    }, 120);
  }

  // ============================================================
  // WINDOW RESIZE / ZOOM
  // ============================================================

  window.addEventListener(
    "resize",

    (event) => {
      if (
        event.target !== window ||
        (window.innerWidth === lastViewportWidth &&
          window.innerHeight === lastViewportHeight)
      ) {
        return;
      }

      lastViewportWidth = window.innerWidth;
      lastViewportHeight = window.innerHeight;

      scheduleCalendarFit();
    },
  );

  // ============================================================
  // ELSŐ MÉRETEZÉS
  // ============================================================

  scheduleCalendarFit();

  requestCalendarRefresh();

  // ============================================================
  // DIAGNOSZTIKA
  // ============================================================

  console.table(
    events.map((event) => ({
      rawId: event.id,

      id: getNewsletterId(event),

      title: event.title,

      start: event.start?.format?.("YYYY-MM-DD HH:mm"),
    })),
  );

  console.log(
    `%c✓ PTE Naptársegéd aktív

MOZGATÁS
  sima drag
  15 perces lépések
  drag közben layout-freeze

EXTRA MENÜ
  SHIFT + bal klikk

MŰVELETEK
  +/- 15 perc
  +/- 1 hét
  pontos időpont
  teszt levél küldése
  szerkesztés
  ID másolása

DINAMIKUS LAYOUT
  kitölti az elérhető magasságot
  0–24 órás rács dinamikus
  kis ablaknál belső scroll
  egyszeri kezdeti méretezés
  utána csak window resize / zoom
  változásellenőrzés percenként és műveletek után`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  toast(
    `✓ PTE Naptársegéd aktív

Mozgatás: sima drag
Menü: SHIFT + bal klikk
Drag közben a layout zárolva van.`,
    "success",
    4500,
  );
})();
