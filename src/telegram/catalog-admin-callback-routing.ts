import { parseItemId } from './catalog-admin-parsing.js';

export type CatalogAdminCallbackPrefixes = {
  browseMenu: string;
  browseSearch: string;
  browseFamily: string;
  browseLetters: string;
  inspect: string;
  inspectGroup: string;
  edit: string;
  createActivity: string;
  autocorrect: string;
  autocorrectBggCandidate: string;
  translateDescription: string;
  deactivate: string;
  addMedia: string;
  editMedia: string;
  deleteMedia: string;
};

export type CatalogAdminCallbackRoute =
  | { kind: 'browse-menu' }
  | { kind: 'browse-search' }
  | { kind: 'browse-family'; familyId: number }
  | { kind: 'browse-letters'; initials: string }
  | { kind: 'inspect-item'; itemId: number }
  | { kind: 'inspect-group'; groupId: number }
  | { kind: 'edit-item'; itemId: number }
  | { kind: 'create-activity'; itemId: number }
  | { kind: 'autocorrect-item'; itemId: number }
  | { kind: 'autocorrect-bgg-candidate'; itemId: number; boardGameGeekId: string }
  | { kind: 'translate-description'; itemId: number }
  | { kind: 'deactivate-item'; itemId: number }
  | { kind: 'add-media'; itemId: number }
  | { kind: 'edit-media'; mediaId: number }
  | { kind: 'delete-media'; mediaId: number };

export function parseCatalogAdminCallbackRoute(
  callbackData: string,
  prefixes: CatalogAdminCallbackPrefixes,
): CatalogAdminCallbackRoute | null {
  if (callbackData === prefixes.browseMenu) {
    return { kind: 'browse-menu' };
  }
  if (callbackData === prefixes.browseSearch) {
    return { kind: 'browse-search' };
  }
  if (callbackData.startsWith(prefixes.browseFamily)) {
    return { kind: 'browse-family', familyId: parseItemId(callbackData, prefixes.browseFamily) };
  }
  if (callbackData.startsWith(prefixes.browseLetters)) {
    return { kind: 'browse-letters', initials: decodeURIComponent(callbackData.slice(prefixes.browseLetters.length)).trim() };
  }
  if (callbackData.startsWith(prefixes.inspect)) {
    return { kind: 'inspect-item', itemId: parseItemId(callbackData, prefixes.inspect) };
  }
  if (callbackData.startsWith(prefixes.inspectGroup)) {
    return { kind: 'inspect-group', groupId: parseItemId(callbackData, prefixes.inspectGroup) };
  }
  if (callbackData.startsWith(prefixes.edit)) {
    return { kind: 'edit-item', itemId: parseItemId(callbackData, prefixes.edit) };
  }
  if (callbackData.startsWith(prefixes.createActivity)) {
    return { kind: 'create-activity', itemId: parseItemId(callbackData, prefixes.createActivity) };
  }
  if (callbackData.startsWith(prefixes.autocorrectBggCandidate)) {
    const selection = parseAutocorrectBggCandidate(callbackData, prefixes.autocorrectBggCandidate);
    return selection ? { kind: 'autocorrect-bgg-candidate', ...selection } : null;
  }
  if (callbackData.startsWith(prefixes.autocorrect)) {
    return { kind: 'autocorrect-item', itemId: parseItemId(callbackData, prefixes.autocorrect) };
  }
  if (callbackData.startsWith(prefixes.translateDescription)) {
    return { kind: 'translate-description', itemId: parseItemId(callbackData, prefixes.translateDescription) };
  }
  if (callbackData.startsWith(prefixes.deactivate)) {
    return { kind: 'deactivate-item', itemId: parseItemId(callbackData, prefixes.deactivate) };
  }
  if (callbackData.startsWith(prefixes.addMedia)) {
    return { kind: 'add-media', itemId: parseItemId(callbackData, prefixes.addMedia) };
  }
  if (callbackData.startsWith(prefixes.editMedia)) {
    return { kind: 'edit-media', mediaId: parseItemId(callbackData, prefixes.editMedia) };
  }
  if (callbackData.startsWith(prefixes.deleteMedia)) {
    return { kind: 'delete-media', mediaId: parseItemId(callbackData, prefixes.deleteMedia) };
  }
  return null;
}

function parseAutocorrectBggCandidate(
  callbackData: string,
  prefix: string,
): { itemId: number; boardGameGeekId: string } | null {
  const [itemIdValue, boardGameGeekId] = callbackData.slice(prefix.length).split(':');
  const itemId = Number(itemIdValue);
  if (!Number.isInteger(itemId) || itemId <= 0 || !boardGameGeekId || !/^\d+$/.test(boardGameGeekId)) {
    return null;
  }
  return { itemId, boardGameGeekId };
}
