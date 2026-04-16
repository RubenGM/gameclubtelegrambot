export interface RepoHealthFile {
  path: string;
  content: string;
}

const exportedDeclarationPattern = /^export\s+(interface|type|class|enum)\s+([A-Za-z_$][\w$]*)\b/gm;

export function findDuplicateExports({
  filePath,
  content,
}: {
  filePath: string;
  content: string;
}): string[] {
  const counts = new Map<string, { kind: string; count: number }>();

  for (const match of content.matchAll(exportedDeclarationPattern)) {
    const [, kind, name] = match;
    if (!kind || !name) {
      continue;
    }
    const existing = counts.get(name);
    if (existing) {
      existing.count += 1;
      continue;
    }

    counts.set(name, { kind, count: 1 });
  }

  const issues: string[] = [];
  for (const [name, entry] of counts.entries()) {
    if (entry.count < 2) {
      continue;
    }

    issues.push(`${filePath}: duplicate exported ${entry.kind} "${name}" declared ${entry.count} times`);
  }

  return issues.sort();
}

export function validateRepoHealth({
  files,
}: {
  files: RepoHealthFile[];
}): string[] {
  return files.flatMap((file) => findDuplicateExports({ filePath: file.path, content: file.content })).sort();
}
