const categories = ["users","roles","forms","workflows"];
export function selectedStructure(tree, requested) {
  const result = {};
  for (const key of categories) {
    if (!Array.isArray(requested?.[key])) continue;
    const wanted = new Set(requested[key]);
    result[key] = [];
    function visit(node) {
      if (node.disabled || node.requires && !result[node.requires[0]]?.includes(node.requires[1])) return;
      if (wanted.has(node.key)) result[key].push(node.key);
      node.children.forEach(visit);
    }
    (tree[key] || []).forEach(visit);
  }
  return result;
}
