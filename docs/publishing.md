# Publishing policy for the community fork

This fork lives at https://github.com/Guuuu233/magpie-claude-science. The upstream npm package belongs to https://github.com/shiyang1026/magpie-claude-science and is not modified or republished.

Run `npm ci --ignore-scripts`, `npm test`, `npm run check:package`, and `npm run test:integration` before preparing any tarball. Build a local archive with `npm pack --ignore-scripts`; distribute archives through this repository’s GitHub Releases, not npm. No automatic publish workflow is installed.
