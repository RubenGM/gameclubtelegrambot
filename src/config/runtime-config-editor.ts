import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { stdin as defaultStdin, stdout as defaultStdout } from 'node:process';

import blessed from 'blessed';
import { ZodError } from 'zod';

import { RuntimeConfigError } from './load-runtime-config.js';
import { runtimeConfigSchema, type RuntimeConfig } from './runtime-config.js';
import {
  fieldPathKey,
  getNestedValue,
  getSectionFields,
  jsonTextFromValue,
  mergeRuntimeConfigSources,
  parseEnvFile,
  parseJsonValue,
  removeNestedValue,
  resolveRuntimeConfigPaths,
  runtimeConfigFieldSpecs,
  runtimeConfigSections,
  serializeEnvFile,
  setNestedValue,
  splitRuntimeConfigForPersistence,
  type RuntimeConfigFieldSpec,
} from './runtime-config-files.js';

const exampleRuntimeConfigPath = 'config/runtime.example.json';

export interface RuntimeConfigEditorOptions {
  env?: Record<string, string | undefined>;
  init?: boolean;
  stdin?: NodeJS.ReadStream;
  stdout?: NodeJS.WriteStream;
}

export interface RuntimeConfigEditorDraft {
  configPath: string;
  envPath: string;
  config: Record<string, unknown>;
  configText: string;
  envText: string;
  originalJsonConfig: Record<string, unknown>;
}

type StatusTone = 'info' | 'success' | 'warning' | 'error';
type EditorPane = 'sections' | 'fields';

interface ValidationState {
  parsedConfig: RuntimeConfig | null;
  errorsByField: Map<string, string[]>;
  summary: string[];
}

export async function runRuntimeConfigEditor(options: RuntimeConfigEditorOptions = {}): Promise<void> {
  const stdin = options.stdin ?? defaultStdin;
  const stdout = options.stdout ?? defaultStdout;
  const env = options.env ?? process.env;

  const draft = await buildRuntimeConfigDraft({
    env,
    forceTemplate: options.init ?? false,
  });

  const session = new RuntimeConfigEditorSession(draft, stdin, stdout);
  await session.run();
}

export async function buildRuntimeConfigDraft(options: {
  env?: Record<string, string | undefined>;
  forceTemplate?: boolean;
} = {}): Promise<RuntimeConfigEditorDraft> {
  const env = options.env ?? process.env;
  const paths = resolveRuntimeConfigPaths(env);
  const templateConfig = await loadExampleRuntimeConfig();

  let currentConfigText = '';
  let currentEnvText = '';
  let parsedCurrentConfig: Record<string, unknown> = {};
  let parsedCurrentEnv: Record<string, string> = {};

  if (!options.forceTemplate) {
    const currentConfigRead = await readTextIfExists(paths.configPath);
    if (currentConfigRead !== undefined) {
      currentConfigText = currentConfigRead;
      try {
        parsedCurrentConfig = JSON.parse(currentConfigRead) as Record<string, unknown>;
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Unknown JSON parse error';
        throw new RuntimeConfigError(`Runtime configuration file ${paths.configPath} contains invalid JSON: ${reason}`);
      }
    }

    const envRead = await readTextIfExists(paths.envPath);
    if (envRead !== undefined) {
      currentEnvText = envRead;
      parsedCurrentEnv = parseEnvFile(envRead);
    }
  }

  const mergedBase = deepMergeObjects(templateConfig, parsedCurrentConfig);
  const mergedConfig = mergeRuntimeConfigSources(mergedBase, parsedCurrentEnv, {}) as Record<string, unknown>;

  for (const spec of runtimeConfigFieldSpecs) {
    if (spec.destination !== 'env' || !spec.envKey) {
      continue;
    }

    const envValue = parsedCurrentEnv[spec.envKey];
    const legacyValue = getNestedValue(parsedCurrentConfig, spec.path);
    if (envValue === undefined && (legacyValue === undefined || legacyValue === null || legacyValue === '')) {
      setNestedValue(mergedConfig, spec.path, '');
    }
  }

  return {
    configPath: paths.configPath,
    envPath: paths.envPath,
    config: mergedConfig,
    configText: currentConfigText,
    envText: currentEnvText,
    originalJsonConfig: parsedCurrentConfig,
  };
}

export async function persistRuntimeConfigDraft(draft: RuntimeConfigEditorDraft): Promise<RuntimeConfigEditorDraft> {
  const parsedConfig = runtimeConfigSchema.parse(normalizeDraftForValidation(draft.config));
  const { jsonConfig, envValues } = splitRuntimeConfigForPersistence(parsedConfig, draft.originalJsonConfig);
  const configText = `${JSON.stringify(jsonConfig, null, 2)}\n`;
  const envText = serializeEnvFile(draft.envText, envValues);

  await writeAtomicText(draft.configPath, configText);
  await writeAtomicText(draft.envPath, envText);

  return {
    ...draft,
    config: parsedConfig as unknown as Record<string, unknown>,
    configText,
    envText,
    originalJsonConfig: jsonConfig,
  };
}

class RuntimeConfigEditorSession {
  private readonly screen: blessed.Widgets.Screen;
  private readonly headerBox: blessed.Widgets.BoxElement;
  private readonly sectionsList: blessed.Widgets.ListElement;
  private readonly fieldsList: blessed.Widgets.ListElement;
  private readonly detailsBox: blessed.Widgets.BoxElement;
  private readonly footerBox: blessed.Widgets.BoxElement;

  private draft: RuntimeConfigEditorDraft;
  private focusedPane: EditorPane = 'fields';
  private activeSectionIndex = 0;
  private activeFieldIndex = 0;
  private searchQuery = '';
  private statusMessage = 'Ready';
  private statusTone: StatusTone = 'info';
  private validationState: ValidationState = {
    parsedConfig: null,
    errorsByField: new Map(),
    summary: [],
  };
  private activeModalCount = 0;
  private isClosing = false;
  private resolveRun?: () => void;
  private rejectRun?: (error: unknown) => void;

  constructor(
    draft: RuntimeConfigEditorDraft,
    private readonly stdin: NodeJS.ReadStream,
    private readonly stdout: NodeJS.WriteStream,
  ) {
    this.draft = draft;
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      autoPadding: false,
      title: 'Game Club Runtime Config Editor',
      input: this.stdin,
      output: this.stdout,
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 4,
      tags: true,
      border: 'line',
      style: { border: { fg: 'cyan' } },
    });

    this.sectionsList = blessed.list({
      parent: this.screen,
      top: 4,
      left: 0,
      width: '22%',
      height: '100%-8',
      label: ' Sections ',
      border: 'line',
      tags: true,
      keys: false,
      vi: false,
      mouse: true,
      scrollable: true,
      style: listStyle('magenta'),
    });

    this.fieldsList = blessed.list({
      parent: this.screen,
      top: 4,
      left: '22%',
      width: '33%',
      height: '100%-8',
      label: ' Fields ',
      border: 'line',
      tags: true,
      keys: false,
      vi: false,
      mouse: true,
      scrollable: true,
      style: listStyle('blue'),
    });

    this.detailsBox = blessed.box({
      parent: this.screen,
      top: 4,
      left: '55%',
      width: '45%',
      height: '100%-8',
      label: ' Details ',
      border: 'line',
      tags: true,
      scrollable: true,
      alwaysScroll: true,
      style: { border: { fg: 'yellow' } },
      padding: {
        left: 1,
        right: 1,
      },
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 4,
      tags: true,
      border: 'line',
      style: { border: { fg: 'green' } },
    });
  }

  async run(): Promise<void> {
    if (!this.stdin.isTTY || !this.stdout.isTTY) {
      throw new RuntimeConfigError('The runtime config editor requires an interactive terminal.');
    }

    this.bindKeys();
    this.validateDraft();
    this.render();

    await new Promise<void>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
  }

  private bindKeys(): void {
    this.screen.key(['q', 'C-c'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.close();
    });

    this.screen.key(['tab'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.focusedPane = this.focusedPane === 'sections' ? 'fields' : 'sections';
      this.render();
    });

    this.screen.key(['S-tab'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.focusedPane = this.focusedPane === 'fields' ? 'sections' : 'fields';
      this.render();
    });

    this.screen.key(['up'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.moveSelection(-1);
    });

    this.screen.key(['down'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.moveSelection(1);
    });

    this.screen.key(['enter'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      void this.activateSelection();
    });

    this.screen.key(['space'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      void this.toggleBooleanField();
    });

    this.screen.key(['/'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      void this.openSearchModal();
    });

    this.screen.key(['C-s'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      void this.save();
    });

    this.screen.key(['escape'], () => {
      if (this.hasActiveModal()) {
        return;
      }
      this.searchQuery = '';
      this.setStatus('Search cleared.', 'info');
      this.ensureValidFieldSelection();
      this.render();
    });
  }

  private moveSelection(delta: number): void {
    if (this.focusedPane === 'sections') {
      this.activeSectionIndex = clamp(this.activeSectionIndex + delta, 0, runtimeConfigSections.length - 1);
      this.activeFieldIndex = 0;
      this.ensureValidFieldSelection();
      this.render();
      return;
    }

    const fields = this.getVisibleFields();
    if (fields.length === 0) {
      return;
    }

    this.activeFieldIndex = clamp(this.activeFieldIndex + delta, 0, fields.length - 1);
    this.render();
  }

  private async activateSelection(): Promise<void> {
    if (this.focusedPane === 'sections') {
      this.focusedPane = 'fields';
      this.ensureValidFieldSelection();
      this.render();
      return;
    }

    const field = this.getCurrentField();
    if (!field) {
      return;
    }

    await this.editField(field);
  }

  private async toggleBooleanField(): Promise<void> {
    const field = this.getCurrentField();
    if (!field || field.type !== 'boolean') {
      return;
    }

    const current = Boolean(getNestedValue(this.draft.config, field.path));
    setNestedValue(this.draft.config, field.path, !current);
    this.validateDraft();
    this.setStatus(`${field.label} updated.`, 'success');
    this.render();
  }

  private async editField(field: RuntimeConfigFieldSpec): Promise<void> {
    try {
      switch (field.type) {
        case 'boolean': {
          await this.toggleBooleanField();
          return;
        }
        case 'enum': {
          await this.openEnumModal(field);
          return;
        }
        case 'json': {
          await this.openJsonModal(field);
          return;
        }
        case 'number': {
          await this.openNumberModal(field);
          return;
        }
        case 'secret': {
          await this.openTextModal(field, true);
          return;
        }
        case 'string': {
          await this.openTextModal(field, false);
          return;
        }
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), 'error');
      this.render();
    }
  }

  private async openSearchModal(): Promise<void> {
    const result = await this.promptForText({
      title: 'Search fields',
      initialValue: this.searchQuery,
      instructions: 'Type part of a field name, section, or path. Empty value clears the filter.',
    });

    if (result === null) {
      return;
    }

    this.searchQuery = result.trim();
    this.activeFieldIndex = 0;
    this.ensureValidFieldSelection();
    this.setStatus(this.searchQuery ? `Filter active: ${this.searchQuery}` : 'Search cleared.', 'info');
    this.render();
  }

  private async openTextModal(field: RuntimeConfigFieldSpec, censor: boolean): Promise<void> {
    const currentValue = getNestedValue(this.draft.config, field.path);
    const result = await this.promptForText({
      title: field.label,
      initialValue: currentValue === undefined || currentValue === null ? '' : String(currentValue),
      instructions: buildTextInstructions(field),
      censor,
    });

    if (result === null) {
      return;
    }

    const normalized = censor ? result : result.trim();
    if (normalized.length === 0 && field.optional) {
      removeNestedValue(this.draft.config, field.path);
    } else {
      setNestedValue(this.draft.config, field.path, normalized);
    }

    this.validateDraft();
    this.setStatus(`${field.label} updated.`, 'success');
    this.render();
  }

  private async openNumberModal(field: RuntimeConfigFieldSpec): Promise<void> {
    const currentValue = getNestedValue(this.draft.config, field.path);
    const result = await this.promptForText({
      title: field.label,
      initialValue: currentValue === undefined || currentValue === null ? '' : String(currentValue),
      instructions: buildTextInstructions(field),
    });

    if (result === null) {
      return;
    }

    const trimmed = result.trim();
    if (trimmed.length === 0 && field.optional) {
      removeNestedValue(this.draft.config, field.path);
      this.validateDraft();
      this.setStatus(`${field.label} cleared.`, 'success');
      this.render();
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      this.setStatus(`${field.label} must be an integer.`, 'error');
      this.render();
      return;
    }

    if ((field.min !== undefined && parsed < field.min) || (field.max !== undefined && parsed > field.max)) {
      this.setStatus(`${field.label} must be between ${field.min ?? '-inf'} and ${field.max ?? '+inf'}.`, 'error');
      this.render();
      return;
    }

    setNestedValue(this.draft.config, field.path, parsed);
    this.validateDraft();
    this.setStatus(`${field.label} updated.`, 'success');
    this.render();
  }

  private async openEnumModal(field: RuntimeConfigFieldSpec): Promise<void> {
    const options = field.options ?? [];
    if (options.length === 0) {
      this.setStatus(`${field.label} has no available options.`, 'error');
      return;
    }

    const currentValue = String(getNestedValue(this.draft.config, field.path) ?? '');
    const selected = await this.promptForChoice({
      title: field.label,
      instructions: buildTextInstructions(field),
      items: options.map((option) => ({
        label: option,
        value: option,
        description: option === currentValue ? 'Current value' : '',
      })),
      selectedValue: currentValue,
    });

    if (selected === null) {
      return;
    }

    setNestedValue(this.draft.config, field.path, selected);
    this.validateDraft();
    this.setStatus(`${field.label} updated.`, 'success');
    this.render();
  }

  private async openJsonModal(field: RuntimeConfigFieldSpec): Promise<void> {
    const currentValue = getNestedValue(this.draft.config, field.path);
    const result = await this.promptForText({
      title: field.label,
      initialValue: jsonTextFromValue(currentValue),
      instructions: buildTextInstructions(field),
      multiline: true,
    });

    if (result === null) {
      return;
    }

    try {
      const parsedValue = parseJsonValue(result);
      setNestedValue(this.draft.config, field.path, parsedValue);
      this.validateDraft();
      this.setStatus(`${field.label} updated.`, 'success');
      this.render();
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : `Invalid JSON for ${field.label}.`, 'error');
      this.render();
    }
  }

  private async save(): Promise<void> {
    this.validateDraft();
    if (this.validationState.summary.length > 0 || !this.validationState.parsedConfig) {
      this.focusFirstInvalidField();
      this.setStatus('Save blocked until validation errors are fixed.', 'error');
      this.render();
      return;
    }

    try {
      this.draft = await persistRuntimeConfigDraft(this.draft);
      this.validateDraft();
      this.setStatus('Configuration saved to runtime.json and .env.', 'success');
      this.render();
    } catch (error) {
      if (error instanceof ZodError) {
        this.setStatus(formatValidationError(error), 'error');
      } else {
        this.setStatus(error instanceof Error ? error.message : String(error), 'error');
      }
      this.render();
    }
  }

  private render(): void {
    this.updateLists();
    this.updatePaneStyles();
    this.headerBox.setContent(this.buildHeaderContent());
    this.detailsBox.setContent(this.buildDetailsContent());
    this.footerBox.setContent(this.buildFooterContent());
    this.screen.render();
  }

  private updateLists(): void {
    const sectionItems = runtimeConfigSections.map((section) => {
      const sectionFields = getSectionFields(section);
      const invalidCount = sectionFields.filter((field) => this.validationState.errorsByField.has(fieldPathKey(field.path))).length;
      const dirtyCount = sectionFields.filter((field) => this.isFieldDirty(field)).length;
      const prefix = invalidCount > 0 ? '{red-fg}!{/red-fg}' : dirtyCount > 0 ? '{yellow-fg}*{/yellow-fg}' : '{green-fg}•{/green-fg}';
      return `${prefix} ${section}`;
    });

    this.sectionsList.setItems(sectionItems);
    this.sectionsList.select(this.activeSectionIndex);

    const fieldItems = this.getVisibleFields().map((field) => formatFieldListItem(field, this.isFieldDirty(field), this.validationState.errorsByField.has(fieldPathKey(field.path))));
    this.fieldsList.setItems(fieldItems.length > 0 ? fieldItems : ['{gray-fg}No fields match the current filter{/gray-fg}']);
    this.fieldsList.select(fieldItems.length > 0 ? this.activeFieldIndex : 0);

    if (this.focusedPane === 'sections') {
      this.sectionsList.focus();
    } else {
      this.fieldsList.focus();
    }
  }

  private updatePaneStyles(): void {
    const sectionsActive = this.focusedPane === 'sections' && !this.hasActiveModal();
    const fieldsActive = this.focusedPane === 'fields' && !this.hasActiveModal();
    const modalActive = this.hasActiveModal();

    this.sectionsList.style.border = { fg: sectionsActive ? 'green' : 'magenta' };
    this.fieldsList.style.border = { fg: fieldsActive ? 'green' : 'blue' };
    this.detailsBox.style.border = { fg: modalActive ? 'green' : 'yellow' };

    this.sectionsList.setLabel(` Sections ${sectionsActive ? '[Active]' : ''} `);
    this.fieldsList.setLabel(` Fields ${fieldsActive ? '[Active]' : ''} `);
    this.detailsBox.setLabel(` Details ${modalActive ? '[Modal Open]' : '[Inspect]'} `);
  }

  private buildHeaderContent(): string {
    const dirtyCount = runtimeConfigFieldSpecs.filter((field) => this.isFieldDirty(field)).length;
    const errorCount = this.validationState.summary.length;
    const searchTag = this.searchQuery ? `{yellow-fg}Filter{/yellow-fg}: ${escapeTags(this.searchQuery)}` : '{gray-fg}Filter{/gray-fg}: none';

    return [
      '{bold}{cyan-fg}Game Club Runtime Config Editor{/cyan-fg}{/bold}',
      `Config: ${escapeTags(this.draft.configPath)}`,
      `Env: ${escapeTags(this.draft.envPath)}`,
      `${searchTag}  {yellow-fg}Dirty{/yellow-fg}: ${dirtyCount}  ${errorCount > 0 ? `{red-fg}Errors{/red-fg}: ${errorCount}` : '{green-fg}Errors{/green-fg}: 0'}`,
    ].join('\n');
  }

  private buildDetailsContent(): string {
    const field = this.getCurrentField();
    if (!field) {
      return '{bold}No field selected{/bold}\n\nAdjust the filter or choose another section.';
    }

    const value = getNestedValue(this.draft.config, field.path);
    const errors = this.validationState.errorsByField.get(fieldPathKey(field.path)) ?? [];
    const details: string[] = [];
    details.push(`{bold}${escapeTags(field.label)}{/bold}`);
    details.push('');
    details.push(escapeTags(field.description));
    details.push('');
    details.push(`{cyan-fg}Type{/cyan-fg}: ${field.type}`);
    details.push(`{cyan-fg}Stored in{/cyan-fg}: ${field.destination === 'env' ? '.env' : 'runtime.json'}${field.envKey ? ` (${field.envKey})` : ''}`);
    details.push(`{cyan-fg}Required{/cyan-fg}: ${field.optional ? 'no' : 'yes'}`);
    if (field.options && field.options.length > 0) {
      details.push(`{cyan-fg}Allowed values{/cyan-fg}: ${field.options.map(escapeTags).join(', ')}`);
    }
    if (field.min !== undefined || field.max !== undefined) {
      details.push(`{cyan-fg}Bounds{/cyan-fg}: ${field.min ?? '-inf'} to ${field.max ?? '+inf'}`);
    }
    if (field.example) {
      details.push(`{cyan-fg}Example{/cyan-fg}: ${escapeTags(field.example)}`);
    }
    details.push(`{cyan-fg}Path{/cyan-fg}: ${escapeTags(fieldPathKey(field.path))}`);
    details.push(`{cyan-fg}Current value{/cyan-fg}: ${escapeTags(formatDetailValue(field, value))}`);

    if (errors.length > 0) {
      details.push('');
      details.push('{red-fg}{bold}Validation{/bold}{/red-fg}');
      for (const error of errors) {
        details.push(`{red-fg}- ${escapeTags(error)}{/red-fg}`);
      }
    }

    return details.join('\n');
  }

  private buildFooterContent(): string {
    const summary = this.validationState.summary.slice(0, 3).map((item) => `{red-fg}- ${escapeTags(item)}{/red-fg}`);
    const statusColor = this.statusTone === 'error'
      ? 'red-fg'
      : this.statusTone === 'success'
        ? 'green-fg'
        : this.statusTone === 'warning'
          ? 'yellow-fg'
          : 'cyan-fg';

    const focusText = this.hasActiveModal()
      ? '{green-fg}Focus: modal dialog{/green-fg}'
      : this.focusedPane === 'sections'
        ? '{green-fg}Focus: sections panel{/green-fg}'
        : '{green-fg}Focus: fields panel{/green-fg}';

    const lines = [
      '{bold}Keys{/bold}: arrows move  Tab switch pane  Enter edit  Space toggle  / search  Esc clear filter  Ctrl-S save  q quit',
      focusText,
      `{${statusColor}}Status: ${escapeTags(this.statusMessage)}{/${statusColor}}`,
    ];

    if (summary.length > 0) {
      lines.push(summary.join('  '));
    } else {
      lines.push('{green-fg}Validation clean.{/green-fg}');
    }

    return lines.join('\n');
  }

  private validateDraft(): void {
    const preparedConfig = normalizeDraftForValidation(this.draft.config);
    const result = runtimeConfigSchema.safeParse(preparedConfig);

    if (result.success) {
      this.validationState = {
        parsedConfig: result.data,
        errorsByField: new Map(),
        summary: [],
      };
      return;
    }

    const errorsByField = new Map<string, string[]>();
    const summary: string[] = [];

    for (const issue of result.error.issues) {
      const key = issue.path.join('.');
      const existing = errorsByField.get(key) ?? [];
      existing.push(issue.message);
      errorsByField.set(key, existing);
      summary.push(`${key || '(root)'}: ${issue.message}`);
    }

    this.validationState = {
      parsedConfig: null,
      errorsByField,
      summary,
    };
  }

  private focusFirstInvalidField(): void {
    const firstKey = this.validationState.summary.length > 0 ? this.validationState.summary[0]?.split(':')[0] ?? '' : '';
    if (!firstKey) {
      return;
    }

    const field = runtimeConfigFieldSpecs.find((candidate) => fieldPathKey(candidate.path) === firstKey);
    if (!field) {
      return;
    }

    const sectionIndex = runtimeConfigSections.findIndex((section) => section === field.section);
    if (sectionIndex >= 0) {
      this.activeSectionIndex = sectionIndex;
    }

    const fields = this.getVisibleFields();
    const fieldIndex = fields.findIndex((candidate) => fieldPathKey(candidate.path) === firstKey);
    if (fieldIndex >= 0) {
      this.activeFieldIndex = fieldIndex;
    } else {
      this.activeFieldIndex = 0;
    }

    this.focusedPane = 'fields';
  }

  private getVisibleFields(): RuntimeConfigFieldSpec[] {
    const section = runtimeConfigSections[this.activeSectionIndex] ?? runtimeConfigSections[0];
    const sectionFields = getSectionFields(section);
    if (!this.searchQuery) {
      return sectionFields;
    }

    const query = this.searchQuery.toLowerCase();
    return sectionFields.filter((field) => {
      const haystack = [field.label, field.description, fieldPathKey(field.path), field.section].join(' ').toLowerCase();
      return haystack.includes(query);
    });
  }

  private getCurrentField(): RuntimeConfigFieldSpec | undefined {
    const fields = this.getVisibleFields();
    return fields[this.activeFieldIndex];
  }

  private ensureValidFieldSelection(): void {
    const fields = this.getVisibleFields();
    if (fields.length === 0) {
      this.activeFieldIndex = 0;
      return;
    }

    this.activeFieldIndex = clamp(this.activeFieldIndex, 0, fields.length - 1);
  }

  private isFieldDirty(field: RuntimeConfigFieldSpec): boolean {
    const current = getNestedValue(normalizeDraftForComparison(this.draft.config), field.path);
    const originalMerged = mergeRuntimeConfigSources(this.draft.originalJsonConfig, parseEnvFile(this.draft.envText), {}) as Record<string, unknown>;
    const original = getNestedValue(normalizeDraftForComparison(originalMerged), field.path);
    return JSON.stringify(current) !== JSON.stringify(original);
  }

  private setStatus(message: string, tone: StatusTone): void {
    this.statusMessage = message;
    this.statusTone = tone;
  }

  private close(): void {
    if (this.isClosing) {
      return;
    }

    this.isClosing = true;
    this.screen.destroy();
    this.resolveRun?.();
  }

  private hasActiveModal(): boolean {
    return this.activeModalCount > 0;
  }

  private async promptForText(options: {
    title: string;
    initialValue: string;
    instructions: string;
    censor?: boolean;
    multiline?: boolean;
  }): Promise<string | null> {
    return await new Promise<string | null>((resolve) => {
      this.activeModalCount += 1;
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: options.multiline ? '70%' : '60%',
        height: options.multiline ? 18 : 12,
        border: 'line',
        label: ` ${options.title} `,
        tags: true,
        style: {
          border: { fg: 'cyan' },
          bg: 'black',
        },
      });

      blessed.box({
        parent: modal,
        top: 1,
        left: 1,
        width: '100%-2',
        height: options.multiline ? 5 : 3,
        tags: true,
        content: escapeTags(options.instructions),
      });

      const input = (options.multiline ? blessed.textarea : blessed.textbox)({
        parent: modal,
        top: options.multiline ? 6 : 4,
        left: 1,
        width: '100%-2',
        height: options.multiline ? 8 : 3,
        border: 'line',
        inputOnFocus: true,
        keys: true,
        mouse: true,
        censor: options.censor,
        style: {
          border: { fg: 'yellow' },
          focus: { border: { fg: 'green' } },
        },
      }) as blessed.Widgets.TextboxElement;

      input.setValue(options.initialValue);

      blessed.box({
        parent: modal,
        bottom: 1,
        left: 1,
        width: '100%-2',
        height: 1,
        tags: true,
        content: '{gray-fg}Enter submit  Esc cancel{/gray-fg}',
      });

      const close = (result: string | null): void => {
        this.activeModalCount = Math.max(0, this.activeModalCount - 1);
        modal.detach();
        this.render();
        resolve(result);
      };

      modal.key(['escape'], () => close(null));
      input.key(['escape'], () => close(null));
      input.on('submit', (value) => close(String(value ?? '')));
      input.on('cancel', () => close(null));
      input.focus();
      this.screen.render();
      input.readInput();
    });
  }

  private async promptForChoice(options: {
    title: string;
    instructions: string;
    items: Array<{ label: string; value: string; description?: string }>;
    selectedValue?: string;
  }): Promise<string | null> {
    return await new Promise<string | null>((resolve) => {
      this.activeModalCount += 1;
      const modal = blessed.box({
        parent: this.screen,
        top: 'center',
        left: 'center',
        width: '50%',
        height: 16,
        border: 'line',
        label: ` ${options.title} `,
        tags: true,
        style: {
          border: { fg: 'cyan' },
          bg: 'black',
        },
      });

      blessed.box({
        parent: modal,
        top: 1,
        left: 1,
        width: '100%-2',
        height: 3,
        tags: true,
        content: escapeTags(options.instructions),
      });

      const list = blessed.list({
        parent: modal,
        top: 4,
        left: 1,
        width: '100%-2',
        height: 9,
        border: 'line',
        keys: true,
        mouse: true,
        tags: true,
        style: listStyle('blue'),
        items: options.items.map((item) => item.label),
      });

      const initialIndex = Math.max(0, options.items.findIndex((item) => item.value === options.selectedValue));
      list.select(initialIndex);

      const close = (result: string | null): void => {
        this.activeModalCount = Math.max(0, this.activeModalCount - 1);
        modal.detach();
        this.render();
        resolve(result);
      };

      modal.key(['escape'], () => close(null));
      list.key(['escape'], () => close(null));
      list.on('select', (_, index) => close(options.items[index]?.value ?? null));
      list.focus();
      this.screen.render();
    });
  }
}

function listStyle(borderColor: string) {
  return {
    border: { fg: borderColor },
    selected: { bg: 'white', fg: 'black', bold: true },
    item: { fg: 'white' },
  };
}

function buildTextInstructions(field: RuntimeConfigFieldSpec): string {
  const parts = [field.description];
  if (field.destination === 'env') {
    parts.push(`Stored in .env${field.envKey ? ` as ${field.envKey}` : ''}.`);
  } else {
    parts.push('Stored in runtime.json.');
  }
  if (field.options && field.options.length > 0) {
    parts.push(`Allowed values: ${field.options.join(', ')}.`);
  }
  if (field.min !== undefined || field.max !== undefined) {
    parts.push(`Bounds: ${field.min ?? '-inf'} to ${field.max ?? '+inf'}.`);
  }
  if (field.optional) {
    parts.push('Leave empty to clear this optional field.');
  }
  return parts.join(' ');
}

function formatFieldListItem(field: RuntimeConfigFieldSpec, dirty: boolean, invalid: boolean): string {
  const markers = [
    invalid ? '{red-fg}!{/red-fg}' : '{green-fg}•{/green-fg}',
    dirty ? '{yellow-fg}*{/yellow-fg}' : ' ',
    field.optional ? '{gray-fg}?{/gray-fg}' : '{white-fg}*{/white-fg}',
  ].join('');
  return `${markers} ${field.label} {gray-fg}[${field.destination === 'env' ? '.env' : 'json'}]{/gray-fg}`;
}

function formatDetailValue(field: RuntimeConfigFieldSpec, value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return '<empty>';
  }
  if (field.secret) {
    return '[hidden]';
  }
  if (field.type === 'json') {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatValidationError(error: ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ');
}

function normalizeDraftForValidation(config: Record<string, unknown>): Record<string, unknown> {
  const clone = deepCloneRecord(config);
  for (const field of runtimeConfigFieldSpecs) {
    if (!field.optional) {
      continue;
    }

    const value = getNestedValue(clone, field.path);
    if (value === '') {
      removeNestedValue(clone, field.path);
    }
  }

  return clone;
}

function normalizeDraftForComparison(config: Record<string, unknown>): Record<string, unknown> {
  return normalizeDraftForValidation(config);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function escapeTags(value: string): string {
  return value.replace(/[{}]/g, '');
}

async function readTextIfExists(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

async function loadExampleRuntimeConfig(): Promise<Record<string, unknown>> {
  try {
    const raw = await readFile(exampleRuntimeConfigPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {
      schemaVersion: 1,
      bot: {
        publicName: 'Game Club Bot',
        clubName: 'Game Club',
        language: 'ca',
      },
      telegram: {},
      bgg: {},
      database: {
        host: '127.0.0.1',
        port: 5432,
        name: 'gameclub',
        user: 'gameclub_user',
        ssl: false,
      },
      adminElevation: {},
      bootstrap: {
        firstAdmin: {
          telegramUserId: 1,
          displayName: 'Club Administrator',
        },
      },
      notifications: {
        defaults: {
          groupAnnouncementsEnabled: true,
          eventRemindersEnabled: true,
          eventReminderLeadHours: 24,
        },
      },
      featureFlags: {},
    };
  }
}

function deepMergeObjects(base: Record<string, unknown>, overlay: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = deepCloneRecord(base);
  for (const [key, value] of Object.entries(overlay)) {
    const existing = result[key];
    if (isPlainRecord(existing) && isPlainRecord(value)) {
      result[key] = deepMergeObjects(existing, value);
      continue;
    }
    result[key] = deepCloneUnknown(value);
  }
  return result;
}

function deepCloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return deepCloneUnknown(value) as Record<string, unknown>;
}

function deepCloneUnknown<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function writeAtomicText(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, content, 'utf8');
  await rename(tempPath, filePath);
}
