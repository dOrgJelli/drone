export type KanbanCard = {
  id: string;
  title: string;
  description: string;
};

export type KanbanLane = {
  id: string;
  title: string;
  cards: KanbanCard[];
};

export type KanbanBoardState = {
  lanes: KanbanLane[];
};

const DEFAULT_KANBAN_LANE_TITLES = ['To do', 'In progress', 'Review', 'Done'] as const;
const PASTED_TEXT_INLINE_TITLE_MAX_CHARS = 24;

function defaultKanbanLaneTitle(index: number): string {
  return DEFAULT_KANBAN_LANE_TITLES[index] ?? `Lane ${index + 1}`;
}

function createKanbanId(prefix: 'lane' | 'card'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createKanbanCard(seed?: Partial<Pick<KanbanCard, 'title' | 'description'>>): KanbanCard {
  return {
    id: createKanbanId('card'),
    title: String(seed?.title ?? '').trim(),
    description: String(seed?.description ?? '').trim(),
  };
}

export function createKanbanLane(seed?: Partial<Pick<KanbanLane, 'title' | 'cards'>>): KanbanLane {
  const cards = Array.isArray(seed?.cards) ? seed.cards : [];
  return {
    id: createKanbanId('lane'),
    title: String(seed?.title ?? '').trim() || defaultKanbanLaneTitle(0),
    cards: cards.map((card) => createKanbanCard(card)),
  };
}

export function createDefaultKanbanBoardState(): KanbanBoardState {
  return {
    lanes: DEFAULT_KANBAN_LANE_TITLES.map((title) => createKanbanLane({ title })),
  };
}

export function sanitizeKanbanBoardState(value: unknown): KanbanBoardState {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const lanesRaw = Array.isArray(raw.lanes) ? raw.lanes : [];
  const lanes: KanbanLane[] = [];
  for (let i = 0; i < lanesRaw.length; i += 1) {
    const laneRaw = lanesRaw[i];
    if (!laneRaw || typeof laneRaw !== 'object' || Array.isArray(laneRaw)) continue;
    const laneRecord = laneRaw as Record<string, unknown>;
    const title = String(laneRecord.title ?? '').trim() || defaultKanbanLaneTitle(i);
    const cardsRaw = Array.isArray(laneRecord.cards) ? laneRecord.cards : [];
    const cards: KanbanCard[] = [];
    for (const cardRaw of cardsRaw) {
      if (!cardRaw || typeof cardRaw !== 'object' || Array.isArray(cardRaw)) continue;
      const cardRecord = cardRaw as Record<string, unknown>;
      cards.push({
        id: String(cardRecord.id ?? '').trim() || createKanbanId('card'),
        title: String(cardRecord.title ?? '').trim(),
        description: String(cardRecord.description ?? '').trim(),
      });
    }
    lanes.push({
      id: String(laneRecord.id ?? '').trim() || createKanbanId('lane'),
      title,
      cards,
    });
  }
  return lanes.length > 0 ? { lanes } : createDefaultKanbanBoardState();
}

function fallbackTitleFromText(textRaw: string): string {
  const [firstLine = ''] = String(textRaw ?? '').split('\n');
  const title = firstLine.trim() || String(textRaw ?? '').trim();
  if (!title) return 'Untitled task';
  return title.length > 72 ? `${title.slice(0, 69).trimEnd()}...` : title;
}

function normalizePastedText(textRaw: string): string {
  const normalized = String(textRaw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return '';
  const lines = normalized.split('\n');
  const trailingLines = lines.slice(1);
  const nonEmptyLinesForIndent = (trailingLines.some((line) => line.trim().length > 0) ? trailingLines : lines).filter(
    (line) => line.trim().length > 0,
  );
  const sharedIndent = nonEmptyLinesForIndent.reduce<number>((min, line) => {
    const match = line.match(/^\s*/);
    const indent = match ? match[0].length : 0;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);
  const [firstLine = '', ...restLines] = lines;
  return [firstLine, ...restLines]
    .map((line, index) => {
      if (index === 0 || !Number.isFinite(sharedIndent) || sharedIndent <= 0) return line;
      return line.slice(Math.min(sharedIndent, line.length));
    })
    .join('\n')
    .trim();
}

export function parsePastedKanbanCard(
  textRaw: string,
): (Pick<KanbanCard, 'title' | 'description'> & { needsGeneratedTitle: boolean }) | null {
  const normalized = normalizePastedText(textRaw);
  if (!normalized) return null;
  if (normalized.length <= PASTED_TEXT_INLINE_TITLE_MAX_CHARS) {
    return {
      title: normalized,
      description: '',
      needsGeneratedTitle: false,
    };
  }
  return {
    title: fallbackTitleFromText(normalized),
    description: normalized,
    needsGeneratedTitle: true,
  };
}
