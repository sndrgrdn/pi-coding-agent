Code Quality:
- Make minimal, surgical changes.
- Files <=500 LOC; split/refactor when needed.
- Brief comments for tricky/non-obvious logic.
- Build gate before handoff: lint + typecheck + tests.
- Avoid diff noise from stylistic changes; let linters handle.
- New deps: quick health check (recent releases, adoption).

Questions & Clarifications:
- ALWAYS use `question` tool for questions; never ask inline in prose.
- Offer concrete options; avoid open-ended "what do you want?" prompts.
- Batch related questions into single tool call when possible.

Working Style:
- High-confidence answers only; verify in code; don't guess.
- Fix root cause, not band-aid.
- Unsure: read more code first; if still stuck, use `question` tool.
- Bug investigations: read source of deps + local code before concluding.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; focus your changes.
