---
name: ship-it
description: Commit the work on the current feature branch, verify it, fast-forward it into main, push main to origin and delete the feature branch. Use when the user says "commit the changes", "ship it", "we're done, merge it", or similar, or runs /ship-it.
---

# Ship it: commit, merge to main, push

Finish the current feature branch: commit, verify, merge into `main` keeping every commit (linear history, no merge commit, no squash), push `main`, delete the branch.

## Confirmation

- **Invoked with `/ship-it`:** the user asked explicitly — no confirmation needed unless something below says STOP.
- **Triggered by a phrase** ("commit the changes" etc.): after step 2, show a short summary — branch, commit message(s), files changed, "will merge into main and push to origin" — and wait for a clear yes. If the user only wanted a commit, stop after committing on the feature branch.

## Steps

1. **Check the branch.** `git branch --show-current`.
   - If it's `main`: STOP. Ask whether to move the changes to a new feature branch first (`git checkout -b feature/<slug>`, which carries uncommitted changes along) — then continue from there.
   - Detached HEAD or mid-rebase/merge: STOP and explain.
2. **Commit.** If `git status --porcelain` shows changes:
   - Review `git diff` and `git status` (don't stage secrets, `.env*`, build output or stray scratch files — ask if unsure).
   - Stage the relevant files by name (avoid blind `git add -A` when unrelated files are present).
   - Write a sensible message in this repo's style (see `git log --oneline -10`): imperative subject ≤ 72 chars describing what changed, blank line, a short body on why when it isn't obvious. Split into several commits if the changes are clearly unrelated.
   - End every commit message with the attribution trailer given in the session's instructions, if any.
   - If nothing is uncommitted and the branch has no commits ahead of `main`, STOP — nothing to ship.
3. **Verify.** Run `npm run typecheck` and `npm test`. If either fails, STOP: show the failure, leave everything on the feature branch, and don't merge.
4. **Update main and line up the branch.**
   ```
   git fetch origin
   git checkout main
   git pull --ff-only origin main
   git checkout <feature>
   ```
   If `main` has moved past the branch's base (`git merge-base --is-ancestor main <feature>` fails), rebase the feature branch onto it — **only if the branch was never pushed** (`git ls-remote --heads origin <feature>` is empty); `git rebase main`. On conflicts: `git rebase --abort` and STOP, showing the conflicting files. If the branch *was* pushed, STOP and ask how to proceed instead of rebasing. After a rebase, re-run step 3.
5. **Merge (fast-forward only, keeps each commit).**
   ```
   git checkout main
   git merge --ff-only <feature>
   ```
6. **Push main.** `git push origin main`. If rejected (someone pushed meanwhile), STOP and report — never force-push.
7. **Delete the feature branch.**
   - Local: `git branch -d <feature>` (never `-D`).
   - Remote, if it exists: `git push origin --delete <feature>`.
8. **Report** briefly: commits shipped (`git log --oneline` of what was merged), the new `main` SHA, and that the branch was deleted.

## Rules

- Never `push --force`, `reset --hard`, `branch -D`, or skip hooks (`--no-verify`).
- Never resolve merge/rebase conflicts silently — stop and show them.
- Stop at the first failure; the feature branch stays intact so nothing is lost.
