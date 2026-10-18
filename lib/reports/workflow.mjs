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
 *  - Once someone at the stage has signed the current content, it is shown,
 *    not edited — for everyone at the stage (owner's review 2026-10-15,
 *    item 4). To change it, the signers withdraw their signatures first.
 *    Content past its stage is read-only too: a correction comes by return.
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

// `edit_after_sign` was a right until the owner's review (item 4): signed
// content is now read-only for everyone. Groups that still hold it keep it in
// the database; it gives nothing.
export const RETIRED_PERMISSIONS = ["edit_after_sign"];
export const PERMISSIONS = {
  view: "مشاهده",
  create: "ایجاد گزارش",
  add_content: "افزودن محتوا",
  edit: "ویرایش محتوا",
  delete_content: "حذف محتوا",
  delete: "افزودن یا حذف گزارش (لغو)",
  sign: "امضا",
  return: "برگشت به مرحلهٔ قبل",
  approve: "تأیید نهایی مرحله",
};

/**
 * Additions to the rules (owner's spec 2026-10-15):
 *
 *  - A stage may name ONE final approver and a deputy. While it does, only
 *    they issue the stage's final approval — each after signing the current
 *    content — and the `approve` right of a group no longer suffices. A
 *    deputy's signature and approval are recorded on behalf of the approver.
 *  - A user who has signed the current content does not edit it: they withdraw
 *    their signature first.
 *  - When a stage returns a report, the users of that stage and of every
 *    stage before it may edit it, each with the rights of their own stage,
 *    until it is approved forward again.
 */

/** The stage's approver and deputy, if it names them. */
export function approverOf(snapshot, stageSeq) {
  const st = snapshot.stages.find((s) => s.seq === stageSeq);
  return { approverId: st?.approverId || null, deputyId: st?.deputyId || null };
}

/**
 * Duties, pages and tree rows (owner's requirements of 2026-10-18, items 1–3):
 *
 *  - A group's members are people named in it and the holders of the duties
 *    attached to it. A duty in a group may reach only some of the workflow's
 *    pages, and change only some rows of the form's trees (a row and
 *    everything under it). A member named without a duty, or a duty with no
 *    pages and no rows named, reaches the whole form.
 *  - A signer may say «if my stage changes the content, my signature
 *    stands». Others at the stage may then edit after they sign, and the
 *    signature still counts; a signature without it lapses on the next change.
 *    The signer themself does not edit what they have signed: they withdraw
 *    first. This replaces the owner's earlier rule (review 2026-10-15, item 4)
 *    that signed content was read-only for the whole stage.
 *  - A duty may have days to review the report in: from when it arrives at
 *    the stage. Past them, a group that has not signed is overdue.
 */

/** The approver a user acts for when they sign or approve at `stageSeq`: the deputy acts for the approver. */
export function onBehalfOf(snapshot, stageSeq, userId) {
  const { approverId, deputyId } = approverOf(snapshot, stageSeq);
  return approverId && deputyId === userId ? approverId : null;
}

/** The stage that returned the report to where it is, if its latest decision is that return. */
function returnedBy(snapshot) {
  const last = [...snapshot.decisions].filter((d) => d.action !== "cancelled").sort((a, b) => (a.t < b.t ? 1 : -1))[0];
  return last && last.action === "returned" && last.stageSeq > snapshot.stageSeq ? last.stageSeq : null;
}

/** Rights a user holds for editing now: their current stage's, or — after a return — those of the returning stage and every stage before it. */
export function editRights(snapshot, userId) {
  const r = rightsAt(snapshot.stages, userId, snapshot.stageSeq);
  const by = returnedBy(snapshot);
  if (by != null) {
    for (const st of snapshot.stages) if (st.seq <= by) for (const x of rightsAt(snapshot.stages, userId, st.seq)) r.add(x);
  }
  return r;
}

const no = (reason) => ({ ok: false, reason });
const yes = (extra = {}) => ({ ok: true, ...extra });

/** Every group of `stageSeq` the user is in, with their rights in it — and the pages and rows those rights reach (none named → all). */
export function groupsOf(stages, userId, stageSeq) {
  const stage = stages.find((s) => s.seq === stageSeq);
  if (!stage) return [];
  return stage.groups
    .map((g) => ({ group: g, member: g.members.find((m) => m.userId === userId) }))
    .filter((x) => x.member)
    .map(({ group, member }) => ({ groupId: group.id, groupSeq: group.seq, name: group.name, permissions: member.permissions,
      pages: member.pages || [], scope: member.scope || [] }));
}

/**
 * Do the user's memberships at the stages they edit for reach every row a
 * change touches? `touched` is [{ section, path }]: the part of the form a
 * row is in, and the ids of the tree rows it hangs from, nearest first (none
 * for a row outside every tree). A membership reaches a row when its pages
 * hold the row's part and its rows include one on the row's path; one that
 * names neither reaches everything. Returns the first row nobody reaches.
 */
export function outOfReach(snapshot, userId, touched = []) {
  const seqs = [snapshot.stageSeq];
  const by = returnedBy(snapshot);
  if (by != null) for (const st of snapshot.stages) if (st.seq <= by && !seqs.includes(st.seq)) seqs.push(st.seq);
  const mine = seqs.flatMap((q) => groupsOf(snapshot.stages, userId, q))
    .filter((g) => ["edit", "add_content", "delete_content"].some((x) => g.permissions.includes(x)));
  if (mine.some((g) => !g.pages.length && !g.scope.length)) return null;
  const pages = snapshot.pages || [];
  const holds = (g, section) => !g.pages.length
    || g.pages.some((id) => { const p = pages.find((x) => x.id === id); return p && (!p.sections.length || p.sections.includes(section)); });
  const under = (g, path) => !g.scope.length || (path || []).some((id) => g.scope.includes(id));
  return touched.find((t) => !mine.some((g) => holds(g, t.section) && under(g, t.path))) || null;
}

/** The rights the user holds at a stage, across all their groups there. */
export function rightsAt(stages, userId, stageSeq) {
  return new Set(groupsOf(stages, userId, stageSeq).flatMap((g) => g.permissions));
}

/** The day a stage's duties have to review by, per group: arrival + the least of its members' days (none → no deadline). */
export function reviewDue(snapshot, stageSeq) {
  const st = snapshot.stages.find((s) => s.seq === stageSeq);
  if (!st) return [];
  const since = Number(arrivedAt(snapshot, stageSeq) / 1000n);
  return st.groups.map((g) => {
    const days = g.members.map((m) => m.reviewDays).filter((d) => Number.isInteger(d) && d > 0);
    return { groupId: g.id, reviewDays: days.length ? Math.min(...days) : null,
      due: days.length ? new Date(since + Math.min(...days) * 86400000).toISOString() : null };
  });
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
 * there, not withdrawn since, on the current version — or on an earlier one
 * when the signer accepted their stage's changes and every version since was
 * written at this stage.
 * Returns [{ groupId, userId, versionNo, t, current, signatureId }] — `current` false for
 * a signature that no longer counts (shown, but it does not count).
 */
export function signaturesAt(snapshot, stageSeq) {
  const since = arrivedAt(snapshot, stageSeq);
  const last = new Map();
  for (const s of snapshot.signatures) {
    if (s.stageSeq !== stageSeq || s.t < since) continue;
    const key = `${s.groupId}|${s.userId}`;
    if (!last.has(key) || s.t >= last.get(key).t) last.set(key, s);
  }
  // a version written at another stage (a return) ends what an accepting signature covers
  const sameStageSince = (v) => (snapshot.versions || []).filter((x) => x.no > v).every((x) => x.stageSeq === stageSeq)
    && (snapshot.versions || []).some((x) => x.no === snapshot.versionNo);
  return [...last.values()]
    .filter((s) => s.action === "sign")
    .map((s) => ({ groupId: s.groupId, userId: s.userId, versionNo: s.versionNo, t: s.t,
      current: s.versionNo === snapshot.versionNo || (!!s.acceptChanges && sameStageSince(s.versionNo)),
      acceptChanges: !!s.acceptChanges, signatureId: s.signatureId ?? null, onBehalfOf: s.onBehalfOf ?? null }));
}

const isOpen = (snapshot) => snapshot.status === "open"
  ? null : no(snapshot.status === "approved" ? "گزارش تأیید نهایی شده و قفل است." : "گزارش لغو شده است.");

export function checkCreate(stages, userId) {
  if (!stages.length) return no("برای این نوع گزارش هنوز مرحله‌ای تعریف نشده است.");
  return rightsAt(stages, userId, stages[0].seq).has("create") ? yes() : no("شما در مرحلهٔ اول این گزارش حق ایجاد ندارید.");
}

export function checkEdit(snapshot, userId, change = null) {
  const closed = isOpen(snapshot); if (closed) return closed;
  const rights = editRights(snapshot, userId);
  const any = ["edit", "add_content", "delete_content"].some((x) => rights.has(x));
  if (!any) return no("شما در مرحلهٔ فعلی گزارش حق ویرایش ندارید.");
  // what this change does, when the caller can say it: rows added, changed, removed
  if (change) {
    if (change.added && !rights.has("add_content")) return no("شما حق افزودن محتوا (ردیف تازه) را ندارید.");
    if (change.removed && !rights.has("delete_content")) return no("شما حق حذف محتوا را ندارید.");
    if (change.changed && !rights.has("edit")) return no("شما حق ویرایش ردیف‌های موجود را ندارید.");
  } else if (!rights.has("edit")) return no("شما در مرحلهٔ فعلی گزارش حق ویرایش ندارید.");
  if (change?.touched?.length) {
    const out = outOfReach(snapshot, userId, change.touched);
    if (out) return no(`ردیف «${out.label || out.section}» بیرون از صفحه‌ها یا ردیف‌هایی است که وظیفهٔ شما در این گردش کار به آن‌ها دسترسی دارد.`);
  }
  const signed = signaturesAt(snapshot, snapshot.stageSeq).filter((s) => s.current);
  if (signed.some((s) => s.userId === userId)) return no("شما محتوای فعلی را امضا کرده‌اید و گزارش برای شما فقط قابل نمایش است؛ برای ویرایش، اول امضای خود را لغو کنید.");
  // the others' signatures that do not accept changes lapse with this one
  return yes({ lapses: signed.filter((s) => !s.acceptChanges) });
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
  const { approverId, deputyId } = approverOf(snapshot, snapshot.stageSeq);
  if (approverId) {
    if (userId !== approverId && userId !== deputyId) return no("تأیید نهایی این مرحله فقط با تأییدکنندهٔ نهایی تعیین‌شده یا جانشین او است.");
  } else if (!rightsAt(snapshot.stages, userId, snapshot.stageSeq).has("approve")) return no("شما در مرحلهٔ فعلی حق تأیید نهایی ندارید.");
  const own = signaturesAt(snapshot, snapshot.stageSeq).find((s) => s.userId === userId && s.current);
  if (!own) return no("تأیید نهایی بدون امضای خود تأییدکننده روی محتوای فعلی ممکن نیست.");
  const seqs = snapshot.stages.map((s) => s.seq).sort((a, b) => a - b);
  const next = seqs.find((s) => s > snapshot.stageSeq);
  return yes({ next: next ?? null, final: next == null, onBehalfOf: onBehalfOf(snapshot, snapshot.stageSeq, userId) });
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
        // the pages its members reach (none → every page): the page footers print only the groups that reach them
        pages: [...new Set(g.members.flatMap((m) => m.pages || []))],
        allPages: !g.members.length || g.members.some((m) => !(m.pages || []).length),
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
