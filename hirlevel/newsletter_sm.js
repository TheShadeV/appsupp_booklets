javascript:(async function () {
    "use strict";

    let ALL_DATA = [];
    let VISIBLE_COLUMNS = ['azonosito', 'targy', 'tipusKat', 'beerkezett', 'tervezettDatum', 'felelos'];
    let isFetching = false;
    let refreshInterval = null;

    const CONFIG = {
        TITLE_FILTER: "Hírlevél igénylése",
        HOSTNAME: location.hostname,
        DEFAULT_WINDOW: 2,
        CONCURRENCY_LIMIT: 3,
        REFRESH_MINUTES: 1,
        
        // --- NPOINT.IO CONFIGURATION ---
        NPOINT_URL: "https://api.npoint.io/51913ae4891fd8eb45bb"
    };

    const HUNGARIAN_CALENDAR = {
        holidays: ['2026-01-01', '2026-01-02', '2026-03-15', '2026-04-03', '2026-04-06', '2026-05-01', '2026-05-25', '2026-08-20', '2026-08-21', '2026-10-23', '2026-11-01', '2026-12-24', '2026-12-25', '2026-12-26'],
        workingSaturdays: ['2026-01-10', '2026-08-08', '2026-12-12']
    };

    const COLUMNS = {
        azonosito: "ID", targy: "Tárgy", tipusKat: "Típus/Kategória", beerkezett: "Beérkezett",
        tervezettDatum: "Tervezett küldés", cimzettek: "Címzettek?", felelos: "Felelős",
        hlFelado: "Feladó", igenylo: "Igénylő", igEmail: "Email", testEmails: "Teszt címek", megjegyzes: "Megjegyzés"
    };

    /* CLOUD SYNCED NOTES MANAGER */
    const Notes = {
        data: {},
        syncTimer: null,
        lastSyncTime: 0,
        isSyncing: false,
        needsSync: false,

        async init() {
            try {
                const res = await fetch(CONFIG.NPOINT_URL);
                this.lastSyncTime = Date.now();

                if (res.ok) {
                    const json = await res.json();
                    if (json && json.smnotes && Object.keys(json.smnotes).length > 0) {
                        this.data = json.smnotes;
                        localStorage.setItem('pte_hirlevel_notes', JSON.stringify(this.data)); 
                    } else {
                        this.loadLocal();
                        this.pushToCloud();
                    }
                } else {
                    console.warn("npoint.io read failed. Using local storage.");
                    this.loadLocal();
                }
            } catch (e) {
                console.warn("Could not reach npoint.io. Using local storage.", e);
                this.loadLocal();
            }
        },

        async pullUpdates() {
            // Prevent overwriting if there are pending local changes waiting to be pushed
            if (!CONFIG.NPOINT_URL || this.syncTimer) return; 
            
            try {
                // Add timestamp cache-buster to ensure we get the absolute latest state
                const res = await fetch(`${CONFIG.NPOINT_URL}?_t=${Date.now()}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json && json.smnotes) {
                        this.data = json.smnotes;
                        localStorage.setItem('pte_hirlevel_notes', JSON.stringify(this.data));
                    }
                }
            } catch (e) {
                console.warn("Background notes sync failed.", e);
            }
        },

        loadLocal() {
            let local = JSON.parse(localStorage.getItem('pte_hirlevel_notes') || '{}');
            let migrated = false;
            // Catch any legacy string notes and convert them
            for (const id in local) {
                if (typeof local[id] === 'string') {
                    local[id] = { text: local[id], checked: false };
                    migrated = true;
                }
            }
            this.data = local;
            if (migrated) {
                localStorage.setItem('pte_hirlevel_notes', JSON.stringify(this.data));
            }
        },

        pushToCloud() {
            if (!CONFIG.NPOINT_URL) return;
            
            // Debounce the network request (wait 1.5s after last change before uploading)
            if (this.syncTimer) clearTimeout(this.syncTimer);
            
            this.syncTimer = setTimeout(async () => {
                try {
                    await fetch(CONFIG.NPOINT_URL, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ smnotes: this.data })
                    });
                } catch (e) {
                    console.error("Failed to sync notes to npoint.io.", e);
                } finally {
                    // Clear the timer so pullUpdates() knows it is safe to pull again
                    this.syncTimer = null; 
                }
            }, 1500);
        },

        getNote(id) { return (this.data[id] || {}).text || ''; },
        isChecked(id) { return !!(this.data[id] || {}).checked; },
        
        save(id, text, checked) {
            const cleanText = (text || '').trim();
            if (!cleanText && !checked) {
                delete this.data[id];
            } else {
                this.data[id] = { text: cleanText, checked: !!checked };
            }
            // 1. Save to local storage for instant UI feeling
            localStorage.setItem('pte_hirlevel_notes', JSON.stringify(this.data));
            // 2. Queue the cloud upload
            this.pushToCloud();
        },
        
        updateNote(id, text) { this.save(id, text, this.isChecked(id)); },
        updateCheck(id, checked) { this.save(id, this.getNote(id), checked); },
        hasNote(id) { return !!this.getNote(id); },
        
        cleanup(activeIdsSet) {
            const orphanedIds = [];
            for (const id in this.data) {
                if (!activeIdsSet.has(id)) {
                    orphanedIds.push(id);
                    delete this.data[id];
                }
            }
            if (orphanedIds.length > 0) {
                localStorage.setItem('pte_hirlevel_notes', JSON.stringify(this.data));
                this.pushToCloud();
            }
            return orphanedIds;
        }
    };

    const DateHelper = {
        MONTHS: { "január": 0, "február": 1, "március": 2, "április": 3, "május": 4, "június": 5, "július": 6, "augusztus": 7, "szeptember": 8, "október": 9, "november": 10, "december": 11 },
        parseHungarian(str) {
            const match = str.match(/(\d{4})\.\s([a-záéíóöőúüű]+)\s(\d+)\.,\s[a-záéíóöőúüű]+\s(\d+):(\d{2}):(\d{2})/i);
            if (!match) return new Date();
            const [, year, month, day, h, m, s] = match;
            return new Date(year, this.MONTHS[month.toLowerCase()], day, h, m, s);
        },
        formatISO(date) { return date.toISOString().split('T')[0]; },
        getDiffWorkdays(targetDate) {
            const today = new Date(); today.setHours(0,0,0,0);
            const target = new Date(targetDate); target.setHours(0,0,0,0);
            if (today.getTime() === target.getTime()) return 0;
            const isFuture = target > today;
            let current = new Date(today), workdays = 0;
            while (current.getTime() !== target.getTime()) {
                current.setDate(current.getDate() + (isFuture ? 1 : -1));
                const dateStr = this.formatISO(current), dayOfWeek = current.getDay();
                const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6), isHoliday = HUNGARIAN_CALENDAR.holidays.includes(dateStr), isWorkingSat = HUNGARIAN_CALENDAR.workingSaturdays.includes(dateStr);
                if ((!isWeekend && !isHoliday) || isWorkingSat) workdays += (isFuture ? 1 : -1);
            }
            return workdays;
        }
    };

    const Scraper = {
        getToken() {
            const cookie = `; ${document.cookie}`.split(`; __RequestVerificationToken=`).pop().split(';').shift();
            return (cookie && cookie !== `; ${document.cookie}`) ? cookie : document.querySelector('input[name="__RequestVerificationToken"]')?.value;
        },
        async fetchDetails(guid, lastModified) {
            const res = await fetch(`https://${CONFIG.HOSTNAME}/ServiceRequest/Dashboard/${guid}`, { credentials: "include" });
            const html = await res.text();
            const doc = new DOMParser().parseFromString(html, "text/html");
            const getTxt = (sel, contextDoc = doc) => contextDoc.querySelector(sel)?.textContent?.trim() || "N/A";
            
            const rawTipus1 = getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(9) > div");
            let tipus1 = "N/A";
            if (rawTipus1.toLowerCase().includes("nem hivatalos")) tipus1 = "Nem hivatalos";
            else if (rawTipus1.toLowerCase().includes("hivatalos")) tipus1 = "Hivatalos";
            else tipus1 = rawTipus1.split(" ")[0]; 
            const tipus2 = getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(10) > div");

            let data = {
                guid: guid,
                lastModified: lastModified,
                azonosito: getTxt("#divServicerequestDetal > div > div.card-body > div.row.dashboardheader > div:nth-child(1) > div > div"),
                targy: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(12) > div"),
                tipusKat: `${tipus1}, ${tipus2}`,
                beerkezett: DateHelper.parseHungarian(getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(20) > div")),
                tervezettDatum: DateHelper.parseHungarian(getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(13) > div")),
                cimzettek: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(14) > div"),
                hlFelado: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(7) > div"),
                igenylo: getTxt("#divUserData > div:nth-child(2) > div > div > div.col-6.text-ellipsis.p-0.ml-2.d-flex.align-items-center > span"),
                igEmail: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(5) > div"),
                testEmails: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(15) > div"),
                megjegyzes: getTxt("#divServicerequestDetal > div > div.card-body > div:nth-child(16) > div"),
                felelos: "Nincs kiosztva",
                maUrl: null 
            };

            const maLink = doc.querySelector('a[href*="/ManualActivity/Dashboard/"]');
            if (maLink) {
                let maUrl = maLink.getAttribute('href');
                if (maUrl.startsWith('/')) maUrl = `https://${CONFIG.HOSTNAME}${maUrl}`;
                data.maUrl = maUrl; 
                try {
                    const maRes = await fetch(maUrl, { credentials: "include" });
                    const maHtml = await maRes.text();
                    const maDoc = new DOMParser().parseFromString(maHtml, "text/html");
                    const felelosText = getTxt("#divUserData > div:nth-child(2) > div", maDoc);
                    if (felelosText !== "N/A") data.felelos = felelosText.replace(/\s+/g, ' ').trim();
                } catch (e) {
                    console.warn(`Nem sikerült lekérni a felelőst a ${data.azonosito} azonosítóhoz.`, e);
                }
            }
            return data;
        }
    };

    const UI = {
        updateTable() {
            const daysLimit = parseInt(document.getElementById("pte-window-input").value) || 0;
            const searchVal = document.getElementById("pte-search-input").value.toLowerCase();
            const sortVal = document.getElementById("pte-sort-select").value;
            const tbody = document.querySelector("#pte-table-body");
            const thead = document.querySelector("#pte-table-head");
            const badge = document.getElementById("pte-count-badge");

            let filtered = ALL_DATA.filter(item => {
                const withinTime = DateHelper.getDiffWorkdays(item.tervezettDatum) <= daysLimit;
                const matchesSearch = Object.values(item).some(val => String(val).toLowerCase().includes(searchVal));
                return withinTime && matchesSearch;
            });

            const [sortKey, sortDir] = sortVal.split("_");
            filtered.sort((a, b) => {
                let valA = a[sortKey];
                let valB = b[sortKey];
                if (valA instanceof Date && valB instanceof Date) return sortDir === 'desc' ? valB - valA : valA - valB;
                else {
                    valA = String(valA || "").toLowerCase();
                    valB = String(valB || "").toLowerCase();
                    if (valA < valB) return sortDir === 'asc' ? -1 : 1;
                    if (valA > valB) return sortDir === 'asc' ? 1 : -1;
                    return 0;
                }
            });

            badge.innerText = `${filtered.length} db`;

            thead.innerHTML = `<tr>${VISIBLE_COLUMNS.map(col => `
                <th style="padding: 10px 12px; color: #64748b; font-size: 0.75rem; text-transform: uppercase; white-space: nowrap;">${COLUMNS[col]}</th>
            `).join('')}</tr>`;

            const now = new Date();
            let lastIsPast = null;

            tbody.innerHTML = filtered.length ? filtered.map((row, idx) => {
                const isPast = row.tervezettDatum < now;
                let separatorHtml = '';

                if (sortKey === 'tervezettDatum') {
                    if (lastIsPast !== null && lastIsPast !== isPast) {
                        separatorHtml = `
                            <tr>
                                <td colspan="${VISIBLE_COLUMNS.length}" style="background: #f8fafc; padding: 12px; text-align: center; font-size: 0.85rem; font-weight: 700; color: #334155; letter-spacing: 2px; border-top: 2px dashed #94a3b8; border-bottom: 2px dashed #94a3b8;">
                                    ⏰ --- JELENLEGI IDŐPONT --- ⏰
                                </td>
                            </tr>
                        `;
                    }
                }
                lastIsPast = isPast;

                const rowBg = isPast ? (idx % 2 === 0 ? '#fff1f2' : '#ffe4e6') : (idx % 2 === 0 ? '#fff' : '#f8fafc');

                let rowHtml = `
                    <tr style="background: ${rowBg}; border-bottom: 1px solid #e2e8f0;">
                        ${VISIBLE_COLUMNS.map(col => {
                            let content = row[col];
                            if (col === 'azonosito') {
                                const maBtn = row.maUrl ? `<a href="${row.maUrl}" target="_blank" style="background: #f59e0b; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold; text-decoration: none; margin-left: 8px; white-space: nowrap;" title="Manual Activity megnyitása">MA</a>` : '';
                                
                                const hasNote = Notes.hasNote(row.azonosito);
                                const isChecked = Notes.isChecked(row.azonosito);
                                
                                const noteColor = hasNote ? '#ef4444' : '#94a3b8';
                                const noteFill = hasNote ? '#ef4444' : 'none';

                                const checkHtml = `<input type="checkbox" class="pte-row-check" data-id="${row.azonosito}" ${isChecked ? 'checked' : ''} style="margin-left: 10px; cursor: pointer; width: 16px; height: 16px; accent-color: #10b981;" title="Feladat megjelölése">`;

                                const noteBtn = `
                                    <button class="pte-note-btn" data-id="${row.azonosito}" style="background:none; border:none; cursor:pointer; margin-left:8px; padding:0; display:flex; align-items:center; color:${noteColor}; transition:color 0.2s;" title="Jegyzet szerkesztése">
                                        <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="${noteFill}" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                            <polyline points="14 2 14 8 20 8"></polyline>
                                            <line x1="16" y1="13" x2="8" y2="13"></line>
                                            <line x1="16" y1="17" x2="8" y2="17"></line>
                                            <polyline points="10 9 9 9 8 9"></polyline>
                                        </svg>
                                    </button>
                                `;

                                content = `<div style="display: flex; align-items: center;"><strong><a href="https://${CONFIG.HOSTNAME}/ServiceRequest/Dashboard/${row.guid}" target="_blank" style="color: #2563eb; text-decoration: none;">${row[col]}</a></strong>${maBtn}${checkHtml}${noteBtn}</div>`;
                            }
                            else if (col === 'targy') content = `<a href="https://hirlevel.pte.hu/news-letters?NewsLettersSearch%5Bsubject%5D=${encodeURIComponent(row[col])}" target="_blank" style="color: #334155; text-decoration: none;">${row[col]}</a>`;
                            else if (col === 'tervezettDatum' || col === 'beerkezett') content = row[col].toLocaleString('hu-HU').slice(0,-3);
                            
                            return `<td style="padding: 10px 12px; ${col === 'tervezettDatum' || col === 'beerkezett' || col === 'azonosito' ? 'white-space: nowrap;' : ''}">${content}</td>`;
                        }).join('')}
                    </tr>
                `;

                return separatorHtml + rowHtml;
            }).join('') : `<tr><td colspan="${VISIBLE_COLUMNS.length}" style="padding: 40px; text-align: center; color: #94a3b8;">Nincs találat.</td></tr>`;
        },

        openNoteEditor(id, title) {
            const old = document.getElementById("pte-note-editor-overlay");
            if (old) old.remove();

            const currentNote = Notes.getNote(id);
            const overlay = document.createElement("div");
            overlay.id = "pte-note-editor-overlay";
            Object.assign(overlay.style, {
                position: "fixed", inset: "0", backgroundColor: "rgba(15, 23, 42, 0.6)", 
                backdropFilter: "blur(2px)", zIndex: "1000000", display: "flex", 
                justifyContent: "center", alignItems: "center", fontFamily: "sans-serif"
            });

            overlay.innerHTML = `
                <div style="background: white; width: 90%; max-width: 500px; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="padding: 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="margin: 0; font-size: 1rem; color: #0f172a; display: flex; align-items: center; gap: 8px;">
                            <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            Jegyzet: <span style="color: #2563eb;">${id}</span>
                        </h3>
                    </div>
                    <div style="padding: 16px; flex: 1;">
                        <p style="margin: 0 0 10px 0; font-size: 0.85rem; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${title}</p>
                        <textarea id="pte-note-textarea" style="width: 100%; height: 180px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 6px; outline: none; font-family: inherit; font-size: 0.95rem; resize: vertical;" placeholder="Ide írhatod a saját megjegyzéseidet...">${currentNote}</textarea>
                    </div>
                    <div style="padding: 16px; background: #f8fafc; border-top: 1px solid #e2e8f0; display: flex; justify-content: flex-end; gap: 10px;">
                        <button id="pte-note-cancel" style="background: white; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem; color: #334155;">Mégse</button>
                        <button id="pte-note-save" style="background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Mentés</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            document.getElementById("pte-note-cancel").onclick = () => overlay.remove();
            document.getElementById("pte-note-save").onclick = () => {
                Notes.updateNote(id, document.getElementById("pte-note-textarea").value);
                this.updateTable();
                overlay.remove();
            };
            document.getElementById("pte-note-textarea").focus();
        },

        showCleanupModal(deletedIds) {
            const overlay = document.createElement("div");
            Object.assign(overlay.style, {
                position: "fixed", inset: "0", backgroundColor: "rgba(15, 23, 42, 0.6)",
                backdropFilter: "blur(2px)", zIndex: "2000000", display: "flex",
                justifyContent: "center", alignItems: "center", fontFamily: "sans-serif"
            });
            
            let contentHtml = '';
            if (deletedIds.length > 0) {
                contentHtml = `<p style="color: #334155;">Sikeresen törölve lett <strong>${deletedIds.length}</strong> árva bejegyzés a felhőből:</p>
                               <ul style="max-height: 150px; overflow: auto; color: #64748b; font-size: 0.85rem; padding-left: 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 10px 10px 30px; margin-top: 10px;">
                                   ${deletedIds.map(id => `<li style="margin-bottom: 4px;">${id}</li>`).join('')}
                               </ul>`;
            } else {
                contentHtml = `<p style="color: #334155;">Nincsenek árva adatok.<br>Minden mentett jegyzet és pipa aktív feladathoz tartozik!</p>`;
            }

            overlay.innerHTML = `
                <div style="background: white; width: 90%; max-width: 400px; border-radius: 12px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); padding: 20px;">
                    <h3 style="margin-top: 0; color: #0f172a; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">🧹 Takarítás eredménye</h3>
                    ${contentHtml}
                    <div style="display: flex; justify-content: flex-end; margin-top: 20px;">
                        <button id="pte-cleanup-close" style="background: #2563eb; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Rendben</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            document.getElementById("pte-cleanup-close").onclick = () => overlay.remove();
        },

        buildModal() {
            const old = document.getElementById("pte-modal-overlay");
            if (old) old.remove();

            const overlay = document.createElement("div");
            overlay.id = "pte-modal-overlay";
            Object.assign(overlay.style, {
                position: "fixed", inset: "0", backgroundColor: "rgba(15, 23, 42, 0.7)", 
                backdropFilter: "blur(4px)", zIndex: "999999", display: "flex", 
                justifyContent: "center", alignItems: "center", fontFamily: "sans-serif"
            });

            overlay.innerHTML = `
                <div style="background: white; width: 98%; max-width: 1900px; height: 95vh; border-radius: 16px; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
                    <div style="padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <h2 style="margin: 0; font-size: 1.1rem; color: #0f172a; white-space: nowrap;">📩 Hírlevelek <span id="pte-count-badge" style="background: #cbd5e1; padding: 2px 8px; border-radius: 20px; font-size: 0.75rem;"></span></h2>
                            <span id="pte-update-status" style="font-size: 0.75rem; color: #64748b; font-weight: 500;"></span>
                        </div>
                        
                        <div style="display: flex; gap: 10px; align-items: center; flex-grow: 1; justify-content: flex-end;">
                            <input type="text" id="pte-search-input" placeholder="Keresés bármire..." style="padding: 6px 12px; border: 1px solid #cbd5e1; border-radius: 6px; width: 250px; outline: none; font-size: 0.85rem;">
                            
                            <div style="display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 8px;">
                                <label style="font-size: 0.7rem; font-weight: bold; color: #64748b;">RENDEZÉS:</label>
                                <select id="pte-sort-select" style="border: none; outline: none; font-size: 0.8rem; background: transparent; cursor: pointer; color: #334155;">
                                    <option value="tervezettDatum_desc">Tervezett küldés (Új elöl)</option>
                                    <option value="tervezettDatum_asc">Tervezett küldés (Régi elöl)</option>
                                    <option value="beerkezett_desc">Beérkezett (Új elöl)</option>
                                    <option value="beerkezett_asc">Beérkezett (Régi elöl)</option>
                                    <option value="azonosito_desc">ID (Csökkenő)</option>
                                    <option value="azonosito_asc">ID (Növekvő)</option>
                                    <option value="targy_asc">Tárgy (A-Z)</option>
                                    <option value="targy_desc">Tárgy (Z-A)</option>
                                </select>
                            </div>

                            <div style="display: flex; align-items: center; gap: 8px; background: white; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 8px;">
                                <label style="font-size: 0.7rem; font-weight: bold; color: #64748b;">MUNKANAP:</label>
                                <input type="number" id="pte-window-input" value="${CONFIG.DEFAULT_WINDOW}" min="0" style="width: 35px; border: none; font-weight: bold; color: #2563eb; outline: none;">
                            </div>

                            <button id="pte-clean-notes" style="background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem; color: #475569; font-weight: 500;" title="Árva jegyzetek törlése a tárhelyről">🧹 Karbantartás</button>

                            <div style="position: relative;">
                                <button id="pte-col-toggle" style="background: white; border: 1px solid #cbd5e1; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">Oszlopok ⚙️</button>
                                <div id="pte-col-menu" style="display: none; position: absolute; right: 0; top: 40px; background: white; border: 1px solid #cbd5e1; border-radius: 8px; box-shadow: 0 10px 15px rgba(0,0,0,0.1); z-index: 100; padding: 10px; width: 180px;">
                                    ${Object.entries(COLUMNS).map(([key, label]) => `
                                        <label style="display: flex; align-items: center; gap: 8px; font-size: 0.8rem; padding: 4px 0; cursor: pointer;">
                                            <input type="checkbox" value="${key}" ${VISIBLE_COLUMNS.includes(key) ? 'checked' : ''} class="pte-col-check"> ${label}
                                        </label>
                                    `).join('')}
                                </div>
                            </div>

                            <button id="pte-close" style="background: #ef4444; color: white; border: none; padding: 7px 14px; border-radius: 6px; cursor: pointer; font-weight: 600; font-size: 0.85rem;">Bezárás</button>
                        </div>
                    </div>
                    <div style="flex: 1; overflow: auto;">
                        <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 0.9rem;">
                            <thead id="pte-table-head" style="position: sticky; top: 0; background: white; box-shadow: 0 1px 0 #e2e8f0; z-index: 10;"></thead>
                            <tbody id="pte-table-body"></tbody>
                        </table>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            document.getElementById("pte-sort-select").onchange = () => this.updateTable();
            document.getElementById("pte-search-input").oninput = () => this.updateTable();
            document.getElementById("pte-window-input").oninput = () => this.updateTable();
            
            const tableBody = document.getElementById("pte-table-body");
            
            tableBody.onclick = (e) => {
                const btn = e.target.closest('.pte-note-btn');
                if (btn) {
                    const id = btn.getAttribute('data-id');
                    const item = ALL_DATA.find(d => d.azonosito === id);
                    this.openNoteEditor(id, item ? item.targy : '');
                }
            };

            tableBody.addEventListener('change', (e) => {
                if (e.target.classList.contains('pte-row-check')) {
                    const id = e.target.getAttribute('data-id');
                    Notes.updateCheck(id, e.target.checked);
                }
            });

            document.getElementById("pte-clean-notes").onclick = () => {
                const activeIds = new Set(ALL_DATA.map(d => d.azonosito));
                const deletedIds = Notes.cleanup(activeIds);
                this.showCleanupModal(deletedIds);
            };

            document.getElementById("pte-col-toggle").onclick = () => {
                const m = document.getElementById("pte-col-menu");
                m.style.display = m.style.display === 'none' ? 'block' : 'none';
            };
            
            document.querySelectorAll(".pte-col-check").forEach(chk => {
                chk.onchange = () => {
                    VISIBLE_COLUMNS = Array.from(document.querySelectorAll(".pte-col-check:checked")).map(c => c.value);
                    this.updateTable();
                };
            });

            document.getElementById("pte-close").onclick = () => {
                if (refreshInterval) clearInterval(refreshInterval);
                overlay.remove();
            };
        }
    };

    /* ENGINE CORE */
    async function fetchAllData(isSilentBackground = false) {
        if (isFetching) return;
        isFetching = true;

        const token = Scraper.getToken();
        if (!token) return alert("Hiba: Jelentkezz be!");

        let loading;
        const statusText = document.getElementById("pte-update-status");

        if (!isSilentBackground) {
            loading = document.createElement("div");
            Object.assign(loading.style, { position: "fixed", top: "20px", right: "20px", background: "#2563eb", color: "white", padding: "12px 24px", borderRadius: "8px", zIndex: "999999", fontWeight: "600", boxShadow: "0 4px 6px rgba(0,0,0,0.1)" });
            loading.innerText = "⏳ Adatok előkészítése...";
            document.body.appendChild(loading);
        } else if (statusText) {
            statusText.innerText = "Változások keresése... ⏳";
            statusText.style.color = "#f59e0b"; 
        }

        try {
            const res = await fetch(`https://${CONFIG.HOSTNAME}/ServiceRequest/Read`, {
                method: "POST",
                headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8", "x-requested-with": "XMLHttpRequest" },
                body: `sort=%24LastModified%24-desc&page=1&pageSize=500&__RequestVerificationToken=${token}&id=5b3a94b5-d565-69c5-a827-5dfb09961fd2`,
                credentials: "include"
            });
            const { Data } = await res.json();
            
            const activeItems = Data
                .filter(i => i.Title === CONFIG.TITLE_FILTER)
                .map(i => ({
                    Guid: i.Guid,
                    LastModified: i["$LastModified$"]
                }));

            let itemsToFetch = [];

            if (isSilentBackground) {
                const currentMap = new Map(ALL_DATA.map(d => [d.guid, d]));
                const activeGuidSet = new Set();

                activeItems.forEach(item => {
                    activeGuidSet.add(item.Guid);
                    const existingData = currentMap.get(item.Guid);

                    if (
                        !existingData || 
                        existingData.lastModified !== item.LastModified || 
                        (existingData.felelos && existingData.felelos.includes("SM_APPsupport"))
                    ) {
                        itemsToFetch.push(item);
                    }
                });

                const originalLength = ALL_DATA.length;
                ALL_DATA = ALL_DATA.filter(d => activeGuidSet.has(d.guid));

                if (itemsToFetch.length === 0 && ALL_DATA.length === originalLength) {
                    if (statusText) {
                        const now = new Date();
                        statusText.innerText = `Utolsó frissítés: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                        statusText.style.color = "#10b981";
                    }
                    isFetching = false;
                    return;
                }

                if (itemsToFetch.length > 0 && statusText) {
                    statusText.innerText = `Adatok frissítése (${itemsToFetch.length} db)... ⏳`;
                }

            } else {
                itemsToFetch = activeItems;
            }

            const newResults = [];
            for (let i = 0; i < itemsToFetch.length; i += CONFIG.CONCURRENCY_LIMIT) {
                const chunk = itemsToFetch.slice(i, i + CONFIG.CONCURRENCY_LIMIT);
                if (!isSilentBackground && loading) {
                    loading.innerText = `⏳ Mélyadatok lekérése... (${Math.min(i + CONFIG.CONCURRENCY_LIMIT, itemsToFetch.length)} / ${itemsToFetch.length})`;
                }
                const chunkResults = await Promise.all(chunk.map(item => Scraper.fetchDetails(item.Guid, item.LastModified)));
                newResults.push(...chunkResults);
            }
            
            if (isSilentBackground) {
                const updatedGuids = new Set(newResults.map(r => r.guid));
                ALL_DATA = ALL_DATA.filter(d => !updatedGuids.has(d.guid));
                
                ALL_DATA.push(...newResults); 
                UI.updateTable(); 
            } else {
                ALL_DATA = newResults; 
                loading.remove();
                UI.buildModal();
                UI.updateTable();
            }

            const finalStatusText = document.getElementById("pte-update-status");
            if (finalStatusText) {
                const now = new Date();
                finalStatusText.innerText = `Utolsó frissítés: ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
                finalStatusText.style.color = "#10b981"; 
            }

        } catch (e) {
            if (!isSilentBackground && loading) loading.remove();
            if (statusText) {
                statusText.innerText = "Frissítés sikertelen ❌";
                statusText.style.color = "#ef4444";
            }
            console.error(e);
        } finally {
            isFetching = false;
        }
    }

    // Initialize Notes from npoint.io, THEN fetch the dashboard data
    await Notes.init();
    await fetchAllData(false);

    refreshInterval = setInterval(async () => {
        if (document.getElementById("pte-modal-overlay")) {
            // First strictly fetch the background notes and await it
            await Notes.pullUpdates();
            // Then run the dashboard logic which updates the UI automatically
            fetchAllData(true); 
        } else {
            clearInterval(refreshInterval); 
        }
    }, CONFIG.REFRESH_MINUTES * 60 * 1000);

})();