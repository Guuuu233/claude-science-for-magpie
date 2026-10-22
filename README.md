> **Community fork** of the MIT-licensed project by Sia ([shiyang1026/magpie-claude-science](https://github.com/shiyang1026/magpie-claude-science)). Install it from Magpie Plugins or from this repository's GitHub Releases. The npm package `magpie-claude-science@latest` is the upstream project, **not this fork**; this fork is not published to npm.

# Claude Science for Magpie

English · [简体中文](README.zh-CN.md)

[![CI](https://github.com/Guuuu233/claude-science-for-magpie/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Guuuu233/claude-science-for-magpie/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/Guuuu233/claude-science-for-magpie)](https://github.com/Guuuu233/claude-science-for-magpie/releases)

Use Magpie's models in the Claude Science app, keeping the original macOS app and icon. Install **Claude Science for Magpie** from **Magpie → Plugins**: local setup runs by itself, and later plugin updates are applied while Science is idle. Then pick models under **Magpie → Agents → Claude Science for Magpie** and open Science as usual.

**Experimental.** An Agent plugin, scoped middleware and a locally managed background service. No CSP required. In daily use with Science **0.1.60** and Magpie **0.1.1318**.

## Quick start

Requires **macOS**, an official Node.js **22+**, the installed **Claude Science.app**, and a working Magpie gateway with at least one model. The plugin sets up the local bridge, **not Claude Science itself**.

1. **Quit Claude Science** — the window and any `claude-science` background process. Setup never stops a running Science: if one is running it skips and notes why in `~/.config/magpie/claude-science-runtime/autoinstall.log`; quit Science, then turn the plugin off and on again.
2. **Install the plugin.** In **Magpie → Plugins → Discover → Unofficial, on GitHub**, find **Guuuu233/claude-science-for-magpie** and install it, or add `github:Guuuu233/claude-science-for-magpie` in Magpie's manual GitHub installer. Leave out a `#tag`: a tag never moves, so Magpie would never offer an update. (The repository was called `Guuuu233/magpie-claude-science` before v0.2.4; installs from that address keep updating through GitHub's redirect.)
3. **Open Claude Science.app** once setup has finished. The first “Sign in” confirms a local browser session, not an Anthropic login. Setup picks a `claude-tui/claude-opus-*` model when there is one, otherwise another Claude TUI model or the first enabled model: **review it on Magpie's Agents page.** If something fails, read `autoinstall.log`.

Setup checks for Node.js 22+ (including nvm, asdf, mise and Volta installs that the desktop app's short PATH misses), copies its runtime, production dependencies and Node into a private release directory, and runs it as a macOS LaunchAgent; the service does not depend on the plugin folder. Node builds linked to external libraries, such as some Homebrew builds, are refused.

### Updates

When the main branch has a new release, Magpie shows an update under **Plugins** (or run `magpie plugin update`). After updating, the plugin replaces its local service only while Science is idle: the Science window is closed, no model request is open, and none ran in the last 10 minutes. Until then it checks again every 5 minutes and never interrupts a task. Sessions, login and your `science.toml` settings are kept; if the new service does not start, the previous one is restored. Progress is logged to `autoinstall.log`.

Installed earlier with a `#v0.2.x` tag? Add the plugin once more without the tag to receive updates. Installations made from a Release package or source checkout are not updated automatically; run `node src/cli.js upgrade` there.

### Terminal setup (alternative)

To manage the installation yourself, start Magpie, finish active Science tasks and install a fixed release:

```sh
mkdir -p claude-science-for-magpie && cd claude-science-for-magpie
curl -fL https://github.com/Guuuu233/claude-science-for-magpie/releases/download/v0.2.4/claude-science-for-magpie-0.2.4.tgz -o science.tgz
tar -xzf science.tgz
cd package
npm install --omit=dev --ignore-scripts
node src/cli.js install
```

Or from the source tag:

```sh
git clone --branch v0.2.4 --depth 1 https://github.com/Guuuu233/claude-science-for-magpie.git
cd claude-science-for-magpie
npm ci --ignore-scripts
node src/cli.js install
```

Choose a model when prompted; for unattended setup, pass `--model` with an ID from your Magpie catalog. The installer reads Magpie's gateway port and picks free local ports; overrides are listed by `node src/cli.js --help`. Once it reports `Installed`, reopen **Claude Science.app** and close the old login tab. Do not reuse a bookmark pointing to an old port.

### Sign in leads to “Sign in on the web” / “Paste code instead”

That page is Science's account login flow: the local service is not answering. Run `doctor`; an existing browser login is not evidence of a working setup. For a plugin install, run it from the installed release:

```sh
R=~/.config/magpie/claude-science-runtime; P=$(node -p "require('$R/state.json').pluginSpec"); "$P/bin/node" "$P/src/cli.js" doctor
```

For a terminal setup, run `node src/cli.js doctor` in its `package/` directory or source checkout. If the service is not initialized, see `autoinstall.log` (plugin) or run `install` (terminal). If it is installed, check the service state and `sciencePort`, then reopen the app. A port such as `localhost:8765` alone does not show whether setup succeeded. When asking for help, share the `doctor` summary, not tokens, full private logs or `state.json`.

## Local target, not a VPS

This plugin drives the original **Claude Science.app** through a loopback compatibility service. It connects only to a literal loopback Magpie gateway (`127.0.0.1` or `[::1]`, read from Magpie's own settings or supplied with `--gateway`) and never to a remote endpoint. It is therefore **not tied to a specific VPS**: any locally running, compatible Magpie provider can serve the selected model. The package ships no server addresses, credentials or VPS material.

## Manage

All lifecycle commands come from `src/cli.js` (for a plugin install, use the `"$P/bin/node" "$P/src/cli.js"` form shown above):

```sh
node src/cli.js install    # First-time setup from a Release package or source checkout
node src/cli.js upgrade    # Prepare a new release from the updated checkout/package
node src/cli.js doctor     # Show runtime, model, gateway, service and deployment checksum state
node src/cli.js restart    # Restart the managed service after finishing Science tasks
node src/cli.js rollback   # Switch back to the previous managed runtime release
node src/cli.js uninstall  # Stop the service, restore original config; retain session data
```

Do not use the upstream npm package for these. Stop active Science tasks before lifecycle changes. Upgrade preserves local identity, sessions and `science.toml` settings, and restores the previous service if startup fails. Migrating an early checkout-based installation is supported through `upgrade`; `rollback` needs a previous managed release.

## How it works

```text
Claude Science → local compatibility service → Magpie → selected provider/model
```

Data, local identity and versioned runtime files live under `~/.config/magpie/claude-science-runtime/`. Original credentials and app binaries are preserved. The original config is redirected only after an owned Science daemon passes readiness checks. Disabling or uninstalling restores it; conflicting user edits are retained for manual resolution.

Science keeps a copy of the profile's local encryption keys in the macOS Keychain (service `com.anthropic.operon-cli`) and prefers it over `auth/encryption.key`: it rewrites that file from the Keychain when the two differ. Do not edit or delete either by hand.

## Limitations

- Science lists every model in your Magpie catalog. Claude TUI models appear under their Claude names (`claude-opus-5-5`, ...) and run on the provider chosen with `install --claude <provider>` (default `claude-tui`, the Claude TUI plugin on this Magpie; a remote Magpie's is e.g. `my-vps/claude-tui`). Science only shows ids starting with `claude-`, so every other model appears under a stable alias `claude-x-<id>-<hash>` with its Magpie name, and runs on that Magpie model.
- Long Science conversations on Claude TUI models need [Claude TUI Boost](https://github.com/Guuuu233/claude-tui-boost) **v0.2.12 or newer**, which serves each conversation from its own history. Earlier 0.2.x runtimes refuse rewritten or interrupted histories (409/502). Other Magpie providers are ordinary stateless models and need nothing special.
- Anthropic-hosted search, MCP and account services are not provided.
- Full scientific workflows, long sessions and image support remain unverified.
- Owned-orphan recovery and executable-change detection have automated tests. Real macOS reboot races and future Science versions still need validation. Finish current tasks before restarting after a Science update.
- Custom XDG roots and relocated Science data directories are not supported.

## Development and releases

```sh
npm test
npm run check:package
npm run check:release
npm run test:integration  # Offline: temporary HOME, copied package, real deployment path
```

`npm run check:package` validates the exact `npm pack --dry-run` surface: the accepted runtime module, the file allowlist, and the absence of secrets, state, authentication, session dumps, logs and binaries. `check:release` runs the same checks plus `node --check` on the entrypoints. The integration test needs no Magpie, Claude Science or network access.

CI validates the package and integration paths. Releases are tagged on main and published as reviewed GitHub release assets; main is kept at the latest release, which is what Magpie installs and updates to. There is no npm publishing; the upstream npm name belongs to its original maintainer. See [publishing policy](docs/publishing.md).

Report bugs through [Issues](https://github.com/Guuuu233/claude-science-for-magpie/issues), including versions, `doctor` output and reproduction steps. Omit credentials and private logs. See [operations (中文)](docs/operations.zh-CN.md) and [Magpie's guide](https://usemagpie.ai/docs/plugins).

## License

[MIT](LICENSE). Independent community project; not affiliated with Anthropic or Magpie.

The Claude Science icon belongs to its respective owner and is excluded from the MIT license.
