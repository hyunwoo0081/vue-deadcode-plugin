import { Node, Edge, NodeId, Confidence } from './types.js';

export interface ReachabilityResult {
  aliveNodeIds: Set<NodeId>;
  traces: Map<NodeId, string[]>;
}

export class BiDirectionalGraph {
  nodes = new Map<NodeId, Node>();
  outgoingEdges = new Map<NodeId, Set<Edge>>();
  incomingEdges = new Map<NodeId, Set<Edge>>();

  addNode(node: Node): void {
    this.nodes.set(node.id, node);
    if (!this.outgoingEdges.has(node.id)) {
      this.outgoingEdges.set(node.id, new Set());
    }
    if (!this.incomingEdges.has(node.id)) {
      this.incomingEdges.set(node.id, new Set());
    }
  }

  addEdge(edge: Edge): void {
    // Add default node records if they don't exist
    if (!this.nodes.has(edge.from)) {
      const isSymbol = edge.from.includes('#');
      this.addNode({
        id: edge.from,
        type: isSymbol ? 'SYMBOL' : 'FILE' as any, // NodeTypes.FILE/SYMBOL
        path: edge.from.split('#')[0],
        symbolName: isSymbol ? edge.from.split('#')[1] : undefined,
        isEntry: false
      });
    }

    if (!this.nodes.has(edge.to)) {
      const isSymbol = edge.to.includes('#');
      this.addNode({
        id: edge.to,
        type: isSymbol ? 'SYMBOL' : 'FILE' as any,
        path: edge.to.split('#')[0],
        symbolName: isSymbol ? edge.to.split('#')[1] : undefined,
        isEntry: false
      });
    }

    this.outgoingEdges.get(edge.from)!.add(edge);
    this.incomingEdges.get(edge.to)!.add(edge);
  }

  getNode(id: NodeId): Node | undefined {
    return this.nodes.get(id);
  }

  getIncomingEdges(id: NodeId): Edge[] {
    return Array.from(this.incomingEdges.get(id) || []);
  }

  getOutgoingEdges(id: NodeId): Edge[] {
    return Array.from(this.outgoingEdges.get(id) || []);
  }

  computeReachability(): ReachabilityResult {
    const aliveNodeIds = new Set<NodeId>();
    const traces = new Map<NodeId, string[]>();
    const queue: NodeId[] = [];

    // Initialize BFS with entry nodes
    for (const [id, node] of this.nodes.entries()) {
      if (node.isEntry) {
        aliveNodeIds.add(id);
        traces.set(id, [id]);
        queue.push(id);
      }
    }

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const outgoing = this.outgoingEdges.get(currentId) || new Set();

      for (const edge of outgoing) {
        const nextId = edge.to;
        if (!aliveNodeIds.has(nextId)) {
          aliveNodeIds.add(nextId);
          
          // Reconstruct path
          const currentTrace = traces.get(currentId) || [];
          traces.set(nextId, [...currentTrace, nextId]);
          
          queue.push(nextId);
        }
      }
    }

    return {
      aliveNodeIds,
      traces
    };
  }
}
