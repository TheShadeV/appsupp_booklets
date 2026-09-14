!async function () {
    let e = [],
        t = ["azonosito", "targy", "tipusKat", "beerkezett", "tervezettDatum", "felelos"],
        n = !1,
        o = null;
    const i = "Hírlevél igénylése",
        a = location.hostname,
        s = 2,
        r = 3,
        d = 1,
        l = "https://api.npoint.io/51913ae4891fd8eb45bb",
        c = {
            holidays: ["2026-01-01", "2026-01-02", "2026-03-15", "2026-04-03", "2026-04-06", "2026-05-01", "2026-05-25", "2026-08-20", "2026-08-21", "2026-10-23", "2026-11-01", "2026-12-24", "2026-12-25", "2026-12-26"],
            workingSaturdays: ["2026-01-10", "2026-08-08", "2026-12-12"]
        },
        p = {
            azonosito: "ID",
            targy: "Tárgy",
            tipusKat: "Típus/Kategória",
            beerkezett: "Beérkezett",
            tervezettDatum: "Tervezett küldés",
            cimzettek: "Címzettek?",
            felelos: "Felelős",
            hlFelado: "Feladó",
            igenylo: "Igénylő",
            igEmail: "Email",
            testEmails: "Teszt címek",
            megjegyzes: "Megjegyzés"
        },
        u = {
            data: {},
            syncTimer: null,
            lastSyncTime: 0,
            isSyncing: !1,
            needsSync: !1,
            async init() {
                try {
                    const e = await fetch(l);
                    if (this.lastSyncTime = Date.now(), e.ok) {
                        const t = await e.json();
                        t && t.smnotes && Object.keys(t.smnotes).length > 0 ? (this.data = t.smnotes, localStorage.setItem("pte_hirlevel_notes", JSON.stringify(this.data))) : (this.loadLocal(), this.pushToCloud())
                    } else console.warn("npoint.io read failed. Using local storage."), this.loadLocal()
                } catch (e) {
                    console.warn("Could not reach npoint.io. Using local storage.", e), this.loadLocal()
                }
            },
            async pullUpdates() {
                if (l && !this.syncTimer) try {
                    const e = await fetch(`${l}?_t=${Date.now()}`);
                    if (e.ok) {
                        const t = await e.json();
                        t && t.smnotes && (this.data = t.smnotes, localStorage.setItem("pte_hirlevel_notes", JSON.stringify(this.data)))
                    }
                } catch (e) {
                    console.warn("Background notes sync failed.", e)
                }
            },
            loadLocal() {
                let e = JSON.parse(localStorage.getItem("pte_hirlevel_notes") || "{}"),
                    t = !1;
                for (const n in e) "string" == typeof e[n] && (e[n] = {
                    text: e[n],
                    checked: !1
                }, t = !0);
                this.data = e, t && localStorage.setItem("pte_hirlevel_notes", JSON.stringify(this.data))
            },
            pushToCloud() {
                l && (this.syncTimer && clearTimeout(this.syncTimer), this.syncTimer = setTimeout(async () => {
                    try {
                        await fetch(l, {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                smnotes: this.data
                            })
                        })
                    } catch (e) {
                        console.error("Failed to sync notes to npoint.io.", e)
                    } finally {
                        this.syncTimer = null
                    }
                }, 1500))
            },
            getNote(e) {
                return (this.data[e] || {}).text || ""
            },
            isChecked(e) {
                return !!(this.data[e] || {}).checked
            },
            save(e, t, n) {
                const o = (t || "").trim();
                o || n ? this.data[e] = {
                    text: o,
                    checked: !!n
                } : delete this.data[e], localStorage.setItem("pte_hirlevel_notes", JSON.stringify(this.data)), this.pushToCloud()
            },
            updateNote(e, t) {
                this.save(e, t, this.isChecked(e))
            },
            updateCheck(e, t) {
                this.save(e, this.getNote(e), t)
            },
            hasNote(e) {
                return !!this.getNote(e)
            },
            cleanup(e) {
                const t = [];
                for (const n in this.data) e.has(n) || (t.push(n), delete this.data[n]);
                return t.length > 0 && (localStorage.setItem("pte_hirlevel_notes", JSON.stringify(this.data)), this.pushToCloud()), t
            }
        },
        g = {
            MONTHS: {
                "január": 0,
                "február": 1,
                "március": 2,
                "április": 3,
                "május": 4,
                "június": 5,
                "július": 6,
                augusztus: 7,
                szeptember: 8,
                "október": 9,
                november: 10,
                december: 11
            },
            parseHungarian(e) {
                const t = e.match(/(\d{4})\.\s([a-záéíóöőúüű]+)\s(\d+)\.,\s[a-záéíóöőúüű]+\s(\d+):(\d{2}):(\d{2})/i);
                if (!t) return new Date;
                const [, n, o, i, a, s, r] = t;
                return new Date(n, this.MONTHS[o.toLowerCase()], i, a, s, r)
            },
            formatISO: e => e.toISOString().split("T")[0],
            getDiffWorkdays(e) {
                const t = new Date;
                t.setHours(0, 0, 0, 0);
                const n = new Date(e);
                if (n.setHours(0, 0, 0, 0), t.getTime() === n.getTime()) return 0;
                const o = n > t;
                let i = new Date(t),
                    a = 0;
                for (; i.getTime() !== n.getTime();) {
                    i.setDate(i.getDate() + (o ? 1 : -1));
                    const e = this.formatISO(i),
                        t = i.getDay(),
                        n = 0 === t || 6 === t,
                        s = c.holidays.includes(e),
                        r = c.workingSaturdays.includes(e);
                    (!n && !s || r) && (a += o ? 1 : -1)
                }
                return a
            }
        },
        h = {
            getToken() {
                const e = `; ${document.cookie}`.split("; __RequestVerificationToken=").pop().split(";").shift();
                return e && e !== `; ${document.cookie}` ? e : document.querySelector('input[name="__RequestVerificationToken"]') ?.value
            },
            async fetchDetails(e, t) {
                const n = await fetch(`https://${a}/ServiceRequest/Dashboard/${e}`, {
                        credentials: "include"
                    }),
                    o = await n.text(),
                    i = (new DOMParser).parseFromString(o, "text/html"),
                    s = (e, t = i) => t.querySelector(e) ?.textContent ?.trim() || "N/A",
                    r = s("#divServicerequestDetal > div > div.card-body > div:nth-child(9) > div");
                let d = "N/A";
                d = r.toLowerCase().includes("nem hivatalos") ? "Nem hivatalos" : r.toLowerCase().includes("hivatalos") ? "Hivatalos" : r.split(" ")[0];
                const l = s("#divServicerequestDetal > div > div.card-body > div:nth-child(10) > div");
                let c = {
                    guid: e,
                    lastModified: t,
                    azonosito: s("#divServicerequestDetal > div > div.card-body > div.row.dashboardheader > div:nth-child(1) > div > div"),
                    targy: s("#divServicerequestDetal > div > div.card-body > div:nth-child(12) > div"),
                    tipusKat: `${d}, ${l}`,
                    beerkezett: g.parseHungarian(s("#divServicerequestDetal > div > div.card-body > div:nth-child(20) > div")),
                    tervezettDatum: g.parseHungarian(s("#divServicerequestDetal > div > div.card-body > div:nth-child(13) > div")),
                    cimzettek: s("#divServicerequestDetal > div > div.card-body > div:nth-child(14) > div"),
                    hlFelado: s("#divServicerequestDetal > div > div.card-body > div:nth-child(7) > div"),
                    igenylo: s("#divUserData > div:nth-child(2) > div > div > div.col-6.text-ellipsis.p-0.ml-2.d-flex.align-items-center > span"),
                    igEmail: s("#divServicerequestDetal > div > div.card-body > div:nth-child(5) > div"),
                    testEmails: s("#divServicerequestDetal > div > div.card-body > div:nth-child(15) > div"),
                    megjegyzes: s("#divServicerequestDetal > div > div.card-body > div:nth-child(16) > div"),
                    felelos: "Nincs kiosztva",
                    maUrl: null
                };
                const p = i.querySelector('a[href*="/ManualActivity/Dashboard/"]');
                if (p) {
                    let e = p.getAttribute("href");
                    e.startsWith("/") && (e = `https://${a}${e}`), c.maUrl = e;
                    try {
                        const t = await fetch(e, {
                                credentials: "include"
                            }),
                            n = await t.text(),
                            o = s("#divUserData > div:nth-child(2) > div", (new DOMParser).parseFromString(n, "text/html"));
                        "N/A" !== o && (c.felelos = o.replace(/\s+/g, " ").trim())
                    } catch (e) {
                        console.warn(`Nem sikerült lekérni a felelőst a ${c.azonosito} azonosítóhoz.`, e)
                    }
                }
                return c
            }
        },
        y = {
            updateTable() {
                const n = parseInt(document.getElementById("pte-window-input").value) || 0,
                    o = document.getElementById("pte-search-input").value.toLowerCase(),
                    i = document.getElementById("pte-sort-select").value,
                    s = document.querySelector("#pte-table-body"),
                    r = document.querySelector("#pte-table-head"),
                    d = document.getElementById("pte-count-badge");
                let l = e.filter(e => {
                    const t = g.getDiffWorkdays(e.tervezettDatum) <= n,
                        i = Object.values(e).some(e => String(e).toLowerCase().includes(o));
                    return t && i
                });
                const [c, h] = i.split("_");
                l.sort((e, t) => {
                    let n = e[c],
                        o = t[c];
                    return n instanceof Date && o instanceof Date ? "desc" === h ? o - n : n - o : (n = String(n || "").toLowerCase(), o = String(o || "").toLowerCase(), n < o ? "asc" === h ? -1 : 1 : n > o ? "asc" === h ? 1 : -1 : 0)
                }), d.innerText = `${l.length} db`, r.innerHTML = `<tr>${t.map(e=>`\n                <th style="padding: 10px 12px; color: #64748b; font-size: 0.75rem; text-transform: uppercase; white-space: nowrap;">${p[e]}</th>\n            `).join("")}</tr>`;
                const y = new Date;
                let b = null;
                s.innerHTML = l.length ? l.map((e, n) => {
                    const o = e.tervezettDatum < y;
                    let i = "";
                    "tervezettDatum" === c && null !== b && b !== o && (i = `\n                            <tr>\n                                <td colspan="${t.length}" style="background: #f8fafc; padding: 12px; text-align: center; font-size: 0.85rem; font-weight: 700; color: #334155; letter-spacing: 2px; border-top: 2px dashed #94a3b8; border-bottom: 2px dashed #94a3b8;">\n                                    ⏰ --- JELENLEGI IDŐPONT --- ⏰\n                                </td>\n                            </tr>\n                        `), b = o;
                    return i + `\n                    <tr style="background: ${o?n%2==0?"#fff1f2":"#ffe4e6":n%2==0?"#fff":"#f8fafc"}; border-bottom: 1px solid #e2e8f0;">\n                        ${t.map(t=>{let n=e[t];if("azonosito"===t){const o=e.maUrl?`<a href="${e.maUrl}" target="_blank" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; text-decoration: none; margin-left: 8px; white-space: nowrap;" title="Manual Activity megnyitása">MA</a>`:"",i=u.hasNote(e.azonosito),s=u.isChecked(e.azonosito),r=i?"#ef4444":"#94a3b8",d=i?"#ef4444":"none",l=`<input type="checkbox" class="pte-row-check" data-id="${e.azonosito}" ${s?"checked":""} style="margin-left: 10px; cursor: pointer; width: 16px; height: 16px; accent-color: #10b981;" title="Feladat megjelölése">`,c=`\n                                    <button class="pte-note-btn" data-id="${e.azonosito}" style="background:none; border:none; cursor:pointer; margin-left:8px; padding:0; display:flex; align-items:center; color:${r}; transition:color 0.2s;" title="Jegyzet szerkesztése">\n                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="${d}" stroke-linecap="round" stroke-linejoin="round">\n                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>\n                                            <polyline points="14 2 14 8 20 8"></polyline>\n                                            <line x1="16" y1="13" x2="8" y2="13"></line>\n                                            <line x1="16" y1="17" x2="8" y2="17"></line>\n                                            <polyline points="10 9 9 9 8 9"></polyline>\n                                        </svg>\n                                    </button>\n                                `;n=`<div style="display: flex; align-items: center;"><strong><a href="https://${a}/ServiceRequest/Dashboard/${e.guid}" target="_blank" style="color: #2563eb; text-decoration: none;">${e[t]}</a></strong>${o}${l}${c}</div>`}else"targy"===t?n=` < a href = "https://hirlevel.pte.hu/news-letters?NewsLettersSearch%5Bsubject%5D=${encodeURIComponent(e[t])}"
                    target = "_blank"
                    style = "color: #334155; text-decoration: none;" > $ {
                        e[t]
                    } < /a>`:"tervezettDatum"!==t&&"beerkezett"!==t||(n=e[t].toLocaleString("hu-HU").slice(0,-3));return`<td style="padding: 10px 12px; ${"tervezettDatum"===t||"beerkezett"===t||"azonosito"===t?"white-space: nowrap;":""}">${n}</td > `}).join("")}\n                    </tr>\n                `
                }).join("") : `<tr><td colspan="${t.length}" style="padding: 40px; text-align: center; color: #94a3b8;">Nincs találat.</td></tr>`
            },
            openNoteEditor(e, t) {
                const n = document.getElementById("pte-note-editor-overlay");
                n && n.remove();
                const o = u.getNote(e),
                    i = document.createElement("div");
                i.id = "pte-note-editor-overlay", Object.assign(i.style, {
                    position: "fixed",
                    inset: "0",
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    backdropFilter: "blur(2px)",
                    zIndex: "1000000",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontFamily: "sans-serif"
                }), i.innerHTML = `\n                <div style="background: white; width: 90%; max-width: 500px; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">\n                    <div style="padding: 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">\n                        <h3 style="margin: 0; font-size: 1rem; color: #0f172a; display: flex; align-items: center; gap: 8px;">\n                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>\n                            Jegyzet: <span style="color: #2563eb;">${e}\n                        </h3>\n                    </div>\n                    <div style="padding: 16px; flex: 1;">\n                        <p style="margin: 0 0 10px 0; font-size: 0.85rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;"></span>${t}</p>\n                        <textarea id="pte-note-textarea" style="width: 100%; height: 180px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; font-family: inherit; font-size: 0.95rem; resize: vertical;" placeholder="Ide írhatod a saját megjegyzéseidet...">${o}</textarea>\n                    </div>\n                    <div style="padding: 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">\n                        <button id="pte-note-cancel" style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem; color: #334155;">Mégse</button>\n                        <button id="pte-note-save" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Mentés</button>\n                    </div>\n                </div>\n            `, document.body.appendChild(i), document.getElementById("pte-note-cancel").onclick = () => i.remove(), document.getElementById("pte-note-save").onclick = () => {
                    u.updateNote(e, document.getElementById("pte-note-textarea").value), this.updateTable(), i.remove()
                }, document.getElementById("pte-note-textarea").focus()
            },
            showCleanupModal(e) {
                const t = document.createElement("div");
                Object.assign(t.style, {
                    position: "fixed",
                    inset: "0",
                    backgroundColor: "rgba(15, 23, 42, 0.6)",
                    backdropFilter: "blur(2px)",
                    zIndex: "2000000",
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontFamily: "sans-serif"
                });
                let n = "";
                n = e.length > 0 ? `<p style="color: #334155;">Sikeresen törölve lett <strong>${e.length}</strong> árva bejegyzés a felhőből:</p>\n                               <ul style="max-height: 150px; overflow: auto; color: #64748b; font-size: 0.85rem; padding-left: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 10px 10px 30px; margin-top: 10px;">\n                                   ${e.map(e=>`<li style="margin-bottom: 4px;">${e}</li>`).join("")}\n                               </ul>` : '<p style="color: #334155;">Nincsenek árva adatok.
                Minden mentett jegyzet és pipa aktív feladathoz tartozik! < /p>',t.innerHTML=`\n                <div style="background: white; width: 90%; max-width: 400px; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); padding: 20px;">\n                    <h3 style="margin-top: 0; color: #0f172a; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">🧹 Takarítás eredménye</h3 > \n $ {
                    n
                }\
                n < div style = "display: flex; justify-content: flex-end; margin-top: 20px;" > \n < button id = "pte-cleanup-close"
                style = "background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;" > Rendben < /button>\n                    </div > \n < /div>\n            `,document.body.appendChild(t),document.getElementById("pte-cleanup-close").onclick=()=>t.remove()},buildModal(){const n=document.getElementById("pte-modal-overlay");n&&n.remove();const i=document.createElement("div");i.id="pte-modal-overlay",Object.assign(i.style,{position:"fixed",inset:"0",backgroundColor:"rgba(15, 23, 42, 0.7)",backdropFilter:"blur(4px)",zIndex:"999999",display:"flex",justifyContent:"center",alignItems:"center",fontFamily:"sans-serif"}),i.innerHTML=`\n                <div style="background: white; width: 98%; max-width: 1900px; height: 95vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">\n                    <div style="padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">\n                        <div style="display: flex; align-items: center; gap: 12px;">\n                            <h2 style="margin: 0; font-size: 1.1rem; color: #0f172a; white-space: nowrap;">📩 Hírlevelek <span id="pte-count-badge" style="background: #cbd5e1; padding: 2px 8px; border-radius: 20px; font-size: 0.75rem;"></h2 > \n < span id = "pte-update-status"
                style = "font-size: 0.75rem; color: #64748b; font-weight: 500;" > < /span>\n                        </div > \n\ n < div style = "display: flex; gap: 10px; align-items: center; flex-grow: 1; justify-content: flex-end;" > \n < input type = "text"
                id = "pte-search-input"
                placeholder = "Keresés bármire..."
                style = "padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; width: 250px; outline: none; font-size: 0.85rem;" > \n\ n < div style = "display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 8px;" > \n < label style = "font-size: 0.7rem; font-weight: bold; color: #64748b;" > RENDEZÉS: < /label>\n                                <select id="pte-sort-select" style="border: none; outline: none; font-size: 0.8rem; background: transparent; cursor: pointer; color: #334155;">\n                                    <option value="tervezettDatum_desc">Tervezett küldés (Új elöl)</option > \n < option value = "tervezettDatum_asc" > Tervezett küldés(Régi elöl) < /option>\n                                    <option value="beerkezett_desc">Beérkezett (Új elöl)</option > \n < option value = "beerkezett_asc" > Beérkezett(Régi elöl) < /option>\n                                    <option value="azonosito_desc">ID (Csökkenő)</option > \n < option value = "azonosito_asc" > ID(Növekvő) < /option>\n                                    <option value="targy_asc">Tárgy (A-Z)</option > \n < option value = "targy_desc" > Tárgy(Z - A) < /option>\n                                </select > \n < /div>\n\n                            <div style="display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 8px;">\n                                <label style="font-size: 0.7rem; font-weight: bold; color: #64748b;">MUNKANAP:</label > \n < input type = "number"
                id = "pte-window-input"
                value = "</span>${s}"
                min = "0"
                style = "width: 35px; border: none; font-weight: bold; color: #2563eb; outline: none;" > \n < /div>\n\n                            <button id="pte-clean-notes" style="background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; color: #475569; font-weight: 500;" title="Árva jegyzetek törlése a tárhelyről">🧹 Karbantartás</button > \n\ n < div style = "position: relative;" > \n < button id = "pte-col-toggle"
                style = "background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem;" > Oszlopok⚙️ < /button>\n                                <div id="pte-col-menu" style="display: none; position: absolute; right: 0; top: 40px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 15px rgba(0,0,0,0.1); z-index: 100; padding: 10px; width: 180px;">\n                                    ${Object.entries(p).map(([e,n])=>`\n                                        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; padding: 4px 0; cursor: pointer;">\n                                            <input type="checkbox" value="${e}" ${t.includes(e)?"checked":""} class="pte-col-check"> ${n}\n                                        </label > \n `).join("")}\n                                </div>\n                            </div>\n\n                            <button id="pte-close" style="background: #ef4444; color: white; border: none; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Bezárás</button>\n                        </div>\n                    </div>\n                    <div style="flex: 1; overflow: auto;">\n                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">\n                            <thead id="pte-table-head" style="position: sticky; top: 0; background: white; box-shadow: 0 1px 0 #e2e8f0; z-index: 10;"></thead>\n                            <tbody id="pte-table-body"></tbody>\n                        </table>\n                    </div>\n                </div>\n            `, document.body.appendChild(i), document.getElementById("pte-sort-select").onchange = () => this.updateTable(), document.getElementById("pte-search-input").oninput = () => this.updateTable(), document.getElementById("pte-window-input").oninput = () => this.updateTable();
                const a = document.getElementById("pte-table-body");
                a.onclick = t => {
                    const n = t.target.closest(".pte-note-btn");
                    if (n) {
                        const t = n.getAttribute("data-id"),
                            o = e.find(e => e.azonosito === t);
                        this.openNoteEditor(t, o ? o.targy : "")
                    }
                }, a.addEventListener("change", e => {
                    if (e.target.classList.contains("pte-row-check")) {
                        const t = e.target.getAttribute("data-id");
                        u.updateCheck(t, e.target.checked)
                    }
                }), document.getElementById("pte-clean-notes").onclick = () => {
                    const t = new Set(e.map(e => e.azonosito)),
                        n = u.cleanup(t);
                    this.showCleanupModal(n)
                }, document.getElementById("pte-col-toggle").onclick = () => {
                    const e = document.getElementById("pte-col-menu");
                    e.style.display = "none" === e.style.display ? "block" : "none"
                }, document.querySelectorAll(".pte-col-check").forEach(e => {
                    e.onchange = () => {
                        t = Array.from(document.querySelectorAll(".pte-col-check:checked")).map(e => e.value), this.updateTable()
                    }
                }), document.getElementById("pte-close").onclick = () => {
                    o && clearInterval(o), i.remove()
                }
            }
        };
    async function b(t = !1) {
        if (n) return;
        n = !0;
        const o = h.getToken();
        if (!o) return alert("Hiba: Jelentkezz be!");
        let s;
        const d = document.getElementById("pte-update-status");
        t ? d && (d.innerText = "Változások keresése... ⏳", d.style.color = "#f59e0b") : (s = document.createElement("div"), Object.assign(s.style, {
            position: "fixed",
            top: "20px",
            right: "20px",
            background: "#2563eb",
            color: "white",
            padding: "12px 24px",
            borderRadius: "8px",
            zIndex: "999999",
            fontWeight: "600",
            boxShadow: "0 4px 6px rgba(0,0,0,0.1)"
        }), s.innerText = "⏳ Adatok előkészítése...", document.body.appendChild(s));
        try {
            const l = await fetch(`https://${a}/ServiceRequest/Read`, {
                    method: "POST",
                    headers: {
                        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "x-requested-with": "XMLHttpRequest"
                    },
                    body: `sort=%24LastModified%24-desc&page=1&pageSize=500&__RequestVerificationToken=${o}&id=5b3a94b5-d565-69c5-a827-5dfb09961fd2`,
                    credentials: "include"
                }),
                {
                    Data: c
                } = await l.json(),
                p = c.filter(e => e.Title === i).map(e => ({
                    Guid: e.Guid,
                    LastModified: e.$LastModified$
                }));
            let u = [];
            if (t) {
                const t = new Map(e.map(e => [e.guid, e])),
                    o = new Set;
                p.forEach(e => {
                    o.add(e.Guid);
                    const n = t.get(e.Guid);
                    (!n || n.lastModified !== e.LastModified || n.felelos && n.felelos.includes("SM_APPsupport")) && u.push(e)
                });
                const i = e.length;
                if (e = e.filter(e => o.has(e.guid)), 0 === u.length && e.length === i) {
                    if (d) {
                        const e = new Date;
                        d.innerText = `Utolsó frissítés: ${e.getHours().toString().padStart(2,"0")}:${e.getMinutes().toString().padStart(2,"0")}`, d.style.color = "#10b981"
                    }
                    return void(n = !1)
                }
                u.length > 0 && d && (d.innerText = `Adatok frissítése (${u.length} db)... ⏳`)
            } else u = p;
            const g = [];
            for (let e = 0; e < u.length; e += r) {
                const n = u.slice(e, e + r);
                !t && s && (s.innerText = `⏳ Mélyadatok lekérése... (${Math.min(e+r,u.length)} / ${u.length})`);
                const o = await Promise.all(n.map(e => h.fetchDetails(e.Guid, e.LastModified)));
                g.push(...o)
            }
            if (t) {
                const t = new Set(g.map(e => e.guid));
                e = e.filter(e => !t.has(e.guid)), e.push(...g), y.updateTable()
            } else e = g, s.remove(), y.buildModal(), y.updateTable();
            const b = document.getElementById("pte-update-status");
            if (b) {
                const e = new Date;
                b.innerText = `Utolsó frissítés: ${e.getHours().toString().padStart(2,"0")}:${e.getMinutes().toString().padStart(2,"0")}`, b.style.color = "#10b981"
            }
        } catch (e) {
            !t && s && s.remove(), d && (d.innerText = "Frissítés sikertelen ❌", d.style.color = "#ef4444"), console.error(e)
        } finally {
            n = !1
        }
    }
    await u.init(), await b(!1), o = setInterval(async () => {
        document.getElementById("pte-modal-overlay") ? (await u.pullUpdates(), b(!0)) : clearInterval(o)
    }, 60 * d * 1e3)
}();