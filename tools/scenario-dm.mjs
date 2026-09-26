/**
 * The DM-water pump scenario (lib/scenario/dm-pump.mjs), for a person.
 *
 *   npm run scenario:dm -- you@example.com            a fresh project at step 0.1; you play the rest
 *   npm run scenario:dm -- you@example.com --upto 5.4 …with every step up to 5.4 already played
 *   npm run scenario:dm -- you@example.com --upto all …the whole job, to look at the end state
 *   npm run scenario:dm -- --doc                      rewrite docs/digital-epc/03-scenario-dm-pump.md
 *
 * Each run makes a NEW project (DMW, then DMW2, DMW3…), so nothing you did
 * in an earlier one is touched. It also makes the two other people the
 * scenario needs — the contractor's QC inspector and the client's
 * representative — and prints their passwords once; nothing stores them.
 *
 * Every date is «day N» of the job; day 0 is printed, and sits far enough
 * back that the whole job is in the past (a 28-day cube break cannot be
 * entered before its 28th day).
 */
import "./env.mjs";
import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { getDb } from "../lib/server/db.mjs";
import { ensureUser, createProject, addMember } from "../lib/db/repos/projects.mjs";
import { setPassword } from "../lib/db/repos/credentials.mjs";
import { SCENARIO, PEOPLE, STEPS, stepsUpTo } from "../lib/scenario/dm-pump.mjs";
import { context, play, startFor } from "../lib/scenario/runner.mjs";
import { guideMarkdown } from "../lib/scenario/guide.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const k = args.indexOf(name); return k < 0 ? null : args[k + 1] ?? true; };

if (args.includes("--doc")) {
  const path = new URL("../docs/digital-epc/03-scenario-dm-pump.md", import.meta.url);
  await writeFile(path, guideMarkdown());
  console.log(`written: docs/digital-epc/03-scenario-dm-pump.md (${STEPS.length} steps)`);
  process.exit(0);
}

const email = (args.find((a) => a.includes("@")) || "").toLowerCase();
if (!email) {
  console.error("usage: npm run scenario:dm -- <your email> [--upto <step>|all]   ·   npm run scenario:dm -- --doc");
  process.exit(1);
}
const upto = flag("--upto");
const steps = upto === "all" ? STEPS : stepsUpTo(upto || "0.1");

const db = await getDb();
try {
  const { rows: [me] } = await db.query("SELECT id FROM app_user WHERE lower(email) = $1", [email]);
  if (!me) throw new Error(`no account for ${email} — run npm run auth:admin first`);

  // A new project each time: DMW, DMW2, …
  const { rows } = await db.query("SELECT code FROM project WHERE code ~ '^DMW[0-9]*$'");
  const taken = new Set(rows.map((r) => r.code));
  let code = SCENARIO.code;
  for (let n = 2; taken.has(code); n++) code = `${SCENARIO.code}${n}`;
  const project = await createProject(db, { code, name: SCENARIO.name, ownerUserId: me.id });

  const users = { pm: me.id };
  const printed = [];
  await addMember(db, { projectId: project.id, userId: me.id, role: PEOPLE.pm.role });
  for (const p of Object.values(PEOPLE).filter((q) => q.email)) {
    const email2 = code === SCENARIO.code ? p.email : p.email.replace(".dmw@", `.${code.toLowerCase()}@`);
    const u = await ensureUser(db, { subject: `local|${email2}`, email: email2, displayName: p.name });
    const password = randomBytes(12).toString("base64url");
    await setPassword(db, { userId: u.id, password });
    await addMember(db, { projectId: project.id, userId: u.id, role: p.role });
    users[p.key] = u.id;
    printed.push([p.title, email2, password]);
  }

  const start = startFor(150);
  const x = context({ db, projectId: project.id, users, start });
  await play(x, steps, { onStep: (s) => console.log(`  ✓ ${s.id}  ${s.title}`) });

  console.log(`\nPROJECT ${code} — «${SCENARIO.name}»`);
  console.log(`  day 0 = ${start}  (day N = N days after it; the guide's dates are days)`);
  console.log(`  played: ${steps.length} of ${STEPS.length} steps — next: ${STEPS[steps.length]?.id ?? "nothing, the job is done"}`);
  console.log("\nTHE OTHER PEOPLE (passwords shown once, stored nowhere else):");
  for (const [title, e, pw] of printed) console.log(`  ${title}\n    email    : ${e}\n    password : ${pw}`);
  console.log("\nGuide: docs/digital-epc/03-scenario-dm-pump.md\n");
} finally {
  await db.close();
}
