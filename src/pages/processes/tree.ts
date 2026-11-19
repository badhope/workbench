import type { ProcInfo } from "../../types";
import { compareProcs, type ProcSortKey } from "../processFilter";

/**
 * 进程树：把扁平快照还原成父子森林。
 *
 * 数据来自 sysinfo 的 parent_pid，它是**外部输入**：Windows 上父进程可能
 * 已退出（形成孤儿），Linux 上 PID 复用可能造出自环甚至多节点环。任何
 * 一种都足以让朴素递归死循环或把节点渲染两次，所以这里用「自然根 DFS +
 * 未访问节点提升为根」两遍扫描，保证每个 PID 恰好出现一次。
 */
export interface TreeNode {
  p: ProcInfo;
  children: TreeNode[];
}

export interface TreeRow {
  p: ProcInfo;
  depth: number;
  hasChildren: boolean;
}

function sortNodes(nodes: TreeNode[], sort: ProcSortKey): void {
  nodes.sort((a, b) => compareProcs(a.p, b.p, sort));
  for (const n of nodes) sortNodes(n.children, sort);
}

/** 构建森林。环中的节点会被提升为根，绝不丢节点。 */
export function buildForest(procs: ProcInfo[], sort: ProcSortKey = "cpu"): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  for (const p of procs) nodes.set(p.pid, { p, children: [] });

  const roots: TreeNode[] = [];
  const visited = new Set<number>();
  const parentOf = new Map<number, number>();

  for (const node of nodes.values()) {
    const parentId = node.p.parent_pid;
    if (parentId === null || parentId === node.p.pid || !nodes.has(parentId)) {
      roots.push(node);
      continue;
    }
    parentOf.set(node.p.pid, parentId);
    nodes.get(parentId)!.children.push(node);
  }

  const walk = (node: TreeNode) => {
    if (visited.has(node.p.pid)) return;
    visited.add(node.p.pid);
    for (const child of node.children) walk(child);
  };
  roots.forEach(walk);

  // 环：没有任何自然根可达。按 PID 取最小者提升为根，并从其父节点摘除，
  // 否则它会同时以「子节点」和「根」出现两次。
  const remaining = [...nodes.values()]
    .filter((n) => !visited.has(n.p.pid))
    .sort((a, b) => a.p.pid - b.p.pid);
  for (const node of remaining) {
    if (visited.has(node.p.pid)) continue;
    const parentId = parentOf.get(node.p.pid);
    if (parentId !== undefined) {
      const parent = nodes.get(parentId);
      if (parent) parent.children = parent.children.filter((c) => c !== node);
    }
    roots.push(node);
    walk(node);
  }

  sortNodes(roots, sort);
  return roots;
}

/** 按展开状态摊平成可虚拟化的行序列（深度优先，父在子前）。 */
export function flattenTree(forest: TreeNode[], expanded: Set<number>): TreeRow[] {
  const out: TreeRow[] = [];
  const walk = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      out.push({ p: node.p, depth, hasChildren: node.children.length > 0 });
      if (node.children.length > 0 && expanded.has(node.p.pid)) {
        walk(node.children, depth + 1);
      }
    }
  };
  walk(forest, 0);
  return out;
}
