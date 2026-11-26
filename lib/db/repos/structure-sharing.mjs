import { SECTIONS } from "../../platform/navigation.mjs";

const bad = (message) => Object.assign(new Error(message), {status:400});
import { selectedStructure } from "../../org/shared-selection.mjs";

async function partyOf(db, { projectId, contractId, stakeholderId }, lock = false) {
  const {rows:[party]} = await db.query(`SELECT s.*, p.name AS project_name,c.title AS contract_name FROM contract_stakeholder s
    JOIN project p ON p.id=s.project_id JOIN contract c ON c.id=s.contract_id
    WHERE s.id=$1 AND s.project_id=$2 AND s.contract_id=$3 ${lock ? "FOR UPDATE OF s" : ""}`, [stakeholderId,projectId,contractId]);
  if (!party) throw bad("ذی‌نفع در قرارداد جاری پیدا نشد.");
  return party;
}

async function catalog(db, source) {
  const args = [source.contract_id,source.company_id];
  const users = (await db.query(`SELECT m.user_id AS id,u.display_name,m.position,m.decree,m.status,u.is_active,appointment_active(m.id) AS current
    FROM contract_member m JOIN app_user u ON u.id=m.user_id WHERE m.contract_id=$1 AND u.company_id=$2 ORDER BY u.display_name`,args)).rows;
  const roles = (await db.query("SELECT id,parent_id,name FROM contract_role WHERE stakeholder_id=$1 ORDER BY seq,name",[source.stakeholder_id])).rows;
  const duties = (await db.query("SELECT id,role_id,name FROM duty WHERE role_id=ANY($1::uuid[]) ORDER BY name",[roles.map(r=>r.id)])).rows;
  const holders = (await db.query("SELECT duty_id,user_id FROM duty_member WHERE duty_id=ANY($1::uuid[]) AND user_id=ANY($2::uuid[]) AND active",[duties.map(d=>d.id),users.map(u=>u.id)])).rows;
  const forms = (await db.query("SELECT id,code,name,workflow_id,form_navigation FROM report_type WHERE form_contract_id=$1 AND form_company_id=$2 AND active ORDER BY code",args)).rows;
  const flows = (await db.query("SELECT id,name FROM workflow WHERE id=ANY($1::uuid[]) ORDER BY name",[forms.map(f=>f.workflow_id).filter(Boolean)])).rows;
  const stages = (await db.query("SELECT id,workflow_id,name FROM report_stage WHERE workflow_id=ANY($1::uuid[]) ORDER BY seq",[flows.map(f=>f.id)])).rows;
  const groups = (await db.query("SELECT id,stage_id,name FROM review_group WHERE stage_id=ANY($1::uuid[]) ORDER BY seq",[stages.map(s=>s.id)])).rows;
  const groupIds = groups.map(g=>g.id);
  const assigned = (await db.query("SELECT group_id,duty_id FROM group_duty WHERE group_id=ANY($1::uuid[]) AND duty_id=ANY($2::uuid[])",[groupIds,duties.map(d=>d.id)])).rows;
  const members = (await db.query("SELECT group_id,user_id FROM group_member WHERE group_id=ANY($1::uuid[]) AND user_id=ANY($2::uuid[])",[groupIds,users.map(u=>u.id)])).rows;
  const node = (key,label,children=[],extra={}) => ({key,label,children,...extra});
  const userNodes = users.map(u => {
    const active = u.current && u.is_active;
    return node(u.id, [u.display_name,u.position,u.decree,active ? "فعال":"غیرفعال"].filter(Boolean).join(" · "), [], {kind:"user",decree:u.decree,disabled:!active});
  });
  const person = (parent,id) => node(parent+"/"+id, userNodes.find(u=>u.key===id).label,[],{kind:"user",requires:["users",id]});
  const roleNodes = new Map(roles.map(r=>[r.id,node(r.id,r.name,[],{kind:"role"})]));
  const roots = [];
  for (const r of roles) (roleNodes.get(r.parent_id)?.children || roots).push(roleNodes.get(r.id));
  for (const d of duties) {
    const people = holders.filter(h=>h.duty_id===d.id).map(h=>person(d.id,h.user_id));
    roleNodes.get(d.role_id).children.push(node(d.id,d.name,people,{kind:"duty"}));
  }
  const names = new Map(duties.map(d=>[d.id,d.name]));
  const groupNodes = g => node(g.id,g.name,[
    ...assigned.filter(a=>a.group_id===g.id).map(a=>node(g.id+"/"+a.duty_id,names.get(a.duty_id),[],{kind:"duty",requires:["roles",a.duty_id]})),
    ...members.filter(m=>m.group_id===g.id).map(m=>person(g.id,m.user_id))
  ],{kind:"group"});
  const stageNodes = s => node(s.id,s.name,groups.filter(g=>g.stage_id===s.id).map(groupNodes),{kind:"stage"});
  const workflows = flows.map(f=>node(f.id,f.name,stages.filter(s=>s.workflow_id===f.id).map(stageNodes),{kind:"workflow"}));
  const formTree = SECTIONS.flatMap(g=>g.items.map(i=>node(i.key,i.title,
    forms.filter(f=>f.form_navigation===i.key).map(f=>node(f.id,f.code+" · "+f.name))))).filter(n=>n.children.length);
  return {users:userNodes,roles:roots,forms:formTree,workflows};
}

// Read the named source only after matching both the company and role against the current contract.
// Keep the source setting transaction-local and restore the target before writing the subscription.
async function state(tx, input, lock=false) {
  const party = await partyOf(tx,input,lock);
  const {rows:sources} = await tx.query("SELECT * FROM structure_source WHERE company_id=$1 AND role=$2 ORDER BY label",[party.company_id,party.role]);
  const own = sources.find(s=>s.stakeholder_id===party.id);
  const {rows:[subscription]} = await tx.query("SELECT source_id,selection FROM structure_subscription WHERE stakeholder_id=$1",[party.id]);
  const sourceId = input.sourceId === undefined ? subscription?.source_id : input.sourceId;
  const source = sources.find(s=>s.id===sourceId && s.contract_id!==party.contract_id);
  if (sourceId && !source) throw bad("قرارداد مبنای این شرکت و نقش پیدا نشد.");
  let tree = {};
  if (source) {
    await tx.query("SELECT set_config('app.project_id',$1,true)",[source.project_id]);
    tree = await catalog(tx,source);
    await tx.query("SELECT set_config('app.project_id',$1,true)",[party.project_id]);
  }
  return {party, own:!!own, sources:sources.filter(s=>s.contract_id!==party.contract_id).map(s=>({id:s.id,label:s.label})),
    sourceId:source?.id || "",selection:source?.id===subscription?.source_id ? subscription?.selection || {} : {}, tree};
}

export async function shareState(db,input) {
  const read = async tx => {
    const s = await state(tx,input);
    const selection = selectedStructure(s.tree,s.selection);
    const signing = input.sourceId === undefined && s.sourceId ? await signingOptions(tx,s.party,selection) : null;
    return {...s,selection,signing};
  };
  return db.inTransaction ? read(db) : db.transaction(read);
}

export async function saveShare(db,input) {
  const write = async tx => {
    const s = await state(tx,input.kind === "share-base" ? {...input,sourceId:undefined} : input,true);
    const p = s.party;
    const args = [p.id,p.project_id,p.contract_id,p.company_id,p.role];
    if (input.kind==="share-base") {
      if (input.enabled && s.sourceId) throw bad("قرارداد استفاده‌کننده نمی‌تواند قرارداد مبنا باشد.");
      if (input.enabled) await tx.query(`INSERT INTO structure_source(stakeholder_id,project_id,contract_id,company_id,role,label)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (stakeholder_id) DO UPDATE SET label=EXCLUDED.label`,[...args,p.project_name+" · "+p.contract_name]);
      else await tx.query("DELETE FROM structure_source WHERE stakeholder_id=$1",[p.id]);
    } else if (s.sourceId) {
      if (s.own) throw bad("قرارداد مبنا نمی‌تواند از قرارداد دیگری استفاده کند.");
      if (!input.sourceId) throw bad("قرارداد مبنا را انتخاب کنید.");
      const selection = selectedStructure(s.tree,input.selection);
      await tx.query(`DELETE FROM shared_signer_approval a USING structure_subscription x,contract_member m
        WHERE a.subscription_id=x.id AND a.appointment_id=m.id AND x.stakeholder_id=$1
          AND (a.source_id<>$2 OR NOT(m.user_id=ANY($3::uuid[])))`,[p.id,s.sourceId,selection.users || []]);
      await tx.query(`INSERT INTO structure_subscription(stakeholder_id,project_id,contract_id,company_id,role,source_id,selection)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(stakeholder_id) DO UPDATE SET source_id=EXCLUDED.source_id,selection=EXCLUDED.selection`,
        [...args,s.sourceId,JSON.stringify(selection)]);
    } else await tx.query("DELETE FROM structure_subscription WHERE stakeholder_id=$1",[p.id]);
    return {id:p.id};
  };
  return db.inTransaction ? write(db) : db.transaction(write);
}

const childKinds = {role:["role","duty"],duty:["user"],workflow:["stage"],stage:["group"],group:["duty","user"]};

function flatten(nodes) {
  return nodes.flatMap(n=>[n,...flatten(n.children)]);
}

async function extensionContext(db, input, lock=false) {
  const stateOfParty = await state(db,input,lock);
  const {tree,party,sourceId} = stateOfParty;
  const selected = selectedStructure(tree,stateOfParty.selection);
  const local = await catalog(db,{...party,stakeholder_id:party.id});
  const options = new Map();
  for (const n of [...flatten(local.roles),...flatten(local.workflows),...local.users]) {
    if (n.kind && !n.disabled && !n.requires) options.set(n.key,n);
  }
  const subscription = (await db.query("SELECT id FROM structure_subscription WHERE stakeholder_id=$1 AND source_id=$2",[party.id,sourceId || null])).rows[0];
  const existing = subscription ? (await db.query("SELECT * FROM structure_extension WHERE subscription_id=$1 AND source_id=$2 AND category=$3",
    [subscription.id,sourceId,input.category])).rows : [];
  return {tree,selected,options,existing,subscription,sourceId};
}

export async function editExtension(db,input) {
  if (!["roles","workflows"].includes(input.category)) throw bad("نوع ساختار نامعتبر است.");
  const write = async tx => {
    const {tree,selected,options,existing,sourceId,subscription} = await extensionContext(tx,{...input,sourceId:undefined},true);
    if (!subscription) throw bad("ابتدا اشتراک را ذخیره کنید.");
    if (input.removeId) {
      if (!existing.some(e=>e.id===input.removeId)) throw bad("ردیف محلی پیدا نشد.");
      await tx.query("DELETE FROM structure_extension WHERE id=$1 AND subscription_id=$2",[input.removeId,subscription.id]);
      return;
    }
    const parent = flatten(tree[input.category] || []).find(n=>n.key===input.parentKey);
    const child = options.get(input.localKey);
    if (!selected[input.category]?.includes(parent?.key) || !childKinds[parent?.kind]?.includes(child?.kind)) throw bad("ردیف محلی با گره اشتراکی سازگار نیست.");
    await tx.query(`INSERT INTO structure_extension(project_id,subscription_id,source_id,category,parent_key,local_key)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[input.projectId,subscription.id,sourceId,input.category,parent.key,child.key]);
  };
  return db.inTransaction ? write(db) : db.transaction(write);
}

/** Only saved nodes appear in the consuming contract. Local additions reference local records. */
export async function inheritedStructure(db, {projectId,contractId,category}) {
  if (!["users","roles","forms","workflows"].includes(category)) throw bad("نوع ساختار نامعتبر است.");
  const {rows:subscriptions} = await db.query(`SELECT x.stakeholder_id,c.name FROM structure_subscription x
    JOIN company c ON c.id=x.company_id WHERE x.contract_id=$1 AND x.project_id=$2`,[contractId,projectId]);
  const result = [];
  for (const row of subscriptions) {
    const input = {projectId,contractId,category,stakeholderId:row.stakeholder_id};
    const read = async tx => {
      const {tree,selected,options,existing} = await extensionContext(tx,input);
      const visible = new Set(selected[category]);
      function prune(nodes) {
        return nodes.flatMap(n=>{
          const children = prune(n.children);
          if (!visible.has(n.key)) return children;
          const additions = existing.filter(e=>e.parent_key===n.key && options.has(e.local_key));
          for (const e of additions) {
            children.push({key:e.id,localId:e.id,label:options.get(e.local_key).label,children:[]});
          }
          const choices = ["roles","workflows"].includes(category) ? [...options.values()]
            .filter(c=>childKinds[n.kind]?.includes(c.kind) && !additions.some(e=>e.local_key===c.key))
            .map(c=>({key:c.key,label:c.label})) : [];
          return [{key:n.key,label:n.label,choices,children}];
        });
      }
      return prune(tree[category] || []);
    };
    const children = db.inTransaction ? await read(db) : await db.transaction(read);
    if (children.length) result.push({key:row.stakeholder_id,label:row.name,children});
  }
  return result;
}

async function signingOptions(db, party, selection) {
  const {rows:appointments} = await db.query(`SELECT m.id,m.user_id,m.decree,u.display_name FROM contract_member m
    JOIN app_user u ON u.id=m.user_id AND u.is_active JOIN project_member pm ON pm.project_id=m.project_id AND pm.user_id=m.user_id
    WHERE m.contract_id=$1 AND u.company_id=$2 AND appointment_active(m.id) AND m.decree IS NOT NULL
      AND m.user_id=ANY($3::uuid[]) ORDER BY u.display_name`,[party.contract_id,party.company_id,selection.users || []]);
  const {rows:groups} = await db.query(`SELECT t.id AS type_id,g.id AS group_id,t.name AS form,s.name AS stage,g.name AS name
    FROM report_type t JOIN report_stage s ON s.workflow_id=t.workflow_id JOIN review_group g ON g.stage_id=s.id
    WHERE t.form_contract_id=$1 AND t.active AND (t.form_company_id IS NULL OR t.form_company_id=$2)
    ORDER BY t.name,s.seq,g.seq`,[party.contract_id,party.company_id]);
  const {rows:approvals} = await db.query(`SELECT a.id,a.destination_decree,a.approved_at,u.display_name,t.name AS form,g.name AS name
    FROM shared_signer_approval a JOIN structure_subscription x ON x.id=a.subscription_id
    JOIN contract_member m ON m.id=a.appointment_id JOIN app_user u ON u.id=m.user_id
    JOIN report_type t ON t.id=a.type_id JOIN review_group g ON g.id=a.group_id
    WHERE x.stakeholder_id=$1 ORDER BY a.approved_at`,[party.id]);
  return {appointments,groups,approvals};
}

export async function decideSharedSigner(db,input,managerId) {
  const write = async tx => {
    const s = await state(tx,{...input,sourceId:undefined},true);
    if (!s.sourceId || s.sourceId !== input.sourceId) throw bad("اشتراک تغییر کرده است. فرم را تازه‌سازی کنید.");
    const selected = selectedStructure(s.tree,s.selection);
    const options = await signingOptions(tx,s.party,selected);
    if (input.revokeId) {
      if (!options.approvals.some(a=>a.id===input.revokeId)) throw bad("تأیید در این قرارداد پیدا نشد.");
      await tx.query("DELETE FROM shared_signer_approval WHERE id=$1 AND project_id=$2",[input.revokeId,input.projectId]);
      return;
    }
    const appointment = options.appointments.find(a=>a.id===input.appointmentId && a.decree===input.destinationDecree);
    const sourceUser = s.tree.users.find(u=>appointment && u.key===appointment.user_id);
    if (!sourceUser?.decree || sourceUser.decree!==input.sourceDecree ||
      !options.groups.some(g=>g.group_id===input.groupId && g.type_id===input.typeId)) throw bad("حکم فعال، فرم و گروه مقصد را دوباره بررسی کنید.");
    await tx.query(`INSERT INTO shared_signer_approval(project_id,subscription_id,source_id,appointment_id,source_decree,destination_decree,type_id,group_id,approved_by)
      SELECT x.project_id,x.id,x.source_id,$2,$3,$4,$5,$6,$7 FROM structure_subscription x WHERE x.stakeholder_id=$1
      ON CONFLICT(subscription_id,appointment_id,type_id,group_id) DO UPDATE SET source_id=EXCLUDED.source_id,
        source_decree=EXCLUDED.source_decree,destination_decree=EXCLUDED.destination_decree,approved_by=EXCLUDED.approved_by,approved_at=now()`,
      [s.party.id,appointment.id,sourceUser.decree,appointment.decree,input.typeId,input.groupId,managerId]);
  };
  return db.inTransaction ? write(db) : db.transaction(write);
}

export async function approvedSharedSigners(db,projectId,typeId) {
  if (!typeId) return [];
  const {rows} = await db.query(`SELECT a.group_id,m.user_id,u.display_name,u.email
    FROM shared_signer_approval a JOIN structure_subscription x ON x.id=a.subscription_id AND x.source_id=a.source_id
    JOIN report_type t ON t.id=a.type_id AND t.active AND t.form_contract_id=x.contract_id
    JOIN review_group g ON g.id=a.group_id JOIN report_stage s ON s.id=g.stage_id AND s.workflow_id=t.workflow_id
    JOIN contract_member m ON m.id=a.appointment_id AND m.contract_id=x.contract_id AND m.decree=a.destination_decree
    JOIN app_user u ON u.id=m.user_id AND u.is_active AND u.company_id=x.company_id
    JOIN project_member pm ON pm.project_id=x.project_id AND pm.user_id=u.id
    WHERE a.project_id=$1 AND a.type_id=$2 AND appointment_active(m.id)
      AND (t.form_company_id IS NULL OR t.form_company_id=x.company_id) AND shared_signer_source_active(a.id)`,[projectId,typeId]);
  return rows.map(row=>({...row,permissions:["view","sign"]}));
}
