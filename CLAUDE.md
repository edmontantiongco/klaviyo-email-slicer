# Klaviyo Email Slicer

## Keep the Import page highlights current

The Import page lists the app's steps at a glance (`PIPELINE` in `src/components/import/ImportView.tsx`). Whenever a change affects what a step does — Slice, Optimize & review, Upload / Send to Klaviyo — update the matching entry in the same change, so the list never describes old behaviour.

## Git workflow

Use the project skills: `/change-requests` to start a feature branch from the latest `main`, `/ship-it` to commit, verify (`npm run typecheck`, `npm test`), fast-forward into `main`, push and delete the branch.
