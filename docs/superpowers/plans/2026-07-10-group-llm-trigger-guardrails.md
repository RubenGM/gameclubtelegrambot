# Group LLM Trigger Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure normal group/topic messages trigger the LLM only for a real reply to the bot or a bot mention at the start of the message, while ignoring quotes and informational mentions elsewhere.

**Architecture:** Keep the policy at the existing LLM fallback boundary. Tighten mention matching in `llm-command-flow.ts`, and make reply-context extraction reject Telegram quote replies in `runtime-boundary-support.ts`. Extend focused tests and update the operational LLM documentation.

**Tech Stack:** TypeScript, Node test runner, Telegram runtime boundary, Markdown documentation.

## Global Constraints

- Private `/ask`, menu sessions, and private fallback behavior remain unchanged.
- In groups/topics, a real reply to a bot message is valid; quote messages are never valid triggers.
- Manual mentions are valid only after leading whitespace and at the beginning of the message.
- After functional changes, run `./scripts/feature-status-audit.sh` and `./startup.sh`.

---

### Task 1: Lock the group trigger contract with tests

**Files:**
- Modify: `src/telegram/llm-command-flow.test.ts`
- Modify: `src/telegram/runtime-boundary-support.test.ts` if the existing test seam is available there

- [ ] Add tests proving `@gameclubbot pregunta` and `   @gameclubbot pregunta` trigger, while `comparte: @gameclubbot` and `para usar el bot escribid a @gameclubbot` do not.
- [ ] Add a test proving a regular reply to a bot message still triggers.
- [ ] Add a test proving a Telegram quote of a bot message does not produce `replyToBotMessageContext`.
- [ ] Run the focused tests and confirm the new expectations fail before implementation.

### Task 2: Implement the trigger guardrails

**Files:**
- Modify: `src/telegram/llm-command-flow.ts`
- Modify: `src/telegram/runtime-boundary-support.ts`

- [ ] Change mention matching from “mention anywhere after whitespace” to “mention at offset zero after optional leading whitespace”.
- [ ] Keep stripping only the leading bot mention from the prompt.
- [ ] Detect Telegram quote metadata on the incoming message and return no bot-reply context when present.
- [ ] Preserve existing bot username matching and case-insensitive behavior.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Align operational documentation and validate

**Files:**
- Modify: `docs/llm-natural-language.md`
- Modify: `docs/feature-status.md` only if the feature-status audit identifies a required visible/operational update

- [ ] Document the exact group/topic trigger rules: leading mention or real reply, quotes ignored, internal mentions ignored.
- [ ] Run `npm run typecheck`.
- [ ] Run the relevant LLM and runtime-boundary tests.
- [ ] Run `./scripts/feature-status-audit.sh`.
- [ ] Run `./startup.sh` and wait for its completion signal.
- [ ] Inspect `git diff --check` and `git status --short --branch` before handoff.
