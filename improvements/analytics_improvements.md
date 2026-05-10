# Analytics Improvements

## 1. Add "No Interaction" Views

Show which menus are displayed but never clicked.

Why it matters:
- This is the fastest way to spot friction in the main menu.
- A menu with many `shown` events and few `action_selected` events is likely unclear, overloaded, or low-value.

What to include:
- count of `menu.shown` per `menuId`
- count of `menu.action_selected` per `menuId`
- interaction rate per menu
- ranking of menus with the worst conversion

## 2. Add Language Breakdown

Break down usage by `language` to compare how the bot performs across localized versions.

Why it matters:
- Different languages may have different button clarity, wording quality, or onboarding success.
- This can reveal translation issues that are invisible in aggregate metrics.

What to include:
- menus shown by language
- actions selected by language
- interaction rate by language
- top actions per language

## 3. Add Recent Activity Timeline

Show the most recent UX events in chronological order.

Why it matters:
- This helps validate manual testing quickly.
- It also makes the analytics tools useful for short operational debugging sessions, not just aggregated analysis.

What to include:
- timestamp
- actor role
- menu id
- action id or action key
- visible label when available

## 4. Add Better Filters

Extend the reporting tools beyond `--days` with focused filters.

Why it matters:
- Once there is more data, global reports become less useful.
- Operators need to isolate one role, one menu, or one action to understand specific UX issues.

Suggested filters:
- `--role admin|member|pending|blocked`
- `--menu <menuId>`
- `--action <telemetryActionKey>`

## 5. Add JSON and CSV Export

Allow exporting the same report data in machine-friendly formats.

Why it matters:
- JSON makes it easy to automate comparisons or feed dashboards.
- CSV makes it easy to inspect data in spreadsheets or share with non-technical collaborators.

Suggested outputs:
- `--json` for full snapshot export
- `--csv top-actions`
- `--csv role-breakdown`

## 6. Improve the TUI

Make the terminal UI more useful for repeated operator use.

Why it matters:
- The current TUI is intentionally small and functional.
- A richer TUI would reduce the need to rerun commands or mentally stitch multiple views together.

Possible improvements:
- clearer tab styling
- interactive time window selection
- optional auto-refresh
- drilldown from a top action into supporting details
- quick toggles for role or menu filters

## 7. Measure Long Flows, Not Just the Main Menu

Expand telemetry beyond the persistent main menu into deeper user flows.

Why it matters:
- The biggest UX problems are often not in the first click, but in the flows that require several steps.
- This is especially relevant for `Activitats` and `Cataleg`, where abandonment is more likely.

What to measure:
- flow started
- step reached
- step cancelled
- flow completed
- most abandoned step per flow

## 8. Normalize Report Labels

Show a canonical label per action instead of relying only on `labelSample`.

Why it matters:
- Samples vary by language and by what happened to be clicked first.
- Canonical labels make reports easier to compare across languages and over time.

What to improve:
- define a stable reporting label for each telemetry action key
- keep the localized sample as secondary context
- group by stable action identity, not translated text

## Recommended Next Iteration

If only one short analytics iteration is planned, the best sequence is:

1. Add the "no interaction" view.
2. Add language breakdown.
3. Add `--role` and `--menu` filters.

This would improve both diagnosis quality and day-to-day usefulness without expanding telemetry scope too aggressively.
