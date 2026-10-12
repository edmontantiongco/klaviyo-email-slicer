---
name: change-requests
description: Start work on change requests in this repo — update main and create a fresh feature branch for them. Use when the user says they have "change requests" (or new feedback/edits to make), or runs /change-requests.
---

# Change requests: start a feature branch

The user has change requests to make. Set up a clean feature branch off the latest `main` **before** touching any code. The requests themselves may be in the message, in `$ARGUMENTS`, or still to come.

## Steps

1. **Check for unsaved work.** Run `git status --porcelain`.
   - If anything is uncommitted, STOP and ask the user whether to commit it (on the current branch), stash it, or discard it. Never discard without an explicit yes. Then continue.
2. **Note the current branch.** If it's a feature branch with commits not on `main` (`git log main..HEAD --oneline` is non-empty), tell the user it hasn't been shipped and ask whether to ship it first (`/ship-it`) or leave it and branch anyway.
3. **Update main.**
   ```
   git checkout main
   git pull --ff-only origin main
   ```
   If the pull isn't a fast-forward (local `main` has diverged), STOP and show the user `git log --oneline origin/main...main` — don't merge or reset on your own.
4. **Clean up merged branches (optional, quiet).** `git branch --merged main` — delete local branches listed there other than `main` with `git branch -d` (never `-D`). Mention any you deleted in one line.
5. **Create the feature branch.**
   - Name: `feature/<short-kebab-slug>` describing the change requests (2–5 words, e.g. `feature/header-logo-error`). One branch covers all the change requests given together.
   - If the requests aren't known yet, ask for them first, or use `feature/change-requests-YYYY-MM-DD` if the user just wants to start.
   - If the name already exists locally or on origin, add a suffix (`-2`).
   ```
   git checkout -b feature/<slug>
   ```
6. **Report** in one or two lines: the branch name and that it's based on the latest `main` (short SHA). Then, if the change requests are already given, start working on them.

## Rules

- Never force-push, `reset --hard`, or delete unmerged branches.
- Don't push the new branch; it's pushed (or not) when shipping.
