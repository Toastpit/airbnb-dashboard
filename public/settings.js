const $ = (id) => document.getElementById(id);

const el = {
    btnBack: $("btnBack"),
    btnReload: $("btnReload"),
    btnLogout: $("btnLogout"),
    msg: $("msg"),

    // Status
    new_status: $("new_status"),
    add_status: $("add_status"),
    list_status: $("list_status"),

    // Source
    new_source: $("new_source"),
    add_source: $("add_source"),
    list_source: $("list_source"),

    // Paid
    new_paid: $("new_paid"),
    add_paid: $("add_paid"),
    list_paid: $("list_paid"),

    // Kurtaxe
    new_kurtaxe: $("new_kurtaxe"),
    add_kurtaxe: $("add_kurtaxe"),
    list_kurtaxe: $("list_kurtaxe"),
};

function setMsg(t, bad = false) {
    el.msg.textContent = t;
    el.msg.style.color = bad ? "#b91c1c" : "";
}

async function api(path, opts = {}) {
    const res = await fetch(path, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(opts.headers || {}) }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

function normalizeSettingsPayload(s) {
    const statuses = s.statuses ?? s.booking_statuses ?? s.bookingStatuses ?? [];
    const sources = s.sources ?? s.source_tokens ?? s.booking_sources ?? [];

    const paid = s.paid_statuses ?? s.paid ?? [];
    const kurtaxe = s.kurtaxe_statuses ?? s.kurtaxe ?? [];

    return { statuses, sources, paid, kurtaxe };
}

function coerceTokens(arr, prefix) {
    const a = Array.isArray(arr) ? arr : [];
    if (!a.length) return [];
    // schon Token-Objekte?
    if (typeof a[0] === "object" && a[0] && "id" in a[0]) return a;

    // sonst: Array von Strings -> Tokens draus machen (read-only fallback)
    return a.map((name, i) => ({
        id: `${prefix}_${i}`,
        name: String(name),
        active: 1,
        sort: (i + 1) * 10
    }));
}



function renderGroup(listEl, groupKey, items) {
    listEl.innerHTML = "";

    const arr = Array.isArray(items) ? items : [];
    if (!arr.length) {
        listEl.innerHTML = `<div class="hint muted">Keine Einträge</div>`;
        return;
    }

    // sort: erst sort, dann name
    const sorted = [...arr].sort((a, b) => {
        const sa = Number.isFinite(+a.sort) ? +a.sort : 9999;
        const sb = Number.isFinite(+b.sort) ? +b.sort : 9999;
        if (sa !== sb) return sa - sb;
        return String(a.name || "").localeCompare(String(b.name || ""), "de");
    });

    for (const it of sorted) {
        const row = document.createElement("div");
        row.className = "token-row";
        row.dataset.id = it.id;

        row.innerHTML = `
      <div class="token-id">${esc(it.id)}</div>
      <input class="inp token-name" value="${esc(it.name)}" />
      <label style="display:flex;align-items:center;gap:8px;justify-content:flex-end;">
        <input type="checkbox" class="tok-active" ${it.active ? "checked" : ""} />
        <span class="hint muted">active</span>
      </label>
      <div class="token-actions">
        <button class="btn tiny ghost tok-save">Save</button>
        <button class="btn tiny ghost tok-del">Del</button>
      </div>
    `;

        const inpName = row.querySelector(".token-name");
        const chkActive = row.querySelector(".tok-active");
        const btnSave = row.querySelector(".tok-save");
        const btnDel = row.querySelector(".tok-del");

        const doSave = async () => {
            const id = it.id;
            const name = (inpName.value || "").trim();
            const active = chkActive.checked ? 1 : 0;


            if (!name) { setMsg("Name darf nicht leer sein", true); return; }

            setMsg("saving...");
            await api(`/api/settings/${encodeURIComponent(groupKey)}/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify({ name, active })
            });
            setMsg("saved ✅");
            await load(); // reload um konsistent zu bleiben
        };

        btnSave.onclick = (e) => { e.preventDefault(); doSave().catch(err => setMsg(err.message, true)); };
        inpName.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); doSave().catch(err => setMsg(err.message, true)); }
        });
        chkActive.onchange = () => doSave().catch(err => setMsg(err.message, true));

        btnDel.onclick = async (e) => {
            e.preventDefault();
            if (!confirm(`"${inpName.value}" wirklich löschen?`)) return;
            setMsg("deleting...");
            await api(`/api/settings/${encodeURIComponent(groupKey)}/${encodeURIComponent(it.id)}`, { method: "DELETE" });
            setMsg("deleted ✅");
            await load();
        };

        listEl.appendChild(row);
    }
}

async function addItem(groupKey, inputEl) {
    const name = (inputEl.value || "").trim();
    if (!name) return setMsg("Bitte Namen eingeben", true);

    setMsg("adding...");
    await api(`/api/settings/${encodeURIComponent(groupKey)}`, {
        method: "POST",
        body: JSON.stringify({ name })
    });
    inputEl.value = "";
    setMsg("added ✅");
    await load();
}

async function load() {
  setMsg("loading...");
  const s = await api("/api/settings");

  renderGroup(el.list_status, "status", s.status || []);
  renderGroup(el.list_source, "source", s.source || []);
  renderGroup(el.list_paid, "paid", s.paid || []);
  renderGroup(el.list_kurtaxe, "kurtaxe", s.kurtaxe || []);

  setMsg("ok");
}



async function logout() {
    try { await api("/api/logout", { method: "POST" }); } catch { }
    location.href = "/";
}

// wiring
el.btnBack.onclick = () => location.href = "/";
el.btnReload.onclick = () => load().catch(e => setMsg(e.message, true));
el.btnLogout.onclick = logout;

el.add_status.onclick  = () => addItem("status", el.new_status).catch(e => setMsg(e.message, true));
el.add_source.onclick  = () => addItem("source", el.new_source).catch(e => setMsg(e.message, true));
el.add_paid.onclick    = () => addItem("paid", el.new_paid).catch(e => setMsg(e.message, true));
el.add_kurtaxe.onclick = () => addItem("kurtaxe", el.new_kurtaxe).catch(e => setMsg(e.message, true));


[el.new_status, el.new_source, el.new_paid, el.new_kurtaxe].forEach((inp) => {
    inp?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            if (inp === el.new_status) el.add_status.click();
            if (inp === el.new_source) el.add_source.click();
            if (inp === el.new_paid) el.add_paid.click();
            if (inp === el.new_kurtaxe) el.add_kurtaxe.click();
        }
    });
});

// start
load().catch(e => setMsg(`Error: ${e.message} (bist du eingeloggt?)`, true));
