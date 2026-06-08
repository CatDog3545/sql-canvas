import type { Edge, JoinNode, SqlNode } from '../types';

interface QueryParts {
  select?: string;
  from?: string;
  joins: { type: string; table: string; on: string }[];
  where?: string;
  groupBy?: string;
  having?: string;
  orderBy?: string;
  limit?: string;
}

/**
 * Находит узел, подключённый к указанному порту (левый вход) данного узла.
 * Возвращает id источника или null.
 */
function findIncoming(nodeId: string, port: 'in' | 'join', edges: Edge[]): string | null {
  const edge = edges.find((e) => e.toId === nodeId && e.toPort === port);
  return edge ? edge.fromId : null;
}

/**
 * Строит SQL-выражение (источник FROM) для узла, который используется как источник
 * (например, TABLE даёт имя таблицы, SUBQUERY даёт подзапрос).
 */
function buildSourceExpression(nodeId: string, nodes: SqlNode[], edges: Edge[]): string {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return '???';

  if (node.type === 'TABLE') {
    return node.tableName.trim() || '???';
  }

  if (node.type === 'SUBQUERY') {
    // Рекурсивно собираем внутренний запрос (цепочка, ведущая в SUBQUERY)
    const inner = buildQuery(node.id, nodes, edges);
    const sql = formatSQL(inner);
    const alias = node.alias.trim() || 'sq';
    return `(${sql}) AS ${alias}`;
  }

  // Если к входу подключён не TABLE и не SUBQUERY, а, например, SELECT,
  // это значит, что источник сам является цепочкой — обернём в подзапрос.
  const inner = buildQuery(node.id, nodes, edges);
  return `(${formatSQL(inner)}) AS sub`;
}

/**
 * Основная рекурсивная функция — собирает части SQL-запроса для терминального узла.
 */
export function buildQuery(terminalId: string, nodes: SqlNode[], edges: Edge[]): QueryParts {
  const node = nodes.find((n) => n.id === terminalId);
  if (!node) {
    return { joins: [] };
  }

  // Для TABLE / SUBQUERY как терминала — базовый FROM
  if (node.type === 'TABLE') {
    return {
      from: node.tableName.trim() || '???',
      joins: [],
    };
  }

  if (node.type === 'SUBQUERY') {
    // SUBQUERY в роли терминала — возвращаем его внутренний запрос как есть
    const prevId = findIncoming(node.id, 'in', edges);
    if (!prevId) {
      return { from: `(SELECT ???) AS ${node.alias.trim() || 'sq'}`, joins: [] };
    }
    const inner = buildQuery(prevId, nodes, edges);
    return {
      from: `(${formatSQL(inner)}) AS ${node.alias.trim() || 'sq'}`,
      joins: [],
    };
  }

  // Для остальных типов — получаем предыдущий узел (основной вход)
  const prevId = findIncoming(node.id, 'in', edges);
  const prev: QueryParts = prevId ? buildQuery(prevId, nodes, edges) : { joins: [] };

  switch (node.type) {
    case 'SELECT':
      prev.select = node.columns.trim() || '*';
      return prev;
    case 'WHERE':
      if (node.condition.trim()) {
        prev.where = prev.where ? `(${prev.where}) AND (${node.condition.trim()})` : node.condition.trim();
      }
      return prev;
    case 'GROUP BY':
      prev.groupBy = node.columns.trim() || prev.groupBy;
      return prev;
    case 'HAVING':
      if (node.condition.trim()) {
        prev.having = prev.having ? `(${prev.having}) AND (${node.condition.trim()})` : node.condition.trim();
      }
      return prev;
    case 'ORDER BY':
      if (node.column.trim()) {
        const clause = `${node.column.trim()} ${node.direction}`;
        prev.orderBy = prev.orderBy ? `${prev.orderBy}, ${clause}` : clause;
      }
      return prev;
    case 'LIMIT':
      if (node.count.trim()) {
        prev.limit = node.count.trim();
      }
      return prev;
    case 'JOIN': {
      const joinNode = node as JoinNode;
      const joinedId = findIncoming(node.id, 'join', edges);
      const joinedTable = joinedId ? buildSourceExpression(joinedId, nodes, edges) : '???';
      prev.joins = [
        ...prev.joins,
        {
          type: joinNode.joinType,
          table: joinedTable,
          on: joinNode.condition.trim() || '1=1',
        },
      ];
      return prev;
    }
    default:
      return prev;
  }
}

export function formatSQL(q: QueryParts): string {
  const lines: string[] = [];
  lines.push(`SELECT ${q.select || '*'}`);
  lines.push(`FROM ${q.from || '???'}`);
  for (const j of q.joins) {
    lines.push(`${j.type} JOIN ${j.table} ON ${j.on}`);
  }
  if (q.where) lines.push(`WHERE ${q.where}`);
  if (q.groupBy) lines.push(`GROUP BY ${q.groupBy}`);
  if (q.having) lines.push(`HAVING ${q.having}`);
  if (q.orderBy) lines.push(`ORDER BY ${q.orderBy}`);
  if (q.limit) lines.push(`LIMIT ${q.limit}`);
  return lines.join('\n');
}

/**
 * Находит все терминальные узлы (правый порт никуда не подключён) —
 * это точки вывода независимых цепочек.
 */
export function findTerminalNodes(nodes: SqlNode[], edges: Edge[]): SqlNode[] {
  return nodes.filter((n) => !edges.some((e) => e.fromId === n.id));
}

/**
 * Генерирует SQL для всех независимых цепочек в графе.
 */
export function generateAllSQL(nodes: SqlNode[], edges: Edge[]): { id: string; label: string; sql: string }[] {
  const terminals = findTerminalNodes(nodes, edges);
  if (terminals.length === 0) return [];

  return terminals.map((t, idx) => {
    const q = buildQuery(t.id, nodes, edges);
    const sql = formatSQL(q);
    const label = describeTerminal(t, idx + 1);
    return { id: t.id, label, sql };
  });
}

function describeTerminal(n: SqlNode, idx: number): string {
  switch (n.type) {
    case 'TABLE':
      return `Query ${idx} — ${n.tableName || '???'}`;
    case 'SELECT':
      return `Query ${idx} — SELECT`;
    case 'WHERE':
      return `Query ${idx} — WHERE`;
    case 'JOIN':
      return `Query ${idx} — JOIN`;
    case 'GROUP BY':
      return `Query ${idx} — GROUP BY`;
    case 'HAVING':
      return `Query ${idx} — HAVING`;
    case 'ORDER BY':
      return `Query ${idx} — ORDER BY`;
    case 'LIMIT':
      return `Query ${idx} — LIMIT`;
    case 'SUBQUERY':
      return `Query ${idx} — ${n.alias || 'subquery'}`;
  }
}
