(async () => {
  "use strict";

  // ============================================================
  // PTE HÍRLEVÉL NAPTÁR SEGÉD
  //
  // FUNKCIÓK
  // ------------------------------------------------------------
  // ✓ 15 perces drag & drop
  // ✓ automatikus sending_time mentés
  // ✓ HTTP redirect hiba tolerálása
  // ✓ szerveroldali mentés-visszaellenőrzés
  // ✓ Shift + bal klikk extra menü
  // ✓ +/- 15 perc
  // ✓ +/- 1 hét
  // ✓ pontos időpont megadása
  // ✓ teszt levél küldése
  // ✓ szerkesztés megnyitása
  // ✓ ID másolása
  // ✓ automatikus naptármagasság
  // ✓ resize / zoom / sidebar kezelés
  // ============================================================

  // ============================================================
  // BEÁLLÍTÁSOK
  // ============================================================

  const CONFIG = {
    calendarSelector: "#w0",

    verifyAttempts: 4,
    verifyDelayMs: 300,

    bottomGap: 8,

    // Kisebb képernyőn ez alatt már inkább
    // a naptár saját scrollját használjuk.
    minCalendarHeight: 380,
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
  // DUPLA FUTTATÁS VÉDELEM
  // ============================================================

  if (window.__PTE_CALENDAR_TOOLS_ACTIVE__) {
    alert(
      "A PTE naptársegéd már aktív.\n\n" +
        "Ha újra szeretnéd indítani, nyomj F5-öt.",
    );

    return;
  }

  window.__PTE_CALENDAR_TOOLS_ACTIVE__ = true;

  // ============================================================
  // SEGÉDFÜGGVÉNYEK
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
  // Szerkesztés URL
  // ------------------------------------------------------------

  function getUpdateUrl(id) {
    return (
      "https://hirlevel.pte.hu/" +
      "news-letters/update?id=" +
      encodeURIComponent(id)
    );
  }

  // ------------------------------------------------------------
  // Tesztküldés URL
  // ------------------------------------------------------------

  function getTestUrl(id) {
    return (
      "https://hirlevel.pte.hu/" +
      "news-letters/test?id=" +
      encodeURIComponent(id)
    );
  }

  // ------------------------------------------------------------
  // Moment -> YYYY-MM-DD HH:mm
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
  // Időpont normalizálás
  //
  // 2026-09-20T13:15
  // 2026-09-20 13:15
  // 2026-09-20T13:15:00
  //
  // mind ->
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

      // File inputok
      if (type === "file") {
        params.append(name, "");

        continue;
      }

      // Nem kiválasztott checkbox / radio
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
        throw new Error("Az ellenőrzéskor nem található a sending_time mező.");
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
  // HÍRLEVÉL IDŐPONT MENTÉSE
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

    // Csak ezt változtatjuk.
    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: mentés → ${sendingTime}`);

    // --------------------------------------------------------
    // POST
    //
    // A backend mentés után HTTP URL-re redirectelhet,
    // amit HTTPS oldalról a böngésző blokkol.
    //
    // Ettől a mentés még megtörténik.
    // Ezért külön GET-tel ellenőrizzük.
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

        url: response.url,
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
  // IDŐPONT ELTOLÁSA
  // ============================================================

  async function shiftEvent(event, amount, unit, description) {
    if (!event || !event.start) {
      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

    try {
      event.start = event.start.clone().add(amount, unit);

      // Az esemény vizuális hosszát is megtartjuk.
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

    const momentLib = window.moment;

    if (typeof momentLib !== "function") {
      alert("A Moment.js nem található.");

      return;
    }

    const newStart = momentLib(value, "YYYY-MM-DD HH:mm", true);

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
  // TESZT LEVÉL KÜLDÉSE
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

      // Normál válasz vagy manual redirect.
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

      // Ugyanaz a helyzet előfordulhat, mint a mentésnél:
      // a GET lefut, majd a redirect blokkolódik.
      //
      // Itt nincs egyszerű szerveres mező, amivel biztosan
      // vissza tudjuk ellenőrizni, hogy az email elküldődött-e.

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
  // ID MÁSOLÁS
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
  // EXTRA MENÜ
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

  // ============================================================
  // MENÜ SEGÉDEK
  // ============================================================

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

  function makeMenuItem(label, action, options = {}) {
    const item = document.createElement("div");

    item.textContent = label;

    Object.assign(item.style, {
      padding: "9px 14px",

      cursor: "pointer",

      whiteSpace: "nowrap",

      color: options.color || "#fff",
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

  // ============================================================
  // MENÜ FELÉPÍTÉSE
  // ============================================================

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

      opacity: ".95",
    });

    menu.appendChild(header);

    // --------------------------------------------------------
    // Aktuális időpont
    // --------------------------------------------------------

    const time = document.createElement("div");

    time.textContent = formatSendingTime(event.start);

    Object.assign(time.style, {
      padding: "0 14px 8px",

      fontSize: "12px",

      opacity: ".65",
    });

    menu.appendChild(time);

    // --------------------------------------------------------
    // Mozgatás
    // --------------------------------------------------------

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

    // --------------------------------------------------------
    // Hírlevél műveletek
    // --------------------------------------------------------

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

  // ============================================================
  // MENÜ MEGJELENÍTÉSE
  // ============================================================

  function showMenu(event, clientX, clientY) {
    selectedEvent = event;

    buildMenu(event);

    menu.style.display = "block";

    menu.style.left = `${clientX}px`;

    menu.style.top = `${clientY}px`;

    const rect = menu.getBoundingClientRect();

    let x = clientX;

    let y = clientY;

    // Jobb szélen ne lógjon ki.
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }

    // Alul se lógjon ki.
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
      // ----------------------------------------------------
      // SHIFT + BAL KLIKK -> saját menü
      // ----------------------------------------------------

      if (jsEvent.shiftKey) {
        jsEvent.preventDefault();
        jsEvent.stopPropagation();

        showMenu(event, jsEvent.clientX, jsEvent.clientY);

        return false;
      }

      // ----------------------------------------------------
      // Normál klikk -> eredeti működés
      // ----------------------------------------------------

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
  // FULLCALENDAR BEÁLLÍTÁSOK
  // ============================================================

  $calendar.fullCalendar("option", "snapDuration", "00:15:00");

  $calendar.fullCalendar("option", "editable", true);

  $calendar.fullCalendar("option", "eventStartEditable", true);

  // Az esemény végét nem engedjük resize-olni.
  $calendar.fullCalendar("option", "eventDurationEditable", false);

  // ============================================================
  // DRAG & DROP
  // ============================================================

  $calendar.fullCalendar(
    "option",
    "eventDrop",

    async function (event, delta, revertFunc, jsEvent, ui, view) {
      const id = getNewsletterId(event);

      const newTime = formatSendingTime(event.start);

      console.log("[PTE] Drag:", {
        id,

        rawId: event.id,

        title: event.title,

        newTime,
      });

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
  // JELENLEGI EVENTEK ENGEDÉLYEZÉSE
  // ============================================================

  const events = $calendar.fullCalendar("clientEvents");

  for (const event of events) {
    event.editable = true;

    event.startEditable = true;

    event.durationEditable = false;
  }

  $calendar.fullCalendar("rerenderEvents");

  // ============================================================
  // AUTOMATIKUS NAPTÁRMAGASSÁG
  // ============================================================

  let lastCalendarHeight = null;

  let resizeTimer = null;

  function findFooter() {
    return document.querySelector(
      "footer.main-footer, .main-footer, footer, .footer",
    );
  }

  function fitCalendarToViewport() {
    const calendarElement = $calendar[0];

    if (!calendarElement) {
      return;
    }

    const calendarRect = calendarElement.getBoundingClientRect();

    const calendarTop = Math.max(0, calendarRect.top);

    // Alapesetben a viewport aljáig mehetünk.
    let bottomLimit = window.innerHeight - CONFIG.bottomGap;

    // Ha a footer jelenleg ténylegesen a viewportban van
    // és a naptár alatt kezdődik, akkor addig nyújtjuk.
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

      console.log("[PTE] Calendar méretezés:", {
        viewportHeight: window.innerHeight,

        calendarTop,

        bottomLimit,

        calendarHeight: availableHeight,
      });

      $calendar.fullCalendar("option", "height", availableHeight);
    }

    // Szélességi layoutot is frissítjük.
    $calendar.fullCalendar("updateSize");
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

  // ============================================================
  // MOBIL / TABLET FORGATÁS
  // ============================================================

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

      // Csak szélességváltozásra reagálunk,
      // hogy ne legyen ResizeObserver loop.
      if (width !== lastObservedWidth) {
        lastObservedWidth = width;

        scheduleCalendarFit(50);
      }
    });

    resizeObserver.observe(parent);

    window.__PTE_CALENDAR_RESIZE_OBSERVER__ = resizeObserver;
  }

  // ============================================================
  // ADMINLTE / BODY CLASS VÁLTOZÁS
  //
  // pl. sidebar collapse
  // ============================================================

  if (typeof MutationObserver !== "undefined") {
    const bodyObserver = new MutationObserver(() => {
      scheduleCalendarFit(50);

      // Sidebar animáció miatt később is
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
  // NAPTÁR NAVIGÁCIÓ UTÁN ÚJRAMÉRETEZÉS
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
    },
  );

  // ============================================================
  // ELSŐ MÉRETEZÉS
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

LAYOUT
  automatikus naptármagasság
  resize / zoom
  sidebar ki/be`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  toast(
    `✓ PTE Naptársegéd aktív

Mozgatás: sima drag
Menü: SHIFT + bal klikk
Naptárméret: automatikus`,
    "success",
    4500,
  );
})();
