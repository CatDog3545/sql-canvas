import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Edge,
  JoinType,
  NodeType,
  PortRole,
  SqlNode,
  Viewport,
} from './types';
import { ALL_NODE_TYPES, NODE_COLORS, NODE_WIDTH } from './types';
import { generateAllSQL } from './utils/sql';

// ---------- Геометрия портов ----------

/** Высота узла по типу */
function nodeHeight(type: NodeType): number {
  switch (type) {
    case 'TABLE':    return 104;
    case 'SELECT':   return 120;
    case 'WHERE':    return 120;
    case 'JOIN':     return 168; // два входных порта
    case 'GROUP BY': return 120;
    case 'HAVING':   return 120;
    case 'ORDER BY': return 140;
    case 'LIMIT':    return 104;
    case 'SUBQUERY': return 104;
  }
}

/** Позиция выходного (правого) порта в canvas-координатах */
function outPortPos(n: SqlNode): { x: number; y: number } {
  const h = nodeHeight(n.type);
  return { x: n.x + NODE_WIDTH, y: n.y + h / 2 };
}

/** Позиция входного (левого) порта в canvas-координатах */
function inPortPos(n: SqlNode): { x: number; y: number } {
  const h = nodeHeight(n.type);
  // Для JOIN основной вход в верхней трети
  if (n.type === 'JOIN') {
    return { x: n.x, y: n.y + 44 };
  }
  return { x: n.x, y: n.y + h / 2 };
}

/** Позиция второго (join) порта для JOIN-узлов */
function joinPortPos(n: SqlNode): { x: number; y: number } | null {
  if (n.type !== 'JOIN') return null;
  return { x: n.x, y: n.y + 124 };
}

/** Есть ли у узла входной порт */
function hasInPort(n: SqlNode): boolean {
  return n.type !== 'TABLE';
}

/** Есть ли у узла выходной порт — всегда да */
function hasOutPort(_n: SqlNode): boolean {
  return true;
}

// ---------- Утилиты ----------

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function makeDefaultNode(type: NodeType, x: number, y: number): SqlNode {
  const base = { id: uid(), x, y };
  switch (type) {
    case 'TABLE':    return { ...base, type, tableName: 'users' };
    case 'SELECT':   return { ...base, type, columns: '*' };
    case 'WHERE':    return { ...base, type, condition: 'id > 0' };
    case 'JOIN':     return { ...base, type, joinType: 'INNER', condition: 'a.id = b.id' };
    case 'GROUP BY': return { ...base, type, columns: 'category' };
    case 'HAVING':   return { ...base, type, condition: 'COUNT(*) > 1' };
    case 'ORDER BY': return { ...base, type, column: 'id', direction: 'ASC' };
    case 'LIMIT':    return { ...base, type, count: '10' };
    case 'SUBQUERY': return { ...base, type, alias: 'sq' };
  }
}

/** Кривая Безье между двумя точками */
function edgePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = Math.max(40, Math.abs(to.x - from.x) * 0.5);
  return `M ${from.x} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x} ${to.y}`;
}

// ---------- Главный компонент ----------

export default function App() {
  const [nodes, setNodes] = useState<SqlNode[]>(() => {
    // Демонстрационная цепочка
    const t: SqlNode = { id: uid(), type: 'TABLE', x: 80,  y: 180, tableName: 'users' };
    const s: SqlNode = { id: uid(), type: 'SELECT', x: 400, y: 180, columns: 'id, name, email' };
    const w: SqlNode = { id: uid(), type: 'WHERE', x: 720, y: 180, condition: 'age >= 18' };
    const o: SqlNode = { id: uid(), type: 'ORDER BY', x: 1040, y: 180, column: 'name', direction: 'ASC' };
    const l: SqlNode = { id: uid(), type: 'LIMIT', x: 1360, y: 180, count: '25' };
    return [t, s, w, o, l];
  });

  const [edges, setEdges] = useState<Edge[]>(() => {
    // Соединения демо-цепочки — создаём после инициализации nodes, но здесь nodes ещё не определены,
    // поэтому сформируем их через id-ы после. Используем useEffect.
    return [];
  });

  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (!initialized) {
      // Построим стартовые соединения по порядку узлов
      const ids = nodes.map((nd) => nd.id);
      const initialEdges: Edge[] = [];
      for (let i = 0; i < ids.length - 1; i++) {
        initialEdges.push({ id: uid(), fromId: ids[i], toId: ids[i + 1], toPort: 'in' });
      }
      setEdges(initialEdges);
      setInitialized(true);
    }
  }, [initialized, nodes]);

  const [viewport, setViewport] = useState<Viewport>({ x: 40, y: 40, zoom: 1 });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Контекстное меню
  const [menu, setMenu] = useState<{ x: number; y: number; canvasX: number; canvasY: number } | null>(null);

  // Pan
  const [panState, setPanState] = useState<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);

  // Перетаскивание узла
  const [dragNode, setDragNode] = useState<{ id: string; offX: number; offY: number } | null>(null);

  // Протягивание соединения
  const [linking, setLinking] = useState<{
    fromId: string;
    mouseX: number; // canvas-координаты
    mouseY: number;
  } | null>(null);

  // Сворачивание SQL-панели
  const [sqlOpen, setSqlOpen] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);

  // ---------- Преобразование координат ----------

  const screenToCanvas = useCallback(
    (sx: number, sy: number) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (sx - rect.left - viewport.x) / viewport.zoom,
        y: (sy - rect.top - viewport.y) / viewport.zoom,
      };
    },
    [viewport]
  );

  // ---------- Zoom ----------

  const applyZoom = useCallback(
    (newZoom: number, pivotSX?: number, pivotSY?: number) => {
      const z = Math.min(2.5, Math.max(0.25, newZoom));
      if (pivotSX != null && pivotSY != null) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) {
          const sx = pivotSX - rect.left;
          const sy = pivotSY - rect.top;
          setViewport((vp) => {
            const cx = (sx - vp.x) / vp.zoom;
            const cy = (sy - vp.y) / vp.zoom;
            return { x: sx - cx * z, y: sy - cy * z, zoom: z };
          });
          return;
        }
      }
      setViewport((vp) => ({ ...vp, zoom: z }));
    },
    []
  );

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      applyZoom(viewport.zoom * factor, e.clientX, e.clientY);
    },
    [applyZoom, viewport.zoom]
  );

  // ---------- Pan / Node Drag / Linking on canvas ----------

  const onCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 2) return; // правая кнопка — для меню
    // Если клик по пустому месту — начинаем панорамирование
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset?.bg === '1') {
      setMenu(null);
      setSelectedNodeId(null);
      setPanState({ startX: e.clientX, startY: e.clientY, vpX: viewport.x, vpY: viewport.y });
    }
  };

  const onCanvasMouseMove = (e: React.MouseEvent) => {
    if (panState) {
      setViewport((vp) => ({
        ...vp,
        x: panState.vpX + (e.clientX - panState.startX),
        y: panState.vpY + (e.clientY - panState.startY),
      }));
    }
    if (dragNode) {
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      setNodes((ns) =>
        ns.map((n) =>
          n.id === dragNode.id ? { ...n, x: x - dragNode.offX, y: y - dragNode.offY } : n
        )
      );
    }
    if (linking) {
      const { x, y } = screenToCanvas(e.clientX, e.clientY);
      setLinking((l) => (l ? { ...l, mouseX: x, mouseY: y } : l));
    }
  };

  const onCanvasMouseUp = () => {
    setPanState(null);
    setDragNode(null);
    setLinking(null);
  };

  // ---------- Контекстное меню ----------

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    setMenu({ x: e.clientX, y: e.clientY, canvasX: x, canvasY: y });
  };

  const addNode = (type: NodeType) => {
    if (!menu) return;
    const n = makeDefaultNode(type, menu.canvasX, menu.canvasY);
    setNodes((ns) => [...ns, n]);
    setSelectedNodeId(n.id);
    setMenu(null);
  };

  const deleteNode = (id: string) => {
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => es.filter((e) => e.fromId !== id && e.toId !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  };

  const deleteEdge = (id: string) => {
    setEdges((es) => es.filter((e) => e.id !== id));
  };

  const clearAll = () => {
    if (confirm('Очистить всё полотно?')) {
      setNodes([]);
      setEdges([]);
      setSelectedNodeId(null);
    }
  };

  // ---------- Обновление узлов ----------

  const updateNode = <T extends SqlNode>(id: string, patch: Partial<T>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? ({ ...(n as T), ...patch } as SqlNode) : n)));
  };

  // ---------- Порты: начало/завершение связи ----------

  const startLinking = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    e.preventDefault();
    const { x, y } = screenToCanvas(e.clientX, e.clientY);
    setLinking({ fromId: nodeId, mouseX: x, mouseY: y });
  };

  const endLinking = (e: React.MouseEvent, targetId: string, toPort: PortRole) => {
    e.stopPropagation();
    e.preventDefault();
    if (!linking) return;
    if (linking.fromId === targetId) {
      setLinking(null);
      return;
    }
    // Заменяем существующее соединение к этому порту
    setEdges((es) => {
      const filtered = es.filter((e) => !(e.toId === targetId && e.toPort === toPort));
      return [...filtered, { id: uid(), fromId: linking.fromId, toId: targetId, toPort }];
    });
    setLinking(null);
  };

  // ---------- Клавиши ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNodeId) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        deleteNode(selectedNodeId);
      }
      if (e.key === 'Escape') {
        setMenu(null);
        setLinking(null);
        setSelectedNodeId(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedNodeId]);

  // Закрытие меню при клике вне
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('mousedown', close, { once: true });
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  // ---------- SQL ----------

  const sqlResults = useMemo(() => generateAllSQL(nodes, edges), [nodes, edges]);

  // ---------- Render ----------

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-100 font-sans text-slate-900">
      {/* Toolbar */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-white/90 px-3 py-2 shadow-md ring-1 ring-slate-200 backdrop-blur">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5v14a9 3 0 0 0 18 0V5" />
              <path d="M3 12a9 3 0 0 0 18 0" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">SQL Canvas</div>
            <div className="text-[11px] text-slate-500">ПКМ — добавить блок</div>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-1 rounded-xl bg-white/90 p-1 shadow-md ring-1 ring-slate-200 backdrop-blur">
          <button
            onClick={() => applyZoom(viewport.zoom / 1.2)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            title="Уменьшить"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M5 12h14" />
            </svg>
          </button>
          <div className="min-w-[3.5rem] text-center text-xs font-medium text-slate-600 tabular-nums">
            {Math.round(viewport.zoom * 100)}%
          </div>
          <button
            onClick={() => applyZoom(viewport.zoom * 1.2)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100"
            title="Увеличить"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
          <div className="mx-1 h-6 w-px bg-slate-200" />
          <button
            onClick={() => setViewport({ x: 40, y: 40, zoom: 1 })}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
            title="Сбросить вид"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Сброс
          </button>
          <button
            onClick={clearAll}
            className="flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
            title="Очистить полотно"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            Очистить
          </button>
        </div>
      </div>

      {/* Подсказка */}
      <div className="pointer-events-none absolute bottom-4 left-4 z-20 rounded-lg bg-white/80 px-3 py-2 text-[11px] leading-relaxed text-slate-600 shadow-sm ring-1 ring-slate-200 backdrop-blur">
        <div><span className="font-medium text-slate-800">Тяни полотно</span> — панорамирование</div>
        <div><span className="font-medium text-slate-800">Колесо</span> — зум · <span className="font-medium text-slate-800">● → ●</span> — связь</div>
        <div><span className="font-medium text-slate-800">Клик по линии</span> — удалить · <span className="font-medium text-slate-800">Del</span> — удалить блок</div>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        className="absolute inset-0 cursor-grab active:cursor-grabbing select-none"
        onWheel={onWheel}
        onMouseDown={onCanvasMouseDown}
        onMouseMove={onCanvasMouseMove}
        onMouseUp={onCanvasMouseUp}
        onContextMenu={onContextMenu}
      >
        {/* Сетка */}
        <div
          data-bg="1"
          className="absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle at 1px 1px, rgba(100,116,139,0.25) 1px, transparent 0)',
            backgroundSize: `${24 * viewport.zoom}px ${24 * viewport.zoom}px`,
            backgroundPosition: `${viewport.x}px ${viewport.y}px`,
          }}
        />

        {/* Мир */}
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
          }}
        >
          {/* SVG для рёбер */}
          <svg
            className="pointer-events-none absolute"
            style={{ overflow: 'visible', left: 0, top: 0, width: 1, height: 1 }}
          >
            <defs>
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#6366f1" />
              </marker>
            </defs>
            {edges.map((e) => {
              const from = nodes.find((n) => n.id === e.fromId);
              const to = nodes.find((n) => n.id === e.toId);
              if (!from || !to) return null;
              const f = outPortPos(from);
              const t = e.toPort === 'join' ? joinPortPos(to) : inPortPos(to);
              if (!t) return null;
              const d = edgePath(f, t);
              return (
                <g key={e.id} className="pointer-events-auto cursor-pointer" onClick={() => deleteEdge(e.id)}>
                  {/* невидимая широкая область для удобного клика */}
                  <path d={d} stroke="transparent" strokeWidth={14} fill="none" />
                  <path
                    d={d}
                    stroke="#6366f1"
                    strokeWidth={2}
                    fill="none"
                    markerEnd="url(#arrow)"
                    className="transition-colors hover:stroke-rose-500"
                  />
                </g>
              );
            })}
            {/* Протягиваемая линия */}
            {linking && (() => {
              const from = nodes.find((n) => n.id === linking.fromId);
              if (!from) return null;
              const f = outPortPos(from);
              const t = { x: linking.mouseX, y: linking.mouseY };
              return (
                <path
                  d={edgePath(f, t)}
                  stroke="#a5b4fc"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  fill="none"
                />
              );
            })()}
          </svg>

          {/* Узлы */}
          {nodes.map((n) => (
            <NodeCard
              key={n.id}
              node={n}
              selected={selectedNodeId === n.id}
              onDragStart={(e) => {
                const { x, y } = screenToCanvas(e.clientX, e.clientY);
                setDragNode({ id: n.id, offX: x - n.x, offY: y - n.y });
                setSelectedNodeId(n.id);
              }}
              onSelect={() => setSelectedNodeId(n.id)}
              onChange={(patch) => updateNode(n.id, patch)}
              onDelete={() => deleteNode(n.id)}
              onOutPortDown={(e) => startLinking(e, n.id)}
              onInPortUp={(e) => endLinking(e, n.id, 'in')}
              onJoinPortUp={(e) => endLinking(e, n.id, 'join')}
              hasIn={hasInPort(n)}
              hasOut={hasOutPort(n)}
            />
          ))}
        </div>
      </div>

      {/* Context menu */}
      {menu && (
        <div
          className="fixed z-30 min-w-[200px] overflow-hidden rounded-xl bg-white/95 shadow-2xl ring-1 ring-slate-200 backdrop-blur"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="border-b border-slate-100 px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            Добавить блок
          </div>
          <div className="py-1">
            {ALL_NODE_TYPES.map((t) => {
              const c = NODE_COLORS[t];
              return (
                <button
                  key={t}
                  onClick={() => addNode(t)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50"
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${c.accent}`} />
                  <span className="font-medium text-slate-800">{t}</span>
                  <span className="ml-auto text-[11px] text-slate-400">{describeType(t)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SQL Preview */}
      <div
        className={`absolute bottom-0 left-0 right-0 z-20 transition-transform ${
          sqlOpen ? 'translate-y-0' : 'translate-y-[calc(100%-2.5rem)]'
        }`}
      >
        <div className="mx-auto max-w-6xl px-4">
          <div className="overflow-hidden rounded-t-2xl bg-slate-900 shadow-2xl ring-1 ring-slate-800">
            <button
              onClick={() => setSqlOpen((v) => !v)}
              className="flex w-full items-center justify-between px-5 py-2.5 text-left text-slate-200 hover:bg-slate-800/60"
            >
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 text-indigo-400">
                  <path d="M4 7h16M4 12h10M4 17h16" />
                </svg>
                <span className="text-sm font-semibold">SQL Preview</span>
                <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-400">
                  {sqlResults.length} {sqlResults.length === 1 ? 'запрос' : 'запросов'}
                </span>
              </div>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`h-4 w-4 transition-transform ${sqlOpen ? 'rotate-180' : ''}`}
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </button>
            <div className="max-h-[40vh] overflow-auto">
              {sqlResults.length === 0 ? (
                <div className="px-5 py-6 text-sm text-slate-400">
                  Добавьте блоки и соедините их — SQL появится здесь автоматически.
                </div>
              ) : (
                <div className="divide-y divide-slate-800">
                  {sqlResults.map((r) => (
                    <div key={r.id} className="px-5 py-3">
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-medium text-indigo-300">{r.label}</span>
                        <button
                          onClick={() => navigator.clipboard?.writeText(r.sql)}
                          className="rounded px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                        >
                          Копировать
                        </button>
                      </div>
                      <pre className="overflow-x-auto whitespace-pre font-mono text-[13px] leading-relaxed text-slate-100">
                        <SqlHighlight sql={r.sql} />
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- NodeCard ----------

interface NodeCardProps {
  node: SqlNode;
  selected: boolean;
  hasIn: boolean;
  hasOut: boolean;
  onDragStart: (e: React.MouseEvent) => void;
  onSelect: () => void;
  onChange: (patch: Partial<SqlNode>) => void;
  onDelete: () => void;
  onOutPortDown: (e: React.MouseEvent) => void;
  onInPortUp: (e: React.MouseEvent) => void;
  onJoinPortUp: (e: React.MouseEvent) => void;
}

function NodeCard(props: NodeCardProps) {
  const { node, selected, hasIn, hasOut, onDragStart, onSelect, onChange, onDelete } = props;
  const c = NODE_COLORS[node.type];
  const h = nodeHeight(node.type);

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className={`absolute rounded-xl border-2 shadow-lg transition-shadow ${c.bg} ${c.border} ${
        selected ? 'shadow-xl ring-2 ring-indigo-400/60' : ''
      }`}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH, height: h }}
      onMouseDown={(e) => {
        stop(e);
        onSelect();
      }}
      onClick={stop}
    >
      {/* Заголовок (drag handle) */}
      <div
        className={`flex h-8 cursor-move items-center justify-between rounded-t-lg px-3 text-xs font-bold uppercase tracking-wider text-white ${c.accent}`}
        onMouseDown={(e) => {
          stop(e);
          onSelect();
          onDragStart(e);
        }}
      >
        <span>{c.label}</span>
        <button
          onClick={(e) => {
            stop(e);
            onDelete();
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-white/80 hover:bg-white/20 hover:text-white"
          title="Удалить"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Контент по типу */}
      <div className="px-3 py-2" onMouseDown={stop}>
        {node.type === 'TABLE' && (
          <Field label="Имя таблицы">
            <input
              value={node.tableName}
              onChange={(e) => onChange({ tableName: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="users"
            />
          </Field>
        )}
        {node.type === 'SELECT' && (
          <Field label="Колонки">
            <input
              value={node.columns}
              onChange={(e) => onChange({ columns: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="id, name, *"
            />
          </Field>
        )}
        {node.type === 'WHERE' && (
          <Field label="Условие">
            <input
              value={node.condition}
              onChange={(e) => onChange({ condition: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="age > 18 AND active = true"
            />
          </Field>
        )}
        {node.type === 'JOIN' && (
          <>
            <Field label="Тип соединения">
              <select
                value={node.joinType}
                onChange={(e) => onChange({ joinType: e.target.value as JoinType } as Partial<SqlNode>)}
                className={inputCls}
              >
                <option value="INNER">INNER</option>
                <option value="LEFT">LEFT</option>
                <option value="RIGHT">RIGHT</option>
                <option value="FULL">FULL</option>
              </select>
            </Field>
            <div className="mt-2">
              <Field label="ON (условие)">
                <input
                  value={node.condition}
                  onChange={(e) => onChange({ condition: e.target.value } as Partial<SqlNode>)}
                  className={inputCls}
                  placeholder="a.id = b.user_id"
                />
              </Field>
            </div>
          </>
        )}
        {node.type === 'GROUP BY' && (
          <Field label="Группировать по">
            <input
              value={node.columns}
              onChange={(e) => onChange({ columns: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="category, status"
            />
          </Field>
        )}
        {node.type === 'HAVING' && (
          <Field label="Условие HAVING">
            <input
              value={node.condition}
              onChange={(e) => onChange({ condition: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="COUNT(*) > 5"
            />
          </Field>
        )}
        {node.type === 'ORDER BY' && (
          <div className="flex gap-2">
            <div className="flex-1">
              <Field label="Колонка">
                <input
                  value={node.column}
                  onChange={(e) => onChange({ column: e.target.value } as Partial<SqlNode>)}
                  className={inputCls}
                  placeholder="created_at"
                />
              </Field>
            </div>
            <div className="w-20">
              <Field label="Порядок">
                <select
                  value={node.direction}
                  onChange={(e) => onChange({ direction: e.target.value as 'ASC' | 'DESC' } as Partial<SqlNode>)}
                  className={inputCls}
                >
                  <option value="ASC">ASC</option>
                  <option value="DESC">DESC</option>
                </select>
              </Field>
            </div>
          </div>
        )}
        {node.type === 'LIMIT' && (
          <Field label="Лимит строк">
            <input
              value={node.count}
              onChange={(e) => onChange({ count: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="10"
            />
          </Field>
        )}
        {node.type === 'SUBQUERY' && (
          <Field label="Псевдоним (AS)">
            <input
              value={node.alias}
              onChange={(e) => onChange({ alias: e.target.value } as Partial<SqlNode>)}
              className={inputCls}
              placeholder="sq"
            />
          </Field>
        )}
      </div>

      {/* Порты */}
      {hasIn && (
        <Port
          style={{ left: -7, top: node.type === 'JOIN' ? 44 - 7 : h / 2 - 7 }}
          onMouseUp={props.onInPortUp}
          title="Вход"
          color={c.accent}
        />
      )}
      {node.type === 'JOIN' && (
        <Port
          style={{ left: -7, top: 124 - 7 }}
          onMouseUp={props.onJoinPortUp}
          title="Присоединяемая таблица"
          color="bg-rose-500"
          label="JOIN"
        />
      )}
      {hasOut && (
        <Port
          style={{ right: -7, top: h / 2 - 7 }}
          onMouseDown={props.onOutPortDown}
          title="Выход — тяни к входу следующего блока"
          color={c.accent}
          output
        />
      )}
    </div>
  );
}

const inputCls =
  'w-full rounded-md border border-slate-300 bg-white px-2 py-1 text-[12px] text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </label>
  );
}

interface PortProps {
  style: React.CSSProperties;
  onMouseDown?: (e: React.MouseEvent) => void;
  onMouseUp?: (e: React.MouseEvent) => void;
  title?: string;
  color: string;
  output?: boolean;
  label?: string;
}

function Port({ style, onMouseDown, onMouseUp, title, color, output, label }: PortProps) {
  return (
    <div
      title={title}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      className={`absolute flex h-3.5 w-3.5 items-center justify-center rounded-full ring-2 ring-white ${color} ${
        output ? 'cursor-crosshair hover:scale-125' : 'hover:scale-125'
      } transition-transform`}
      style={style}
    >
      {label && (
        <div className="absolute left-4 top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-slate-900/90 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-white opacity-0 group-hover:opacity-100">
          {label}
        </div>
      )}
    </div>
  );
}

// ---------- Подсветка SQL ----------

const SQL_KEYWORDS = [
  'SELECT','FROM','WHERE','INNER','LEFT','RIGHT','FULL','JOIN','ON','GROUP BY','HAVING','ORDER BY','ASC','DESC','LIMIT','AS','AND','OR',
];

function SqlHighlight({ sql }: { sql: string }) {
  // Простая подсветка: ключевые слова в начале строк
  const parts: React.ReactNode[] = [];
  sql.split('\n').forEach((line, li) => {
    const firstMatch = SQL_KEYWORDS
      .filter((k) => line.trimStart().toUpperCase().startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (firstMatch) {
      const idx = line.toUpperCase().indexOf(firstMatch);
      parts.push(
        <span key={li}>
          {line.slice(0, idx)}
          <span className="font-semibold text-indigo-300">{line.slice(idx, idx + firstMatch.length)}</span>
          <span className="text-slate-100">{line.slice(idx + firstMatch.length)}</span>
          {li < sql.split('\n').length - 1 ? '\n' : ''}
        </span>
      );
    } else {
      parts.push(
        <span key={li}>
          {line}
          {li < sql.split('\n').length - 1 ? '\n' : ''}
        </span>
      );
    }
  });
  return <>{parts}</>;
}

function describeType(t: NodeType): string {
  switch (t) {
    case 'TABLE': return 'FROM';
    case 'SELECT': return 'колонки';
    case 'WHERE': return 'фильтр';
    case 'JOIN': return 'объединение';
    case 'GROUP BY': return 'группа';
    case 'HAVING': return 'фильтр группы';
    case 'ORDER BY': return 'сортировка';
    case 'LIMIT': return 'лимит';
    case 'SUBQUERY': return 'подзапрос';
  }
}
