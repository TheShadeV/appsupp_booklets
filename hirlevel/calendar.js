(async () => {
  "use strict";

  // ============================================================
  // PTE HÍRLEVÉL NAPTÁR SEGÉD
  //
  // Funkciók:
  //  - 15 perces drag & drop
  //  - automatikus sending_time mentés
  //  - hibás HTTP redirect tolerálása
  //  - szerveroldali mentés-visszaellenőrzés
  //  - YYYY-MM-DD HH:mm / YYYY-MM-DDTHH:mm normalizálás
  //  - jobb klikkes menü
  //  - Shift + bal klikk menü
  //  - Alt + bal klikk menü
  //  - +/- 15 perc
  //  - +/- 1 hét
  //  - pontos időpont megadása
  //  - szerkesztőoldal megnyitása
  //  - ID másolása
  // ============================================================

  // ============================================================
  // BEÁLLÍTÁSOK
  // ============================================================

  const CONFIG = {
    calendarSelector: "#w0",

    // Ha false, a natív jobb klikk menü megmarad,
    // és csak Shift/Alt + bal klikk használható.
    enableRightClickMenu: true,

    // Shift + bal klikk
    enableShiftClickMenu: true,

    // Alt + bal klikk
    enableAltClickMenu: true,

    // Mentés ellenőrzési próbálkozások
    verifyAttempts: 4,

    // Próbálkozások közti idő
    verifyDelayMs: 300,
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
    alert("A PTE naptársegéd már aktív ezen az oldalon.");

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
  // Update URL
  // ------------------------------------------------------------

  function getUpdateUrl(id) {
    return (
      "https://hirlevel.pte.hu/" +
      "news-letters/update?id=" +
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
  // FONTOS JAVÍTÁS:
  //
  // 2026-09-20T13:15
  // 2026-09-20 13:15
  // 2026-09-20T13:15:00
  //
  // mind:
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

      // File input:
      // az eredeti requestben is üres mezőként szerepelhet
      if (type === "file") {
        params.append(name, "");

        continue;
      }

      // Nem kiválasztott checkbox/radio
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

      maxWidth: "430px",

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

    setTimeout(() => el.remove(), duration);
  }

  // ============================================================
  // FORM BETÖLTÉSE
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
  // SZERVEROLDALI ELLENŐRZÉS
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
  // MENTÉS
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

    // Biztos rekord ID
    params.set("NewsLetters[id]", id);

    // Csak a küldési időt módosítjuk
    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: mentés → ${sendingTime}`);

    // --------------------------------------------------------
    // POST
    //
    // A szerver mentés után hibás HTTP redirectet adhat.
    //
    // redirect: manual miatt nem próbáljuk követni.
    // A tényleges eredményt UTÁNA külön GET-tel ellenőrizzük.
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
      // Ez önmagában még NEM mentési hiba.
      //
      // Lehet csak a HTTPS -> HTTP redirect problémája.

      console.warn(
        "[PTE] POST/redirect fetch hiba. " + "A mentést külön ellenőrizzük.",
        error,
      );
    }

    // --------------------------------------------------------
    // Külön ellenőrizzük a szerveren
    // --------------------------------------------------------

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
  // IDŐPONT PROGRAMOZOTT ELTOLÁSA
  // ============================================================

  async function shiftEvent(event, amount, unit, description) {
    if (!event || !event.start) {
      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

    try {
      event.start = event.start.clone().add(amount, unit);

      // Az event vizuális hosszát is megtartjuk
      if (event.end) {
        event.end = event.end.clone().add(amount, unit);
      }

      // UI azonnali frissítése
      $calendar.fullCalendar("updateEvent", event);

      toast(`${description}\nMentés...`, "loading");

      const result = await saveEvent(event);

      toast(`✓ Mentve\n${result.sendingTime}`, "success", 3000);
    } catch (error) {
      // Sikertelen valódi mentésnél vissza
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      console.error("[PTE] Áthelyezési hiba:", error);

      toast("Mentési hiba.\n" + error.message, "error", 6000);
    }
  }

  // ============================================================
  // PONTOS IDŐPONT MEGADÁSA
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
          "Engedélyezett percek:\n" +
          ":00\n:15\n:30\n:45",
      );

      return;
    }

    const oldStart = event.start.clone();

    const oldEnd = event.end ? event.end.clone() : null;

    // Eredeti időtartam
    const durationMs = event.end ? event.end.diff(event.start) : null;

    try {
      event.start = newStart;

      if (durationMs !== null) {
        event.end = newStart.clone().add(durationMs, "milliseconds");
      }

      $calendar.fullCalendar("updateEvent", event);

      toast("Új időpont mentése...", "loading");

      const result = await saveEvent(event);

      toast(`✓ Mentve\n${result.sendingTime}`, "success", 3000);
    } catch (error) {
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      console.error("[PTE] Pontos időpont mentési hiba:", error);

      toast("Mentési hiba.\n" + error.message, "error", 6000);
    }
  }

  // ============================================================
  // SZERKESZTŐOLDAL
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
  // CONTEXT MENU LÉTREHOZÁSA
  // ============================================================

  const menu = document.createElement("div");

  menu.id = "__pte_calendar_context_menu";

  Object.assign(menu.style, {
    display: "none",

    position: "fixed",

    minWidth: "260px",

    maxWidth: "420px",

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

  let contextEvent = null;

  // ============================================================
  // MENÜ SEGÉDFÜGGVÉNYEK
  // ============================================================

  function hideMenu() {
    menu.style.display = "none";

    contextEvent = null;
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

      const event = contextEvent;

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
      padding: "8px 14px 10px",

      fontWeight: "bold",

      overflow: "hidden",

      textOverflow: "ellipsis",

      whiteSpace: "nowrap",

      opacity: ".9",
    });

    menu.appendChild(header);

    // Aktuális idő
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

    makeMenuItem("🧪 Teszt / szerkesztés megnyitása", (event) => {
      openEditor(event);
    });

    makeMenuItem("📋 Hírlevél ID másolása", (event) => copyId(event));
  }

  // ============================================================
  // MENÜ POZICIONÁLÁSA
  // ============================================================

  function showMenu(event, clientX, clientY) {
    contextEvent = event;

    buildMenu(event);

    menu.style.display = "block";

    // Ideiglenes pozíció
    menu.style.left = `${clientX}px`;

    menu.style.top = `${clientY}px`;

    const rect = menu.getBoundingClientRect();

    let x = clientX;

    let y = clientY;

    // Jobb szélen belül tartás
    if (x + rect.width > window.innerWidth) {
      x = window.innerWidth - rect.width - 8;
    }

    // Alsó szélen belül tartás
    if (y + rect.height > window.innerHeight) {
      y = window.innerHeight - rect.height - 8;
    }

    menu.style.left = `${Math.max(8, x)}px`;

    menu.style.top = `${Math.max(8, y)}px`;
  }

  // ============================================================
  // JOBB KLIKK
  //
  // Capture phase!
  //
  // Ez hamarabb kapja meg az eseményt, mint az oldal legtöbb
  // saját contextmenu handlere.
  // ============================================================

  function handleContextMenuCapture(e) {
    if (!CONFIG.enableRightClickMenu) {
      return;
    }

    const target = e.target.closest?.(`${CONFIG.calendarSelector} .fc-event`);

    if (!target) {
      return;
    }

    // FONTOS:
    // a böngésző normál context menüjét tiltjuk
    e.preventDefault();

    // az oldal saját contextmenu eseményét se engedjük tovább
    e.stopPropagation();

    if (typeof e.stopImmediatePropagation === "function") {
      e.stopImmediatePropagation();
    }

    const $target = jq(target);

    const seg = $target.data("fcSeg");

    const event = seg?.event;

    if (!event) {
      console.warn(
        "[PTE] Nem sikerült az eventet kinyerni a DOM elemből.",
        target,
      );

      toast(
        "Nem sikerült az esemény adatait lekérni.\n" +
          "Használd a Shift + bal klikket.",
        "error",
        4000,
      );

      return;
    }

    showMenu(event, e.clientX, e.clientY);
  }

  document.addEventListener("contextmenu", handleContextMenuCapture, true);

  // ============================================================
  // SHIFT / ALT + BAL KLIKK
  //
  // Ez a megbízhatóbb alternatíva.
  //
  // FullCalendar közvetlenül átadja az event objektumot,
  // tehát nincs szükség DOM -> event visszakeresésre.
  // ============================================================

  const originalEventClick = $calendar.fullCalendar("option", "eventClick");

  $calendar.fullCalendar(
    "option",
    "eventClick",

    function (event, jsEvent, view) {
      const openWithShift = CONFIG.enableShiftClickMenu && jsEvent.shiftKey;

      const openWithAlt = CONFIG.enableAltClickMenu && jsEvent.altKey;

      if (openWithShift || openWithAlt) {
        jsEvent.preventDefault();
        jsEvent.stopPropagation();

        showMenu(event, jsEvent.clientX, jsEvent.clientY);

        return false;
      }

      // Ha eredetileg volt eventClick handler,
      // normál klikk esetén meghagyjuk.
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

  // Resize most ne módosítsa a levél időtartamát
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

      toast(`Mentés...\n${newTime}`, "loading");

      try {
        const result = await saveEvent(event);

        // FONTOS:
        // csak valódi ellenőrzési hiba esetén revertelünk.

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

Drag:
  15 perces pontosság

Extra menü:
  jobb klikk
  Shift + bal klikk
  Alt + bal klikk

Műveletek:
  +/- 15 perc
  +/- 1 hét
  pontos időpont
  szerkesztés
  ID másolás`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  toast(
    `✓ PTE Naptársegéd aktív

Drag: 15 perces lépések
Menü: jobb klikk vagy Shift + bal klikk`,
    "success",
    4500,
  );
})();
