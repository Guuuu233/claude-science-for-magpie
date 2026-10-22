> **Community fork:** based on the original MIT-licensed project by Sia (shiyang1026). The npm package `magpie-claude-science@latest` is **not this fork**. Download this repository’s GitHub Release or install from checked-out source; no automatic npm publishing is enabled.

# Claude Science for Magpie

English · [简体中文](README.zh-CN.md)

[![CI](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guuuu233/magpie-claude-science/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Guuuu233/magpie-claude-science)](https://github.com/Guuuu233/magpie-claude-science/releases)

Use Magpie's models in Claude Science while keeping the original macOS app icon. With the new GitHub plugin, install and enable it in **Magpie → Plugins**; local setup starts automatically. Then choose models in **Magpie → Agent → Claude Science** and open Science as usual.

**Experimental.** An Agent plugin, scoped middleware and a locally managed background service. No CSP required. Tested with Science **0.1.60** and Magpie **0.1.1219**.

## Quick start

Requires **macOS**, an official Node.js **22+**, the installed **Claude Science.app**, and a working Magpie gateway with at least one model. The plugin installs the local bridge, **not Claude Science itself**.

**One-click setup (from v0.2.1 onward):** In **Magpie → Plugins → Discover → Unofficial, on GitHub**, locate **Guuuu233/magpie-claude-science** and click Install/Enable. If the repository has not appeared in Discover yet, add `github:Guuuu233/magpie-claude-science#v0.2.1` in Magpie's manual GitHub plugin installer. It can appear in GitHub discovery after the maintainer publishes v0.2.1 and adds the `magpie-plugin` topic. On first enable the local installer picks a model from Magpie's catalog, creates the isolated local service and LaunchAgent, and preserves the original Science configuration for uninstall. **Existing managed installations are not silently replaced.** Reopen Science once setup finishes; check `~/.config/magpie/claude-science-runtime/autoinstall.log` if it fails.

**Safety before enabling:** Quit Claude Science.app and any running `claude-science` background process before installing this GitHub plugin. If Science is running, automatic setup **skips installation without stopping any task** and writes a note to `~/.config/magpie/claude-science-runtime/autoinstall.log`; after quitting Science, disable and re-enable the plugin. The installer checks for **Node.js 22+**, including common nvm/asdf/mise/Volta installations even when the desktop app has a limited PATH. During unattended first setup it prefers a `claude-tui/claude-opus-*` model when available, otherwise another TUI model or the first enabled model. **Review and change the chosen model in Magpie's Agent page.**

**Alternative terminal setup (existing v0.2.0 Release):** For users who prefer the previous explicitly managed installation, start Magpie, finish active Science tasks, and install that fixed version from GitHub:

```sh
mkdir -p magpie-science-lite && cd magpie-science-lite
curl -fL https://github.com/Guuuu233/magpie-claude-science/releases/download/v0.2.0/magpie-claude-science-0.2.0.tgz -o science.tgz
tar -xzf science.tgz
cd package
npm install --omit=dev --ignore-scripts
node src/cli.js install
```

Choose a model when prompted. Once the terminal reports `Installed`, reopen **Claude Science.app** and close the old login tab. Do not reuse a bookmark pointing to the old port.

Alternatively, clone the v0.2.0 source tag:

```sh
git clone --branch v0.2.0 --depth 1 https://github.com/Guuuu233/magpie-claude-science.git
cd magpie-claude-science
npm ci --ignore-scripts
node src/cli.js install
```

Choose a model when prompted. For unattended setup, supply `--model` with an ID from your Magpie catalog. The installer reads Magpie's gateway port and finds available local ports; overrides are listed by `node src/cli.js --help`.

**The v0.2.1 Magpie plugin completes setup automatically on first enable.** The installer creates a macOS LaunchAgent and copies its runtime, production dependencies and Node into a private release directory. The installed service no longer depends on the checkout or npm cache. Node builds linked to external libraries, such as some Homebrew builds, are refused.

Open the original **Claude Science.app**. The first “Sign in” confirms a local browser session, not an Anthropic login. Keep Magpie running and select models from its Agent page.

### Sign in leads to Sign in on the web / Paste code instead

That page is Science's account login flow. Check whether local setup completed; existing browser login state is not evidence of a successful installation:

```sh
node src/cli.js doctor  # From the GitHub Release package/ or cloned repository
```

If the local service is not initialized, run `install` above. If installed, check the service state and `sciencePort` in the output, then reopen the app to reach the managed service. A port such as `localhost:8765` alone does not establish whether setup succeeded. If `doctor` reports an error, share its summary, not tokens, full private logs, or `state.json`.

## Local target, not a VPS

This plugin drives the original **Claude Science.app** through a loopback compatibility service. It connects only to a literal loopback Magpie gateway (`127.0.0.1` or `[::1]`, read from Magpie's own settings or supplied with `--gateway`) and never to a remote endpoint. It is therefore **not tied to a specific VPS**: any locally running, compatible Magpie provider can serve the selected model. The package ships no server addresses, credentials, or VPS material.

## Manage

All lifecycle commands come from `src/cli.js`:

```sh
node src/cli.js install    # First-time setup (run in this fork's release package or source checkout)
node src/cli.js upgrade    # Prepare a new release from the updated checkout/package
node src/cli.js doctor     # Show runtime, model, gateway, service and deployment checksum state
node src/cli.js restart    # Restart the managed service after finishing Science tasks
node src/cli.js rollback   # Switch back to the previous managed runtime release
node src/cli.js uninstall  # Stop the service, restore original config; retain session data
```

Run lifecycle commands from this fork's extracted GitHub Release package or source checkout, using `node src/cli.js <command>`; do not use the upstream npm package. Keep that directory or obtain the matching version from GitHub when you need to manage the installation. Stop active Science tasks before lifecycle changes. Upgrade preserves local identity and sessions and restores the previous service if startup fails. Migrating an early checkout-based installation is supported through `upgrade`; a previous managed release is required for `rollback`.

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

CI validates the package and integration paths. Releases for this fork are published as reviewed GitHub release assets; this repository has no automatic npm publishing workflow, and the upstream npm name belongs to its original maintainer. See [publishing policy](docs/publishing.md).

Report bugs through [Issues](https://github.com/Guuuu233/magpie-claude-science/issues), including versions, `doctor` output and reproduction steps. Omit credentials and private logs. See [operations (中文)](docs/operations.zh-CN.md) and [Magpie's guide](https://usemagpie.ai/docs/plugins).

## License

[MIT](LICENSE). Independent community project; not affiliated with Anthropic or Magpie.

The Claude Science icon belongs to its respective owner and is excluded from the MIT license.
