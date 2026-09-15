(async () => {
  "use strict";

  // ============================================================
  // PTE HÍRLEVÉL NAPTÁR SEGÉD
  //
  // - 15 perces drag & drop
  // - automatikus sending_time mentés
  // - hibás HTTP redirect kezelése
  // - szerveroldali visszaellenőrzés
  // - jobb klikkes menü
  // - +/- 15 perc
  // - +/- 1 hét
  // - kézi időpont megadás
  // - szerkesztő / teszt oldal megnyitása
  // ============================================================

  const jq = window.jQuery;

  if (!jq || !jq.fn || typeof jq.fn.fullCalendar !== "function") {
    alert("Nem található az oldal jQuery / FullCalendar példánya.");
    return;
  }

  const CALENDAR_SELECTOR = "#w0";
  const $calendar = jq(CALENDAR_SELECTOR);

  if (!$calendar.length) {
    alert("Nem található a #w0 naptár.");
    return;
  }

  // ------------------------------------------------------------
  // Ne telepítsük kétszer ugyanazon az oldalon
  // ------------------------------------------------------------

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
  // Event ID:
  //
  // "7629text" -> "7629"
  // ------------------------------------------------------------

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

  // ------------------------------------------------------------
  // FullCalendar / Moment -> szerver formátum
  //
  // 2026-09-16 08:15
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
  // GET form -> URLSearchParams
  // ------------------------------------------------------------

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

      // Az eredeti form requestben az üres
      // file inputok is szerepelhetnek.
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
    const old = document.getElementById("__pte_calendar_toast");

    if (old) {
      old.remove();
    }

    const el = document.createElement("div");

    el.id = "__pte_calendar_toast";

    el.textContent = message;

    Object.assign(el.style, {
      position: "fixed",
      right: "20px",
      bottom: "20px",
      zIndex: "2147483647",
      maxWidth: "420px",
      padding: "12px 16px",
      borderRadius: "8px",
      boxShadow: "0 4px 20px rgba(0,0,0,.35)",
      fontFamily: "Arial, sans-serif",
      fontSize: "14px",
      lineHeight: "1.35",
      color: "#fff",
      background:
        type === "success" ? "#218838" : type === "error" ? "#b52b27" : "#333",
    });

    document.body.appendChild(el);

    setTimeout(() => {
      el.remove();
    }, duration);
  }

  // ============================================================
  // SZERKESZTŐ FORM LEKÉRÉSE
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
        `A szerkesztőoldal lekérése sikertelen. HTTP ${response.status}`,
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
  // MENTÉS
  // ============================================================

  async function saveEvent(event) {
    const id = getNewsletterId(event);

    if (!id) {
      throw new Error(`Nem sikerült ID-t kinyerni ebből: ${event?.id}`);
    }

    const sendingTime = formatSendingTime(event.start);

    console.log(`[PTE] #${id}: form lekérése...`);

    const { url, form } = await loadNewsletterForm(id);

    const params = formToParams(form);

    // Mindig biztosítsuk a rekord ID-ját.
    params.set("NewsLetters[id]", id);

    // CSAK az időpontot írjuk át.
    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: mentés → ${sendingTime}`);

    // --------------------------------------------------------
    // POST
    //
    // A backend nálatok a mentés után valószínűleg
    // http://... címre redirectel.
    //
    // Ez HTTPS oldalról Mixed Content miatt elbukhat,
    // miközben maga a mentés már megtörtént.
    // --------------------------------------------------------

    try {
      const postResponse = await fetch(url, {
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
        status: postResponse.status,

        type: postResponse.type,

        redirected: postResponse.redirected,

        url: postResponse.url,
      });
    } catch (error) {
      // Nálatok ez lehet pusztán a hibás
      // HTTP redirect következménye.
      console.warn(
        "[PTE] POST/redirect hiba. " + "A mentést külön ellenőrizzük.",
        error,
      );
    }

    // --------------------------------------------------------
    // Kis várakozás az adatbázis frissülésére
    // --------------------------------------------------------

    await sleep(300);

    // --------------------------------------------------------
    // ELLENŐRZÉS
    //
    // Újra lekérjük HTTPS-en ugyanazt a rekordot.
    // --------------------------------------------------------

    const verifyUrl = url + "&_pte_verify=" + Date.now();

    const verifyResponse = await fetch(verifyUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!verifyResponse.ok) {
      throw new Error(
        `A mentés ellenőrzése sikertelen. HTTP ${verifyResponse.status}`,
      );
    }

    const verifyHtml = await verifyResponse.text();

    const verifyDoc = new DOMParser().parseFromString(verifyHtml, "text/html");

    const savedInput = verifyDoc.querySelector(
      '[name="NewsLetters[sending_time]"]',
    );

    if (!savedInput) {
      throw new Error("Az ellenőrzéskor nem található a sending_time mező.");
    }

    const actual = String(savedInput.value || "").trim();

    console.log("[PTE] Ellenőrzés:", {
      id,
      wanted: sendingTime,
      actual,
    });

    if (actual !== sendingTime) {
      throw new Error(
        "A szerveren nem az új időpont szerepel.\n\n" +
          `Kért időpont: ${sendingTime}\n` +
          `Szerver: ${actual}`,
      );
    }

    console.log(
      `%c✓ #${id} mentve: ${sendingTime}`,
      "color:green;font-weight:bold",
    );

    return {
      id,
      sendingTime,
    };
  }

  // ============================================================
  // PROGRAMOZOTT ÁTHELYEZÉS
  // ============================================================

  async function shiftEvent(event, amount, unit, description) {
    if (!event || !event.start) {
      return;
    }

    const oldStart = event.start.clone ? event.start.clone() : event.start;

    const oldEnd = event.end
      ? event.end.clone
        ? event.end.clone()
        : event.end
      : null;

    try {
      // Start mozgatása
      if (typeof event.start.add === "function") {
        event.start = event.start.clone().add(amount, unit);
      } else {
        throw new Error("Az esemény kezdési ideje nem Moment objektum.");
      }

      // Endet ugyanannyival toljuk,
      // hogy a vizuális hossz megmaradjon.
      if (event.end && typeof event.end.add === "function") {
        event.end = event.end.clone().add(amount, unit);
      }

      // Azonnali UI frissítés
      $calendar.fullCalendar("updateEvent", event);

      toast(`${description}: mentés...`);

      const result = await saveEvent(event);

      toast(`✓ Mentve: ${result.sendingTime}`, "success");
    } catch (error) {
      // Visszaállítás
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      console.error("[PTE] Áthelyezési hiba:", error);

      toast("Mentési hiba: " + error.message, "error", 5000);
    }
  }

  // ============================================================
  // KÉZI IDŐPONT MEGADÁS
  // ============================================================

  async function setExactTime(event) {
    const current = formatSendingTime(event.start);

    const input = prompt(
      "Új időpont:\n\n" + "Formátum: YYYY-MM-DD HH:mm",
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

    // 15 perces kényszer
    if (newStart.minute() % 15 !== 0) {
      alert(
        "Az időpontnak 15 perces lépésre kell esnie.\n\n" +
          "Pl. :00, :15, :30 vagy :45",
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

      toast("Új időpont mentése...");

      const result = await saveEvent(event);

      toast(`✓ Mentve: ${result.sendingTime}`, "success");
    } catch (error) {
      event.start = oldStart;

      event.end = oldEnd;

      $calendar.fullCalendar("updateEvent", event);

      toast("Mentési hiba: " + error.message, "error", 5000);
    }
  }

  // ============================================================
  // SZERKESZTŐ / TESZT OLDAL
  // ============================================================

  function openEditor(event) {
    const id = getNewsletterId(event);

    if (!id) {
      alert("Nem található a hírlevél ID.");
      return;
    }

    const url = getUpdateUrl(id);

    window.open(url, "_blank");

    toast(
      "A hírlevél szerkesztőoldala megnyílt. " +
        "Innen jelenleg a normál tesztküldés használható.",
    );
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

      toast(`ID másolva: ${id}`, "success");
    } catch (_) {
      prompt("Hírlevél ID:", id);
    }
  }

  // ============================================================
  // JOBB KLIKK MENÜ
  // ============================================================

  const menu = document.createElement("div");

  menu.id = "__pte_calendar_context_menu";

  Object.assign(menu.style, {
    display: "none",
    position: "fixed",
    minWidth: "240px",
    zIndex: "2147483646",
    background: "#20272b",
    color: "#fff",
    border: "1px solid rgba(255,255,255,.15)",
    borderRadius: "7px",
    boxShadow: "0 8px 30px rgba(0,0,0,.45)",
    padding: "6px 0",
    fontFamily: "Arial, sans-serif",
    fontSize: "14px",
    userSelect: "none",
  });

  document.body.appendChild(menu);

  let contextEvent = null;

  function hideMenu() {
    menu.style.display = "none";

    contextEvent = null;
  }

  function makeMenuItem(label, action, extraStyle = {}) {
    const item = document.createElement("div");

    item.textContent = label;

    Object.assign(item.style, {
      padding: "9px 14px",
      cursor: "pointer",
      whiteSpace: "nowrap",
      ...extraStyle,
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
        console.error(error);

        toast(error.message, "error", 5000);
      }
    });

    menu.appendChild(item);
  }

  function addSeparator() {
    const sep = document.createElement("div");

    Object.assign(sep.style, {
      height: "1px",
      margin: "5px 0",
      background: "rgba(255,255,255,.15)",
    });

    menu.appendChild(sep);
  }

  function buildMenu(event) {
    menu.innerHTML = "";

    const id = getNewsletterId(event);

    const title = String(event.title || "Hírlevél");

    const header = document.createElement("div");

    header.textContent = `${title}  (#${id || "?"})`;

    Object.assign(header.style, {
      padding: "7px 14px 9px",
      maxWidth: "380px",
      fontWeight: "bold",
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
      opacity: ".85",
    });

    menu.appendChild(header);

    addSeparator();

    makeMenuItem("➕ 15 perccel később", (event) =>
      shiftEvent(event, 15, "minutes", "+15 perc"),
    );

    makeMenuItem("➖ 15 perccel korábban", (event) =>
      shiftEvent(event, -15, "minutes", "-15 perc"),
    );

    addSeparator();

    makeMenuItem("➡ 1 héttel később", (event) =>
      shiftEvent(event, 1, "week", "+1 hét"),
    );

    makeMenuItem("⬅ 1 héttel korábban", (event) =>
      shiftEvent(event, -1, "week", "-1 hét"),
    );

    makeMenuItem("🕒 Időpont megadása…", (event) => setExactTime(event));

    addSeparator();

    makeMenuItem("🧪 Teszt / szerkesztés megnyitása", (event) => {
      openEditor(event);
    });

    makeMenuItem("📋 Hírlevél ID másolása", (event) => copyId(event));
  }

  function getEventFromElement(element) {
    const $event = jq(element).closest(".fc-event");

    if (!$event.length) {
      return null;
    }

    // FullCalendar 3.x
    const seg = $event.data("fcSeg");

    if (seg && seg.event) {
      return seg.event;
    }

    return null;
  }

  jq(document).on(
    "contextmenu.__pteCalendarTools",
    `${CALENDAR_SELECTOR} .fc-event`,
    function (e) {
      const event = getEventFromElement(this);

      if (!event) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();

      contextEvent = event;

      buildMenu(event);

      menu.style.display = "block";

      // Első pozíció
      menu.style.left = e.clientX + "px";

      menu.style.top = e.clientY + "px";

      // Képernyőn belül tartjuk
      const rect = menu.getBoundingClientRect();

      let x = e.clientX;

      let y = e.clientY;

      if (x + rect.width > window.innerWidth) {
        x = window.innerWidth - rect.width - 8;
      }

      if (y + rect.height > window.innerHeight) {
        y = window.innerHeight - rect.height - 8;
      }

      menu.style.left = Math.max(8, x) + "px";

      menu.style.top = Math.max(8, y) + "px";
    },
  );

  jq(document).on("mousedown.__pteCalendarTools", function (e) {
    if (!menu.contains(e.target)) {
      hideMenu();
    }
  });

  jq(window).on(
    "blur.__pteCalendarTools resize.__pteCalendarTools scroll.__pteCalendarTools",
    hideMenu,
  );

  // ============================================================
  // FULLCALENDAR BEÁLLÍTÁS
  // ============================================================

  $calendar.fullCalendar("option", "snapDuration", "00:15:00");

  $calendar.fullCalendar("option", "editable", true);

  $calendar.fullCalendar("option", "eventStartEditable", true);

  // Az event hosszát nem akarjuk egérrel módosítani.
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

      toast(`Mentés: ${newTime}...`);

      try {
        const result = await saveEvent(event);

        // FONTOS:
        // itt már NEM revertelünk a hibás redirect miatt,
        // mert saveEvent külön ellenőrzi a szerveren.
        toast(`✓ Mentve: ${result.sendingTime}`, "success");
      } catch (error) {
        console.error("[PTE] Valódi mentési hiba:", error);

        if (typeof revertFunc === "function") {
          revertFunc();
        }

        toast(
          "Nem sikerült elmenteni. " +
            "Az esemény vissza lett helyezve.\n" +
            error.message,
          "error",
          6000,
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
- 15 perces drag
- automatikus mentés
- jobb klikk menü
- +/- 1 hét
- kézi időpont`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  toast(`✓ PTE Naptársegéd aktív (${events.length} esemény)`, "success", 3500);
})();
