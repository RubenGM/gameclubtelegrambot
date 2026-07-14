export type PrintPageSelectionResult =
  | { ok: true; pages: number[]; label: string }
  | { ok: false; reason: 'empty' | 'invalid-format' | 'invalid-total-pages' | 'out-of-range' };

const allPagesLabels = new Set(['all', 'todo', 'todos', 'toda', 'todas', 'tot', 'tots', 'tota', 'totes']);

export function parsePrintPageSelection(input: string, totalPages: number): PrintPageSelectionResult {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    return { ok: false, reason: 'invalid-total-pages' };
  }

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    return { ok: false, reason: 'empty' };
  }

  if (allPagesLabels.has(trimmed)) {
    const pages = range(1, totalPages);
    return { ok: true, pages, label: compactPageSelectionLabel(pages) };
  }

  const chunks = trimmed.split(',');
  if (chunks.some((chunk) => chunk.trim() === '')) {
    return { ok: false, reason: 'invalid-format' };
  }

  const selected = new Set<number>();
  for (const chunk of chunks) {
    const parsed = parseChunk(chunk.trim());
    if (!parsed) {
      return { ok: false, reason: 'invalid-format' };
    }

    for (const page of parsed) {
      if (page < 1 || page > totalPages) {
        return { ok: false, reason: 'out-of-range' };
      }
      selected.add(page);
    }
  }

  const pages = [...selected].sort((left, right) => left - right);
  if (pages.length === 0) {
    return { ok: false, reason: 'empty' };
  }

  return { ok: true, pages, label: compactPageSelectionLabel(pages) };
}

export function compactPageSelectionLabel(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((left, right) => left - right);
  const ranges: string[] = [];
  let index = 0;

  while (index < sorted.length) {
    const start = sorted[index]!;
    let end = start;
    while (sorted[index + 1] === end + 1) {
      index += 1;
      end = sorted[index]!;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    index += 1;
  }

  return ranges.join(',');
}

function parseChunk(chunk: string): number[] | null {
  const single = /^(\d+)$/.exec(chunk);
  if (single) {
    return [Number(single[1])];
  }

  const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(chunk);
  if (!rangeMatch) {
    return null;
  }

  const start = Number(rangeMatch[1]);
  const end = Number(rangeMatch[2]);
  if (end < start) {
    return null;
  }

  return range(start, end);
}

function range(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

