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

const DEFAULT_FIRST_LANE_TITLE = 'Inbox';

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
    title: String(seed?.title ?? '').trim() || DEFAULT_FIRST_LANE_TITLE,
    cards: cards.map((card) => createKanbanCard(card)),
  };
}

export function createDefaultKanbanBoardState(): KanbanBoardState {
  return {
    lanes: [createKanbanLane({ title: DEFAULT_FIRST_LANE_TITLE })],
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
    const title = String(laneRecord.title ?? '').trim() || (i === 0 ? DEFAULT_FIRST_LANE_TITLE : `Lane ${i + 1}`);
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

export function parsePastedKanbanCard(textRaw: string): Pick<KanbanCard, 'title' | 'description'> | null {
  const normalized = String(textRaw ?? '').replace(/\r\n?/g, '\n').trim();
  if (!normalized) return null;
  const [firstLine = '', ...rest] = normalized.split('\n');
  const title = firstLine.trim();
  const nonEmptyRest = rest.filter((line) => line.trim().length > 0);
  const sharedIndent = nonEmptyRest.reduce<number>((min, line) => {
    const match = line.match(/^\s*/);
    const indent = match ? match[0].length : 0;
    return Math.min(min, indent);
  }, Number.POSITIVE_INFINITY);
  const description = rest
    .map((line) => {
      if (!Number.isFinite(sharedIndent) || sharedIndent <= 0) return line;
      return line.slice(Math.min(sharedIndent, line.length));
    })
    .join('\n')
    .trim();
  if (!title && !description) return null;
  return {
    title,
    description,
  };
}
