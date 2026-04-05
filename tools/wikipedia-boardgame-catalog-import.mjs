#!/usr/bin/env node

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  emitError('bad-input', 'Uso: wikipedia-boardgame-catalog-import <nombre del juego>');
}

main().catch((error) => {
  emitError('unexpected', error instanceof Error ? error.message : String(error));
});

async function main() {
  const candidateTitles = await searchWikipediaTitles(title);
  if (candidateTitles.length === 0) {
    emitError('not-found', 'No s ha trobat el joc a Wikipedia.');
  }

  const selectedTitle = chooseBestTitle(title, candidateTitles);
  const page = await fetchPageData(selectedTitle);
  const wikitext = page?.revisions?.[0]?.slots?.main?.content ?? page?.revisions?.[0]?.content ?? null;
  if (!wikitext) {
    emitError('not-found', 'No s ha pogut llegir la pagina de Wikipedia.');
  }

  const draft = await buildDraftFromWikitext(
    selectedTitle,
    wikitext,
    page?.pageprops?.wikibase_item ?? null,
    await fetchImageUrl(wikitext),
  );
  if (!draft) {
    emitError('invalid-response', 'No he pogut extreure l infobox del joc.');
  }

  process.stdout.write(`${JSON.stringify(draft)}\n`);
}

async function searchWikipediaTitles(query) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    srnamespace: '0',
    format: 'json',
    formatversion: '2',
    srlimit: '20',
  });

  const response = await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
  const results = response?.query?.search ?? [];
  return results
    .map((entry) => entry?.title)
    .filter((entry) => typeof entry === 'string');
}

function chooseBestTitle(query, candidates) {
  const normalizedQuery = normalizeText(query);
  const boardGameCandidate = candidates.find((candidate) => /\b(board game|boardgame|game)\b/i.test(candidate));
  if (boardGameCandidate) {
    return boardGameCandidate;
  }

  const exact = candidates.find((candidate) => normalizeText(candidate) === normalizedQuery);
  if (exact) {
    return exact;
  }

  return candidates[0];
}

async function fetchPageData(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'revisions|pageprops|pageimages',
    rvprop: 'content',
    rvslots: 'main',
    titles: title,
    format: 'json',
    formatversion: '2',
    piprop: 'original|thumbnail',
    pithumbsize: '1200',
  });

  const response = await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
  return response?.query?.pages?.[0] ?? null;
}

async function fetchImageUrl(wikitext) {
  const infobox = extractInfobox(wikitext);
  if (!infobox) {
    return null;
  }

  const fields = parseInfoboxFields(infobox);
  const imageTitle = firstFileTitle(fields.image ?? fields.image_file ?? fields.imagefile);
  if (!imageTitle) {
    return null;
  }

  const params = new URLSearchParams({
    action: 'query',
    titles: imageTitle,
    prop: 'imageinfo',
    iiprop: 'url',
    format: 'json',
    formatversion: '2',
  });

  const response = await fetchJson(`https://en.wikipedia.org/w/api.php?${params.toString()}`);
  const page = response?.query?.pages?.[0];
  const info = page?.imageinfo?.[0];
  return info?.url ?? info?.thumburl ?? null;
}

async function buildDraftFromWikitext(pageTitle, wikitext, wikidataId, imageUrl) {
  const infobox = extractInfobox(wikitext);
  if (!infobox) {
    return null;
  }

  const fields = parseInfoboxFields(infobox);
  const title = fields.title ?? stripDisambiguation(pageTitle);
  const players = parsePlayerRange(fields.players);
  const playTime = parseDurationMinutes(fields.playing_time ?? fields.playingtime ?? fields.play_time ?? fields.playtime);
  const publicationYear = parseFirstInteger(fields.published ?? fields.publication_year ?? fields.release_year ?? fields.year ?? fields.date);

  return {
    familyId: null,
    groupId: null,
    itemType: inferItemType(pageTitle, fields),
    displayName: title,
    originalName: fields.original_name ?? title,
    description: null,
    language: null,
    publisher: firstText(fields.publisher),
    publicationYear,
    playerCountMin: players.min,
    playerCountMax: players.max,
    recommendedAge: parseFirstInteger(fields.recommended_age ?? fields.age),
    playTimeMinutes: playTime,
    externalRefs: {
      wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
      wikidataId,
    },
    metadata: {
      source: 'wikipedia',
      wikipediaUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`,
      wikidataId,
      imageUrl,
      rank: null,
      designers: splitList(fields.designer ?? fields.designers),
      illustrators: splitList(fields.illustrator ?? fields.illustrators),
      genres: splitList(fields.genre ?? fields.genres ?? fields.category),
      notes: collectNotes(fields),
      editionType: inferEditionType(pageTitle, fields),
    },
  };
}

function inferItemType(pageTitle, fields) {
  const text = normalizeText(`${pageTitle} ${Object.values(fields).filter(Boolean).join(' ')}`);
  if (/\b(expansion|expansion pack)\b/i.test(text)) {
    return 'expansion';
  }
  return 'board-game';
}

function inferEditionType(pageTitle, fields) {
  const text = normalizeText(`${pageTitle} ${Object.values(fields).filter(Boolean).join(' ')}`);
  if (/anniversary/i.test(text)) {
    return 'anniversary';
  }
  if (/collector|special edition/i.test(text)) {
    return 'special';
  }
  if (/reprint/i.test(text)) {
    return 'reprint';
  }
  return null;
}

function extractInfobox(wikitext) {
  const normalized = wikitext.replace(/\r\n/g, '\n');
  const start = normalized.indexOf('{{Infobox');
  if (start < 0) {
    return null;
  }

  let depth = 0;
  for (let index = start; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (pair === '{{') {
      depth += 1;
      index += 1;
      continue;
    }
    if (pair === '}}') {
      depth -= 1;
      index += 1;
      if (depth === 0) {
        return normalized.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseInfoboxFields(infobox) {
  const fields = {};
  const lines = infobox.split('\n');
  let currentKey = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      continue;
    }

    const separator = line.indexOf('=');
    if (separator > 1) {
      currentKey = normalizeKey(line.slice(1, separator));
      fields[currentKey] = cleanValue(line.slice(separator + 1));
      continue;
    }

    if (currentKey) {
      fields[currentKey] = [fields[currentKey], cleanValue(line.slice(1))].filter(Boolean).join(' ').trim();
    }
  }

  return fields;
}

function cleanValue(value) {
  return normalizeText(
    value
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{\{([^{}]|\{[^{}]*\})*\}\}/g, ' ')
      .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, '$2')
      .replace(/<!--.*?-->/g, ' '),
  );
}

function normalizeKey(key) {
  return key.trim().toLowerCase().replace(/\s+/g, '_');
}

function splitList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(/\s*(?:,|;| and | & )\s*/i)
    .map((entry) => normalizeText(entry))
    .filter(Boolean);
}

function firstFileTitle(value) {
  if (!value) {
    return null;
  }

  const match = String(value).match(/File:([^|]+)/i);
  return match?.[1] ? `File:${normalizeText(match[1])}` : null;
}

function collectNotes(fields) {
  const notes = [];
  const sourceFields = [fields.award, fields.awards, fields.note, fields.notes, fields.recognition];

  for (const value of sourceFields) {
    for (const entry of splitList(value)) {
      if (!notes.includes(entry)) {
        notes.push(entry);
      }
    }
  }

  return notes;
}

function firstText(value) {
  if (!value) {
    return null;
  }
  const [first] = splitList(value);
  return first ?? (normalizeText(value) || null);
}

function parsePlayerRange(value) {
  if (!value) {
    return { min: null, max: null };
  }

  const range = value.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]) };
  }

  const single = value.match(/\d+/);
  if (single) {
    const num = Number(single[0]);
    return { min: num, max: num };
  }

  return { min: null, max: null };
}

function parseDurationMinutes(value) {
  if (!value) {
    return null;
  }

  const range = value.match(/(\d+)\s*[–-]\s*(\d+)/);
  if (range) {
    return Number(range[1]);
  }

  return parseFirstInteger(value);
}

function parseFirstInteger(value) {
  if (!value) {
    return null;
  }

  const match = value.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function stripDisambiguation(value) {
  return normalizeText(value.replace(/\s*\([^)]*\)\s*$/, ''));
}

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'GameClubTelegramBot/1.0 (Wikipedia import)',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    emitError('connection', `Wikipedia API returned ${response.status}`);
  }

  return response.json();
}

function emitError(type, message) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { type, message } })}\n`);
  process.exit(0);
}
