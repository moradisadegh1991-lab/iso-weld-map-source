/**
 * Notifications (owner's requirements of 2026-10-22, item 15; migration 088):
 * a member sends others of the project a title and a text, with files and,
 * if a reply is asked for, the day it is due by. Each recipient reads it and
 * replies once; a reply after the day is taken and shown as late — the day
 * says when one was asked for, it does not silence whoever answers after.
 * What was sent is not edited or withdrawn. Only the sender and the
 * recipients read a notification or its files. Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import { latestToday } from "../../civil/concrete.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (x) => Object.assign(new Error(`${x} not found`), { status: 404 });
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const blank = (v) => { const s = String(v ?? "").trim(); return s || null; };
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 10;

/**
 * Send: recipients are members of the project other than the sender; the day
 * a reply is due by, when given, is not before today. `files` are
 * [{ name, bytes, contentType }].
 */
export async function sendNotification(db, { projectId, userId, recipients = [], title, body = null, replyDue = null, files = [], store, today = latestToday() }) {
  const t = blank(title);
  if (!t) throw bad("عنوان نوتیفیکیشن لازم است.");
  if (t.length > 200) throw bad("عنوان تا ۲۰۰ نویسه.");
  const text = blank(body);
  if (text && text.length > 10000) throw bad("متن تا ۱۰٬۰۰۰ نویسه.");
  const ids = [...new Set(recipients.filter(Boolean))].filter((x) => x !== userId);
  if (!ids.length) throw bad("دست‌کم یک گیرنده (غیر از خودتان) انتخاب کنید.");
  const { rows: members } = await db.query("SELECT user_id FROM project_member WHERE project_id = $1 AND user_id = ANY($2::uuid[])", [projectId, ids]);
  if (members.length !== ids.length) throw bad("همهٔ گیرنده‌ها باید عضو پروژه باشند.");
  const due = blank(replyDue);
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw bad("مهلت پاسخ: تاریخ به شکل YYYY-MM-DD.");
  if (due && due < today) throw bad(`مهلت پاسخ (${due}) گذشته است.`);
  if (files.length > MAX_FILES) throw bad(`حداکثر ${MAX_FILES} پیوست.`);
  for (const f of files) {
    if (!f.bytes?.length) throw bad(`پیوست «${f.name}» خالی است.`);
    if (f.bytes.length > MAX_FILE_BYTES) throw bad(`حجم پیوست «${f.name}» بیش از ۲۰ مگابایت است.`);
  }
  const { rows: [n] } = await db.query(
    "INSERT INTO notification (project_id, sender_id, title, body, reply_due) VALUES ($1,$2,$3,$4,$5) RETURNING *", [projectId, userId, t, text, due]);
  for (const u of ids) await db.query("INSERT INTO notification_recipient (project_id, notification_id, user_id) VALUES ($1,$2,$3)", [projectId, n.id, u]);
  for (const f of files) {
    const ext = String(f.name || "").match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || "";
    const blob = await store.put(f.bytes, { ext, contentType: f.contentType || "application/octet-stream" });
    await db.query(
      `INSERT INTO notification_file (project_id, notification_id, name, sha256, storage_uri, content_type, byte_size) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projectId, n.id, blank(f.name) || "پیوست", blob.digest || createHash("sha256").update(f.bytes).digest("hex"), blob.uri, f.contentType || "application/octet-stream", f.bytes.length]);
  }
  // the project's log says one was sent, not what it says: that is for its sender and recipients
  await logEvent(db, { projectId, section: "project", entityType: "notification", entityId: n.id, label: "نوتیفیکیشن", action: "sent",
    comment: `${ids.length} گیرنده${due ? `؛ مهلت پاسخ ${due}` : ""}${files.length ? `؛ ${files.length} پیوست` : ""}`, userId });
  return n;
}

const LIST = `SELECT n.id, n.title, n.body, n.reply_due::text AS reply_due, n.created_at, n.sender_id, s.display_name AS sender_name,
    (SELECT json_agg(json_build_object('id', f.id, 'name', f.name, 'size', f.byte_size) ORDER BY f.name) FROM notification_file f WHERE f.notification_id = n.id) AS files
  FROM notification n LEFT JOIN app_user s ON s.id = n.sender_id`;

/**
 * What a member received and sent. Received: newest first, each with whether
 * they read it, their reply, and where it stands against its day (`late` once
 * the day has passed without a reply, or for a reply given after it). Sent:
 * each with its recipients' state.
 */
export async function notificationsOf(db, { projectId, userId, today = latestToday() }) {
  const { rows: inbox } = await db.query(
    `${LIST} JOIN notification_recipient r ON r.notification_id = n.id
      WHERE n.project_id = $1 AND r.user_id = $2 ORDER BY n.created_at DESC`.replace("SELECT n.id,", "SELECT r.read_at, r.reply, r.replied_at, n.id,"), [projectId, userId]);
  const { rows: sent } = await db.query(`${LIST} WHERE n.project_id = $1 AND n.sender_id = $2 ORDER BY n.created_at DESC`, [projectId, userId]);
  const { rows: rec } = sent.length ? await db.query(
    `SELECT r.notification_id, r.user_id, u.display_name, r.read_at, r.reply, r.replied_at FROM notification_recipient r LEFT JOIN app_user u ON u.id = r.user_id
      WHERE r.notification_id = ANY($1::uuid[]) ORDER BY u.display_name`, [sent.map((n) => n.id)]) : { rows: [] };
  const stateOf = (n, r) => {
    const repliedDay = r.replied_at ? new Date(r.replied_at).toISOString().slice(0, 10) : null;
    if (!n.reply_due) return r.reply ? "replied" : r.read_at ? "read" : "unread";
    if (r.reply) return repliedDay > n.reply_due ? "late" : "replied";
    return today > n.reply_due ? "overdue" : r.read_at ? "read" : "unread";
  };
  return {
    inbox: inbox.map((n) => ({ ...n, files: n.files || [], state: stateOf(n, n) })),
    sent: sent.map((n) => ({ ...n, files: n.files || [],
      recipients: rec.filter((r) => r.notification_id === n.id).map((r) => ({ userId: r.user_id, name: r.display_name, readAt: r.read_at, reply: r.reply, repliedAt: r.replied_at, state: stateOf(n, r) })) })),
    unread: inbox.filter((n) => !n.read_at).length,
    awaitingReply: inbox.filter((n) => n.reply_due && !n.reply).length,
  };
}

async function mine(db, { projectId, id, userId }) {
  const { rows: [r] } = await db.query(
    `SELECT r.*, n.reply_due::text AS reply_due, n.title FROM notification_recipient r JOIN notification n ON n.id = r.notification_id
      WHERE r.notification_id = $1 AND r.user_id = $2 AND r.project_id = $3`, [id, userId, projectId]);
  if (!r) throw notFound("notification");
  return r;
}

/** Opened by a recipient: read from now on (the first time counts). */
export async function markRead(db, { projectId, id, userId }) {
  const r = await mine(db, { projectId, id, userId });
  if (!r.read_at) await db.query("UPDATE notification_recipient SET read_at = clock_timestamp() WHERE id = $1", [r.id]);
}

/** A recipient's one reply; given, it stays. It reads the notification too. */
export async function reply(db, { projectId, id, userId, text }) {
  const r = await mine(db, { projectId, id, userId });
  const tx = blank(text);
  if (!tx) throw bad("متن پاسخ لازم است.");
  if (tx.length > 5000) throw bad("پاسخ تا ۵٬۰۰۰ نویسه.");
  if (r.reply) throw bad("به این نوتیفیکیشن پاسخ داده‌اید؛ پاسخ داده‌شده عوض نمی‌شود.");
  await db.query("UPDATE notification_recipient SET reply = $2, replied_at = clock_timestamp(), read_at = COALESCE(read_at, clock_timestamp()) WHERE id = $1", [r.id, tx]);
  await logEvent(db, { projectId, section: "project", entityType: "notification", entityId: id, label: "نوتیفیکیشن", action: "updated", comment: "پاسخ", userId });
}

/** An attachment, to its sender or one of its recipients only. */
export async function readFile(db, { projectId, fileId, userId, store }) {
  const { rows: [f] } = await db.query(
    `SELECT f.*, n.sender_id FROM notification_file f JOIN notification n ON n.id = f.notification_id WHERE f.id = $1 AND f.project_id = $2`, [fileId, projectId]);
  if (!f) throw notFound("file");
  if (f.sender_id !== userId) {
    const { rows: [r] } = await db.query("SELECT 1 FROM notification_recipient WHERE notification_id = $1 AND user_id = $2", [f.notification_id, userId]);
    if (!r) throw forbidden("این پیوست برای شما نیست.");
  }
  return { bytes: await store.get(f.storage_uri), contentType: f.content_type, name: f.name };
}
