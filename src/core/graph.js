/** 概念依赖图：拓扑排序、解锁状态、学习路径推断。 */

export const CONCEPT_STATES = {
  locked: 'locked',
  available: 'available',
  inProgress: 'in-progress',
  mastered: 'mastered',
};

export const STATE_LABELS = {
  locked: '前置未完成',
  available: '可以开始',
  'in-progress': '学习中',
  mastered: '已掌握',
};

/**
 * 构建依赖图并做完整性检查。
 * @param {Array<{id: string, prerequisites?: string[], difficulty?: number}>} concepts
 * @returns {{byId: Map<string, object>, order: string[], missing: Array<{id: string, prerequisite: string}>, cycles: string[], dependents: Map<string, string[]>}}
 */
export function buildGraph(concepts = []) {
  const byId = new Map();
  concepts.forEach((c, index) => byId.set(c.id, { ...c, _index: index }));
  const missing = [];
  const dependents = new Map();
  for (const concept of byId.values()) {
    dependents.set(concept.id, dependents.get(concept.id) || []);
  }
  for (const concept of byId.values()) {
    for (const prereq of concept.prerequisites || []) {
      if (!byId.has(prereq)) missing.push({ id: concept.id, prerequisite: prereq });
      else dependents.get(prereq).push(concept.id);
    }
  }
  const { order, cycles } = topologicalOrder([...byId.values()], byId, missing);
  return { byId, order, missing, cycles, dependents };
}

function topologicalOrder(concepts, byId, missing) {
  const indegree = new Map();
  for (const c of concepts) {
    const valid = (c.prerequisites || []).filter((p) => byId.has(p));
    indegree.set(c.id, valid.length);
  }
  const ready = concepts
    .filter((c) => indegree.get(c.id) === 0)
    .sort(compareConcepts);
  const order = [];
  const seen = new Set();
  while (ready.length > 0) {
    const current = ready.shift();
    if (seen.has(current.id)) continue;
    seen.add(current.id);
    order.push(current.id);
    for (const depId of (byId.get(current.id)?.prerequisites || [])) void depId;
    for (const other of concepts) {
      if (seen.has(other.id)) continue;
      const valid = (other.prerequisites || []).filter((p) => byId.has(p));
      if (valid.includes(current.id)) {
        indegree.set(other.id, indegree.get(other.id) - 1);
        if (indegree.get(other.id) === 0 && !ready.includes(other)) ready.push(other);
      }
    }
    ready.sort(compareConcepts);
  }
  // 仍未被访问的节点属于环或依赖不存在的前置
  const cycles = concepts.filter((c) => !seen.has(c.id)).map((c) => c.id);
  if (missing.length === 0 && cycles.length === 0) return { order, cycles };
  // 存在环时，把剩余节点按稳定顺序附加，保证 UI 不会丢内容
  return { order: order.concat(cycles), cycles };
}

function compareConcepts(a, b) {
  const da = Number(a.difficulty) || 1;
  const db = Number(b.difficulty) || 1;
  if (da !== db) return da - db;
  return (a._index ?? 0) - (b._index ?? 0);
}

/** 返回给定概念集合的全部前置（含自身）。 */
export function prerequisiteClosure(ids, byId) {
  const result = new Set();
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop();
    if (result.has(id)) continue;
    result.add(id);
    const concept = byId.get ? byId.get(id) : null;
    for (const p of concept?.prerequisites || []) stack.push(p);
  }
  return result;
}

/**
 * 计算每个概念的状态。
 * @param {Array<object>} concepts
 * @param {Record<string, {mastered?: boolean, started?: boolean}>} statusMap
 */
export function conceptStates(concepts, statusMap = {}) {
  const { byId, order } = buildGraph(concepts);
  const states = {};
  for (const id of order) {
    const concept = byId.get(id);
    const status = statusMap[id] || {};
    const prereqs = (concept.prerequisites || []).filter((p) => byId.has(p));
    const prereqDone = prereqs.every((p) => stateOf(p, statusMap, byId) === CONCEPT_STATES.mastered);
    let state;
    if (status.mastered) state = CONCEPT_STATES.mastered;
    else if (!prereqDone) state = CONCEPT_STATES.locked;
    else if (status.started) state = CONCEPT_STATES.inProgress;
    else state = CONCEPT_STATES.available;
    states[id] = {
      id,
      state,
      label: STATE_LABELS[state],
      blockedBy: prereqDone ? [] : prereqs.filter((p) => stateOf(p, statusMap, byId) !== CONCEPT_STATES.mastered),
    };
  }
  return states;
}

function stateOf(id, statusMap, byId) {
  const status = statusMap[id] || {};
  if (status.mastered) return CONCEPT_STATES.mastered;
  const prereqs = (byId.get(id)?.prerequisites || []).filter((p) => byId.has(p));
  if (prereqs.some((p) => stateOf(p, statusMap, byId) !== CONCEPT_STATES.mastered)) return CONCEPT_STATES.locked;
  return status.started ? CONCEPT_STATES.inProgress : CONCEPT_STATES.available;
}

/** 按拓扑顺序给出「下一步可以学什么」。 */
export function recommendNext(concepts, statusMap = {}, limit = 3) {
  const states = conceptStates(concepts, statusMap);
  const { order, byId } = buildGraph(concepts);
  const pick = (wanted) => order.filter((id) => states[id].state === wanted);
  const list = [...pick(CONCEPT_STATES.inProgress), ...pick(CONCEPT_STATES.available)];
  return list.slice(0, limit).map((id) => ({ ...byId.get(id), state: states[id].state }));
}

/** 依赖图的分层结果，用于路线图绘制。 */
export function roadmapLevels(concepts) {
  const { byId, order } = buildGraph(concepts);
  const depth = new Map();
  for (const id of order) {
    const prereqs = (byId.get(id)?.prerequisites || []).filter((p) => byId.has(p) && depth.has(p));
    const d = prereqs.length === 0 ? 0 : Math.max(...prereqs.map((p) => depth.get(p))) + 1;
    depth.set(id, d);
  }
  const maxDepth = Math.max(0, ...[...depth.values()]);
  const levels = [];
  for (let i = 0; i <= maxDepth; i += 1) {
    levels.push(order.filter((id) => depth.get(id) === i).map((id) => byId.get(id)));
  }
  return levels;
}
