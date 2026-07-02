Commit all staged and unstaged changes, push to a new branch, and open a pull request. Follow these steps exactly:

1. Run `git status` and `git diff` to understand what changed.

2. Run `git log --oneline -5` to match the project's commit message style.

3. Stage relevant changed files with `git add` (specific files, not `git add -A` or `git add .` — avoid accidentally including .env or sensitive files).

4. Write a concise commit message (1-2 sentences) focused on the WHY, not the WHAT. End it with:
   Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
   Use a HEREDOC to pass the message to avoid shell escaping issues.

5. Create a new branch named after the change using kebab-case (e.g. `feat/instructor-vetting-ui` or `fix/booking-slot-overlap`). Branch from current HEAD.

6. Commit on the new branch.

7. Push the branch to origin with `-u`.

8. Open a pull request using `gh pr create` with:
   - A short title (under 70 chars)
   - A body (via HEREDOC) with sections: ## Summary (3 bullets max), ## Test plan (checklist)
   - Do NOT add "🤖 Generated" footer — this project omits it

9. Print the PR URL.

Important constraints from CLAUDE.md:
- Never push directly to main
- Never auto-merge
- Never expose instructor PII in PR description or comments
- If the changes touch auth, payments, instructor data, or Stripe — remind the user to run /cso before merging
