const $ = (id) => document.getElementById(id);

// Toast-Notification System
function showToast(message, type = "success") {
  const container = $("toastContainer") || document.body;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  const icon = type === "success" ? "✓" : type === "error" ? "✕" : "ℹ";
  toast.innerHTML = `<span style="font-size:18px;">${icon}</span><span>${escapeHtml(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = "slideOut 0.3s ease";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

const el = {
  yearSel: $("yearSel"),
  btnReload: $("btnReload"),
  btnAdd: $("btnAdd"),
  btnLogout: $("btnLogout"),
  btnSettings: $("btnSettings"),

  stats: $("stats"),
  statRevenue: $("stat-revenue"),
  statNet: $("stat-net"),
  statKt: $("stat-kt"),
  statClean: $("stat-clean"),
  statLaundry: $("stat-laundry"),

  loginPanel: $("loginPanel"),
  dataPanel: $("dataPanel"),
  username: $("username"),
  pw: $("pw"),
  btnLogin: $("btnLogin"),
  loginMsg: $("loginMsg"),

  table: $("table"),

  dlg: $("dlgEdit"),
  dlgTitle: $("dlgTitle"),
  btnSave: $("btnSave"),
  btnDelete: $("btnDelete"),

  f_year: $("f_year"),
  f_status: $("f_status"),
  f_source: $("f_source"),
  f_persons: $("f_persons"),
  f_in: $("f_in"),
  f_out: $("f_out"),
  f_booked: $("f_booked"),
  f_price: $("f_price"),
  f_paid: $("f_paid"),
  f_clean: $("f_clean"),
  f_clean_paid: $("f_clean_paid"),
  f_kt: $("f_kt"),
  f_kt_status: $("f_kt_status"),
  f_kt_paid: $("f_kt_paid"),
  f_kur_incl: $("f_kur_incl"),
  f_l_booked: $("f_l_booked"),
  f_l_incl: $("f_l_incl"),
  f_l_paid: $("f_l_paid"),
  f_l_fee: $("f_l_fee"),
  f_notes: $("f_notes"),
  f_guest: $("f_guest"),

  guestsList: $("guestsList"),
  btnAddGuest: $("btnAddGuest"),
  btnCalcKurtaxe: $("btnCalcKurtaxe"),
};

let state = { years: [], year: 2026, bookings: [] };
let editingId = null;
let session = { isAdmin: false, viewer: false, editor: false, statistics: false };

let tokens = { status: [], source: [], paid: [], kurtaxe: [] };
let tokenMap = { status: {}, source: {}, paid: {}, kurtaxe: {} }; // id -> item

let guests = []; // {name: "", age: 0}
let kurtaxeConfig = [];

function buildTokenMaps() {
  tokenMap = { status: {}, source: {}, paid: {}, kurtaxe: {} };
  for (const k of Object.keys(tokens)) {
    for (const it of (tokens[k] || [])) tokenMap[k][it.id] = it;
  }
}

function fillSelect(selectEl, items, currentId, fallbackId) {
  selectEl.innerHTML = "";
  const active = (items || []).filter(x => x.active);
  // sort by sort then name
  active.sort((a, b) => (a.sort ?? 9999) - (b.sort ?? 9999) || String(a.name).localeCompare(String(b.name), "de"));

  for (const it of active) {
    const opt = document.createElement("option");
    opt.value = it.id;
    opt.textContent = it.name;
    selectEl.appendChild(opt);
  }

  const wanted = currentId || fallbackId || (active[0]?.id ?? "");
  if (wanted) selectEl.value = wanted;
}

async function loadTokens() {
  const data = await authed("/api/settings");
  tokens.status = data.status || [];
  tokens.source = data.source || [];
  tokens.paid = data.paid || [];
  tokens.kurtaxe = data.kurtaxe || [];
  buildTokenMaps();
}

async function loadKurtaxeConfig() {
  try {
    const data = await authed("/api/kurtaxe-config");
    kurtaxeConfig = data.config || [];
  } catch (e) {
    console.error("Kurtaxe config load failed", e);
  }
}

// Gäste-Verwaltung
function renderGuests() {
  el.guestsList.innerHTML = "";

  if (!guests.length) {
    el.guestsList.innerHTML = '<div class="hint muted">Keine Gäste hinzugefügt</div>';
    return;
  }

  guests.forEach((guest, idx) => {
    const div = document.createElement("div");
    div.className = "guest-item";
    div.innerHTML = `
      <input type="text" placeholder="Name" value="${escapeHtml(guest.name || "")}" data-idx="${idx}" data-field="name">
      <input type="number" placeholder="Alter" value="${guest.age || 0}" min="0" max="120" data-idx="${idx}" data-field="age">
      <button type="button" class="btn tiny ghost" data-idx="${idx}" data-action="remove">🗑</button>
    `;
    el.guestsList.appendChild(div);
  });

  // Event listeners
  el.guestsList.querySelectorAll("input").forEach(inp => {
    inp.addEventListener("input", (e) => {
      const idx = Number(e.target.dataset.idx);
      const field = e.target.dataset.field;
      if (field === "name") guests[idx].name = e.target.value;
      else if (field === "age") guests[idx].age = Number(e.target.value) || 0;
    });
  });

  el.guestsList.querySelectorAll("button[data-action='remove']").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      guests.splice(idx, 1);
      renderGuests();
    });
  });
}

function addGuest() {
  if (guests.length >= 4) {
    showToast("Maximal 4 Gäste möglich", "error");
    return;
  }
  guests.push({ name: "", age: 0 });
  renderGuests();
}

// Kurtaxe-Berechnung
function isHighSeason(date) {
  const d = new Date(date);
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();

  // Hauptsaison: 15. März - 31. Oktober
  if (month > 3 && month < 11) return true; // April-Oktober
  if (month === 3 && day >= 15) return true; // ab 15. März
  if (month === 11 && day <= 31) return false; // November
  return false;
}

function calculateKurtaxe() {
  const checkIn = el.f_in.value;
  const checkOut = el.f_out.value;

  if (!checkIn || !checkOut) {
    showToast("Check-in und Check-out erforderlich", "error");
    return;
  }

  if (!guests.length) {
    showToast("Bitte Gäste hinzufügen", "error");
    return;
  }

  const days = calculateDays(checkIn, checkOut);
  if (days <= 0) {
    showToast("Ungültige Daten", "error");
    return;
  }

  console.log("=== Kurtaxe Berechnung ===");
  console.log("Gäste:", guests);
  console.log("Kurtaxe Config:", kurtaxeConfig);
  console.log("Tage:", days);

  let total = 0;
  let highSeasonNights = 0;
  let lowSeasonNights = 0;

  // Berechne jede einzelne Nacht separat
  const startDate = new Date(checkIn);

  for (let i = 0; i < days; i++) {
    const currentDate = new Date(startDate);
    currentDate.setDate(startDate.getDate() + i);

    const dateString = currentDate.toISOString().split('T')[0];
    const isHigh = isHighSeason(dateString);

    console.log(`Nacht ${i}: ${dateString}, Saison: ${isHigh ? 'Haupt' : 'Neben'}`);

    if (isHigh) highSeasonNights++;
    else lowSeasonNights++;

    // Für jeden Gast die passende Rate für diese Nacht finden
    guests.forEach((guest, guestIdx) => {
      console.log(`  Gast ${guestIdx}: Alter=${guest.age}`);

      if (!guest.age && guest.age !== 0) {
        console.log(`    -> Übersprungen (kein Alter)`);
        return;
      }

      // Finde passende Kurtaxe-Config basierend auf Alter
      const config = kurtaxeConfig.find(c => guest.age >= c.age_min && guest.age <= c.age_max);
      console.log(`    -> Config gefunden:`, config);

      if (!config) {
        console.log(`    -> Keine Config für Alter ${guest.age}`);
        return;
      }

      // Wähle Rate basierend auf Saison dieser Nacht
      const rate = isHigh ? config.rate_high_season : config.rate_low_season;
      console.log(`    -> Rate: ${rate}€`);
      total += rate;
    });
  }

  console.log("Gesamt:", total);
  el.f_kt.value = total.toFixed(2);

  let msg = `Kurtaxe berechnet: ${total.toFixed(2)} € (${guests.length} Gäste)`;
  if (highSeasonNights > 0 && lowSeasonNights > 0) {
    msg += `\n${highSeasonNights}× Hauptsaison + ${lowSeasonNights}× Nebensaison`;
  } else if (highSeasonNights > 0) {
    msg += `\n${highSeasonNights} Nächte Hauptsaison`;
  } else {
    msg += `\n${lowSeasonNights} Nächte Nebensaison`;
  }

  showToast(msg, "success");
}



function showLoggedIn(ok) {
  el.loginPanel.style.display = ok ? "none" : "";
  el.dataPanel.style.display = ok ? "" : "none";

  // Statistics nur wenn Berechtigung vorhanden
  el.stats.style.display = (ok && session.statistics) ? "flex" : "none";

  // Edit-Buttons nur wenn Editor-Berechtigung
  if (el.btnAdd) el.btnAdd.style.display = (ok && session.editor) ? "" : "none";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function authed(path, opts = {}) {
  const { res, data } = await api(path, opts);
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function fillForm(b) {
  el.f_year.value = b.year ?? Number(el.yearSel.value || 2026);

  el.f_persons.value = b.persons ?? 1;
  el.f_in.value = b.check_in ?? "";
  el.f_out.value = b.check_out ?? "";
  el.f_booked.value = b.booked_at ? b.booked_at.slice(0, 16) : "";
  el.f_price.value = b.price_total ?? 0;
  el.f_clean.value = b.cleaning_fee ?? 0;
  el.f_clean_paid.checked = !!b.cleaning_paid;
  el.f_guest.value = b.guest_name ?? "";
  el.f_kt.value = b.kurtaxe_total ?? 0;
  el.f_kt_paid.checked = !!b.kurtaxe_paid;
  el.f_clean.value = b.cleaning_fee ?? 100;
  el.f_l_fee.value = b.laundry_fee ?? 0;


  el.f_kur_incl.checked = !!b.kurkarte_included;
  el.f_l_booked.checked = !!b.laundry_booked;
  el.f_l_incl.checked = !!b.laundry_included;
  el.f_l_paid.checked = !!b.laundry_paid;
  el.f_notes.value = b.notes ?? "";
  fillSelect(el.f_status, tokens.status, b.status_id, "st_inquiry");
  fillSelect(el.f_source, tokens.source, b.source_id, "src_airbnb");
  fillSelect(el.f_paid, tokens.paid, b.paid_status_id, "pay_unpaid");
  fillSelect(el.f_kt_status, tokens.kurtaxe, b.kurtaxe_status_id, "kt_open");

  // Gäste laden
  try {
    guests = b.guests ? JSON.parse(b.guests) : [];
  } catch (e) {
    guests = [];
  }
  renderGuests();
}

function readForm() {

  return {
    year: Number(el.f_year.value || el.yearSel.value || 2026),


    persons: Number(el.f_persons.value || 1),
    check_in: el.f_in.value,
    check_out: el.f_out.value,
    booked_at: el.f_booked.value ? new Date(el.f_booked.value).toISOString() : null,
    price_total: Number(el.f_price.value || 0),

    cleaning_fee: Number(el.f_clean.value || 0),
    cleaning_paid: el.f_clean_paid.checked ? 1 : 0,
    kurtaxe_total: Number(el.f_kt.value || 0),
    kurtaxe_paid: el.f_kt_paid.checked ? 1 : 0,

    kurkarte_included: el.f_kur_incl.checked ? 1 : 0,
    laundry_booked: el.f_l_booked.checked ? 1 : 0,
    laundry_included: el.f_l_incl.checked ? 1 : 0,
    laundry_paid: el.f_l_paid.checked ? 1 : 0,
    laundry_fee: Number(el.f_l_fee.value || 0),
    notes: el.f_notes.value || "",
    guest_name: el.f_guest.value?.trim() || "",
    guests: guests.length > 0 ? guests : null,
    status_id: el.f_status.value,
    source_id: el.f_source.value,
    paid_status_id: el.f_paid.value,
    kurtaxe_status_id: el.f_kt_status.value,

  };
}

async function loadYears() {
  const { res, data } = await api("/api/years");
  if (!res.ok) return false;

  state.years = data.years?.length ? data.years : [2026];
  if (!state.years.includes(state.year)) state.year = state.years[0];

  el.yearSel.innerHTML = "";
  state.years.forEach(y => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    if (y === state.year) opt.selected = true;
    el.yearSel.appendChild(opt);
  });

  return true;
}

function calculateDays(checkIn, checkOut) {
  if (!checkIn || !checkOut) return 0;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

function updateStats() {
  const bookings = state.bookings || [];

  // Gesamteinnahmen
  const totalRevenue = bookings.reduce((sum, b) => sum + Number(b.price_total || 0), 0);

  // Offene Kurtaxe (nicht bezahlt)
  const openKurtaxe = bookings
    .filter(b => !b.kurtaxe_paid)
    .reduce((sum, b) => sum + Number(b.kurtaxe_total || 0), 0);

  // Offene Reinigung (nicht bezahlt)
  const openCleaning = bookings
    .filter(b => !b.cleaning_paid)
    .reduce((sum, b) => sum + Number(b.cleaning_fee || 0), 0);

  // Offene Wäsche (nicht bezahlt)
  const openLaundry = bookings
    .filter(b => b.laundry_booked && !b.laundry_paid)
    .reduce((sum, b) => sum + Number(b.laundry_fee || 0), 0);

  // Netto-Einnahmen (Einnahmen minus alle Kosten)
  const totalCosts = bookings.reduce((sum, b) => {
    return sum +
      Number(b.kurtaxe_total || 0) +
      Number(b.cleaning_fee || 0) +
      (b.laundry_booked ? Number(b.laundry_fee || 0) : 0);
  }, 0);
  const netRevenue = totalRevenue - totalCosts;

  // Anzeige aktualisieren
  el.statRevenue.textContent = `${totalRevenue.toFixed(2)} €`;
  el.statNet.textContent = `${netRevenue.toFixed(2)} €`;
  el.statKt.textContent = `${openKurtaxe.toFixed(2)} €`;
  el.statClean.textContent = `${openCleaning.toFixed(2)} €`;
  el.statLaundry.textContent = `${openLaundry.toFixed(2)} €`;
}

function renderBookings() {
  const rows = (state.bookings || []).map(b => {
    const st = tokenMap.status[b.status_id]?.name || b.status || "";
    const stColor = tokenMap.status[b.status_id]?.color || null;
    const src = tokenMap.source[b.source_id]?.name || b.source || "";
    const pay = tokenMap.paid[b.paid_status_id]?.name || b.paid_status || "";
    const kt = tokenMap.kurtaxe[b.kurtaxe_status_id]?.name || b.kurtaxe_status || "";
    const days = calculateDays(b.check_in, b.check_out);

    const statusStyle = stColor ? `style="background-color: ${escapeHtml(stColor)}; color: #000; font-weight: 600; padding: 6px 8px;"` : '';

    // Kurtaxe mit Details (wie Wäsche)
    const kurtaxeDisplay = b.kurtaxe_total > 0
      ? `${Number(b.kurtaxe_total || 0).toFixed(2)} €${b.kurkarte_included ? " <span class='badge-mini'>inkl.</span>" : ""} <span class='badge-status'>${escapeHtml(kt)}</span>${b.kurtaxe_paid ? " ✅" : ""}`
      : "-";

    // Wäsche mit verbessertem Format
    const laundryDisplay = b.laundry_booked
      ? `🧺 ${Number(b.laundry_fee || 0).toFixed(2)} €${b.laundry_included ? " <span class='badge-mini'>inkl.</span>" : ""} ${b.laundry_paid ? "✅" : ""}`
      : "-";

    // Reinigung
    const cleaningDisplay = b.cleaning_fee > 0
      ? `${Number(b.cleaning_fee || 0).toFixed(2)} € ${b.cleaning_paid ? "✅" : ""}`
      : "-";

    return `
      <tr data-id="${b.id}">
        <td ${statusStyle}>${escapeHtml(st)}</td>
        <td>${escapeHtml(b.check_in)} → ${escapeHtml(b.check_out)}</td>
        <td class="centered">${days > 0 ? days : "-"}</td>
        <td>${escapeHtml(b.guest_name || "")}</td>
        <td>${escapeHtml(src)}</td>
        <td class="centered">${Number(b.persons || 1)}</td>
        <td class="price">${Number(b.price_total || 0).toFixed(2)} €</td>
        <td><span class='badge-status'>${escapeHtml(pay)}</span></td>
        <td>${kurtaxeDisplay}</td>
        <td>${cleaningDisplay}</td>
        <td>${laundryDisplay}</td>
        <td class="notes">${escapeHtml((b.notes || "").slice(0, 24))}${(b.notes || "").length > 24 ? "…" : ""}</td>
      </tr>
    `;
  }).join("");

  const hintText = session.editor
    ? "Click auf Zeile = Edit"
    : "Nur Ansicht (keine Editor-Rechte)";

  el.table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Status</th><th>Datum</th><th>Tage</th><th>Gast</th><th>Quelle</th><th>Personen</th><th>Preis</th>
          <th>Bezahlt</th><th>Kurtaxe</th><th>Reinigung</th><th>Wäsche</th><th>Notiz</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="12">Keine Einträge</td></tr>`}</tbody>
    </table>
    <div class="hint" style="padding-top:10px;">${hintText}</div>
  `;

  if (session.editor) {
    el.table.querySelectorAll("tr[data-id]").forEach(tr => {
      tr.addEventListener("click", () => openEditDialog(Number(tr.dataset.id)));
    });
  }
}


async function loadBookings() {
  const year = Number(el.yearSel.value || state.year || 2026);
  state.year = year;

  const { res, data } = await api(`/api/bookings?year=${encodeURIComponent(year)}`);
  if (!res.ok) { showLoggedIn(false); return; }

  state.bookings = data.bookings || [];
  renderBookings();
  updateStats();
}

function recalcLaundry() {
  const persons = Number(el.f_persons.value || 1);
  if (el.f_l_booked.checked) {
    el.f_l_fee.value = (persons * 15).toFixed(2);
  }
}

// Listener EINMAL registrieren (nicht bei jedem Dialog-Open)
el.f_l_booked.addEventListener("change", recalcLaundry);
el.f_persons.addEventListener("change", recalcLaundry);

function openCreateDialog() {
  editingId = null;
  el.btnDelete.style.display = "none";
  el.dlgTitle.textContent = "Eintrag (neu)";

  guests = []; // Gäste-Liste leeren

  fillForm({
    year: state.year,
    status_id: "st_inquiry",
    source_id: "src_airbnb",
    paid_status_id: "pay_unpaid",
    kurtaxe_status_id: "kt_open",
    cleaning_fee: 100,
    laundry_booked: 1,
    laundry_included: 1,
    kurkarte_included: 1,
  });

  recalcLaundry();       // setzt laundry_fee direkt
  el.dlg.showModal();    // DAS hat gefehlt
}



async function openEditDialog(id) {
  const b = await authed(`/api/bookings/${id}`);
  editingId = id;
  el.btnDelete.style.display = "";
  el.dlgTitle.textContent = `Edit #${id}`;
  fillForm(b);
  el.dlg.showModal();
}



async function login() {
  el.loginMsg.textContent = "";
  const username = el.username.value.trim();
  const password = el.pw.value;

  const { res, data } = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ username: username || undefined, password })
  });

  if (!res.ok) {
    if (data.error === "locked") el.loginMsg.textContent = "Zu viele Versuche – gesperrt.";
    else if (data.error === "no_permissions") el.loginMsg.textContent = "Keine Berechtigungen vergeben.";
    else el.loginMsg.textContent = `Falsch. (${data.fails || 0}/3)`;
    return;
  }

  // Session Daten speichern
  session = {
    isAdmin: data.isAdmin || false,
    viewer: data.viewer || false,
    editor: data.editor || false,
    statistics: data.statistics || false,
    name: data.name || "User"
  };

  showLoggedIn(true);
  await loadTokens();
  await loadYears();
  await loadBookings();
}

async function logout() {
  await api("/api/logout", { method: "POST" });
  showLoggedIn(false);
}

el.btnLogin.addEventListener("click", login);
el.username.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
el.pw.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

el.btnLogout.addEventListener("click", logout);
el.btnReload.addEventListener("click", async () => { await loadYears(); await loadTokens(); await loadKurtaxeConfig(); await loadBookings(); });
el.btnAdd.addEventListener("click", (e) => { e.preventDefault(); openCreateDialog(); });
el.yearSel.addEventListener("change", loadBookings);

el.btnAddGuest.addEventListener("click", addGuest);
el.btnCalcKurtaxe.addEventListener("click", calculateKurtaxe);

el.btnSave.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const payload = readForm();
  if (!payload.check_in || !payload.check_out) {
    showToast("Check-in / Check-out fehlt", "error");
    return;
  }

  try {
    if (editingId == null) {
      await authed("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
      showToast("Buchung erstellt ✓", "success");
    } else {
      await authed(`/api/bookings/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
      showToast("Buchung gespeichert ✓", "success");
    }
  } catch (e) {
    showToast(e.message || "Fehler beim Speichern", "error");
    return;
  }

  el.dlg.close();

  // Jahr der gespeicherten Buchung merken
  const savedYear = payload.year;

  // Jahre neu laden
  await loadYears();
  await loadTokens();

  // Zum Jahr der gespeicherten Buchung wechseln
  if (savedYear && savedYear !== state.year) {
    state.year = savedYear;
    el.yearSel.value = savedYear;
  }

  await loadBookings(); // Wichtig: loadBookings ruft updateStats() auf
});

el.btnDelete.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (editingId == null) return;
  if (!confirm("Wirklich löschen?")) return;

  await authed(`/api/bookings/${editingId}`, { method: "DELETE" });
  el.dlg.close();
  await loadYears();
  await loadTokens();
  await loadBookings(); // Wichtig: loadBookings ruft updateStats() auf
});

(async () => {
  const ok = await loadYears();
  if (ok) {
    // Check session permissions
    try {
      const sessionData = await authed("/api/session");
      session = {
        isAdmin: sessionData.isAdmin || false,
        viewer: sessionData.viewer || false,
        editor: sessionData.editor || false,
        statistics: sessionData.statistics || false,
        name: sessionData.name || "User"
      };
    } catch (e) {
      // Session check failed, not logged in
      showLoggedIn(false);
      return;
    }
  }
  showLoggedIn(ok);
  if (ok) {
    await loadTokens();
    await loadKurtaxeConfig();
    await loadBookings();
  }
})();


el.btnSettings.onclick = () => location.href = "/settings.html";