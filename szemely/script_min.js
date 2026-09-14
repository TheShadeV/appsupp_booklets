(() => {
  const e = document.getElementById("pte-name-checker");
  e && e.remove();
  const n = document.createElement("div");
  ((n.id = "pte-name-checker"),
    (n.innerHTML =
      '\n    <style>\n      #pte-name-checker {\n        position: fixed;\n        top: 40px;\n        right: 40px;\n        width: 560px;\n        max-height: 85vh;\n        overflow: auto;\n        z-index: 999999;\n        background: #fff;\n        color: #17233c;\n        border: 1px solid #cfd8e3;\n        box-shadow: 0 8px 30px rgba(0,0,0,.25);\n        border-radius: 10px;\n        font-family: Arial, sans-serif;\n        font-size: 14px;\n      }\n      #pte-name-checker header {\n        background: #2f6ecb;\n        color: #fff;\n        padding: 12px 16px;\n        font-weight: bold;\n        display: flex;\n        justify-content: space-between;\n        align-items: center;\n        border-radius: 10px 10px 0 0;\n      }\n      #pte-name-checker main {\n        padding: 14px 16px;\n      }\n      #pte-name-checker textarea {\n        width: 100%;\n        height: 150px;\n        box-sizing: border-box;\n        resize: vertical;\n        padding: 8px;\n        border: 1px solid #cbd5e1;\n        border-radius: 6px;\n        font-family: Consolas, monospace;\n      }\n      #pte-name-checker button {\n        margin-top: 8px;\n        margin-right: 6px;\n        padding: 8px 12px;\n        border: 0;\n        border-radius: 6px;\n        cursor: pointer;\n        font-weight: 600;\n      }\n      #pte-name-checker .primary { background: #22c55e; color: #fff; }\n      #pte-name-checker .secondary { background: #e2e8f0; color: #17233c; }\n      #pte-name-checker .danger { background: #ef4444; color: #fff; }\n      #pte-name-checker table {\n        width: 100%;\n        border-collapse: collapse;\n        margin-top: 12px;\n      }\n      #pte-name-checker th, #pte-name-checker td {\n        border-bottom: 1px solid #e5e7eb;\n        padding: 7px 6px;\n        text-align: left;\n        vertical-align: top;\n      }\n      #pte-name-checker th {\n        background: #f8fafc;\n      }\n      #pte-name-checker .ok { color: #15803d; font-weight: bold; }\n      #pte-name-checker .no { color: #b91c1c; font-weight: bold; }\n      #pte-name-checker .small {\n        color: #64748b;\n        font-size: 12px;\n        margin-top: 6px;\n      }\n    </style>\n\n    <header>\n      <span>Login_name ellenőrző</span>\n      <button class="danger" id="closeBtn">X</button>\n    </header>\n\n    <main>\n      <div>login_name lista, soronként egy érték:</div>\n      <textarea id="names" placeholder="nagy.lajos&#10;kiss.imre&#10;winch.eszter"></textarea>\n\n      <div class="small">\n        A script a jelenlegi bejelentkezett böngésző sessiont használja. Nem kér jelszót.\n      </div>\n\n      <div style="margin-top:10px;">\n        <label>\n          Késleltetés lekérdezésenként:\n          <input id="delay" type="number" value="250" min="0" step="50" style="width:80px;"> ms\n        </label>\n      </div>\n\n      <button class="primary" id="runBtn">Keresés indítása</button>\n      <button class="secondary" id="stopBtn">Megállítás</button>\n      <button class="secondary" id="csvBtn">CSV mentése</button>\n\n      <div id="status" class="small"></div>\n\n      <table>\n        <thead>\n          <tr>\n            <th>#</th>\n            <th>Keresett login_name</th>\n            <th>Eredmény</th>\n            <th>Találatok</th>\n            <th>Visszaadott nevek</th>\n          </tr>\n        </thead>\n        <tbody id="results"></tbody>\n      </table>\n    </main>\n  '),
    document.body.appendChild(n));
  const t = (e) => n.querySelector(e);
  let a = !1,
    r = [];
  async function o(e) {
    const n = new URL("/felhasznalok", window.location.origin);
    n.searchParams.set("filters[login_name]", e);
    const t = (function () {
      try {
        const e = document.querySelector("#app[data-page], [data-page]");
        if (!e) return null;
        const n = JSON.parse(e.getAttribute("data-page"));
        return n?.version || null;
      } catch {
        return null;
      }
    })();
    let a = {
      "X-Requested-With": "XMLHttpRequest",
      "X-Inertia": "true",
      Accept: "text/html, application/xhtml+xml",
    };
    t && (a["X-Inertia-Version"] = t);
    let r = await fetch(n.toString(), {
      method: "GET",
      credentials: "include",
      headers: a,
      redirect: "follow",
    });
    if (
      ((409 !== r.status && r.ok) ||
        (r = await fetch(n.toString(), {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "text/html,application/xhtml+xml,application/json",
          },
          redirect: "follow",
        })),
      !r.ok)
    )
      throw new Error(`HTTP hiba: ${r.status}`);
    const o = r.headers.get("content-type") || "",
      s = (function (e, n) {
        const t = e.trim();
        if (n.includes("json") || t.startsWith("{")) return JSON.parse(t);
        const a = new DOMParser().parseFromString(e, "text/html"),
          r = a.querySelector("#app[data-page], [data-page]");
        if (r) return JSON.parse(r.getAttribute("data-page"));
        const o = e.match(/data-page=(["'])(.*?)\1/);
        if (o) {
          const e = document.createElement("textarea");
          return ((e.innerHTML = o[2]), JSON.parse(e.value));
        }
        throw new Error(
          "Nem találtam feldolgozható Inertia adatot. Lehet, hogy lejárt a bejelentkezés.",
        );
      })(await r.text(), o),
      i = s?.props?.users || s?.users || s?.props?.data?.users,
      c = (function (e) {
        return e
          ? Array.isArray(e)
            ? e
            : Array.isArray(e.data)
              ? e.data
              : Array.isArray(e.items)
                ? e.items
                : Array.isArray(e.rows)
                  ? e.rows
                  : Array.isArray(e.results)
                    ? e.results
                    : []
          : [];
      })(i),
      d = Number.isFinite(i?.total) ? i.total : c.length;
    return {
      name: e,
      found: d > 0,
      count: d,
      returnedNames: c.map(l).filter(Boolean).slice(0, 10),
      url: n.toString(),
    };
  }
  function l(e) {
    return (
      (e &&
        "object" == typeof e &&
        (e.login_name ||
          e.loginName ||
          e.name ||
          e.nev ||
          e.full_name ||
          e.fullName ||
          e.display_name ||
          e.displayName ||
          e.email)) ||
      ""
    );
  }
  function s() {
    t("#results").innerHTML = r
      .map(
        (e, n) =>
          `\n      <tr>\n        <td>${n + 1}</td>\n        <td>${c(e.name)}</td>\n        <td>\n          ${e.error ? `<span class="no">Hiba</span><br><span class="small">${c(e.error)}</span>` : e.found ? '<span class="ok">Találat</span>' : '<span class="no">Nincs találat</span>'}\n        </td>\n        <td>${e.count ?? 0}</td>\n        <td>${c((e.returnedNames || []).join(", "))}</td>\n      </tr>\n    `,
      )
      .join("");
  }
  function i(e) {
    return new Promise((n) => setTimeout(n, e));
  }
  function c(e) {
    return String(e ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
  function d(e) {
    return `"${String(e ?? "").replaceAll('"', '""')}"`;
  }
  ((t("#closeBtn").onclick = () => n.remove()),
    (t("#stopBtn").onclick = () => {
      ((a = !0), (t("#status").textContent = "Megállítás kérve..."));
    }),
    (t("#csvBtn").onclick = () => {
      if (!r.length) return void alert("Még nincs exportálható eredmény.");
      const e = [
          [
            "Keresett login_name",
            "Találat",
            "Találatok száma",
            "Visszaadott nevek",
            "URL",
          ],
          ...r.map((e) => [
            e.name,
            e.found ? "Találat" : "Nincs találat",
            e.count,
            (e.returnedNames || []).join(" | "),
            e.url || "",
          ]),
        ]
          .map((e) => e.map(d).join(";"))
          .join("\n"),
        n = new Blob(["\ufeff" + e], { type: "text/csv;charset=utf-8" }),
        t = document.createElement("a");
      ((t.href = URL.createObjectURL(n)),
        (t.download = "login_name_ellenorzes.csv"),
        t.click(),
        URL.revokeObjectURL(t.href));
    }),
    (t("#runBtn").onclick = async () => {
      const e = t("#names")
        .value.split(/\r?\n|;|,/)
        .map((e) => e.trim())
        .filter(Boolean);
      if (e.length) {
        ((a = !1), (r = []), s());
        for (let n = 0; n < e.length && !a; n++) {
          const a = e[n];
          t("#status").textContent = `Keresés: ${n + 1}/${e.length} – ${a}`;
          try {
            const e = await o(a);
            r.push(e);
          } catch (e) {
            r.push({
              name: a,
              found: !1,
              count: 0,
              returnedNames: [],
              error: e.message || String(e),
            });
          }
          s();
          const l = Number(t("#delay").value || 0);
          l > 0 && (await i(l));
        }
        t("#status").textContent = a
          ? `Megállítva. Feldolgozva: ${r.length}/${e.length}`
          : `Kész. Feldolgozva: ${r.length}/${e.length}`;
      } else alert("Adj meg legalább egy értéket.");
    }));
})();
