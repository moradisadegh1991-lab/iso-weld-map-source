/**
 * Who may do what to a report, and when — decided here, from a snapshot of
 * the report, its workflow and its history. No database: the repo
 * (lib/db/repos/reports.mjs) loads the snapshot, asks, and writes only what
 * these functions allow.
 *
 * THE RULES
 *
 *  - A report is at one stage at a time. Only the members of that stage's
 *    groups act on it, each within the rights their group gives them.
 *  - A signature attests to one version of the content. When the content
 *    changes, signatures on the old version no longer count: the signer has
 *    to sign again.
 *  - A signature counts only if it was given since the report last arrived at
 *    the stage. A report returned to a stage comes back to be reviewed again,
 *    so the stage signs again.
 *  - Once someone at the stage has signed the current content, only a member
 *    with `edit_after_sign` may still change it (their signatures then lapse).
 *    Plain `edit` is for content nobody at the stage has signed yet.
 *  - Final approval of a stage needs the approver's own signature on the
 *    current content. It locks the report for that stage and sends it on; the
 *    last stage's approval makes that version the record of the report.
 *  - A return sends the report back one stage, with a reason. That stage's
 *    users can edit it again — and so can every stage before it, as the
 *    report is returned further.
 *  - A signature may be withdrawn while the report is still at its stage, and
 *    given again. After the stage approves, it stands.
 *  - A report is cancelled (not deleted: its history stays) only while it is
 *    at the first stage and no stage has ever approved it.
 *
 * Interpretation of the owner's spec, agreed before this was written:
 * "editing rights even after prior approval" is `edit_after_sign` within the
 * stage; once a stage has approved, a correction comes by return, never by
 * editing a report that is past the stage.
 */

export const PERMISSIONS = {
  view: "مشاهده",
  create: "ایجاد گزارش",
  edit: "ویرایش محتوا",
  edit_after_sign: "ویرایش پس از امضا (در همان مرحله)",
  delete: "حذف (لغو) گزارش",
  sign: "امضا",
  return: "برگشت به مرحلهٔ قبل",
  approve: "تأیید نهایی مرحله",
};

const no = (reason) => ({ ok: false, reason });
const yes = (extra = {}) => ({ ok: true, ...extra });

/** Every group of `stageSeq` the user is in, with their rights in it. */
export function groupsOf(stages, userId, stageSeq) {
  const stage = stages.find((s) => s.seq === stageSeq);
  if (!stage) return [];
  return stage.groups
    .map((g) => ({ group: g, member: g.members.find((m) => m.userId === userId) }))
    .filter((x) => x.member)
    .map(({ group, member }) => ({ groupId: group.id, groupSeq: group.seq, name: group.name, permissions: member.permissions }));
}

/** The rights the user holds at a stage, across all their groups there. */
export function rightsAt(stages, userId, stageSeq) {
  return new Set(groupsOf(stages, userId, stageSeq).flatMap((g) => g.permissions));
}

/** May the user see this report at all: a member of any of its groups, or someone it was sent to. */
export function canView(stages, userId, recipients = []) {
  return stages.some((s) => s.groups.some((g) => g.members.some((m) => m.userId === userId && m.permissions.length)))
    || recipients.includes(userId);
}

/**
 * When the report last arrived at `stageSeq`: its creation for the first
 * stage, else the latest approval of the stage before or return from the
 * stage after. `t` values are comparable integers (microseconds).
 */
export function arrivedAt(snapshot, stageSeq) {
  let t = snapshot.createdT;
  for (const d of snapshot.decisions) {
    if ((d.action === "approved" && d.stageSeq === stageSeq - 1) || (d.action === "returned" && d.stageSeq === stageSeq + 1)) {
      if (d.t > t) t = d.t;
    }
  }
  return t;
}

/**
 * The signatures that count at a stage: given since the report last arrived
 * there, not withdrawn since, on the current version.
 * Returns [{ groupId, userId, versionNo, t, current }] — `current` false for
 * a signature on an older version (shown, but it does not count).
 */
export function signaturesAt(snapshot, stageSeq) {
  const since = arrivedAt(snapshot, stageSeq);
  const last = new Map();
  for (const s of snapshot.signatures) {
    if (s.stageSeq !== stageSeq || s.t < since) continue;
    const key = `${s.groupId}|${s.userId}`;
    if (!last.has(key) || s.t >= last.get(key).t) last.set(key, s);
  }
  return [...last.values()]
    .filter((s) => s.action === "sign")
    .map((s) => ({ groupId: s.groupId, userId: s.userId, versionNo: s.versionNo, t: s.t, current: s.versionNo === snapshot.versionNo }));
}

const isOpen = (snapshot) => snapshot.status === "open"
  ? null : no(snapshot.status === "approved" ? "گزارش تأیید نهایی شده و قفل است." : "گزارش لغو شده است.");

export function checkCreate(stages, userId) {
  if (!stages.length) return no("برای این نوع گزارش هنوز مرحله‌ای تعریف نشده است.");
  return rightsAt(stages, userId, stages[0].seq).has("create") ? yes() : no("شما در مرحلهٔ اول این گزارش حق ایجاد ندارید.");
}

export function checkEdit(snapshot, userId) {
  const closed = isOpen(snapshot); if (closed) return closed;
  const rights = rightsAt(snapshot.stages, userId, snapshot.stageSeq);
  if (!rights.has("edit") && !rights.has("edit_after_sign")) return no("شما در مرحلهٔ فعلی گزارش حق ویرایش ندارید.");
  const signed = signaturesAt(snapshot, snapshot.stageSeq).filter((s) => s.current);
  if (signed.length && !rights.has("edit_after_sign")) {
    return no("محتوای فعلی در این مرحله امضا شده است؛ ویرایش آن فقط با حق «ویرایش پس از امضا» ممکن است.");
  }
  return yes({ lapses: signed });            // these signatures stop counting once the content changes
}

/** `groupId` may be omitted when the user signs for exactly one group at the stage. */
export function checkSign(snapshot, userId, groupId = null) {
  const closed = isOpen(snapshot); if (closed) return closed;
  const mine = groupsOf(snapshot.stages, userId, snapshot.stageSeq).filter((g) => g.permissions.includes("sign"));
  if (!mine.length) return no("شما در مرحلهٔ فعلی گزارش حق امضا ندارید.");
  let g = mine.find((x) => x.groupId === groupId);
  if (!g) {
    if (groupId) return no("شما در این گروه حق امضا ندارید.");
    if (mine.length > 1) return no("شما در چند گروه این مرحله هستید؛ گروهی را که برایش امضا می‌کنید انتخاب کنید.");
    [g] = mine;
  }
  const already = signaturesAt(snapshot, snapshot.stageSeq).find((s) => s.groupId === g.groupId && s.userId === userId && s.current);
  if (already) return no("شما محتوای فعلی را برای این گروه امضا کرده‌اید.");
  return yes({ groupId: g.groupId });
}

export function checkWithdraw(snapshot, userId, groupId = null) {
  const closed = isOpen(snapshot); if (closed) return closed;
  const mine = signaturesAt(snapshot, snapshot.stageSeq).filter((s) => s.userId === userId && (!groupId || s.groupId === groupId));
  if (!mine.length) return no("امضای فعالی از شما در مرحلهٔ فعلی نیست؛ امضای مرحله‌ای که تأیید شده پس گرفته نمی‌شود.");
  if (mine.length > 1) return no("شما برای چند گروه امضا کرده‌اید؛ گروه را انتخاب کنید.");
  return yes({ groupId: mine[0].groupId });
}

export function checkApprove(snapshot, userId) {
  const closed = isOpen(snapshot); if (closed) return closed;
  if (!rightsAt(snapshot.stages, userId, snapshot.stageSeq).has("approve")) return no("شما در مرحلهٔ فعلی حق تأیید نهایی ندارید.");
  const own = signaturesAt(snapshot, snapshot.stageSeq).find((s) => s.userId === userId && s.current);
  if (!own) return no("تأیید نهایی بدون امضای خود تأییدکننده روی محتوای فعلی ممکن نیست.");
  const seqs = snapshot.stages.map((s) => s.seq).sort((a, b) => a - b);
  const next = seqs.find((s) => s > snapshot.stageSeq);
  return yes({ next: next ?? null, final: next == null });
}

export function checkReturn(snapshot, userId, comment) {
  const closed = isOpen(snapshot); if (closed) return closed;
  if (!rightsAt(snapshot.stages, userId, snapshot.stageSeq).has("return")) return no("شما در مرحلهٔ فعلی حق برگشت گزارش ندارید.");
  const seqs = snapshot.stages.map((s) => s.seq).sort((a, b) => a - b);
  const prev = [...seqs].reverse().find((s) => s < snapshot.stageSeq);
  if (prev == null) return no("گزارش در مرحلهٔ اول است؛ مرحلهٔ قبلی برای برگشت ندارد.");
  if (!String(comment ?? "").trim()) return no("دلیل برگشت را بنویسید.");
  return yes({ to: prev });
}

export function checkCancel(snapshot, userId, comment) {
  const closed = isOpen(snapshot); if (closed) return closed;
  const first = Math.min(...snapshot.stages.map((s) => s.seq));
  if (!rightsAt(snapshot.stages, userId, snapshot.stageSeq).has("delete")) return no("شما حق حذف این گزارش را ندارید.");
  if (snapshot.stageSeq !== first || snapshot.decisions.some((d) => d.action === "approved")) {
    return no("گزارشی که مرحله‌ای آن را تأیید کرده حذف نمی‌شود؛ باید برگشت داده شود.");
  }
  if (!String(comment ?? "").trim()) return no("دلیل حذف را بنویسید.");
  return yes();
}

/**
 * The signature boxes, as the footer prints them: by stage, then by group
 * priority; within a group, by when they signed. Older-version signatures are
 * listed with `current: false` so a reader sees they no longer count.
 */
export function signatureBoxes(snapshot) {
  const stages = [...snapshot.stages].sort((a, b) => a.seq - b.seq);
  return stages.map((st) => {
    const counted = signaturesAt(snapshot, st.seq);
    return {
      stageSeq: st.seq, stageName: st.name,
      groups: [...st.groups].sort((a, b) => a.seq - b.seq).map((g) => ({
        groupId: g.id, name: g.name, title: g.title || null, description: g.description || null,
        signatures: counted.filter((s) => s.groupId === g.id).sort((a, b) => (a.t < b.t ? -1 : 1)),
      })),
    };
  });
}

/** Content as one canonical string: same content, same hash, whatever the key order. */
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
