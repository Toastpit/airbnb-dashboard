import express from "express";
import cookieParser from "cookie-parser";
import crypto from "node:crypto";
import {
  listSettingItems, createSettingItem, updateSettingItem, deleteSettingItem,
  listUsers, getUserByUsername, getUserById, createUser, updateUser, deleteUser, updateUserPassword
} from "./db.js";
import path from "node:path";
import { fileURLToPath } from "node:url";


import { openDb, listYears, listBookings, getBooking, insertBooking, updateBooking, deleteBooking } from "./db.js";

const PORT = Number(process.env.PORT || 3010);
const PASS = String(process.env.DASH_PASS || "");
const DB_FILE = String(process.env.DB_FILE || "/opt/airbnb-dashboard/data/airbnb.sqlite");
const MAX_FAILS = Number(process.env.MAX_FAILS || 3);
const LOCK_MINUTES = Number(process.env.LOCK_MINUTES || 15);

const ALLOWED_TYPES = ["status", "source", "paid", "kurtaxe"];


const GROUP_MAP = {
  statuses: "status",
  sources: "source",
  paid_statuses: "paid",
  kurtaxe_statuses: "kurtaxe",
};

if (!PASS) {
  console.error("DASH_PASS missing");
  process.exit(1);
}

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
// hinter Caddy/Nginx: richtige IP + secure cookies
app.set("trust proxy", 1);

// static files
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "../public")));


// ---- in-memory auth & lockout (pro IP)
const sessions = new Map(); // sid -> { createdAt, isAdmin, userId, viewer, editor, statistics }
const failMap = new Map();  // ip -> { fails, lockUntil }

function ipOf(req) {
  // nginx setzt X-Real-IP
  return (req.headers["x-real-ip"] || req.ip || "").toString();
}

function typeOf(req) {
  const t = String(req.params.type || "");
  if (!ALLOWED_TYPES.includes(t)) throw new Error("bad type");
  return t;
}

function isLocked(ip) {
  const r = failMap.get(ip);
  if (!r) return false;
  if (!r.lockUntil) return false;
  if (Date.now() >= r.lockUntil) {
    failMap.delete(ip);
    return false;
  }
  return true;
}

function registerFail(ip) {
  const r = failMap.get(ip) || { fails: 0, lockUntil: 0 };
  r.fails += 1;
  if (r.fails >= MAX_FAILS) {
    r.lockUntil = Date.now() + LOCK_MINUTES * 60 * 1000;
  }
  failMap.set(ip, r);
  return r;
}

function resetFails(ip) {
  failMap.delete(ip);
}

function requireAuth(req, res, next) {
  const sid = req.cookies?.sid;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: "unauthorized" });
  req.session = sessions.get(sid);
  next();
}

function requireAdmin(req, res, next) {
  const sid = req.cookies?.sid;
  if (!sid || !sessions.has(sid)) return res.status(401).json({ error: "unauthorized" });
  req.session = sessions.get(sid);
  if (!req.session.isAdmin) return res.status(403).json({ error: "admin_only" });
  next();
}

function requireViewer(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.isAdmin || req.session.viewer) return next();
    res.status(403).json({ error: "viewer_required" });
  });
}

function requireEditor(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.isAdmin || req.session.editor) return next();
    res.status(403).json({ error: "editor_required" });
  });
}

function requireStatistics(req, res, next) {
  requireAuth(req, res, () => {
    if (req.session.isAdmin || req.session.statistics) return next();
    res.status(403).json({ error: "statistics_required" });
  });
}

// ---- helpers
function normBool(v) { return v ? 1 : 0; }
function str(v, max = 2000) { return String(v ?? "").slice(0, max); }
function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function oneOf(v, allowed, def) {
  const s = String(v ?? "");
  return allowed.includes(s) ? s : def;
}
function yyyyMmDd(v) {
  const s = String(v ?? "");
  // sehr simple validation
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
  return s;
}

function nameById(type, id, fallbackName) {
  const row = db.prepare(`SELECT name FROM setting_items WHERE type=? AND id=?`).get(type, id);
  return row?.name || fallbackName;
}


const ALLOWED_STATUS = ["RESERVED", "CONFIRMED", "CANCELLED", "INQUIRY"];
const ALLOWED_SOURCE = ["AIRBNB", "BOOKING", "PRIVATE"];
const ALLOWED_PAID = ["UNPAID", "PARTIAL", "PAID"];
const ALLOWED_KT = ["OPEN", "ENTERED", "RELEASED", "PAID"];

function sanitizeBooking(body) {
  const year = Number(body?.year);
  const nowIso = new Date().toISOString();

  const check_in = yyyyMmDd(body?.check_in);
  const check_out = yyyyMmDd(body?.check_out);
  if (!year || year < 2000 || year > 2100) throw new Error("invalid year");
  if (!check_in || !check_out) throw new Error("check_in/check_out invalid");

  const persons = Math.max(1, Math.trunc(num(body?.persons, 1)));
  const laundry_booked = normBool(body?.laundry_booked);

  let cleaning_fee = num(body?.cleaning_fee, 100);
  let laundry_fee = num(body?.laundry_fee, 0);

    const status_id  = ensureSettingId("status",  body?.status_id,  "st_inquiry");
  const source_id  = ensureSettingId("source",  body?.source_id,  "src_airbnb");
  const paid_id    = ensureSettingId("paid",    body?.paid_status_id, "pay_unpaid");
  const kt_id      = ensureSettingId("kurtaxe", body?.kurtaxe_status_id, "kt_open");

  return {
    year,

    status_id,
    source_id,
    paid_status_id: paid_id,
    kurtaxe_status_id: kt_id,

    // legacy text fields (für NOT NULL / alte DBs)
    status: nameById("status", status_id, "INQUIRY"),
    source: nameById("source", source_id, "AIRBNB"),
    paid_status: nameById("paid", paid_id, "UNPAID"),
    kurtaxe_status: nameById("kurtaxe", kt_id, "OPEN"),

    check_in,
    check_out,
    booked_at: str(body?.booked_at || "", 40),
    persons,
    price_total: num(body?.price_total, 0),
    cleaning_fee: cleaning_fee,
    cleaning_paid: normBool(body?.cleaning_paid),
    kurtaxe_total: num(body?.kurtaxe_total, 0),
    kurtaxe_paid: normBool(body?.kurtaxe_paid),
    kurkarte_included: normBool(body?.kurkarte_included),

    laundry_booked,
    laundry_included: normBool(body?.laundry_included),
    laundry_paid: normBool(body?.laundry_paid),
    laundry_fee,

    notes: str(body?.notes, 5000),
    guest_name: str(body?.guest_name, 200),

    created_at: nowIso,
    updated_at: nowIso
  };

}

const db = openDb(DB_FILE);

// ---- auth routes
app.post("/api/login", (req, res) => {
  const ip = ipOf(req);
  if (isLocked(ip)) {
    const r = failMap.get(ip);
    return res.status(429).json({ error: "locked", retryAt: r.lockUntil });
  }

  const username = String(req.body?.username || "").trim();
  const pass = String(req.body?.password || "");

  let sessionData = null;

  // Admin login (kein Username, nur Password aus .env)
  if (!username && pass === PASS) {
    sessionData = {
      createdAt: Date.now(),
      isAdmin: true,
      userId: null,
      viewer: true,
      editor: true,
      statistics: true
    };
  }
  // User login (Username + Password aus DB)
  else if (username) {
    const user = getUserByUsername(db, username);
    if (!user || user.password_hash !== pass) {
      const r = registerFail(ip);
      return res.status(401).json({
        error: "bad_credentials",
        fails: r.fails,
        locked: isLocked(ip),
        lockMinutes: LOCK_MINUTES
      });
    }

    // Check if user has at least one permission
    if (!user.viewer && !user.editor && !user.statistics) {
      return res.status(403).json({ error: "no_permissions" });
    }

    sessionData = {
      createdAt: Date.now(),
      isAdmin: false,
      userId: user.id,
      username: user.username,
      name: user.name,
      viewer: Boolean(user.viewer),
      editor: Boolean(user.editor),
      statistics: Boolean(user.statistics)
    };
  }
  // Weder Admin noch User - falsche Credentials
  else {
    const r = registerFail(ip);
    return res.status(401).json({
      error: "bad_credentials",
      fails: r.fails,
      locked: isLocked(ip),
      lockMinutes: LOCK_MINUTES
    });
  }

  resetFails(ip);
  const sid = crypto.randomBytes(24).toString("hex");
  sessions.set(sid, sessionData);

  // cookie: sameSite lax reicht für subdomain
  res.cookie("sid", sid, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });

  res.json({
    ok: true,
    isAdmin: sessionData.isAdmin,
    viewer: sessionData.viewer,
    editor: sessionData.editor,
    statistics: sessionData.statistics,
    name: sessionData.name || "Admin"
  });
});

app.post("/api/logout", (req, res) => {
  const sid = req.cookies?.sid;
  if (sid) sessions.delete(sid);
  res.clearCookie("sid");
  res.json({ ok: true });
});

app.get("/api/session", requireAuth, (req, res) => {
  res.json({
    isAdmin: req.session.isAdmin || false,
    viewer: req.session.viewer || false,
    editor: req.session.editor || false,
    statistics: req.session.statistics || false,
    name: req.session.name || "Admin"
  });
});

// ---- user management routes (admin only)
app.get("/api/users", requireAdmin, (req, res) => {
  res.json({ users: listUsers(db) });
});

app.post("/api/users", requireAdmin, (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "").trim();
    const name = String(req.body?.name || "").trim();

    if (!username || !password || !name) {
      return res.status(400).json({ error: "username, password, name required" });
    }

    const viewer = req.body?.viewer ? 1 : 0;
    const editor = req.body?.editor ? 1 : 0;
    const statistics = req.body?.statistics ? 1 : 0;

    const userId = createUser(db, {
      username,
      password_hash: password,
      name,
      viewer,
      editor,
      statistics,
      active: 1
    });

    res.json({ ok: true, id: userId });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.put("/api/users/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const username = String(req.body?.username || "").trim();
    const name = String(req.body?.name || "").trim();

    if (!username || !name) {
      return res.status(400).json({ error: "username, name required" });
    }

    const viewer = req.body?.viewer ? 1 : 0;
    const editor = req.body?.editor ? 1 : 0;
    const statistics = req.body?.statistics ? 1 : 0;
    const active = req.body?.active !== undefined ? (req.body.active ? 1 : 0) : 1;

    const changes = updateUser(db, id, {
      username,
      name,
      viewer,
      editor,
      statistics,
      active
    });

    if (!changes) return res.status(404).json({ error: "user not found" });

    // Update password if provided
    if (req.body?.password) {
      const password = String(req.body.password).trim();
      if (password) {
        updateUserPassword(db, id, password);
      }
    }

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.delete("/api/users/:id", requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: "invalid id" });

    const changes = deleteUser(db, id);
    if (!changes) return res.status(404).json({ error: "user not found" });

    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// ---- data routes
app.get("/api/settings", requireAuth, (req, res) => {
  res.json({
    status: listSettingItems(db, "status"),
    source: listSettingItems(db, "source"),
    paid: listSettingItems(db, "paid"),
    kurtaxe: listSettingItems(db, "kurtaxe"),
  });
});

// list pro type
app.get("/api/settings/:type", requireAuth, (req, res) => {
  try {
    const type = typeOf(req);
    res.json({ items: listSettingItems(db, type) });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// create single token
app.post("/api/settings/:type", requireAuth, (req, res) => {
  try {
    const type = typeOf(req);
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name missing" });
    const id = createSettingItem(db, type, name);
    res.json({ ok: true, id });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

// update single token
app.put("/api/settings/:type/:id", requireAuth, (req, res) => {
  try {
    const type = typeOf(req);
    const id = String(req.params.id || "");
    const patch = {
      name: typeof req.body?.name === "string" ? req.body.name.trim() : undefined,
      active: (req.body?.active === undefined) ? undefined : (req.body.active ? 1 : 0),
      sort: (req.body?.sort === undefined) ? undefined : Number(req.body.sort),
      color: (req.body?.color === undefined) ? undefined : (req.body.color || null)
    };
    const changes = updateSettingItem(db, type, id, patch);
    if (!changes) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

function ensureSettingId(type, id, fallback) {
  const row = db.prepare(`SELECT id, active FROM setting_items WHERE type=? AND id=?`).get(type, String(id || ""));
  if (row && row.active) return row.id;
  return fallback;
}

// delete single token
app.delete("/api/settings/:type/:id", requireAuth, (req, res) => {
  try {
    const type = typeOf(req);
    const id = String(req.params.id || "");
    const changes = deleteSettingItem(db, type, id);
    if (!changes) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.get("/api/years", requireViewer, (req, res) => {
  res.json({ years: listYears(db) });
});

app.get("/api/bookings", requireViewer, (req, res) => {
  const year = Number(req.query?.year);
  if (!year) return res.status(400).json({ error: "year missing" });
  res.json({ bookings: listBookings(db, year) });
});

app.post("/api/bookings", requireEditor, (req, res) => {
  try {
    const b = sanitizeBooking(req.body);
    const id = insertBooking(db, b);
    res.json({ ok: true, id, booking: getBooking(db, id) });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.put("/api/bookings/:id", requireEditor, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });

  try {
    const b = sanitizeBooking(req.body);
    b.created_at = getBooking(db, id)?.created_at || b.created_at; // nicht überschreiben
    b.updated_at = new Date().toISOString();
    const changes = updateBooking(db, id, b);
    if (!changes) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true, booking: getBooking(db, id) });
  } catch (e) {
    res.status(400).json({ error: String(e?.message || e) });
  }
});

app.get("/api/bookings/:id", requireViewer, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });

  const b = getBooking(db, id);
  if (!b) return res.status(404).json({ error: "not_found" });

  res.json(b);
});


app.delete("/api/bookings/:id", requireEditor, (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "bad id" });
  const changes = deleteBooking(db, id);
  if (!changes) return res.status(404).json({ error: "not_found" });
  res.json({ ok: true });
});

app.get("/api/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`airbnb-dashboard on 0.0.0.0:${PORT}`);
});

