/** 命令面板 → 知识页的一次性请求。避免为一个跳转新增全局 store 字段。 */
export interface KnowledgeRequest {
  query?: string;
  path?: string;
}

let pending: KnowledgeRequest | null = null;
const listeners = new Set<(req: KnowledgeRequest) => void>();

export function requestKnowledge(req: KnowledgeRequest): void {
  pending = req;
  for (const fn of listeners) fn(req);
}

export function takeKnowledgeRequest(): KnowledgeRequest | null {
  const req = pending;
  pending = null;
  return req;
}

export function subscribeKnowledge(fn: (req: KnowledgeRequest) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
