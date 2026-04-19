---
name: boardgamegeek-api
description: Use this skill whenever work on `gameclubtelegrambot` involves BoardGameGeek, BGG XML API2, board-game metadata import, candidate matching, collection-driven features, or enriching Telegram bot catalog data from BGG. Prefer this skill whenever the user wants to add or modify bot features that search BGG, read game details, compare BGG candidates, or use BoardGameGeek collections.
triggers:
  - boardgamegeek
  - boardgamegeek api
  - bgg
  - bgg xml api2
  - board game metadata
  - catalog import
  - board game import
  - game detail enrichment
  - bgg collection
  - telegram bot catalog
role: expert
scope: implementation
output-format: guidance
---

# BoardGameGeek API

Expert guidance for extending `gameclubtelegrambot` with BoardGameGeek-backed features.

This skill is not generic API documentation. It exists to help you make correct implementation decisions inside this repo when working with BGG data.

## When to Use This Skill

- Adding or changing board-game import flows
- Enriching catalog items with BoardGameGeek metadata
- Resolving multiple BGG candidates for a user-provided title
- Building Telegram features around BGG game details
- Building Telegram features around a user's public BGG collection
- Adding discovery or trending features based on popular games
- Reviewing code that calls or parses BGG XML API2

## Project Assumptions

- Treat BoardGameGeek as the primary metadata source for board games in this repo.
- Assume the bot already handles the BGG API key correctly through runtime config.
- Do not redesign authentication unless the task is explicitly about runtime config.
- Prefer existing repo behavior over generic API advice when they differ.
- Do not introduce Wikipedia fallback logic unless the task explicitly asks for that path.

Current repo behavior to preserve:

- `bgg.apiKey` is sent as `Authorization: Bearer <key>`
- `search` is used to gather candidates for a title
- `thing` is used to load canonical detail for a selected BGG item
- exact primary-name matches beat alternate-name matches
- multiple reasonable matches require explicit user selection instead of auto-picking one

## Endpoint Selection by Task

Use the endpoint that matches the feature's purpose.

### 1. Catalog import or metadata update

Start with `search`, then confirm with `thing`.

Use this flow when the user provides a title and the bot needs a catalog draft or metadata refresh.

Recommended sequence:

1. Query `search?type=boardgame`
2. Parse candidates and compare title matches
3. If one candidate is clearly correct, request `thing?id=<id>&stats=1`
4. Build the bot-facing data from `thing`, not from `search`

Do not use `search` output alone as canonical metadata.

### 2. Detailed game inspection

Use `thing` directly when the BGG item id is already known.

This is the source of truth for structured detail such as:

- primary display name
- description
- publication year
- min/max players
- play time
- minimum age
- image and thumbnail
- rank and stats
- designers, artists, publishers, categories, mechanics, families

If the feature needs a durable external reference, carry the BGG item id and BGG URL forward.

### 3. User collection features

Use `collection` when the feature depends on a user's public BGG library.

Typical examples:

- import or browse a member's owned games
- suggest games from a member's collection
- compare club catalog against a user's public collection

Keep responsibilities separate:

- `collection` answers whether an item appears in a user's BGG library and which BGG ids are involved
- `thing` provides the canonical metadata for display, storage, and enrichment

Do not treat `collection` as a replacement for `thing`.

### 4. Discovery and trending features

Use `hot` for exploratory or trending lists.

Typical examples:

- show popular games right now
- seed a discovery UI
- generate a short suggestion list

`hot` is only a starting point. If a game will be shown with meaningful detail or persisted into catalog workflows, follow up with `thing`.

## Candidate Resolution Rules

When implementing title-based import, preserve the repo's matching policy.

Recommended decision order:

1. Exact normalized match against the candidate's primary name
2. Exact normalized match against any known name
3. Single strong prefix match
4. Single strong token/inclusion match
5. If more than one reasonable candidate remains, ask the user to choose

Do not silently pick from multiple plausible candidates.

Good candidate labels usually include:

- primary name
- publication year when available
- BGG id

That gives users enough context to choose without reading raw XML.

## Interpreting XML2 Responses

Focus on fields this bot can use directly.

### Fields worth extracting from `search`

- item `id`
- candidate names
- primary name
- `yearpublished`

`search` is for candidate discovery, not full metadata.

### Fields worth extracting from `thing`

- item type to distinguish `boardgame` from `boardgameexpansion`
- primary `name`
- `description`
- `yearpublished`
- `minplayers`
- `maxplayers`
- `playingtime`
- `minplaytime`
- `maxplaytime`
- `minage`
- `image`
- `thumbnail`
- `link` entries for publisher, designer, artist, category, mechanic, family
- ranking and stats when relevant to the feature

Treat missing fields as genuinely absent data. Leave them empty or null in downstream structures instead of inventing substitutes.

## Failure Handling

BoardGameGeek responses are not always immediately ready or complete.

Design for these cases:

- `202 Accepted` can mean the payload is still being prepared; retry with backoff
- non-OK responses should fail the lookup clearly instead of pretending nothing happened
- `collection` may be delayed or unavailable even for a valid user
- `thing` may return partial metadata; use only what is actually present
- no candidate or no usable `thing` result should stop import rather than creating a misleading draft

If the implementation already contains a working retry or parsing pattern, reuse it instead of creating a second one.

## Repo Pointers

Read these files before changing BGG behavior:

- `src/catalog/wikipedia-boardgame-import-service.ts` - current BGG search, candidate resolution, XML parsing, and catalog draft shaping
- `src/telegram/catalog-admin-support.ts` - Telegram catalog admin flow integration points
- `src/telegram/runtime-boundary-middleware.ts` - runtime wiring for the import service
- `docs/runtime-configuration.md` - runtime config rules for `bgg.apiKey`

When possible, extend the existing BGG path instead of creating a parallel service with slightly different behavior.

## Implementation Checklist

Before finishing BGG-related changes, verify:

1. The feature uses the right endpoint for its job
2. Metadata comes from `thing` when canonical detail matters
3. Multi-match cases ask the user to choose
4. Missing XML fields stay missing instead of being guessed
5. Existing repo matching rules were preserved
6. New code reuses current parsing and request patterns where practical

## Prompt Examples

These are the kinds of requests where this skill should help.

**Example 1:**
User: `Añade al bot una mejora para importar juegos desde BoardGameGeek usando el nombre del juego y dejar que el admin elija entre coincidencias ambiguas.`

**Example 2:**
User: `Quiero que la ficha de juego en Telegram muestre mecánicas, diseñadores e imagen desde BGG.`

**Example 3:**
User: `Agrega una feature para ver juegos de la colección pública de BGG de un usuario y cruzarlos con el catálogo del club.`

**Example 4:**
User: `Revisa este flujo de importación de juegos porque BGG está trayendo candidatos equivocados.`
