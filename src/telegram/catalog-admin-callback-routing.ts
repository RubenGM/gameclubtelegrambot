import { parseItemId } from './catalog-admin-parsing.js';

export type CatalogAdminCallbackPrefixes = {
  browseMenu: string;
  browseSearch: string;
  browseFamily: string;
  inspect: string;
  inspectGroup: string;
  edit: string;
  deactivate: string;
  editMedia: string;
  deleteMedia: string;
};

export type CatalogAdminCallbackRoute =
  | { kind: 'browse-menu' }
  | { kind: 'browse-search' }
  | { kind: 'browse-family'; familyId: number }
  | { kind: 'inspect-item'; itemId: number }
  | { kind: 'inspect-group'; groupId: number }
  | { kind: 'edit-item'; itemId: number }
  | { kind: 'deactivate-item'; itemId: number }
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
  if (callbackData.startsWith(prefixes.inspect)) {
    return { kind: 'inspect-item', itemId: parseItemId(callbackData, prefixes.inspect) };
  }
  if (callbackData.startsWith(prefixes.inspectGroup)) {
    return { kind: 'inspect-group', groupId: parseItemId(callbackData, prefixes.inspectGroup) };
  }
  if (callbackData.startsWith(prefixes.edit)) {
    return { kind: 'edit-item', itemId: parseItemId(callbackData, prefixes.edit) };
  }
  if (callbackData.startsWith(prefixes.deactivate)) {
    return { kind: 'deactivate-item', itemId: parseItemId(callbackData, prefixes.deactivate) };
  }
  if (callbackData.startsWith(prefixes.editMedia)) {
    return { kind: 'edit-media', mediaId: parseItemId(callbackData, prefixes.editMedia) };
  }
  if (callbackData.startsWith(prefixes.deleteMedia)) {
    return { kind: 'delete-media', mediaId: parseItemId(callbackData, prefixes.deleteMedia) };
  }
  return null;
}
