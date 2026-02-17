import Database from "better-sqlite3";

function ensureColumn(db, table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name);
  if (!cols.includes(col)) db.exec(ddl);
}

function ensureTable(db, ddl) { db.exec(ddl); }

function makeId(prefix) {
  // deterministisch genug, kurz, keine Kollisionen in Praxis
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

// --------- USERS TABLE ----------
function initUsers(db) {
  ensureTable(db, `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      viewer INTEGER NOT NULL DEFAULT 0,
      editor INTEGER NOT NULL DEFAULT 0,
      statistics INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
  `);
}

// --------- SETTINGS TABLES ----------
function initSettings(db) {
  ensureTable(db, `
    CREATE TABLE IF NOT EXISTS setting_items (
      type TEXT NOT NULL,                 -- status|source|paid|kurtaxe
      id   TEXT NOT NULL,                 -- stable key
      name TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      sort INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (type, id)
    );
    CREATE INDEX IF NOT EXISTS idx_setting_items_type_sort ON setting_items(type, sort, name);
  `);

  // Farb-Spalte hinzufügen (nur für Status)
  ensureColumn(db, "setting_items", "color", `ALTER TABLE setting_items ADD COLUMN color TEXT DEFAULT NULL`);

  // Defaults nur wenn noch leer
  const cnt = db.prepare(`SELECT COUNT(*) c FROM setting_items`).get().c;
  if (cnt === 0) {
    const ins = db.prepare(`INSERT INTO setting_items(type,id,name,active,sort) VALUES (?,?,?,?,?)`);

    // STATUS
    ins.run("status",  "st_inquiry",   "INQUIRY",   1, 10);
    ins.run("status",  "st_reserved",  "RESERVED",  1, 20);
    ins.run("status",  "st_confirmed", "CONFIRMED", 1, 30);
    ins.run("status",  "st_cancelled", "CANCELLED", 1, 40);

    // SOURCE
    ins.run("source",  "src_airbnb",  "AIRBNB",  1, 10);
    ins.run("source",  "src_booking", "BOOKING", 1, 20);
    ins.run("source",  "src_private", "PRIVATE", 1, 30);

    // PAID
    ins.run("paid",    "pay_unpaid",  "UNPAID",  1, 10);
    ins.run("paid",    "pay_partial", "PARTIAL", 1, 20);
    ins.run("paid",    "pay_paid",    "PAID",    1, 30);

    // KURTAXE
    ins.run("kurtaxe", "kt_open",     "OPEN",     1, 10);
    ins.run("kurtaxe", "kt_entered",  "ENTERED",  1, 20);
    ins.run("kurtaxe", "kt_released", "RELEASED", 1, 30);
    ins.run("kurtaxe", "kt_paid",     "PAID",     1, 40);
  }
}

function mapNameToId(db, type, name, fallbackId) {
  // versucht per Name zu matchen, sonst fallback
  const row = db.prepare(`SELECT id FROM setting_items WHERE type=? AND name=? LIMIT 1`).get(type, String(name ?? ""));
  return row?.id || fallbackId;
}

function migrateBookingsToIds(db) {
  // neue Spalten anlegen
  ensureColumn(db, "bookings", "status_id",        `ALTER TABLE bookings ADD COLUMN status_id TEXT NOT NULL DEFAULT 'st_inquiry'`);
  ensureColumn(db, "bookings", "source_id",        `ALTER TABLE bookings ADD COLUMN source_id TEXT NOT NULL DEFAULT 'src_airbnb'`);
  ensureColumn(db, "bookings", "paid_status_id",   `ALTER TABLE bookings ADD COLUMN paid_status_id TEXT NOT NULL DEFAULT 'pay_unpaid'`);
  ensureColumn(db, "bookings", "kurtaxe_status_id",`ALTER TABLE bookings ADD COLUMN kurtaxe_status_id TEXT NOT NULL DEFAULT 'kt_open'`);

  // Falls alte Spalten existieren: status/source/paid_status/kurtaxe_status
  const cols = db.prepare(`PRAGMA table_info(bookings)`).all().map(r => r.name);

  const hasOldStatus   = cols.includes("status");
  const hasOldSource   = cols.includes("source");
  const hasOldPaid     = cols.includes("paid_status");
  const hasOldKurtaxe  = cols.includes("kurtaxe_status");

  // Nur migrieren, wenn alte Spalten existieren und neue noch default sind
  const rows = db.prepare(`SELECT id, status, source, paid_status, kurtaxe_status FROM bookings`).all();

  const upd = db.prepare(`
    UPDATE bookings SET
      status_id=?,
      source_id=?,
      paid_status_id=?,
      kurtaxe_status_id=?
    WHERE id=?
  `);

  db.transaction(() => {
    for (const r of rows) {
      const st  = hasOldStatus  ? mapNameToId(db, "status",  r.status,        "st_inquiry") : "st_inquiry";
      const src = hasOldSource  ? mapNameToId(db, "source",  r.source,        "src_airbnb") : "src_airbnb";
      const pay = hasOldPaid    ? mapNameToId(db, "paid",    r.paid_status,   "pay_unpaid") : "pay_unpaid";
      const kt  = hasOldKurtaxe ? mapNameToId(db, "kurtaxe", r.kurtaxe_status,"kt_open")    : "kt_open";
      upd.run(st, src, pay, kt, r.id);
    }
  })();
}

// --------- PUBLIC API for settings ----------
export function listSettingItems(db, type) {
  return db.prepare(`
    SELECT id,name,active,sort,color
    FROM setting_items
    WHERE type=?
    ORDER BY sort ASC, name ASC
  `).all(type);
}

export function createSettingItem(db, type, name) {
  const id = makeId(type.slice(0, 2));
  const sort = Date.now(); // simpel, später editierbar
  db.prepare(`INSERT INTO setting_items(type,id,name,active,sort) VALUES (?,?,?,?,?)`)
    .run(type, id, String(name ?? "").trim().slice(0, 80), 1, sort);
  return id;
}

export function updateSettingItem(db, type, id, patch) {
  const cur = db.prepare(`SELECT * FROM setting_items WHERE type=? AND id=?`).get(type, id);
  if (!cur) return 0;

  const name = (patch?.name != null) ? String(patch.name).trim().slice(0, 80) : cur.name;
  const active = (patch?.active != null) ? (patch.active ? 1 : 0) : cur.active;
  const sort = (patch?.sort != null) ? Math.trunc(Number(patch.sort) || 0) : cur.sort;
  const color = (patch?.color !== undefined) ? (patch.color ? String(patch.color).slice(0, 7) : null) : cur.color;

  return db.prepare(`UPDATE setting_items SET name=?, active=?, sort=?, color=? WHERE type=? AND id=?`)
    .run(name, active, sort, color, type, id).changes;
}

export function deleteSettingItem(db, type, id) {
  // hard delete ok; alternativ soft-delete über active=0
  return db.prepare(`DELETE FROM setting_items WHERE type=? AND id=?`).run(type, id).changes;
}

// --------- BOOKINGS (angepasst) ----------
export function openDb(dbFile) {
  const db = new Database(dbFile);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      year INTEGER NOT NULL,

      -- legacy columns may exist (status/source/paid_status/kurtaxe_status) - lassen wir
      status TEXT,
      source TEXT,

      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      booked_at TEXT,

      persons INTEGER NOT NULL DEFAULT 1,
      guest_name TEXT NOT NULL DEFAULT '',

      price_total REAL NOT NULL DEFAULT 0,
      paid_status TEXT,

      cleaning_fee REAL NOT NULL DEFAULT 0,
      cleaning_paid INTEGER NOT NULL DEFAULT 0,

      kurtaxe_total REAL NOT NULL DEFAULT 0,
      kurtaxe_status TEXT,
      kurkarte_included INTEGER NOT NULL DEFAULT 0,

      laundry_booked INTEGER NOT NULL DEFAULT 0,
      laundry_included INTEGER NOT NULL DEFAULT 0,
      laundry_paid INTEGER NOT NULL DEFAULT 0,
      laundry_fee REAL NOT NULL DEFAULT 0,

      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_year_checkin ON bookings(year, check_in);
  `);

  ensureColumn(db, "bookings", "guest_name", `ALTER TABLE bookings ADD COLUMN guest_name TEXT NOT NULL DEFAULT ''`);
  ensureColumn(db, "bookings", "laundry_fee",
  `ALTER TABLE bookings ADD COLUMN laundry_fee REAL NOT NULL DEFAULT 0`
);
  ensureColumn(db, "bookings", "kurtaxe_paid", `ALTER TABLE bookings ADD COLUMN kurtaxe_paid INTEGER NOT NULL DEFAULT 0`);

  initUsers(db);
  initSettings(db);
  migrateBookingsToIds(db);

  return db;
}

// --------- USER MANAGEMENT ----------
export function listUsers(db) {
  return db.prepare(`
    SELECT id, username, name, viewer, editor, statistics, active, created_at, updated_at
    FROM users
    WHERE active=1
    ORDER BY name ASC
  `).all();
}

export function getUserByUsername(db, username) {
  return db.prepare(`
    SELECT * FROM users WHERE username=? AND active=1
  `).get(username);
}

export function getUserById(db, id) {
  return db.prepare(`
    SELECT id, username, name, viewer, editor, statistics, active, created_at, updated_at
    FROM users WHERE id=?
  `).get(id);
}

export function createUser(db, user) {
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO users (username, password_hash, name, viewer, editor, statistics, active, created_at, updated_at)
    VALUES (@username, @password_hash, @name, @viewer, @editor, @statistics, @active, @created_at, @updated_at)
  `);
  const info = stmt.run({
    ...user,
    created_at: nowIso,
    updated_at: nowIso
  });
  return info.lastInsertRowid;
}

export function updateUser(db, id, user) {
  const nowIso = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE users SET
      username=@username,
      name=@name,
      viewer=@viewer,
      editor=@editor,
      statistics=@statistics,
      active=@active,
      updated_at=@updated_at
    WHERE id=@id
  `);
  return stmt.run({ id, ...user, updated_at: nowIso }).changes;
}

export function updateUserPassword(db, id, password_hash) {
  const nowIso = new Date().toISOString();
  return db.prepare(`UPDATE users SET password_hash=?, updated_at=? WHERE id=?`)
    .run(password_hash, nowIso, id).changes;
}

export function deleteUser(db, id) {
  // Soft delete
  const nowIso = new Date().toISOString();
  return db.prepare(`UPDATE users SET active=0, updated_at=? WHERE id=?`)
    .run(nowIso, id).changes;
}

export function listYears(db) {
  return db.prepare(`SELECT DISTINCT year FROM bookings ORDER BY year DESC`).all().map(r => r.year);
}

export function listBookings(db, year) {
  return db.prepare(`SELECT * FROM bookings WHERE year=? ORDER BY check_in ASC`).all(year);
}

export function getBooking(db, id) {
  return db.prepare(`SELECT * FROM bookings WHERE id=?`).get(id);
}

export function insertBooking(db, b) {
  const stmt = db.prepare(`
    INSERT INTO bookings (
  year, check_in, check_out, booked_at, persons, guest_name,
  price_total, cleaning_fee, cleaning_paid,
  kurtaxe_total, kurtaxe_paid, kurkarte_included,
  laundry_booked, laundry_included, laundry_paid, laundry_fee,
  notes, created_at, updated_at,
  status_id, source_id, paid_status_id, kurtaxe_status_id,
  status, source, paid_status, kurtaxe_status
) VALUES (
  @year, @check_in, @check_out, @booked_at, @persons, @guest_name,
  @price_total, @cleaning_fee, @cleaning_paid,
  @kurtaxe_total, @kurtaxe_paid, @kurkarte_included,
  @laundry_booked, @laundry_included, @laundry_paid, @laundry_fee,
  @notes, @created_at, @updated_at,
  @status_id, @source_id, @paid_status_id, @kurtaxe_status_id,
  @status, @source, @paid_status, @kurtaxe_status
)

  `);
  const info = stmt.run(b);
  return info.lastInsertRowid;
}


export function updateBooking(db, id, b) {
  const stmt = db.prepare(`
    UPDATE bookings SET
      year=@year,
      check_in=@check_in, check_out=@check_out, booked_at=@booked_at,
      persons=@persons, guest_name=@guest_name,
      price_total=@price_total,
      cleaning_fee=@cleaning_fee, cleaning_paid=@cleaning_paid,
      kurtaxe_total=@kurtaxe_total, kurtaxe_paid=@kurtaxe_paid, kurkarte_included=@kurkarte_included,
      laundry_booked=@laundry_booked, laundry_included=@laundry_included, laundry_paid=@laundry_paid,
      laundry_fee=@laundry_fee,
      notes=@notes,
      updated_at=@updated_at,
      status_id=@status_id, source_id=@source_id, paid_status_id=@paid_status_id, kurtaxe_status_id=@kurtaxe_status_id,
      status=@status, source=@source, paid_status=@paid_status, kurtaxe_status=@kurtaxe_status
    WHERE id=@id
  `);
  return stmt.run({ id, ...b }).changes;
}


export function deleteBooking(db, id) {
  return db.prepare(`DELETE FROM bookings WHERE id=?`).run(id).changes;
}
