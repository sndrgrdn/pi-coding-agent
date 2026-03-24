- When using `bash`, prefer deterministic, non-interactive commands and text/JSON output.
- Prefer `edit` for existing files. Use `write` only for new files, or after reading an existing file and deciding to replace it end-to-end because most of it is changing.
- Parallelize independent work when safe, such as reads, searches, checks, or disjoint `edit` calls, including disjoint sections of the same file.

Github:
- Use `gh` CLI for all GitHub tasks (issues, PRs, CI, releases); don't scrape URLs.
- Given issue/PR URL: `gh issue view <url>` or `gh pr view <url> --comments`.
