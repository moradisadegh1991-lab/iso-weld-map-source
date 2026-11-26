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
  const users = (await db.query(`SELECT m.user_id AS id,u.display_name,m.position,m.decree,m.status,u.is_active
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
    const active = u.status === "active" && u.is_active;
    return node(u.id, [u.display_name,u.position,u.decree,active ? "فعال":"غیرفعال"].filter(Boolean).join(" · "), [], {kind:"user",disabled:!active});
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
    return {...s,selection:selectedStructure(s.tree,s.selection)};
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
      await tx.query(`INSERT INTO structure_subscription(stakeholder_id,project_id,contract_id,company_id,role,source_id,selection)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(stakeholder_id) DO UPDATE SET source_id=EXCLUDED.source_id,selection=EXCLUDED.selection`,
        [...args,s.sourceId,JSON.stringify(selectedStructure(s.tree,input.selection))]);
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
