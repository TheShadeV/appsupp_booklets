(async () => {
  const e = (e) =>
      String(e ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase("hu-HU"),
    t = (e) =>
      String(e ?? "").replace(
        /[&<>"']/g,
        (e) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;",
          })[e],
      ),
    r = {
      "ekop.pte.hu": {
        stateField: "TenderSearch[state]",
        otherStateField: "TenderSearch[status]",
        detailPath: /^\/tender\/\d+\/?$/,
        siteName: "EKOP",
      },
      "kitep.pte.hu": {
        stateField: "TenderSearch[status]",
        otherStateField: "TenderSearch[state]",
        detailPath: /^\/tender\/view\/\d+\/?$/,
        siteName: "KITEP",
      },
    }[location.hostname.toLowerCase().replace(/^www\./, "")];
  if (!r)
    return void alert(
      "Ez a bookmarklet jelenleg csak az ekop.pte.hu és a kitep.pte.hu oldalakon használható.",
    );
  const a =
      document.querySelector(`select[name="${r.stateField}"]`) ||
      document.querySelector(
        'select[name="TenderSearch[state]"], select[name="TenderSearch[status]"]',
      ),
    n =
      a?.selectedOptions?.[0]?.textContent?.trim() || "Pályázat Tartaléklistán",
    l = prompt("Melyik pályázati státuszra keressek?", n);
  if (!l) return;
  const o = { "pályázat tartaléklistán": "TenderWorkflow/spare-list" };
  let s = "",
    i = l.trim();
  if (a) {
    const t = [...a.options],
      r = t.find((t) => e(t.textContent) === e(l)),
      n = t.find((t) => e(t.textContent).includes(e(l))),
      o = r || n;
    o && ((s = o.value), (i = o.textContent.trim()));
  }
  if ((s || (s = o[e(l)] || (l.includes("/") ? l.trim() : "")), !s))
    return void alert(
      "Nem találtam ilyen státuszt. Írd be pontosan a legördülő listában szereplő nevet.",
    );
  const c = document.querySelector('meta[name="csrf-token"]')?.content,
    d = {
      accept: "text/html, */*; q=0.01",
      "x-requested-with": "XMLHttpRequest",
      "x-pjax": "true",
      "x-pjax-container": "#p0",
    };
  c && (d["x-csrf-token"] = c);
  const p = new URL(location.href);
  ((p.pathname = "/tender/index"),
    p.searchParams.set(r.stateField, s),
    p.searchParams.delete(r.otherStateField),
    p.searchParams.set("_pjax", "#p0"),
    p.searchParams.delete("page"),
    p.searchParams.delete("p0-page"));
  const m = new Set(),
    h = [];
  let u = [],
    x = p,
    f = 0;
  for (; x && f < 100; ) {
    const e = x.href;
    if (m.has(e)) break;
    (m.add(e), (f += 1));
    const t = await fetch(x.href, {
      method: "GET",
      credentials: "include",
      headers: d,
    });
    if (!t.ok) throw new Error(`Lista lekérése sikertelen: HTTP ${t.status}`);
    const a = await t.text(),
      n = new DOMParser().parseFromString(a, "text/html"),
      l = n.querySelector("#p0") || n.body;
    u.length ||
      (u = [...l.querySelectorAll("table thead th")].map((e) =>
        e.textContent.replace(/\s+/g, " ").trim(),
      ));
    const o = [...l.querySelectorAll("table tbody tr")].filter(
      (e) => !e.querySelector("td.empty"),
    );
    for (const e of o) {
      const t = [...e.querySelectorAll("th, td")].map((e) =>
          e.textContent.replace(/\s+/g, " ").trim(),
        ),
        a = [...e.querySelectorAll("a[href]")].find((e) => {
          try {
            const t = new URL(e.getAttribute("href"), location.origin);
            return (
              t.origin === location.origin && r.detailPath.test(t.pathname)
            );
          } catch {
            return !1;
          }
        }),
        n = a ? new URL(a.getAttribute("href"), location.href).href : "";
      h.push({ cells: t, detailUrl: n, email: "" });
    }
    const s = l.querySelector(
      'ul.pagination li.next:not(.disabled) a, .pagination li.next:not(.disabled) a, a[rel="next"]',
    );
    s?.getAttribute("href")
      ? ((x = new URL(s.getAttribute("href"), location.href)),
        x.searchParams.set("_pjax", "#p0"))
      : (x = null);
  }
  document.getElementById("ekop-kitep-bookmarklet-results")?.remove();
  const g = document.createElement("div");
  ((g.id = "ekop-kitep-bookmarklet-results"),
    (g.style.cssText =
      "position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif;"));
  const k = document.createElement("div");
  k.style.cssText =
    "background:#fff;color:#111;width:min(1500px,96vw);max-height:92vh;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);display:flex;flex-direction:column;overflow:hidden;";
  const y = document.createElement("div");
  y.style.cssText =
    "display:flex;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid #ddd;";
  const b = document.createElement("strong");
  ((b.style.cssText = "flex:1"),
    (b.textContent = `${r.siteName}: ${i} — ${h.length} találat (${f} oldal) — e-mailek lekérése...`));
  const w = document.createElement("button");
  ((w.textContent = "Másolás TSV-ként"),
    (w.disabled = !0),
    (w.style.cssText = "padding:8px 12px;cursor:pointer;"));
  const S = document.createElement("button");
  ((S.textContent = "Bezárás"),
    (S.style.cssText = "padding:8px 12px;cursor:pointer;"),
    (S.onclick = () => g.remove()),
    y.append(b, w, S));
  const T = document.createElement("div");
  ((T.style.cssText = "overflow:auto;padding:0 16px 16px;"),
    k.append(y, T),
    g.append(k),
    g.addEventListener("click", (e) => {
      e.target === g && g.remove();
    }),
    document.body.append(g));
  const $ = (t) => {
      const r = new DOMParser().parseFromString(t, "text/html"),
        a =
          [...r.querySelectorAll("section")].find((t) =>
            [...t.querySelectorAll("h1,h2,h3,h4,h5,h6")].some(
              (t) => "elérhetőségek" === e(t.textContent),
            ),
          ) || r,
        n = [...a.querySelectorAll("tr")].find((t) => {
          const r = t.querySelector("th");
          return (
            r && "email" === ((a = r.textContent), e(a).replace(/[-–—]/g, ""))
          );
          var a;
        }),
        l =
          n?.querySelector('a[href^="mailto:"]') ||
          a.querySelector('a[href^="mailto:"]');
      if (l)
        return decodeURIComponent(
          l
            .getAttribute("href")
            .replace(/^mailto:/i, "")
            .split("?")[0],
        ).trim();
      const o = (n?.querySelector("td")?.textContent?.trim() || "").match(
        /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
      );
      return o?.[0] || "";
    },
    q = new Map(),
    v = async (e) => {
      if (!e) return "";
      if (q.has(e)) return q.get(e);
      const t = fetch(e, {
        method: "GET",
        credentials: "include",
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      })
        .then((e) => {
          if (!e.ok) throw new Error(`HTTP ${e.status}`);
          return e.text();
        })
        .then($)
        .catch((t) => (console.warn("E-mail lekérése sikertelen:", e, t), ""));
      return (q.set(e, t), t);
    };
  let C = 0;
  const E = h.map((e) => e);
  await Promise.all(
    Array.from({ length: Math.min(4, h.length || 1) }, () =>
      (async () => {
        for (; E.length; ) {
          const e = E.shift();
          if (!e) return;
          ((e.email = await v(e.detailUrl)),
            (C += 1),
            (b.textContent = `${r.siteName}: ${i} — ${h.length} találat (${f} oldal) — e-mailek: ${C}/${h.length}`));
        }
      })(),
    ),
  );
  const A = [...u, "E-mail"],
    P = h.map((e) => [...e.cells, e.email]),
    z = h.filter((e) => e.email).length;
  if (
    ((b.textContent = `${r.siteName}: ${i} — ${h.length} találat (${f} oldal) — ${z} e-mail cím`),
    (w.disabled = !1),
    (w.onclick = async () => {
      const e = [A, ...P].map((e) => e.join("\t")).join("\n");
      (await navigator.clipboard.writeText(e),
        (w.textContent = "Kimásolva"),
        setTimeout(() => {
          w.textContent = "Másolás TSV-ként";
        }, 1200));
    }),
    !P.length)
  )
    return void (T.innerHTML =
      '<p style="padding:18px 0">Nincs találat ehhez a státuszhoz.</p>');
  const L = `<thead><tr>${A.map((e) => `<th>${t(e)}</th>`).join("")}</tr></thead>`,
    j = P.map(
      (e) => `<tr>${e.map((e) => `<td>${t(e)}</td>`).join("")}</tr>`,
    ).join("");
  T.innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:13px"><style>#ekop-kitep-bookmarklet-results th,#ekop-kitep-bookmarklet-results td{border:1px solid #ddd;padding:7px 9px;text-align:left;vertical-align:top}#ekop-kitep-bookmarklet-results th{position:sticky;top:0;background:#f5f5f5}</style>${L}<tbody>${j}</tbody></table>`;
})().catch((e) => {
  (console.error(e), alert(`Hiba történt: ${e.message}`));
});
