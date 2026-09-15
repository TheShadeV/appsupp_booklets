(async () => {
  "use strict";

  const jq = window.jQuery;

  if (!jq || !jq.fn || typeof jq.fn.fullCalendar !== "function") {
    alert("Nem található az oldal FullCalendar példánya.");
    return;
  }

  const $cal = jq("#w0");

  if (!$cal.length) {
    alert("Nem található a #w0 naptár.");
    return;
  }

  if (window.__PTE_15MIN_DRAG__) {
    alert("A 15 perces mozgatás már aktív.");
    return;
  }

  window.__PTE_15MIN_DRAG__ = true;

  // ---------------------------------------------------------
  // 7629text -> 7629
  // ---------------------------------------------------------

  function getNewsletterId(event) {
    const raw = String(event?.id ?? "");

    const match = raw.match(/^(\d+)/);

    return match ? match[1] : null;
  }

  // ---------------------------------------------------------
  // 2026-09-15 08:15
  // ---------------------------------------------------------

  function formatSendingTime(value) {
    if (!value) {
      throw new Error("Hiányzik az esemény kezdési ideje.");
    }

    if (typeof value.format === "function") {
      return value.format("YYYY-MM-DD HH:mm");
    }

    const d = new Date(value);

    const p = (n) => String(n).padStart(2, "0");

    return [
      d.getFullYear(),
      "-",
      p(d.getMonth() + 1),
      "-",
      p(d.getDate()),
      " ",
      p(d.getHours()),
      ":",
      p(d.getMinutes()),
    ].join("");
  }

  // ---------------------------------------------------------
  // Form mezők összeszedése
  // ---------------------------------------------------------

  function formToParams(form) {
    const params = new URLSearchParams();

    const elements = form.querySelectorAll(
      "input[name], textarea[name], select[name]",
    );

    for (const el of elements) {
      if (el.disabled || !el.name) {
        continue;
      }

      const type = String(el.type || "").toLowerCase();

      // file inputokat nem küldünk újra
      if (type === "file") {
        continue;
      }

      if ((type === "checkbox" || type === "radio") && !el.checked) {
        continue;
      }

      if (el.tagName === "SELECT" && el.multiple) {
        for (const option of el.options) {
          if (option.selected) {
            params.append(el.name, option.value);
          }
        }

        continue;
      }

      params.append(el.name, el.value ?? "");
    }

    return params;
  }

  // ---------------------------------------------------------
  // Mentés
  // ---------------------------------------------------------

  async function saveEvent(event) {
    const id = getNewsletterId(event);

    if (!id) {
      throw new Error(`Nem sikerült ID-t kinyerni ebből: ${event?.id}`);
    }

    const sendingTime = formatSendingTime(event.start);

    const url = `${location.origin}/news-letters/update?id=${encodeURIComponent(id)}`;

    console.log(`[PTE] #${id}: szerkesztőoldal lekérése...`);

    // 1. Aktuális form lekérése
    const getResponse = await fetch(url, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!getResponse.ok) {
      throw new Error(`GET sikertelen: HTTP ${getResponse.status}`);
    }

    const html = await getResponse.text();

    const doc = new DOMParser().parseFromString(html, "text/html");

    const timeInput = doc.querySelector('[name="NewsLetters[sending_time]"]');

    if (!timeInput) {
      throw new Error("Nem található a NewsLetters[sending_time] mező.");
    }

    const form = timeInput.closest("form");

    if (!form) {
      throw new Error("Nem található a szerkesztő űrlap.");
    }

    // 2. Aktuális formértékek
    const params = formToParams(form);

    // Rekord ID
    params.set("NewsLetters[id]", id);

    // CSAK ezt módosítjuk
    params.set("NewsLetters[sending_time]", sendingTime);

    console.log(`[PTE] #${id}: ${sendingTime} mentése...`);

    // 3. POST
    const postResponse = await fetch(url, {
      method: "POST",

      credentials: "include",

      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",

        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },

      body: params.toString(),
    });

    if (!postResponse.ok) {
      throw new Error(`POST sikertelen: HTTP ${postResponse.status}`);
    }

    const resultHtml = await postResponse.text();

    const resultDoc = new DOMParser().parseFromString(resultHtml, "text/html");

    // Yii bootstrap validation hibák keresése
    const errors = [
      ...resultDoc.querySelectorAll(
        ".has-error .help-block, .help-block-error",
      ),
    ]
      .map((x) => x.textContent.trim())
      .filter(Boolean);

    if (errors.length) {
      throw new Error([...new Set(errors)].join("\n"));
    }

    console.log(
      `%c✓ #${id} mentve: ${sendingTime}`,
      "color:#00a000;font-weight:bold",
    );

    return {
      id,
      sendingTime,
    };
  }

  // ---------------------------------------------------------
  // FullCalendar
  // ---------------------------------------------------------

  $cal.fullCalendar("option", "snapDuration", "00:15:00");

  $cal.fullCalendar("option", "editable", true);

  $cal.fullCalendar("option", "eventStartEditable", true);

  // Csak mozgatunk, resize egyelőre ne legyen
  $cal.fullCalendar("option", "eventDurationEditable", false);

  // ---------------------------------------------------------
  // DROP
  // ---------------------------------------------------------

  $cal.fullCalendar(
    "option",
    "eventDrop",

    async function (event, delta, revertFunc, jsEvent, ui, view) {
      const id = getNewsletterId(event);

      const newTime = formatSendingTime(event.start);

      console.log("[PTE] Mozgatás:", {
        id,
        rawId: event.id,
        title: event.title,
        newTime,
      });

      try {
        await saveEvent(event);

        // Rövid zöld visszajelzés
        jq(".fc-event").each(function () {
          const seg = jq(this).data("fcSeg");

          if (seg?.event === event) {
            const el = this;

            el.style.boxShadow = "inset 0 0 0 3px #00c853";

            setTimeout(() => {
              el.style.boxShadow = "";
            }, 1200);
          }
        });
      } catch (err) {
        console.error("[PTE] Mentési hiba:", err);

        // szerverhiba esetén vissza az eredeti helyre
        if (typeof revertFunc === "function") {
          revertFunc();
        }

        alert(
          "Nem sikerült elmenteni az időpontot.\n\n" +
            err.message +
            "\n\n" +
            "Az esemény vissza lett helyezve az eredeti időpontra.",
        );
      }
    },
  );

  // ---------------------------------------------------------
  // Már létező eventek szerkeszthetővé tétele
  // ---------------------------------------------------------

  const events = $cal.fullCalendar("clientEvents");

  for (const event of events) {
    event.editable = true;
    event.startEditable = true;
    event.durationEditable = false;
  }

  $cal.fullCalendar("rerenderEvents");

  console.table(
    events.map((e) => ({
      rawId: e.id,
      id: getNewsletterId(e),
      title: e.title,
      start: e.start?.format?.("YYYY-MM-DD HH:mm"),
    })),
  );

  console.log(
    `%c✓ PTE 15 perces drag aktív (${events.length} esemény)`,
    "color:#00a000;font-weight:bold;font-size:14px",
  );

  alert(
    "✓ 15 perces mozgatás bekapcsolva.\n\n" +
      "Az eseményeket most már húzhatod például:\n" +
      "08:00 → 08:15 → 08:30 → 08:45 → 09:00\n\n" +
      "Elengedés után az új időpont automatikusan mentésre kerül.",
  );
})();
