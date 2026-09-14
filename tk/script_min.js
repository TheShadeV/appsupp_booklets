(() => {
  const e = document.getElementById("tk-xml-checker");
  e && e.remove();
  const t = (e, t = {}, o = "") => {
      const r = document.createElementNS("http://www.w3.org/1999/xhtml", e);
      for (const [e, o] of Object.entries(t || {}))
        "style" === e
          ? n(r, o)
          : "className" === e
            ? r.setAttribute("class", o)
            : r.setAttribute(e, o);
      return (o && (r.textContent = o), r);
    },
    n = (e, t) => {
      e.setAttribute(
        "style",
        Object.entries(t)
          .map(
            ([e, t]) =>
              `${e.replace(/[A-Z]/g, (e) => "-" + e.toLowerCase())}:${t}`,
          )
          .join(";"),
      );
    },
    o = t("div", { id: "tk-xml-checker" });
  n(o, {
    position: "fixed",
    top: "28px",
    right: "28px",
    width: "780px",
    maxHeight: "88vh",
    overflow: "auto",
    zIndex: "999999",
    background: "white",
    color: "#17233c",
    border: "1px solid #cbd5e1",
    borderRadius: "10px",
    boxShadow: "0 8px 30px rgba(0,0,0,.25)",
    fontFamily: "Arial, sans-serif",
    fontSize: "14px",
  });
  const r = t("div");
  (n(r, {
    background: "#2f6ecb",
    color: "white",
    padding: "12px 16px",
    fontWeight: "bold",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: "10px 10px 0 0",
  }),
    r.appendChild(t("span", {}, "TK XML névellenőrző")));
  const a = t("button", { type: "button" }, "X");
  (n(a, {
    background: "#ef4444",
    color: "white",
    border: "0",
    borderRadius: "6px",
    padding: "8px 12px",
    cursor: "pointer",
    fontWeight: "bold",
  }),
    r.appendChild(a));
  const i = t("div");
  (n(i, { padding: "14px 16px" }),
    i.appendChild(t("div", {}, "Nevek listája, soronként egy név:")));
  const l = t("textarea", {
    placeholder: "Teszt Elek\nWinch Eszter\nKiss Pista",
  });
  (n(l, {
    width: "100%",
    height: "140px",
    boxSizing: "border-box",
    fontFamily: "Consolas, monospace",
    border: "1px solid #cbd5e1",
    borderRadius: "6px",
    padding: "8px",
  }),
    i.appendChild(l));
  const s = t(
    "div",
    {},
    'A fetch válasz XML. A script a <szemely> elemeket olvassa, aktívnak a deleted="" / deleted="0" rekordokat veszi, és a teljesnev/normnev/match attribútumban keres.',
  );
  (n(s, { color: "#64748b", marginTop: "8px", fontSize: "12px" }),
    i.appendChild(s));
  const d = t("div");
  (n(d, { marginTop: "10px" }),
    d.appendChild(t("span", {}, "Késleltetés lekérdezésenként: ")));
  const p = t("input", { type: "number", value: "200", min: "0", step: "50" });
  (n(p, {
    width: "80px",
    padding: "5px",
    border: "1px solid #cbd5e1",
    borderRadius: "4px",
  }),
    d.appendChild(p),
    d.appendChild(t("span", {}, " ms")),
    i.appendChild(d));
  const c = t("div");
  n(c, { marginTop: "10px" });
  const g = t("button", { type: "button" }, "Keresés indítása"),
    h = t("button", { type: "button" }, "Megállítás"),
    u = t("button", { type: "button" }, "CSV mentése");
  for (const e of [g, h, u])
    n(e, {
      marginRight: "8px",
      padding: "8px 12px",
      border: "0",
      borderRadius: "6px",
      cursor: "pointer",
      fontWeight: "bold",
      background: "#e2e8f0",
      color: "#17233c",
    });
  (n(g, {
    marginRight: "8px",
    padding: "8px 12px",
    border: "0",
    borderRadius: "6px",
    cursor: "pointer",
    fontWeight: "bold",
    background: "#22c55e",
    color: "white",
  }),
    c.appendChild(g),
    c.appendChild(h),
    c.appendChild(u),
    i.appendChild(c));
  const m = t("div");
  (n(m, { color: "#64748b", marginTop: "8px", fontSize: "12px" }),
    i.appendChild(m));
  const f = t("table");
  n(f, { width: "100%", borderCollapse: "collapse", marginTop: "12px" });
  const b = t("thead"),
    x = t("tr");
  ([
    "#",
    "Keresett név",
    "Eredmény",
    "Találat db",
    "Talált aktív nevek",
  ].forEach((e) => {
    const o = t("th", {}, e);
    (n(o, {
      borderBottom: "1px solid #e5e7eb",
      padding: "7px",
      textAlign: "left",
      background: "#f8fafc",
    }),
      x.appendChild(o));
  }),
    b.appendChild(x));
  const v = t("tbody");
  (f.appendChild(b),
    f.appendChild(v),
    i.appendChild(f),
    o.appendChild(r),
    o.appendChild(i),
    document.body.appendChild(o));
  let C = !1,
    k = [];
  async function y(e) {
    const t = new URL("/keres.php", location.origin);
    t.searchParams.set("p", e);
    const n = await fetch(t.toString(), {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept:
          "text/xml,application/xml,text/html,application/xhtml+xml,*/*;q=0.8",
      },
    });
    if (!n.ok) throw new Error(`HTTP hiba: ${n.status}`);
    const o = (function (e) {
        const t = [],
          n = new DOMParser().parseFromString(e, "application/xml");
        if (!n.getElementsByTagName("parsererror")[0]) {
          const e = (function (e) {
            return Array.from(new Set(e.filter(Boolean)));
          })([
            ...Array.from(n.getElementsByTagName("szemely")),
            ...Array.from(n.getElementsByTagNameNS("*", "szemely")),
          ]);
          for (const n of e) {
            if (w(T(n.getAttribute("deleted") || ""))) continue;
            const e =
              T(n.getAttribute("teljesnev") || "") ||
              T(n.getAttribute("normnev") || "") ||
              T(n.getAttribute("match") || "") ||
              T(n.getAttribute("nev") || "");
            e && t.push({ name: e });
          }
        }
        if (!t.length) {
          const n = /<szemely\b([^>]*)>([\s\S]*?)<\/szemely>/gi;
          let o;
          for (; null !== (o = n.exec(e)); ) {
            const e = o[1] || "";
            if (w(T(S(e, "deleted")))) continue;
            const n =
              T(S(e, "teljesnev")) ||
              T(S(e, "normnev")) ||
              T(S(e, "match")) ||
              T(S(e, "nev"));
            n && t.push({ name: n });
          }
        }
        return (function (e) {
          const t = new Set(),
            n = [];
          for (const o of e) {
            const e = A(o.name);
            t.has(e) || (t.add(e), n.push(o));
          }
          return n;
        })(t);
      })(await n.text()),
      r = o.filter((t) =>
        (function (e, t) {
          const n = A(e),
            o = A(t);
          return !(!n || !o) && n.includes(o);
        })(t.name, e),
      );
    return {
      searched: e,
      found: r.length > 0,
      count: r.length,
      names: r.map((e) => e.name),
      url: t.toString(),
    };
  }
  function w(e) {
    const t = A(e);
    return !!t && "0" !== t && "false" !== t && "nem" !== t;
  }
  function S(e, t) {
    const n = new RegExp(
      `\\b${((o = t), String(o).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    );
    var o;
    const r = String(e || "").match(n);
    return r
      ? (function (e) {
          return String(e || "")
            .replace(/&#(\d+);/g, (e, t) => String.fromCharCode(Number(t)))
            .replace(/&#x([0-9a-f]+);/gi, (e, t) =>
              String.fromCharCode(parseInt(t, 16)),
            )
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'");
        })(r[1] || r[2] || r[3] || "")
      : "";
  }
  function z() {
    for (; v.firstChild; ) v.removeChild(v.firstChild);
    k.forEach((e, o) => {
      const r = t("tr"),
        a = e.error
          ? "Hiba: " + e.error
          : e.found
            ? "Találat"
            : "Nincs találat";
      ([
        String(o + 1),
        e.searched,
        a,
        String(e.count),
        (e.names || []).join(", "),
      ].forEach((o, a) => {
        const i = t("td", {}, o);
        (n(i, {
          borderBottom: "1px solid #e5e7eb",
          padding: "7px",
          textAlign: "left",
          verticalAlign: "top",
          fontWeight: 2 === a ? "bold" : "normal",
          color: 2 === a ? (e.found ? "#15803d" : "#b91c1c") : "#17233c",
        }),
          r.appendChild(i));
      }),
        v.appendChild(r));
    });
  }
  function T(e) {
    return String(e || "")
      .replace(/\u00a0/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function A(e) {
    return T(e)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  }
  function R(e) {
    return new Promise((t) => setTimeout(t, e));
  }
  function j(e) {
    return `"${String(e ?? "").replace(/"/g, '""')}"`;
  }
  ((a.onclick = () => o.remove()),
    (h.onclick = () => {
      ((C = !0), (m.textContent = "Megállítás kérve..."));
    }),
    (g.onclick = async () => {
      const e = l.value
        .split(/\r?\n|;/)
        .map((e) => e.trim())
        .filter(Boolean);
      if (e.length) {
        ((C = !1), (k = []), z());
        for (let t = 0; t < e.length && !C; t++) {
          const n = e[t];
          m.textContent = `Keresés: ${t + 1}/${e.length} – ${n}`;
          try {
            const e = await y(n);
            k.push(e);
          } catch (e) {
            k.push({
              searched: n,
              found: !1,
              count: 0,
              names: [],
              error: e.message || String(e),
            });
          }
          z();
          const o = Number(p.value || 0);
          o > 0 && (await R(o));
        }
        m.textContent = C
          ? `Megállítva. Feldolgozva: ${k.length}/${e.length}`
          : `Kész. Feldolgozva: ${k.length}/${e.length}`;
      } else alert("Adj meg legalább egy nevet.");
    }),
    (u.onclick = () => {
      if (!k.length) return void alert("Nincs exportálható eredmény.");
      const e = [
          [
            "Keresett név",
            "Találat",
            "Találat db",
            "Talált aktív nevek",
            "URL",
          ],
          ...k.map((e) => [
            e.searched,
            e.found ? "Találat" : "Nincs találat",
            e.count,
            (e.names || []).join(" | "),
            e.url || "",
          ]),
        ]
          .map((e) => e.map(j).join(";"))
          .join("\n"),
        n = new Blob(["\ufeff" + e], { type: "text/csv;charset=utf-8" }),
        o = t("a");
      ((o.href = URL.createObjectURL(n)),
        (o.download = "tk_nev_ellenorzes.csv"),
        o.click(),
        URL.revokeObjectURL(o.href));
    }));
})();
