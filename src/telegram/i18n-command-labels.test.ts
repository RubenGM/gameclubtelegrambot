import test from 'node:test';
import assert from 'node:assert/strict';

import { createTelegramI18n, supportedBotLanguages } from './i18n.js';

test('context-specific reply-keyboard commands never collide in any supported language', () => {
  for (const language of supportedBotLanguages) {
    const texts = createTelegramI18n(language);
    const commands = {
      catalogSearch: texts.catalogAdmin.searchByName,
      storageSearch: texts.storage.searchFiles,
      storageSearchByWordOrTag: texts.storage.searchByTextOrTag,
      catalogCreateActivity: texts.catalogAdmin.createActivity,
      roleGameCreate: texts.roleGames.createGame,
      scheduleEdit: texts.schedule.listEditAction,
      scheduleCancel: texts.schedule.listCancelAction,
      tableEdit: texts.tableAdmin.edit,
      venueEventEdit: texts.venueEventAdmin.editButton,
      catalogLoanEdit: texts.catalogLoan.editLoan,
      lfgEdit: texts.lfg.editButton,
      noticeEdit: texts.notices.editButton,
      storageEdit: texts.storage.editButton,
      storageDelete: texts.storage.deleteButton,
      printingCancel: texts.printing.cancelButton,
      printingBack: texts.printing.adminBackButton,
      modelAdminBack: texts.llmModelAdmin.backButton,
      roleGameCancel: texts.roleGames.cancel,
      welcomeDelete: texts.common.welcomeTemplatesDeleteButton,
      tableSaveChanges: texts.tableAdmin.confirmEdit,
      venueEventSaveChanges: texts.venueEventAdmin.confirmEdit,
      venueEventCancel: texts.venueEventAdmin.cancelButton,
      scheduleSaveChanges: texts.schedule.confirmEdit,
    };
    const labels = Object.values(commands);

    assert.equal(new Set(labels).size, labels.length, language);
    assert.ok(!labels.some((label) => label.startsWith('/')), language);
  }
});
