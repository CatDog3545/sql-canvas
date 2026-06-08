export type NodeType =
  | 'TABLE'
  | 'SELECT'
  | 'WHERE'
  | 'JOIN'
  | 'GROUP BY'
  | 'HAVING'
  | 'ORDER BY'
  | 'LIMIT'
  | 'SUBQUERY';

export type JoinType = 'INNER' | 'LEFT' | 'RIGHT' | 'FULL';

export interface BaseNode {
  id: string;
  type: NodeType;
  x: number;
  y: number;
}

export interface TableNode extends BaseNode {
  type: 'TABLE';
  tableName: string;
}

export interface SelectNode extends BaseNode {
  type: 'SELECT';
  columns: string; // comma-separated
}

export interface WhereNode extends BaseNode {
  type: 'WHERE';
  condition: string;
}

export interface JoinNode extends BaseNode {
  type: 'JOIN';
  joinType: JoinType;
  condition: string; // ON ...
}

export interface GroupByNode extends BaseNode {
  type: 'GROUP BY';
  columns: string;
}

export interface HavingNode extends BaseNode {
  type: 'HAVING';
  condition: string;
}

export interface OrderByNode extends BaseNode {
  type: 'ORDER BY';
  column: string;
  direction: 'ASC' | 'DESC';
}

export interface LimitNode extends BaseNode {
  type: 'LIMIT';
  count: string;
}

export interface SubqueryNode extends BaseNode {
  type: 'SUBQUERY';
  alias: string;
}

export type SqlNode =
  | TableNode
  | SelectNode
  | WhereNode
  | JoinNode
  | GroupByNode
  | HavingNode
  | OrderByNode
  | LimitNode
  | SubqueryNode;

// Ports
// 'in' — основной вход (левый)
// 'join' — второй вход JOIN (нижний-левый)
// 'out' — выход (правый)
export type PortRole = 'in' | 'join' | 'out';

export interface Edge {
  id: string;
  fromId: string;     // source node id (out port)
  toId: string;       // target node id
  toPort: PortRole;   // 'in' or 'join'
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export const NODE_WIDTH = 240;
export const NODE_BASE_HEIGHT = 96;

// Цветовая схема для типов
export const NODE_COLORS: Record<NodeType, { bg: string; border: string; accent: string; text: string; label: string }> = {
  'TABLE':    { bg: 'bg-emerald-50',  border: 'border-emerald-400',  accent: 'bg-emerald-500',  text: 'text-emerald-700', label: 'TABLE' },
  'SELECT':   { bg: 'bg-sky-50',      border: 'border-sky-400',      accent: 'bg-sky-500',      text: 'text-sky-700',     label: 'SELECT' },
  'WHERE':    { bg: 'bg-amber-50',    border: 'border-amber-400',    accent: 'bg-amber-500',    text: 'text-amber-700',   label: 'WHERE' },
  'JOIN':     { bg: 'bg-rose-50',     border: 'border-rose-400',     accent: 'bg-rose-500',     text: 'text-rose-700',    label: 'JOIN' },
  'GROUP BY': { bg: 'bg-violet-50',   border: 'border-violet-400',   accent: 'bg-violet-500',   text: 'text-violet-700',  label: 'GROUP BY' },
  'HAVING':   { bg: 'bg-fuchsia-50',  border: 'border-fuchsia-400',  accent: 'bg-fuchsia-500',  text: 'text-fuchsia-700', label: 'HAVING' },
  'ORDER BY': { bg: 'bg-indigo-50',   border: 'border-indigo-400',   accent: 'bg-indigo-500',   text: 'text-indigo-700',  label: 'ORDER BY' },
  'LIMIT':    { bg: 'bg-orange-50',   border: 'border-orange-400',   accent: 'bg-orange-500',   text: 'text-orange-700',  label: 'LIMIT' },
  'SUBQUERY': { bg: 'bg-teal-50',     border: 'border-teal-400',     accent: 'bg-teal-500',     text: 'text-teal-700',    label: 'SUBQUERY' },
};

export const ALL_NODE_TYPES: NodeType[] = [
  'TABLE', 'SELECT', 'WHERE', 'JOIN', 'GROUP BY', 'HAVING', 'ORDER BY', 'LIMIT', 'SUBQUERY',
];
