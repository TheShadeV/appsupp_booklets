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
  // ✓ fix fejléc és lábléc, közöttük görgethető tartalom
  // ✓ saját színek, böngészőben mentett megjelenés
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

  function getNavigationUrl(value) {
    if (typeof value !== "string" || !value.trim() || value.trim().startsWith("#")) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      if (url.hash && url.origin === location.origin &&
          url.pathname === location.pathname && url.search === location.search) return null;
      return url;
    } catch {
      return null;
    }
  }

  function isLogoutLink(link, url) {
    const route = url.pathname + "/" + (url.searchParams.get("r") || "");
    const label = [link?.textContent, link?.getAttribute("aria-label"), link?.title].filter(Boolean).join(" ");
    return /(?:^|\/)(?:log-?out|sign-?out)(?:\/|$)/i.test(route) ||
      /kijelentkez|\blog\s*out\b|\bsign\s*out\b/i.test(label);
  }

  function installNewTabLinks() {
    function prepareLink(link) {
      const url = getNavigationUrl(link.getAttribute("href"));
      if (!url) return false;
      if (isLogoutLink(link, url)) {
        if (link.target !== "_self") link.target = "_self";
        return false;
      }
      if (link.matches("[data-toggle], [data-bs-toggle], [data-widget], .dropdown-toggle, [role=button]") ||
          (link.parentElement?.classList.contains("treeview") &&
           link.parentElement.querySelector(".treeview-menu"))) return false;
      if (link.target !== "_blank") link.target = "_blank";
      link.relList.add("noopener");
      link.setAttribute("data-pjax", "0");
      return true;
    }
    function prepareTree(root) {
      if (root.nodeType !== 1) return;
      if (root.matches("a[href]")) prepareLink(root);
      root.querySelectorAll("a[href]").forEach(prepareLink);
    }
    prepareTree(document.body);
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (record.target.matches("a[href]")) prepareLink(record.target);
        } else {
          record.addedNodes.forEach(prepareTree);
        }
      }
    });
    observer.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ["href", "target"],
    });
    document.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href]");
      if (!link || !prepareLink(link)) return;
      // A FullCalendar döntse el, hogy kattintás vagy húzás történt;
      // a valódi eseménykattintást az eventClick nyitja új lapon.
      // A Yii megerősítést / POST-ot is az eredeti kezelő kapja.
      if (link.closest(CONFIG.calendarSelector) ||
          link.hasAttribute("data-method") || link.hasAttribute("data-confirm") ||
          link.hasAttribute("download")) return;
      // A natív linknyitást meghagyjuk, de a régi click-kezelő nem
      // irányíthatja át a naptár lapját location.href-fel.
      event.stopImmediatePropagation();
    }, true);
  }

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

      const link = jsEvent.target?.closest?.("a[href]");
      const url = getNavigationUrl(event.url || link?.getAttribute("href"));
      if (url && !isLogoutLink(link, url)) {
        jsEvent.preventDefault();
        window.open(url.href, "_blank", "noopener");
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
  // MEGJELENÉS BEÁLLÍTÁSAI
  // ============================================================

  function installAppearanceSettings() {
    const storageKey = "pte.calendar.appearance.v1";
    const header = document.querySelector(".main-header");
    const content = $calendar[0].closest(".content-wrapper");
    const footer = document.querySelector(".main-footer");
    const navbar = header?.querySelector(".navbar");
    const calendar = $calendar[0];
    const fields = [
      ["navbarBackground", "Fejléc háttere"],
      ["navbarText", "Fejléc szövege és ikonjai"],
      ["pageBackground", "Oldal háttere"],
      ["calendarBackground", "Naptár háttere"],
      ["text", "Tartalom szövege"],
      ["calendarTitle", "Naptár címe és napfejlécei"],
      ["eventText", "Naptáresemények szövege"],
      ["eventSending", "Kiküldés alatt (eredetileg zöld)"],
      ["eventArmed", "Élesített (eredetileg piros)"],
      ["eventOther", "Egyéb esemény (eredetileg kék)"],
      ["grid", "Naptárrács fővonalai és keretek"],
      ["gridMinor", "Naptárrács köztes vonalai"],
      ["today", "Mai nap kiemelése"],
      ["accent", "Naptárgombok"],
      ["footerBackground", "Lábléc háttere"],
      ["footerText", "Lábléc szövege"],
    ];

    function readColor(element, property, fallback) {
      if (!element) return fallback;
      const value = window.getComputedStyle(element)[property];
      const match = value.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
      if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return fallback;
      return "#" + match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, "0")).join("");
    }

    const defaults = {
      navbarBackground: readColor(navbar, "backgroundColor", "#3c8dbc"),
      navbarText: readColor(navbar?.querySelector(".navbar-nav > li > a"), "color", "#ffffff"),
      pageBackground: readColor(content, "backgroundColor", "#ecf0f5"),
      calendarBackground: readColor(calendar.querySelector(".fc-view-container"), "backgroundColor", "#ffffff"),
      text: readColor(calendar, "color", "#333333"),
      calendarTitle: readColor(calendar.querySelector(".fc-toolbar h2"), "color", "#333333"),
      eventText: readColor(calendar.querySelector(".fc-event"), "color", "#ffffff"),
      eventSending: "#00a65a",
      eventArmed: "#dd4b39",
      eventOther: "#3c8dbc",
      grid: readColor(calendar.querySelector("td"), "borderBottomColor", "#dddddd"),
      gridMinor: readColor(calendar.querySelector(".fc-slats .fc-minor td"), "borderBottomColor", "#e8edf2"),
      today: readColor(calendar.querySelector(".fc-today"), "backgroundColor", "#fcf8e3"),
      accent: readColor(calendar.querySelector(".fc-button"), "backgroundColor", "#e6e6e6"),
      footerBackground: readColor(footer, "backgroundColor", "#ffffff"),
      footerText: readColor(footer, "color", "#444444"),
    };
    const presets = {
      light: {
        navbarBackground: "#3c8dbc", navbarText: "#ffffff",
        pageBackground: "#ecf0f5", calendarBackground: "#ffffff",
        text: "#263445", grid: "#d5dce5", today: "#e8f3ff",
        calendarTitle: "#263445", eventText: "#ffffff", gridMinor: "#e8edf2",
        eventSending: "#218838", eventArmed: "#b52b27", eventOther: "#287db0",
        accent: "#287db0", footerBackground: "#ffffff", footerText: "#444444",
      },
      dark: {
        navbarBackground: "#172234", navbarText: "#f1f5f9",
        pageBackground: "#111827", calendarBackground: "#1f2937",
        text: "#e5e7eb", grid: "#475569", today: "#293f5b",
        calendarTitle: "#f1f5f9", eventText: "#ffffff", gridMinor: "#334155",
        eventSending: "#247a4b", eventArmed: "#a73535", eventOther: "#285f99",
        accent: "#60a5fa", footerBackground: "#172234", footerText: "#e5e7eb",
      },
    };
    const themeStyle = document.createElement("style");
    themeStyle.id = "__pte_calendar_colors";
    document.head.appendChild(themeStyle);

    // A szerver eredeti színjelölését az eseményadatok átírása nélkül
    // azonosítjuk. A saját paletta így nem válik a következő frissítés
    // vagy újrarajzolás státusz-felismerésének alapjává.
    const colorProbe = document.createElement("span");
    colorProbe.hidden = true;
    document.body.appendChild(colorProbe);
    const statusColors = new Map();
    function statusFromColor(value) {
      if (typeof value !== "string" || !value.trim()) return null;
      if (statusColors.has(value)) return statusColors.get(value);
      colorProbe.style.color = "";
      colorProbe.style.color = value;
      const hex = colorProbe.style.color ? readColor(colorProbe, "color", null) : null;
      let status = null;
      if (hex) {
        const [red, green, blue] = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255);
        const max = Math.max(red, green, blue);
        const delta = max - Math.min(red, green, blue);
        if (delta > 0.1) {
          let hue = max === red ? (green - blue) / delta :
            max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4;
          hue = (hue * 60 + 360) % 360;
          if (hue < 20 || hue >= 345) status = "armed";
          else if (hue >= 70 && hue < 170) status = "sending";
          else if (hue >= 170 && hue < 260) status = "other";
        }
      }
      statusColors.set(value, status);
      return status;
    }

    const originalEventRender = $calendar.fullCalendar("option", "eventRender");
    $calendar.fullCalendar("option", "eventRender", function (event, element, ...args) {
      const result = typeof originalEventRender === "function"
        ? originalEventRender.call(this, event, element, ...args) : undefined;
      if (result === false) return false;
      const rendered = result && result !== true ? jq(result) : element;
      const originalColor = rendered[0]?.style.backgroundColor ||
        event.backgroundColor || event.color ||
        event.source?.backgroundColor || event.source?.color ||
        $calendar.fullCalendar("option", "eventBackgroundColor") ||
        $calendar.fullCalendar("option", "eventColor") || "#3a87ad";
      const status = statusFromColor(originalColor);
      rendered.removeAttr("data-pte-calendar-status");
      if (status) rendered.attr("data-pte-calendar-status", status);
      // HTML-szöveges visszatérésnél is a már megjelölt elemet adjuk tovább.
      return result && result !== true ? rendered : result;
    });

    const footerStyle = document.createElement("style");
    footerStyle.textContent = `
      html[data-pte-calendar-footer-hidden] .main-footer { display: none !important; }
    `;
    document.head.appendChild(footerStyle);
    function applyFooterVisibility(visible) {
      document.documentElement.toggleAttribute("data-pte-calendar-footer-hidden", !visible);
      // Azonnal átadjuk a felszabaduló helyet, ResizeObserver nélkül is.
      document.documentElement.style.setProperty(
        "--pte-calendar-footer-height", `${footer?.getBoundingClientRect().height || 0}px`,
      );
      scheduleCalendarFit();
    }

    function normalizeColors(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const colors = {};
      for (const [key] of fields) {
        // A korábban mentett palettákhoz az új mezőket alapértékkel pótoljuk.
        const color = value[key] ?? defaults[key];
        if (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color)) return null;
        colors[key] = color.toLowerCase();
      }
      return colors;
    }

    function applyColors(colors) {
      if (!colors) {
        themeStyle.textContent = "";
        document.documentElement.removeAttribute("data-pte-calendar-colors");
        return;
      }
      const rgb = colors.accent.slice(1).match(/../g).map((part) => parseInt(part, 16));
      const buttonText = (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 150
        ? "#111827" : "#ffffff";
      const scope = "html[data-pte-calendar-colors]";
      themeStyle.textContent = `
        ${scope} .main-header .navbar,
        ${scope} .main-header .logo,
        ${scope} .main-header .logo:hover {
          background-color: ${colors.navbarBackground} !important;
          color: ${colors.navbarText} !important;
        }
        ${scope} .main-header .navbar .sidebar-toggle,
        ${scope} .main-header .navbar-nav > li > a {
          color: ${colors.navbarText} !important;
        }
        ${scope} .main-header .navbar .sidebar-toggle:hover,
        ${scope} .main-header .navbar-nav > li > a:hover,
        ${scope} .main-header .navbar-nav > li > a:focus,
        ${scope} .main-header .navbar-nav > .open > a {
          background-color: ${colors.navbarBackground} !important;
          box-shadow: inset 0 0 0 100px rgba(0, 0, 0, .12);
        }
        ${scope} .content-wrapper {
          background-color: ${colors.pageBackground} !important;
          color: ${colors.text} !important;
        }
        ${scope} .content-wrapper .box,
        ${scope} ${CONFIG.calendarSelector},
        ${scope} ${CONFIG.calendarSelector} .fc-view-container,
        ${scope} ${CONFIG.calendarSelector} .fc-list-view,
        ${scope} ${CONFIG.calendarSelector} .fc-popover {
          background-color: ${colors.calendarBackground} !important;
          color: ${colors.text} !important;
        }
        ${scope} ${CONFIG.calendarSelector} th,
        ${scope} ${CONFIG.calendarSelector} td,
        ${scope} ${CONFIG.calendarSelector} .fc-divider,
        ${scope} ${CONFIG.calendarSelector} .fc-list-view,
        ${scope} ${CONFIG.calendarSelector} .fc-popover,
        ${scope} .content-wrapper .box {
          border-color: ${colors.grid} !important;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-today,
        ${scope} ${CONFIG.calendarSelector} .fc-list-heading td,
        ${scope} ${CONFIG.calendarSelector} .fc-popover .fc-header {
          background-color: ${colors.today} !important;
          color: ${colors.text} !important;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-toolbar h2,
        ${scope} ${CONFIG.calendarSelector} .fc-day-header,
        ${scope} ${CONFIG.calendarSelector} .fc-day-header a,
        ${scope} ${CONFIG.calendarSelector} .fc-day-number,
        ${scope} ${CONFIG.calendarSelector} .fc-list-heading a {
          color: ${colors.calendarTitle} !important;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-event,
        ${scope} ${CONFIG.calendarSelector} .fc-event .fc-title,
        ${scope} ${CONFIG.calendarSelector} .fc-event .fc-time,
        ${scope} ${CONFIG.calendarSelector} .fc-list-item,
        ${scope} ${CONFIG.calendarSelector} .fc-list-item a {
          color: ${colors.eventText} !important;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-slats .fc-minor td {
          border-color: ${colors.gridMinor} !important;
        }
        ${scope} ${CONFIG.calendarSelector} [data-pte-calendar-status="sending"] {
          --pte-event-color: ${colors.eventSending};
        }
        ${scope} ${CONFIG.calendarSelector} [data-pte-calendar-status="armed"] {
          --pte-event-color: ${colors.eventArmed};
        }
        ${scope} ${CONFIG.calendarSelector} [data-pte-calendar-status="other"] {
          --pte-event-color: ${colors.eventOther};
        }
        ${scope} ${CONFIG.calendarSelector} .fc-event[data-pte-calendar-status],
        ${scope} ${CONFIG.calendarSelector} .fc-bg-event[data-pte-calendar-status],
        ${scope} ${CONFIG.calendarSelector} .fc-list-item[data-pte-calendar-status] td,
        ${scope} ${CONFIG.calendarSelector} [data-pte-calendar-status] .fc-event-dot {
          background-color: var(--pte-event-color) !important;
          border-color: var(--pte-event-color) !important;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-button {
          background: ${colors.accent} !important;
          border-color: ${colors.accent} !important;
          color: ${buttonText} !important;
          text-shadow: none;
        }
        ${scope} ${CONFIG.calendarSelector} .fc-state-active {
          box-shadow: inset 0 0 0 2px ${buttonText};
        }
        ${scope} .main-footer,
        ${scope} .main-footer a {
          background-color: ${colors.footerBackground} !important;
          color: ${colors.footerText} !important;
        }
      `;
      document.documentElement.setAttribute("data-pte-calendar-colors", "true");
    }

    let savedColors = null;
    let savedShowFooter = true;
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (saved?.version === 1 || saved?.version === 2) {
        savedColors = normalizeColors(saved.colors);
        if (typeof saved.showFooter === "boolean") savedShowFooter = saved.showFooter;
      }
    } catch (error) {
      console.warn("[PTE] A mentett színek nem tölthetők be:", error);
    }
    applyColors(savedColors);
    applyFooterVisibility(savedShowFooter);
    $calendar.fullCalendar("rerenderEvents");

    const navList = header?.querySelector(".navbar-custom-menu .navbar-nav, .navbar-right.navbar-nav") ||
      navbar?.querySelector(".navbar-nav");
    if (!navList) {
      console.warn("[PTE] A színbeállítások gombjához nem található a navbar menüje.");
      return;
    }
    const userItem = Array.from(navList.children).find((item) =>
      item.matches(".user-menu") || item.querySelector(".user-image")
    ) || navList.lastElementChild;
    const navItem = document.createElement("li");
    const trigger = document.createElement("a");
    trigger.href = "#";
    trigger.title = "Megjelenés beállítása";
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-label", "Megjelenés beállítása");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", "__pte_calendar_appearance");
    trigger.innerHTML = '<span aria-hidden="true" style="display:block;font-size:22px;line-height:20px">&#9881;</span>';
    navItem.appendChild(trigger);
    navList.insertBefore(navItem, userItem);

    const dialogStyle = document.createElement("style");
    dialogStyle.textContent = `
      #__pte_calendar_appearance {
        width: 520px; max-width: calc(100vw - 32px);
        max-height: calc(100dvh - 32px); overflow: auto;
        box-sizing: border-box; padding: 24px; margin: auto;
        border: 1px solid #d5dce5; border-radius: 12px;
        color: #263445; background: #fff; font: 14px/1.5 Arial, sans-serif;
        box-shadow: 0 16px 60px rgba(0,0,0,.3);
      }
      #__pte_calendar_appearance::backdrop { background: rgba(15,23,42,.55); }
      #__pte_calendar_appearance h2 { margin: 0 0 8px; font-size: 22px; color: #172234; }
      #__pte_calendar_appearance p { margin: 0 0 16px; }
      #__pte_calendar_appearance .pte-presets,
      #__pte_calendar_appearance .pte-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      #__pte_calendar_appearance .pte-presets { margin-bottom: 16px; }
      #__pte_calendar_appearance .pte-actions { justify-content: flex-end; margin-top: 20px; }
      #__pte_calendar_appearance label {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; margin: 0; padding: 8px 0; font-weight: normal;
        border-bottom: 1px solid #edf0f4;
      }
      #__pte_calendar_appearance input[type=color] {
        width: 54px; height: 32px; flex-shrink: 0; padding: 2px;
        border: 1px solid #cbd5e1; border-radius: 4px; background: #fff; cursor: pointer;
      }
      #__pte_calendar_appearance input[type=checkbox] {
        width: 18px; height: 18px; margin: 0; accent-color: #1769aa; cursor: pointer;
      }
      #__pte_calendar_appearance button {
        padding: 8px 14px; border: 1px solid #cbd5e1; border-radius: 6px;
        background: #f8fafc; color: #263445; font: inherit; cursor: pointer;
      }
      #__pte_calendar_appearance button[type=submit] { background: #1769aa; color: #fff; border-color: #1769aa; }
      #__pte_calendar_appearance :focus-visible { outline: 2px solid #1769aa; outline-offset: 3px; }
      #__pte_calendar_appearance .pte-error { color: #b52b27; margin-top: 12px; }
    `;
    document.head.appendChild(dialogStyle);
    const dialog = document.createElement("dialog");
    dialog.id = "__pte_calendar_appearance";
    dialog.setAttribute("aria-labelledby", "__pte_calendar_appearance_title");
    dialog.innerHTML = `
      <form>
        <h2 id="__pte_calendar_appearance_title">Megjelenés</h2>
        <p>Válaszd ki az oldal színeit. A mentés ebben a böngészőben marad meg.</p>
        <div class="pte-presets">
          <button type="button" data-preset="light">Világos</button>
          <button type="button" data-preset="dark">Sötét</button>
          <button type="button" data-preset="default">Eredeti színek</button>
        </div>
        <div class="pte-color-fields"></div>
        <label><span>Lábléc megjelenítése</span><input type="checkbox" name="showFooter"></label>
        <p class="pte-error" role="alert" hidden></p>
        <div class="pte-actions">
          <button type="button" data-cancel>Mégse</button>
          <button type="submit">Mentés</button>
        </div>
      </form>
    `;
    document.body.appendChild(dialog);
    const inputs = new Map();
    const errorMessage = dialog.querySelector(".pte-error");
    const footerInput = dialog.querySelector('[name="showFooter"]');
    let useDefaults = false;
    for (const [key, title] of fields) {
      const label = document.createElement("label");
      const caption = document.createElement("span");
      caption.textContent = title;
      const input = document.createElement("input");
      input.type = "color";
      input.name = key;
      input.addEventListener("input", () => { useDefaults = false; });
      label.append(caption, input);
      dialog.querySelector(".pte-color-fields").appendChild(label);
      inputs.set(key, input);
    }
    function fillForm(colors) {
      for (const [key, input] of inputs) input.value = colors[key];
      errorMessage.hidden = true;
    }
    function openDialog(event) {
      event.preventDefault();
      useDefaults = savedColors === null;
      fillForm(savedColors || defaults);
      footerInput.checked = savedShowFooter;
      if (!dialog.open) dialog.showModal();
    }
    trigger.addEventListener("click", openDialog);
    trigger.addEventListener("keydown", (event) => {
      if (event.key === " ") openDialog(event);
    });
    dialog.querySelector("[data-cancel]").addEventListener("click", () => dialog.close());
    for (const button of dialog.querySelectorAll("[data-preset]")) {
      button.addEventListener("click", () => {
        useDefaults = button.dataset.preset === "default";
        fillForm(useDefaults ? defaults : presets[button.dataset.preset]);
        if (useDefaults) footerInput.checked = true;
      });
    }
    dialog.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      const colors = normalizeColors(Object.fromEntries(
        Array.from(inputs, ([key, input]) => [key, input.value])
      ));
      if (!colors) return;
      const nextColors = useDefaults ? null : colors;
      const showFooter = footerInput.checked;
      try {
        if (useDefaults && showFooter) localStorage.removeItem(storageKey);
        else localStorage.setItem(storageKey, JSON.stringify({ version: 2, colors: nextColors, showFooter }));
      } catch (error) {
        errorMessage.textContent = "A böngésző nem engedte a helyi mentést. Engedélyezd az oldal adattárolását, majd próbáld újra.";
        errorMessage.hidden = false;
        console.warn("[PTE] A színek mentése sikertelen:", error);
        return;
      }
      savedColors = nextColors;
      savedShowFooter = showFooter;
      applyColors(savedColors);
      applyFooterVisibility(savedShowFooter);
      dialog.close();
      toast("Megjelenés elmentve ebben a böngészőben.", "success");
    });
  }

  // ============================================================
  // DINAMIKUS LAYOUT
  // ============================================================

  function installPageLayout() {
    const header = document.querySelector(".main-header");
    const footer = document.querySelector(".main-footer");
    const content = $calendar[0].closest(".content-wrapper");

    if (!header || !footer || !content) {
      return null;
    }

    const style = document.createElement("style");
    style.id = "__pte_calendar_page_layout";
    style.textContent = `
      .__pte_calendar_fixed_layout .main-header {
        position: relative !important;
        top: auto;
        left: auto;
        right: auto;
      }
      .__pte_calendar_fixed_layout .main-footer {
        position: relative !important;
        bottom: auto;
        left: auto;
        right: auto;
      }
      .__pte_calendar_fixed_layout .content-wrapper {
        position: relative !important;
        top: auto;
        bottom: auto;
        height: max(0px, calc(100vh - var(--pte-calendar-header-height) - var(--pte-calendar-footer-height))) !important;
        height: max(0px, calc(100dvh - var(--pte-calendar-header-height) - var(--pte-calendar-footer-height))) !important;
        min-height: 0 !important;
        margin-top: 0;
        margin-bottom: 0;
        overflow: auto !important;
        box-sizing: border-box;
        overscroll-behavior: contain;
      }
      .__pte_calendar_fixed_layout .content-header {
        display: none !important;
      }
      .__pte_calendar_fixed_layout body.fixed .content-wrapper {
        padding-top: 0;
      }
    `;
    document.head.appendChild(style);
    document.documentElement.classList.add("__pte_calendar_fixed_layout");

    // Mindhárom elem a normál dokumentumfolyamban marad: együtt adják
    // a wrapper magasságát, amelyhez az eredeti sidebar is igazodik.
    // Görgetni csak a korlátozott magasságú középső tartalmat kell.
    let lastHeaderHeight = null;
    let lastFooterHeight = null;
    let lastContentWidth = null;
    let lastContentHeight = null;
    function updateBounds() {
      const headerHeight = header.getBoundingClientRect().height;
      const footerHeight = footer.getBoundingClientRect().height;
      const boundsChanged = headerHeight !== lastHeaderHeight || footerHeight !== lastFooterHeight;
      if (boundsChanged) {
        lastHeaderHeight = headerHeight;
        lastFooterHeight = footerHeight;
        document.documentElement.style.setProperty("--pte-calendar-header-height", `${headerHeight}px`);
        document.documentElement.style.setProperty("--pte-calendar-footer-height", `${footerHeight}px`);
      }
      const { width, height } = content.getBoundingClientRect();
      if (boundsChanged || width !== lastContentWidth || height !== lastContentHeight) {
        lastContentWidth = width;
        lastContentHeight = height;
        scheduleCalendarFit();
      }
    }

    updateBounds();
    window.addEventListener("resize", updateBounds);

    if (typeof ResizeObserver === "function") {
      let boundsFrame = null;
      const observer = new ResizeObserver(() => {
        if (boundsFrame !== null) return;
        // A mért elemeket a következő képkockában módosítjuk, hogy ne
        // hozzunk létre ResizeObserver-visszacsatolást ugyanabban a körben.
        boundsFrame = requestAnimationFrame(() => {
          boundsFrame = null;
          updateBounds();
        });
      });
      observer.observe(header);
      observer.observe(footer);
      // Sidebar nyitás/csukás után a naptár szélességét is újramérjük.
      observer.observe(content);
    } else {
      content.addEventListener("transitionend", updateBounds);
    }

    return content;
  }

  const pageContent = installPageLayout();

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

    // A középső terület görgetése ne növelje meg a naptárat a következő
    // átméretezéskor: a görgetés előtti pozícióból számolunk.
    const calendarTop = Math.max(0, calendarRect.top + (pageContent?.scrollTop || 0));

    let bottomLimit = window.innerHeight - CONFIG.bottomGap;

    if (pageContent) {
      // A naptár alatti margók, paddingek és keretek is helyet foglalnak.
      // Ezek nélkül a naptár ugyan elférne, de a .content/.box burkolata
      // már kilógna, és megjelenne egy második, külső görgetősáv.
      const pixels = (value) => parseFloat(value) || 0;
      const contentStyle = window.getComputedStyle(pageContent);
      let bottomSpace = CONFIG.bottomGap + pixels(contentStyle.paddingBottom);

      for (let element = calendarElement; element && element !== pageContent; element = element.parentElement) {
        const style = window.getComputedStyle(element);
        bottomSpace += pixels(style.marginBottom) +
          pixels(style.paddingBottom) + pixels(style.borderBottomWidth);

        if (element === calendarElement) {
          // A FullCalendar height opciója a saját belső tartalmát méretezi.
          bottomSpace += pixels(style.paddingTop) + pixels(style.borderTopWidth);
        }
      }

      const contentRect = pageContent.getBoundingClientRect();
      bottomLimit = contentRect.top + pageContent.clientTop +
        pageContent.clientHeight - bottomSpace;
    }

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

    // Kis ablakban sem kényszerítünk a rendelkezésre állónál nagyobb
    // külső magasságot; az időrács a saját görgetőjét használja.
    availableHeight = Math.max(1, availableHeight);

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

  installAppearanceSettings();
  installNewTabLinks();

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
  fix fejléc és lábléc
  rejtett content-header
  kitölti az elérhető magasságot
  0–24 órás rács dinamikus
  kis ablaknál belső scroll
  egyszeri kezdeti méretezés
  méretezés ablak- és sidebar-változáskor
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
