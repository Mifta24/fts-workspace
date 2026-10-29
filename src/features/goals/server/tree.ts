import type { GoalView } from "@/features/goals/server/goal-service";

export type GoalNode = GoalView & { children: GoalNode[] };

/**
 * Builds a forest from a flat goal list. Goals whose parent is missing from the
 * list (for example archived or filtered out) are shown as roots, and a visited
 * set guarantees termination even if corrupt data contained a cycle.
 */
export function buildGoalTree(goals: readonly GoalView[]): GoalNode[] {
  const nodes = new Map<string, GoalNode>(
    goals.map((goal) => [goal.id, { ...goal, children: [] }]),
  );
  const roots: GoalNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentGoalId ? nodes.get(node.parentGoalId) : undefined;
    if (parent && !createsLoop(nodes, node)) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function createsLoop(nodes: Map<string, GoalNode>, start: GoalNode): boolean {
  const seen = new Set<string>([start.id]);
  let current = start.parentGoalId ? nodes.get(start.parentGoalId) : undefined;
  while (current) {
    if (seen.has(current.id)) return true;
    seen.add(current.id);
    current = current.parentGoalId ? nodes.get(current.parentGoalId) : undefined;
  }
  return false;
}
