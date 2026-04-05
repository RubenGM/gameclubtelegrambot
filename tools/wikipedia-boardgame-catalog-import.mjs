#!/usr/bin/env node
import { execSync, spawnSync } from 'node:child_process';

const model = 'opencode/qwen3.6-plus-free';
const skillName = 'wikipedia-boardgame-catalog-import';

const title = process.argv.slice(2).join(' ').trim();
if (!title) {
  process.stderr.write('Uso: wikipedia-boardgame-catalog-import <nombre del juego>\n');
  process.exit(1);
}

const attachUrl = resolveAttachUrl();
if (!attachUrl) {
  process.stderr.write('No encuentro un servidor opencode activo. Define OPENCODE_ATTACH o ejecuta `opencode serve`.\n');
  process.exit(1);
}

const prompt = [
  `Use the skill ${skillName}.`,
  `Extract the board game data for Wikipedia title: ${title}.`,
  'Use Wikipedia infobox only.',
  'Return exactly one JSON object and nothing else.',
  'Do not add markdown fences, explanations, or extra text.',
  'If a field is unknown, use null or an empty array as appropriate.',
].join(' ');

const result = spawnSync(
  'opencode',
  ['run', '--attach', attachUrl, '--model', model, '--format', 'json', '--title', `wiki-boardgame:${title}`, prompt],
  { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);

if (result.error) {
  process.stderr.write(`${result.error.message}\n`);
  process.exit(1);
}

if (result.status !== 0) {
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  process.exit(result.status ?? 1);
}

const assistantText = extractAssistantText(result.stdout);
const jsonText = extractJsonText(assistantText);

try {
  const parsed = JSON.parse(jsonText);
  process.stdout.write(`${JSON.stringify(parsed)}\n`);
} catch (error) {
  process.stderr.write(`No he pogut parsejar la resposta JSON d'opencode.\n${String(error)}\nResposta:\n${assistantText}\n`);
  process.exit(1);
}

function resolveAttachUrl() {
  const direct = process.env.OPENCODE_ATTACH?.trim() || process.env.OPENCODE_SERVER_URL?.trim();
  if (direct) {
    return direct;
  }

  try {
    const psOutput = execSync('ps -ef', { encoding: 'utf8' });
    const match = psOutput.match(/opencode-cli .*\bserve\b.*--port\s+(\d+)/m);
    if (match) {
      return `http://127.0.0.1:${match[1]}`;
    }
  } catch {
    return null;
  }

  return null;
}

function extractAssistantText(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let lastText = '';

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'text' && typeof event?.part?.text === 'string') {
        lastText = event.part.text;
      }
    } catch {
      // Ignore non-JSON lines.
    }
  }

  return lastText;
}

function extractJsonText(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i) || text.match(/```\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1).trim();
  }

  return text.trim();
}
