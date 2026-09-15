(async () => {
  "use strict";

  // ============================================================
  // PTE HÍRLEVÉL NAPTÁR SEGÉD
  //
  // ✓ 15 perces drag & drop
  // ✓ automatikus sending_time mentés
  // ✓ redirect hiba tolerálása
  // ✓ szerveroldali visszaellenőrzés
  // ✓ Shift + bal klikk menü
  // ✓ +/- 15 perc
  // ✓ +/- 1 hét
  // ✓ pontos időpont megadása
  // ✓ teszt levél küldése
  // ✓ szerkesztés
  // ✓ ID másolás
  // ✓ dinamikus naptármagasság
  // ✓ dinamikusan széthúzott 0–24 órás rács
  // ✓ resize / zoom / sidebar kezelés
  // ============================================================

  // ============================================================
  // CONFIG
  // ============================================================

  const CONFIG = {
    calendarSelector: "#w0",

    verifyAttempts: 4,
    verifyDelayMs: 300,

    bottomGap: 8,

    // A teljes FullCalendar minimum magassága
    minCalendarHeight: 380,

    // Egy félórás sor ennél ne legyen alacsonyabb.
    // Kis ablaknál inkább scrollozunk.
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
      "A PTE naptársegéd már aktív.\n\n" + "Újraindításhoz előbb nyomj F5-öt.",
    );

    return;
  }

  window.__PTE_CALENDAR_TOOLS_ACTIVE__ = true;

  // ============================================================
  // SEGÉDEK
  // ============================================================

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // "7629text" -> "7629"
  function getNewsletterId(event) {
    const raw = String(event?.id ?? "");

    const match = raw.match(/^(\d+)/);

    return match ? match[1] : null;
  }

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

      if (type === "file") {
        params.append(name, "");

        continue;
      }

      if ((type === "checkbox" || type === "radio") && !control.checked) {
        continue;
      }

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

    console.log(`[PTE] #${id}: szerkesztő form lekérése...`);

    const { url, form } = await loadNewsletterForm(id);

    const params = formToParams(form);

    params.set("NewsLetters[id]", id);

    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: mentés → ${sendingTime}`);

    // A szerver a sikeres mentés után HTTP-re
    // redirectelhet. Maga a mentés ettől még sikeres.
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

        url: response.url,
      });
    } catch (error) {
      console.warn(
        "[PTE] POST/redirect hiba. " +
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
  // +/- IDŐPONT
  // ============================================================

  async function shiftEvent(event, amount, unit, description) {
    if (!event || !event.start) {
      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

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

    console.log(`[PTE] Tesztküldés: #${id}`, url);

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

        url: response.url,
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
      console.warn("[PTE] Tesztküldés/redirect hiba:", error);

      toast(
        "A tesztküldési kérés elindult, " +
          "de a válasz nem volt ellenőrizhető.\n\n" +
          "Lehetséges, hogy a szerver redirectje blokkolódott.",
        "error",
        7000,
      );
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
      }
    });

    menu.appendChild(item);
  }

  function buildMenu(event) {
    menu.innerHTML = "";

    const id = getNewsletterId(event);

    const title = String(event.title || "Hírlevél");

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

    const time = document.createElement("div");

    time.textContent = formatSendingTime(event.start);

    Object.assign(time.style, {
      padding: "0 14px 8px",

      fontSize: "12px",

      opacity: ".65",
    });

    menu.appendChild(time);

    addSeparator();

    makeMenuItem("＋ 15 perccel később", (event) =>
      shiftEvent(event, 15, "minutes", "+15 perc"),
    );

    makeMenuItem("− 15 perccel korábban", (event) =>
      shiftEvent(event, -15, "minutes", "-15 perc"),
    );

    addSeparator();

    makeMenuItem("➡ 1 héttel később", (event) =>
      shiftEvent(event, 1, "week", "+1 hét"),
    );

    makeMenuItem("⬅ 1 héttel korábban", (event) =>
      shiftEvent(event, -1, "week", "-1 hét"),
    );

    makeMenuItem("🕒 Pontos időpont megadása…", (event) => setExactTime(event));

    addSeparator();

    makeMenuItem("🧪 Teszt levél küldése", (event) =>
      sendTestNewsletter(event),
    );

    makeMenuItem("✏️ Szerkesztés", (event) => openEditor(event));

    addSeparator();

    makeMenuItem("📋 Hírlevél ID másolása", (event) => copyId(event));
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
  // FULLCALENDAR
  // ============================================================

  $calendar.fullCalendar("option", "snapDuration", "00:15:00");

  $calendar.fullCalendar("option", "editable", true);

  $calendar.fullCalendar("option", "eventStartEditable", true);

  $calendar.fullCalendar("option", "eventDurationEditable", false);

  // ============================================================
  // DRAG
  // ============================================================

  $calendar.fullCalendar(
    "option",
    "eventDrop",

    async function (event, delta, revertFunc, jsEvent, ui, view) {
      const newTime = formatSendingTime(event.start);

      toast(`Mentés...\n${newTime}`, "loading", 10000);

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
  // DINAMIKUS NAPTÁR + 0-24 ÓRÁS RÁCS
  // ============================================================

  let lastCalendarHeight = null;

  let resizeTimer = null;

  let gridResizeRunning = false;

  function findFooter() {
    return document.querySelector(
      "footer.main-footer, .main-footer, footer, .footer",
    );
  }

  // ------------------------------------------------------------
  // MAGÁNAK A 48 FÉLÓRÁS SORNAK A MÉRETEZÉSE
  // ------------------------------------------------------------

  function stretchTimeGrid() {
    if (gridResizeRunning) {
      return;
    }

    gridResizeRunning = true;

    try {
      const calendarElement = $calendar[0];

      if (!calendarElement) {
        return;
      }

      // Month nézetben nincs time grid.
      const scroller = calendarElement.querySelector(".fc-time-grid-container");

      const timeGrid = calendarElement.querySelector(".fc-time-grid");

      const slats = calendarElement.querySelector(".fc-slats");

      const slatsTable = slats?.querySelector("table");

      if (!scroller || !timeGrid || !slats || !slatsTable) {
        return;
      }

      const rows = Array.from(slats.querySelectorAll("tbody > tr"));

      if (!rows.length) {
        return;
      }

      // Scrollpozíció megőrzése kis képernyőn
      const oldScrollHeight = scroller.scrollHeight;

      const oldScrollTop = scroller.scrollTop;

      const scrollRatio =
        oldScrollHeight > 0 ? oldScrollTop / oldScrollHeight : 0;

      // Régi saját méretezés törlése.
      for (const row of rows) {
        row.style.height = "";
        row.style.minHeight = "";

        for (const cell of row.children) {
          cell.style.height = "";
          cell.style.minHeight = "";
        }
      }

      slats.style.height = "";
      slatsTable.style.height = "";
      timeGrid.style.minHeight = "";

      const availableHeight = scroller.clientHeight;

      if (!availableHeight || availableHeight <= 0) {
        return;
      }

      // 48 félórás sor.
      const calculatedRowHeight = availableHeight / rows.length;

      const rowHeight = Math.max(
        CONFIG.minHalfHourRowHeight,
        calculatedRowHeight,
      );

      const wantedGridHeight = rowHeight * rows.length;

      // ----------------------------------------------------
      // Sorok tényleges magassága
      // ----------------------------------------------------

      for (const row of rows) {
        row.style.height = `${rowHeight}px`;

        row.style.minHeight = `${rowHeight}px`;

        for (const cell of row.children) {
          cell.style.height = `${rowHeight}px`;

          cell.style.minHeight = `${rowHeight}px`;
        }
      }

      slats.style.height = `${wantedGridHeight}px`;

      slatsTable.style.height = `${wantedGridHeight}px`;

      timeGrid.style.minHeight = `${wantedGridHeight}px`;

      // ----------------------------------------------------
      // Nagy kijelzőn nincs függőleges scroll.
      //
      // Kis kijelzőn megtartjuk a minimum sormagasságot
      // és scrollozunk.
      // ----------------------------------------------------

      if (wantedGridHeight > availableHeight + 1) {
        scroller.style.overflowY = "auto";
      } else {
        scroller.style.overflowY = "hidden";

        scroller.scrollTop = 0;
      }

      console.log("[PTE] Dinamikus TimeGrid:", {
        rowCount: rows.length,

        availableHeight,

        calculatedRowHeight,

        appliedRowHeight: rowHeight,

        wantedGridHeight,

        scroll: wantedGridHeight > availableHeight + 1,
      });

      // A sorok koordinátái megváltoztak,
      // ezért az eseményeket újrarajzoljuk.
      $calendar.fullCalendar("rerenderEvents");

      // Kis kijelzőn scrollpozíció visszaállítása
      if (wantedGridHeight > availableHeight + 1 && scrollRatio > 0) {
        requestAnimationFrame(() => {
          scroller.scrollTop = Math.round(scroller.scrollHeight * scrollRatio);
        });
      }
    } finally {
      gridResizeRunning = false;
    }
  }

  // ------------------------------------------------------------
  // FULLCALENDAR KÜLSŐ MAGASSÁG
  // ------------------------------------------------------------

  function fitCalendarToViewport() {
    const calendarElement = $calendar[0];

    if (!calendarElement) {
      return;
    }

    const calendarRect = calendarElement.getBoundingClientRect();

    const calendarTop = Math.max(0, calendarRect.top);

    // Alapeset:
    // viewport aljáig.
    let bottomLimit = window.innerHeight - CONFIG.bottomGap;

    // Ha a footer éppen a viewportban van,
    // annak tetejéig.
    const footer = findFooter();

    if (footer) {
      const footerStyle = window.getComputedStyle(footer);

      if (
        footerStyle.display !== "none" &&
        footerStyle.visibility !== "hidden"
      ) {
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

    if (availableHeight !== lastCalendarHeight) {
      lastCalendarHeight = availableHeight;

      $calendar.fullCalendar("option", "height", availableHeight);

      console.log("[PTE] Calendar magasság:", {
        viewportHeight: window.innerHeight,

        calendarTop,

        bottomLimit,

        calendarHeight: availableHeight,
      });
    }

    $calendar.fullCalendar("updateSize");

    // FullCalendar előbb fejezze be a saját layoutját.
    requestAnimationFrame(() => {
      stretchTimeGrid();
    });
  }

  function scheduleCalendarFit(delay = 80) {
    clearTimeout(resizeTimer);

    resizeTimer = setTimeout(fitCalendarToViewport, delay);
  }

  // ============================================================
  // RESIZE / ZOOM
  // ============================================================

  window.addEventListener("resize", () => {
    scheduleCalendarFit(60);
  });

  window.addEventListener("orientationchange", () => {
    scheduleCalendarFit(200);
  });

  // ============================================================
  // SIDEBAR / SZÉLESSÉGVÁLTOZÁS
  // ============================================================

  function getCalendarParent() {
    const element = $calendar[0];

    return element?.parentElement || document.body;
  }

  let lastObservedWidth = null;

  if (typeof ResizeObserver !== "undefined") {
    const parent = getCalendarParent();

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || !entries.length) {
        return;
      }

      const width = Math.round(entries[0].contentRect.width);

      // Csak szélességváltozásra,
      // hogy ne legyen resize loop.
      if (width !== lastObservedWidth) {
        lastObservedWidth = width;

        scheduleCalendarFit(60);
      }
    });

    resizeObserver.observe(parent);

    window.__PTE_CALENDAR_RESIZE_OBSERVER__ = resizeObserver;
  }

  // ============================================================
  // ADMINLTE SIDEBAR CLASS VÁLTOZÁS
  // ============================================================

  if (typeof MutationObserver !== "undefined") {
    const bodyObserver = new MutationObserver(() => {
      scheduleCalendarFit(50);

      setTimeout(fitCalendarToViewport, 250);

      setTimeout(fitCalendarToViewport, 450);
    });

    bodyObserver.observe(document.body, {
      attributes: true,

      attributeFilter: ["class"],
    });

    window.__PTE_CALENDAR_BODY_OBSERVER__ = bodyObserver;
  }

  // ============================================================
  // NAPTÁR NAVIGÁCIÓ
  // ============================================================

  jq(document).on(
    "click.__pteCalendarFit",

    [
      `${CONFIG.calendarSelector} .fc-prev-button`,
      `${CONFIG.calendarSelector} .fc-next-button`,
      `${CONFIG.calendarSelector} .fc-today-button`,
      `${CONFIG.calendarSelector} .fc-agendaDay-button`,
      `${CONFIG.calendarSelector} .fc-agendaWeek-button`,
      `${CONFIG.calendarSelector} .fc-month-button`,
    ].join(","),

    () => {
      scheduleCalendarFit(80);

      setTimeout(fitCalendarToViewport, 250);

      setTimeout(fitCalendarToViewport, 500);
    },
  );

  // ============================================================
  // ELSŐ DINAMIKUS MÉRETEZÉSEK
  // ============================================================

  setTimeout(fitCalendarToViewport, 0);

  setTimeout(fitCalendarToViewport, 100);

  setTimeout(fitCalendarToViewport, 300);

  setTimeout(fitCalendarToViewport, 700);

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
  naptár kitölti az elérhető magasságot
  0–24 órás rács is kitölti a naptárat
  kis ablaknál automatikus scroll
  resize / zoom / sidebar támogatás`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  toast(
    `✓ PTE Naptársegéd aktív

Mozgatás: sima drag
Menü: SHIFT + bal klikk
Naptár: dinamikus 0–24 órás rács`,
    "success",
    4500,
  );
})();
