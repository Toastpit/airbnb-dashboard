const $ = (id) => document.getElementById(id);

const el = {
  yearSel: $("yearSel"),
  btnReload: $("btnReload"),
  btnAdd: $("btnAdd"),
  btnLogout: $("btnLogout"),
  btnSettings: $("btnSettings"),

  loginPanel: $("loginPanel"),
  dataPanel: $("dataPanel"),
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
  f_kur_incl: $("f_kur_incl"),
  f_l_booked: $("f_l_booked"),
  f_l_incl: $("f_l_incl"),
  f_l_paid: $("f_l_paid"),
  f_l_fee: $("f_l_fee"),
  f_notes: $("f_notes"),
  f_guest: $("f_guest"),
};

let state = { years: [], year: 2026, bookings: [] };
let editingId = null;

let tokens = { status: [], source: [], paid: [], kurtaxe: [] };
let tokenMap = { status: {}, source: {}, paid: {}, kurtaxe: {} }; // id -> item

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



function showLoggedIn(ok) {
  el.loginPanel.style.display = ok ? "none" : "";
  el.dataPanel.style.display = ok ? "" : "none";
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


    kurkarte_included: el.f_kur_incl.checked ? 1 : 0,
    laundry_booked: el.f_l_booked.checked ? 1 : 0,
    laundry_included: el.f_l_incl.checked ? 1 : 0,
    laundry_paid: el.f_l_paid.checked ? 1 : 0,
    laundry_fee: Number(el.f_l_fee.value || 0),
    notes: el.f_notes.value || "",
    guest_name: el.f_guest.value?.trim() || "",
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

function renderBookings() {
  const rows = (state.bookings || []).map(b => {
    const st = tokenMap.status[b.status_id]?.name || b.status || "";
    const src = tokenMap.source[b.source_id]?.name || b.source || "";
    const pay = tokenMap.paid[b.paid_status_id]?.name || b.paid_status || "";
    const kt = tokenMap.kurtaxe[b.kurtaxe_status_id]?.name || b.kurtaxe_status || "";

    return `
      <tr data-id="${b.id}">
        <td>${escapeHtml(st)}</td>
        <td>${escapeHtml(b.check_in)} → ${escapeHtml(b.check_out)}</td>
        <td>${escapeHtml(b.guest_name || "")}</td>
        <td>${escapeHtml(src)}</td>
        <td>${Number(b.persons || 1)}</td>
        <td>${Number(b.price_total || 0).toFixed(2)}</td>
        <td>${escapeHtml(pay)}</td>
        <td>${Number(b.kurtaxe_total || 0).toFixed(2)} (${escapeHtml(kt)})</td>
        <td>${b.laundry_booked
        ? `🧺 ${Number(b.laundry_fee || 0).toFixed(2)} CHF${b.laundry_included ? " (inkl.)" : ""} ${b.laundry_paid ? "✅" : ""}`
        : ""
      }</td>

        <td>${escapeHtml((b.notes || "").slice(0, 24))}${(b.notes || "").length > 24 ? "…" : ""}</td>
      </tr>
    `;
  }).join("");

  el.table.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Status</th><th>Datum</th><th>Gast</th><th>Quelle</th><th>Personen</th><th>Preis</th>
          <th>Bezahlt</th><th>Kurtaxe</th><th>Wäsche</th><th>Notiz</th>
        </tr>
      </thead>
      <tbody>${rows || `<tr><td colspan="10">Keine Einträge</td></tr>`}</tbody>
    </table>
    <div class="hint" style="padding-top:10px;">Click auf Zeile = Edit</div>
  `;

  el.table.querySelectorAll("tr[data-id]").forEach(tr => {
    tr.addEventListener("click", () => openEditDialog(Number(tr.dataset.id)));
  });
}


async function loadBookings() {
  const year = Number(el.yearSel.value || state.year || 2026);
  state.year = year;

  const { res, data } = await api(`/api/bookings?year=${encodeURIComponent(year)}`);
  if (!res.ok) { showLoggedIn(false); return; }

  state.bookings = data.bookings || [];
  renderBookings();
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
  const { res, data } = await api("/api/login", {
    method: "POST",
    body: JSON.stringify({ password: el.pw.value })
  });

  if (!res.ok) {
    if (data.error === "locked") el.loginMsg.textContent = "Zu viele Versuche – gesperrt.";
    else el.loginMsg.textContent = `Falsch. (${data.fails || 0}/3)`;
    return;
  }

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
el.pw.addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

el.btnLogout.addEventListener("click", logout);
el.btnReload.addEventListener("click", async () => { await loadYears(); await loadTokens(); await loadBookings(); });
el.btnAdd.addEventListener("click", (e) => { e.preventDefault(); openCreateDialog(); });
el.yearSel.addEventListener("change", loadBookings);

el.btnSave.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  const payload = readForm();
  if (!payload.check_in || !payload.check_out) return alert("Check-in / Check-out fehlt");

  if (editingId == null) {
    await authed("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
  } else {
    await authed(`/api/bookings/${editingId}`, { method: "PUT", body: JSON.stringify(payload) });
  }

  el.dlg.close();
  await loadYears();
  await loadBookings();
  await loadTokens();
});

el.btnDelete.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (editingId == null) return;
  if (!confirm("Wirklich löschen?")) return;

  await authed(`/api/bookings/${editingId}`, { method: "DELETE" });
  el.dlg.close();
  await loadYears();
  await loadBookings();
  await loadTokens();
});

(async () => {
  const ok = await loadYears();
  showLoggedIn(ok);
  if (ok) {
    await loadTokens();
    await loadBookings();
    await loadTokens();
  }
})();


el.btnSettings.onclick = () => location.href = "/settings.html";