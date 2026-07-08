# @wanahq/cli

CLI for [Wana](https://wana.shakenokiri.me) — Cloudflare-native crash reporting.

## Install

```sh
npm install -g @wanahq/cli
```

The binary is `wana`.

## Commands

### `wana upload-dif`

Upload Mach-O debug files (`.dSYM` bundles and Xcode 14+ `.debug.dylib` sidecars) so Wana can symbolicate native crash stacks.

The CLI scans for any `.dSYM/Contents/Resources/DWARF/<binary>` and `*.debug.dylib` files under the given path, extracts their Mach-O UUIDs via `dwarfdump`, deduplicates them, and uploads each to the matching project.

```sh
wana upload-dif [path] \
  --dsn "https://<publicKey>@ingest.wana.example/<projectId>" \
  [--git-sha <sha>] [--git-repo <owner/repo>]
```

- `path` defaults to `$DWARF_DSYM_FOLDER_PATH` (set by Xcode at archive time), then `cwd`.
- `--dsn` falls back to `$WANA_DSN`, then `$SENTRY_DSN`.
- `--git-sha` / `--git-repo` default to `git rev-parse HEAD` + `git remote get-url origin`. When present, Wana renders stack frames as deep-links to GitHub at the matching commit.

### Xcode Run Script (recommended)

Add a New Run Script Phase to your iOS / macOS target after **Strip Debug Symbols**:

```sh
if which wana >/dev/null; then
  export WANA_DSN="https://<publicKey>@ingest.wana.example/<projectId>"
  wana upload-dif "$DWARF_DSYM_FOLDER_PATH"
fi
```

Every build / archive now ships its dSYM + git context automatically. Crashes that come in within minutes will have function names and clickable GitHub links.

## Requirements

- macOS with Xcode Command Line Tools installed (the CLI calls `dwarfdump` for UUID extraction).
- Node.js 18+.

## License

MIT
