> **Community fork:** based on the original MIT-licensed project by Sia (shiyang1026). The npm package `magpie-claude-science@latest` is **not this fork**. Download this repository’s GitHub Release or install from checked-out source; no automatic npm publishing is enabled.

# Claude Science for Magpie

English · [简体中文](README.zh-CN.md)

[![npm](https://img.shields.io/npm/v/magpie-claude-science)](https://www.npmjs.com/package/magpie-claude-science)
[![CI](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/shiyang1026/magpie-claude-science)](https://github.com/Guuuu233/magpie-claude-science/releases)

Use Magpie's models in Claude Science while keeping the original macOS app icon. Complete the terminal setup below first; then choose models in **Magpie → Agent → Claude Science** and open Science as usual.

**Experimental.** An Agent plugin, scoped middleware and an explicitly installed background service. No CSP required. Tested with Science **0.1.60** and Magpie **0.1.1219**.

## Quick start

Requires macOS, an official Node.js 22+ distribution, and installed Claude Science and Magpie. **Clicking Install in Magpie alone is not enough.** Start Magpie, enable at least one model, finish active Science tasks, and run this in a terminal (no source checkout needed):

```sh
npx magpie-claude-science@latest install
```

Choose a model when prompted. Once the terminal reports `Installed`, reopen **Claude Science.app** and close the old login tab. Do not reuse a bookmark pointing to the old port.

Alternatively, from a source checkout:

```sh
npm ci --ignore-scripts
node src/cli.js install
```

Choose a model when prompted. For unattended setup, supply `--model` with an ID from your Magpie catalog. The installer reads Magpie's gateway port and finds available local ports; overrides are listed by `node src/cli.js --help`.

**Adding the plugin in Magpie alone does not complete setup.** The installer creates a macOS LaunchAgent and copies its runtime, production dependencies and Node into a private release directory. The installed service no longer depends on the checkout or npm cache. Node builds linked to external libraries, such as some Homebrew builds, are refused.

Open the original **Claude Science.app**. The first “Sign in” confirms a local browser session, not an Anthropic login. Keep Magpie running and select models from its Agent page.

### Sign in leads to Sign in on the web / Paste code instead

That page is Science's account login flow. Check whether local setup completed; existing browser login state is not evidence of a successful installation:

```sh
npx magpie-claude-science@latest doctor
```

If the local service is not initialized, run `install` above. If installed, check the service state and `sciencePort` in the output, then reopen the app to reach the managed service. A port such as `localhost:8765` alone does not establish whether setup succeeded. If `doctor` reports an error, share its summary, not tokens, full private logs, or `state.json`.

## Local target, not a VPS

This plugin drives the original **Claude Science.app** through a loopback compatibility service. It connects only to a literal loopback Magpie gateway (`127.0.0.1` or `[::1]`, read from Magpie's own settings or supplied with `--gateway`) and never to a remote endpoint. It is therefore **not tied to a specific VPS**: any locally running, compatible Magpie provider can serve the selected model. The package ships no server addresses, credentials, or VPS material.

## Manage

All lifecycle commands come from `src/cli.js`:

```sh
node src/cli.js install    # First-time setup; also available as npx magpie-claude-science@latest install
node src/cli.js upgrade    # Prepare a new release from the updated checkout/package
node src/cli.js doctor     # Show runtime, model, gateway, service and deployment checksum state
node src/cli.js restart    # Restart the managed service after finishing Science tasks
node src/cli.js rollback   # Switch back to the previous managed runtime release
node src/cli.js uninstall  # Stop the service, restore original config; retain session data
```

Installed copies can run the same operations through `npx magpie-claude-science@latest <command>`. Stop active Science tasks before lifecycle changes. Upgrade preserves local identity and sessions and restores the previous service if startup fails. Migrating an early checkout-based installation is supported through `upgrade`; a previous managed release is required for `rollback`.

## How it works

```text
Claude Science → local compatibility service → Magpie → selected provider/model
```

Data, local identity and versioned runtime files live under `~/.config/magpie/claude-science-runtime/`. Original credentials and app binaries are preserved. The original config is redirected only after an owned Science daemon passes readiness checks. Disabling or uninstalling restores it; conflicting user edits are retained for manual resolution.

## Limitations

- Science lists every model in your Magpie catalog. Claude TUI models appear under their Claude names (`claude-opus-5-5`, ...) and run on the provider chosen with `install --claude <provider>` (default `claude-tui`, the Claude TUI plugin on this Magpie; a remote Magpie's is e.g. `my-vps/claude-tui`). Science only shows ids starting with `claude-`, so every other model appears under a stable alias `claude-x-<id>-<hash>` with its Magpie name, and runs on that Magpie model.
- Anthropic-hosted search, MCP and account services are not provided.
- Full scientific workflows, long sessions and image support remain unverified.
- Owned-orphan recovery and executable-change detection have automated tests. Real macOS reboot races and future Science versions still need validation. Finish current tasks before restarting after a Science update.
### Provider capability compatibility

Long Science conversations on Claude TUI models need a TUI Boost runtime that
serves each conversation from its own history (the tui-lite build): it resumes
the native session when the history follows it and rebuilds it from that
history otherwise. A plain TUI Boost 0.2.x runtime refuses rewritten or
interrupted histories (409/502). Other Magpie providers are ordinary stateless models
and need nothing special.

- Custom XDG roots and relocated Science data directories are not supported.

## Development and releases

```sh
npm test
npm run check:package
npm run check:release
npm run test:integration  # Offline: temporary HOME, copied package, real deployment path
```

`npm run check:package` validates the exact `npm pack --dry-run` surface: the accepted runtime module, the file allowlist, and the absence of secrets, state, authentication, session dumps, logs and binaries. `check:release` runs the same checks plus `node --check` on the entrypoints. The integration test needs no Magpie, Claude Science or network access.

CI tests Node 22/24 on Linux/macOS, the packed/deployed CLI and a pinned Magpie version. Release Please prepares a version and [CHANGELOG](CHANGELOG.md) PR from conventional commits. You review and merge it; the same workflow creates a GitHub Release, tests that exact commit and waits for `npm` environment approval before publishing through OIDC. Manual tag dispatch remains available for recovery. See [release setup (中文)](docs/publishing.md).

Report bugs through [Issues](https://github.com/Guuuu233/magpie-claude-science/issues), including versions, `doctor` output and reproduction steps. Omit credentials and private logs. See [operations (中文)](docs/operations.zh-CN.md) and [Magpie's guide](https://usemagpie.ai/docs/plugins).

## License

[MIT](LICENSE). Independent community project; not affiliated with Anthropic or Magpie.

The Claude Science icon belongs to its respective owner and is excluded from the MIT license.
