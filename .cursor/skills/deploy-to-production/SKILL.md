---
name: deploy-to-production
description: Use when the user wants to deploy the app to production, run a release, or ship to a hosting environment (e.g. Chrome Web Store, Netlify, Vercel).
---

# Deploy to production

Use this skill when the task involves deploying or releasing the project.

## Steps

1. **Confirm target** – Where should this deploy? (Chrome Web Store, static host, server, etc.)
2. **Check config** – Ensure `package.json` scripts and any env or secrets are documented. Do not commit secrets.
3. **Build** – Run `npm run build` and confirm it succeeds.
4. **Follow project docs** – If `docs/` or README describe a release process, follow them.
5. **Verify** – After deploy, note how to confirm the release (e.g. version in manifest, health URL).

## Notes

- For a Chrome extension, production usually means packing for the Web Store or loading an unpacked build.
- Add or adjust this skill to match your real deployment flow (e.g. CI job, manual steps).
