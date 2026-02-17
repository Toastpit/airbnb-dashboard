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

    // Kurtaxe Config
    list_kurtaxe_config: $("list_kurtaxe_config"),

    // Users
    usersPanel: $("usersPanel"),
    add_user_btn: $("add_user_btn"),
    list_users: $("list_users"),
    dlgUser: $("dlgUser"),
    userDlgTitle: $("userDlgTitle"),
    u_username: $("u_username"),
    u_name: $("u_name"),
    u_password: $("u_password"),
    u_viewer: $("u_viewer"),
    u_editor: $("u_editor"),
    u_statistics: $("u_statistics"),
    btnUserDelete: $("btnUserDelete"),
    btnUserSave: $("btnUserSave"),
};

let isAdmin = false;
let currentEditUserId = null;

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

    const showColorPicker = (groupKey === "status");

    // sort: erst sort, dann name
    const sorted = [...arr].sort((a, b) => {
        const sa = Number.isFinite(+a.sort) ? +a.sort : 9999;
        const sb = Number.isFinite(+b.sort) ? +b.sort : 9999;
        if (sa !== sb) return sa - sb;
        return String(a.name || "").localeCompare(String(b.name || ""), "de");
    });

    for (const it of sorted) {
        const row = document.createElement("div");
        row.className = showColorPicker ? "token-row with-color" : "token-row";
        row.dataset.id = it.id;

        const colorPickerHtml = showColorPicker
            ? `<input type="color" class="tok-color" value="${it.color || '#e2e8f0'}" title="Farbe wählen" />`
            : '';

        row.innerHTML = `
      <div class="token-id">${esc(it.id)}</div>
      <input class="inp token-name" value="${esc(it.name)}" />
      ${colorPickerHtml}
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
        const inpColor = row.querySelector(".tok-color");
        const chkActive = row.querySelector(".tok-active");
        const btnSave = row.querySelector(".tok-save");
        const btnDel = row.querySelector(".tok-del");

        const doSave = async () => {
            const id = it.id;
            const name = (inpName.value || "").trim();
            const active = chkActive.checked ? 1 : 0;
            const color = inpColor ? inpColor.value : null;

            if (!name) { setMsg("Name darf nicht leer sein", true); return; }

            setMsg("saving...");
            const payload = { name, active };
            if (color) payload.color = color;

            await api(`/api/settings/${encodeURIComponent(groupKey)}/${encodeURIComponent(id)}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            });
            setMsg("saved ✅");
            await load(); // reload um konsistent zu bleiben
        };

        btnSave.onclick = (e) => { e.preventDefault(); doSave().catch(err => setMsg(err.message, true)); };
        inpName.addEventListener("keydown", (e) => {
            if (e.key === "Enter") { e.preventDefault(); doSave().catch(err => setMsg(err.message, true)); }
        });
        chkActive.onchange = () => doSave().catch(err => setMsg(err.message, true));
        if (inpColor) {
            inpColor.onchange = () => doSave().catch(err => setMsg(err.message, true));
        }

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

  // Check if admin and load users
  try {
    const session = await api("/api/session");
    isAdmin = session.isAdmin || false;
    if (isAdmin) {
      el.usersPanel.style.display = "";
      await loadUsers();
    }
  } catch (e) {
    // Not admin, hide users panel
    el.usersPanel.style.display = "none";
  }

  await loadKurtaxeConfig();

  setMsg("ok");
}

async function loadKurtaxeConfig() {
  const data = await api("/api/kurtaxe-config");
  renderKurtaxeConfig(data.config || []);
}

function renderKurtaxeConfig(config) {
  el.list_kurtaxe_config.innerHTML = "";

  if (!config.length) {
    el.list_kurtaxe_config.innerHTML = `<div class="hint muted">Keine Konfiguration</div>`;
    return;
  }

  for (const c of config) {
    const row = document.createElement("div");
    row.className = "token-row";
    row.innerHTML = `
      <div style="font-weight:600;color:#334155;">${esc(c.description)}</div>
      <input type="number" class="inp" value="${c.age_min}" min="0" max="999" style="width:80px;" data-id="${c.id}" data-field="age_min" placeholder="Min">
      <input type="number" class="inp" value="${c.age_max}" min="0" max="999" style="width:80px;" data-id="${c.id}" data-field="age_max" placeholder="Max">
      <input type="number" class="inp" value="${c.rate_high_season}" step="0.01" style="width:100px;" data-id="${c.id}" data-field="rate_high_season" placeholder="Hauptsaison">
      <input type="number" class="inp" value="${c.rate_low_season}" step="0.01" style="width:100px;" data-id="${c.id}" data-field="rate_low_season" placeholder="Nebensaison">
      <button class="btn tiny primary" data-id="${c.id}" data-action="save">💾</button>
    `;

    el.list_kurtaxe_config.appendChild(row);
  }

  // Event listeners
  el.list_kurtaxe_config.querySelectorAll("button[data-action='save']").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.id);
      const row = btn.closest(".token-row");
      const inputs = row.querySelectorAll("input");

      const data = {};
      inputs.forEach(inp => {
        const field = inp.dataset.field;
        if (field) data[field] = Number(inp.value) || 0;
      });

      setMsg("saving...");
      try {
        await api(`/api/kurtaxe-config/${id}`, {
          method: "PUT",
          body: JSON.stringify(data)
        });
        setMsg("saved ✅");
      } catch (e) {
        setMsg(e.message, true);
      }
    });
  });
}

async function loadUsers() {
  if (!isAdmin) return;
  const data = await api("/api/users");
  renderUsers(data.users || []);
}

function renderUsers(users) {
  el.list_users.innerHTML = "";

  if (!users.length) {
    el.list_users.innerHTML = `<div class="hint muted">Keine User</div>`;
    return;
  }

  for (const user of users) {
    const row = document.createElement("div");
    row.className = "token-row";
    row.dataset.id = user.id;

    const perms = [];
    if (user.viewer) perms.push("👁 Viewer");
    if (user.editor) perms.push("✏️ Editor");
    if (user.statistics) perms.push("📊 Stats");
    const permsStr = perms.length ? perms.join(", ") : "keine Rechte";

    row.innerHTML = `
      <div class="token-id">${esc(user.username)}</div>
      <div style="font-weight:500;">${esc(user.name)}</div>
      <div class="hint muted" style="font-size:11px;">${permsStr}</div>
      <div class="token-actions">
        <button class="btn tiny ghost user-edit">Edit</button>
      </div>
    `;

    const btnEdit = row.querySelector(".user-edit");
    btnEdit.onclick = (e) => {
      e.preventDefault();
      openUserDialog(user);
    };

    el.list_users.appendChild(row);
  }
}

function openUserDialog(user = null) {
  currentEditUserId = user ? user.id : null;

  if (user) {
    el.userDlgTitle.textContent = "User bearbeiten";
    el.u_username.value = user.username;
    el.u_name.value = user.name;
    el.u_password.value = "";
    el.u_password.placeholder = "Leer lassen um nicht zu ändern";
    el.u_viewer.checked = Boolean(user.viewer);
    el.u_editor.checked = Boolean(user.editor);
    el.u_statistics.checked = Boolean(user.statistics);
    el.btnUserDelete.style.display = "";
  } else {
    el.userDlgTitle.textContent = "Neuer User";
    el.u_username.value = "";
    el.u_name.value = "";
    el.u_password.value = "";
    el.u_password.placeholder = "Passwort";
    el.u_viewer.checked = false;
    el.u_editor.checked = false;
    el.u_statistics.checked = false;
    el.btnUserDelete.style.display = "none";
  }

  el.dlgUser.showModal();
}

el.dlgUser.addEventListener("close", async () => {
  const val = el.dlgUser.returnValue;
  if (val === "ok") {
    await saveUser();
  } else if (val === "delete") {
    await deleteUserConfirm();
  }
});

async function saveUser() {
  const username = el.u_username.value.trim();
  const name = el.u_name.value.trim();
  const password = el.u_password.value.trim();

  if (!username || !name) {
    setMsg("Username und Name erforderlich", true);
    return;
  }

  if (!currentEditUserId && !password) {
    setMsg("Passwort erforderlich für neuen User", true);
    return;
  }

  setMsg("saving...");

  const payload = {
    username,
    name,
    viewer: el.u_viewer.checked,
    editor: el.u_editor.checked,
    statistics: el.u_statistics.checked
  };

  if (password) payload.password = password;

  try {
    if (currentEditUserId) {
      await api(`/api/users/${currentEditUserId}`, {
        method: "PUT",
        body: JSON.stringify(payload)
      });
    } else {
      await api("/api/users", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
    setMsg("saved ✅");
    await loadUsers();
  } catch (e) {
    setMsg(e.message, true);
  }
}

async function deleteUserConfirm() {
  if (!currentEditUserId) return;
  if (!confirm("User wirklich löschen?")) return;

  setMsg("deleting...");
  try {
    await api(`/api/users/${currentEditUserId}`, { method: "DELETE" });
    setMsg("deleted ✅");
    await loadUsers();
  } catch (e) {
    setMsg(e.message, true);
  }
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
el.add_user_btn.onclick = () => openUserDialog();


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
