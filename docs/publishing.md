# Publishing policy for the community fork

This fork, Claude Science for Magpie, lives at https://github.com/Guuuu233/claude-science-for-magpie (renamed from `Guuuu233/magpie-claude-science` in v0.2.4; GitHub redirects the old address, so do not create a new repository under that name). The upstream npm package belongs to https://github.com/shiyang1026/magpie-claude-science and is not modified or republished.

Magpie installs and updates GitHub plugins from the default branch, so `main` is kept at the latest release: merge release changes, bump `package.json` and `CHANGELOG.md`, tag that commit `vX.Y.Z`, and attach the tarball to the GitHub Release. Installed copies pick the new commit up through Magpie's plugin update and replace their local service when Science is idle.

Run `npm ci --ignore-scripts`, `npm test`, `npm run check:package`, and `npm run test:integration` before preparing any tarball. Build a local archive with `npm pack --ignore-scripts`; distribute archives through this repository’s GitHub Releases, not npm. No automatic publish workflow is installed.
