# dsh-span-compaction

English | [简体中文](README.zh.md)

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)

A DSH compaction engine that keeps one summarization call inside a replay budget.

The stock engine (`@deepseek-ai/dsh-compaction-basic`) selects everything between
the surface head and the retained tail, then replays that whole span as the
summarization request. On a long session that request carries the entire
uncompacted history, so any lane that refuses oversized side requests rejects it
before forwarding — the pass fails, the retry loop fires again one minute later
with an even longer history, and the conversation never gets compacted.

By default, this plugin narrows each automatic pass to a balanced prefix of the selected span based on the `spanBudgetTokens` replay budget. Each pass commits a normal durable compaction, so repeated passes converge. Set the budget to `0` to use the full span selected by the stock engine.

It also exposes two model-facing tools (`compact_targets`, `compact`) so the model
can compact a chosen span with a summary it writes itself — no auxiliary
summarization request is sent. A pressure nudge reminds the model when context
grows large. Automatic compaction stays enabled as an overflow safety net.

## What it changes

Only the span a pass is allowed to replay. Range selection, retention policy,
stability checks, shadow pricing, the checkpoint message and the commit path are
all the stock ones — this is a subclass of `BasicCompactionEngine`, not a
reimplementation, so `/compact`, pressure compaction and overflow recovery keep
working.

## Install

```sh
dsh plugin --profile web add github:Mooling0602/dsh-span-compaction
```

Replace `web` with the profile you use. The repository ships the compiled
JavaScript — `dists/index.js` for the Host half and `dist/client.js` for the
browser half — so the install runs no build step and needs no Node toolchain on
this machine. The committed output is byte for byte what `npm run build`
produces.

In the graphical plugin installer you only need to enter
`github:Mooling0602/dsh-span-compaction` and confirm.

To remove it:

```sh
dsh plugin --profile web remove dsh-span-compaction
```

Restart the service afterwards. The bundle patch installs one entry, which is
also the one that registers the model-facing tools and the nudge, and disables the
profile-level stock engine:

```yaml
- insert:
    - id: span-compaction
      name: dsh-span-compaction
- id: compaction-basic
  disabled: true
```

Everything the plugin mounts lives on that single row on purpose: a package may be
the source of only one client module row, and `client-modules` refuses a package
that two active rows resolve to, so a second hooks row would silently cost the
bundle its settings page.

The profile-level stock engine must be disabled so Span Compaction can own the `compaction` service. Setting `auto: false` only stops the stock engine's pressure and overflow listeners; it still registers the service. Profile patches cannot target engine rows nested in agent presets. The preset gate replaces those rows separately, preserving their `auto` settings.

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-compaction`,
`@deepseek-ai/dsh-compaction-basic` and `@deepseek-ai/schemastery` are
peer dependencies: the runtime resolves them from the installation scope, so the
plugin tracks the host version instead of pinning its own copy.

## Taking over preset engines

A profile patch cannot address entries nested inside an agent preset, and every
session's engine lives in a preset group that isolates the `compaction` service.
The plugin therefore watches the `internal/config` waterfall and renames stock
engine rows to itself before the loader mounts them. Pass
`takeoverPresets: false` to keep the stock engine for presets and only mount this
entry where the profile names it explicitly.

Rows inside an isolated compaction group are renamed even when the host marked
them `disabled`, because that mark is what this plugin is there to override. Rows
anywhere else are renamed only when the host left them enabled.

## Note on request-layer proxies

A proxy that folds requests on the way out (billion-context's `bili-native`) and
a surface engine compact the same session in two different places. Only one of
them can own that decision: the surface engine rewrites what the session itself
derives, so every consumer — periodic reports, subagents, replay — sees the
compacted history, while a request-layer fold is invisible to all of them. Mount
this plugin and remove the competing proxy compressor from
`dsh.profile.bundles`; the plugin logs a warning when both are running.

## Model-driven compaction

Two tools are registered globally by the shallowest plugin entry:

| Tool | Purpose |
| --- | --- |
| `compact_targets` | Report the session's total price plus two views of the finished history: `ranges` are ready-made contiguous blocks that together cover it (start/end, node count, priced tokens), and `targets` are the 40 largest single safe cut points. `compactableTokens` is the honest priced total of that history; the current turn is excluded from both lists. Neither list is the limit: `compact` accepts any balanced range. |
| `compact` | Commit any chosen range using a summary the model writes in the `summary` argument, via the native compaction transaction. One large completed block beats many small nodes; a span smaller than its summary is a net loss. |

The model-written summary is fed to `BasicCompactionEngine.summarize()` through a
one-shot per-agent queue, so the full commit path (balance checks, shrink check,
checkpoint framing, surface replace) still runs — but no extra LLM request is
issued just to condense history. This is what avoids the oversized-summary
request that fails on strict proxies. The automatic engine and `/compact` are
unchanged; the model-driven path simply adds a second, model-controlled way in.

`shadowedTokens` in the tool result is the **gross** price of the replaced span.
The summary is written back into the surface, so the net reduction is that price
minus the summary itself. Compacting a few thousand priced tokens with a long
summary can move the session total by only a percent; pick a span that is much
larger than the summary you can write for it.

A pre-step nudge (`<span-compaction-reminder>`) quotes the context reading once priced context crosses `nudgeRatio` of the model window **and** `nudgeMinTokens`. If compaction would interrupt work or the user declines that attempt, it tells the model to finish the task and recheck older eligible history before the final reply. The model can try once at that point through the normal approval flow, unless the user asked it not to retry. The nudge never runs compaction itself and is rate-limited by `nudgeEverySteps` plus a pressure-delta guard. Steps count across turns even though each turn's step numbering restarts at 1.

## Configuration

Every setting lives on the one `span-compaction` entry, so there is one namespace
and one form. The page is the bundle's own configuration on its card in
**Plugins** — a `plugins.bundle.config` entry keyed by the package name, rendered
between the description and the component list, so it is outside the components
and needs no drilling into one. It is built from the official settings primitives:
each control stages a draft, and one save writes them all inside a single
revision-fenced mutation. Leaving the page drops whatever was not saved.

| Key | Default | Meaning |
| --- | --- | --- |
| `spanBudgetTokens` | `160000` | Replay budget in route-priced tokens per automatic pass. Set `0` to disable this budget. |
| `thresholdRatio` | `0.8` | Share of the routed model's context window at which a step-boundary automatic compaction runs. |
| `toolsEnabled` | `true` | Register the `compact_targets` / `compact` tools. |
| `nudgeEnabled` | `true` | Inject the context-pressure reminder. |
| `nudgeRatio` | `0.2` | Fraction of the model window that starts the reminder. |
| `nudgeMinTokens` | `100000` | Absolute token floor below which no reminder fires. |
| `nudgeEverySteps` | `10` | Minimum admitted steps between two reminders for one agent. |
| `approveCompact` | `true` | Ask for consent before the model runs `compact`; Full access never prompts. |
| `exemptTargets` | `true` | Let `compact_targets` bypass downstream pre-execute policy, including Auto review. |

Automatic compaction fires when the priced context reaches `thresholdRatio` of
the *routed model's declared* window. That window is often much larger than a
real session: the stock DeepSeek adapter declares 1,048,576 tokens for
`deepseek-flash`, which puts `0.8` near 840,000 tokens. A single session reaches
the reminder (0.2 of the window, or `nudgeMinTokens`) long before it reaches the
automatic pass, so lower `thresholdRatio` when automatic passes should happen on
ordinary sessions.

The keys are flat because the shared form model addresses a control by its own
field name inside the section; a nested object would have no control that could
edit it. Every key is volatile, so a save applies to the next step or the next
compaction pass without restarting the entry.

### Approval gate

`compact` replaces retained history, so under an interactive approval policy the
model now waits for your consent before the call runs. The gate is the outermost
`tools/pre-execute` listener and reads the session's approval policy: Full access
(`never`) keeps its no-prompt contract, and every `ask` preset — including Auto —
shows the approval card. `compact_targets` is exempt instead: it only lists
candidates, so it skips the whole downstream chain, including the Auto review
request that would otherwise resend the retained history for every listing.
`approveCompact` and `exemptTargets` turn either half off.

Every stock engine key still applies and can be set in `cordis.patch.yml`:

```yaml
- id: span-compaction
  name: dsh-span-compaction
  config:
    spanBudgetTokens: 120000
    thresholdRatio: 0.7
```

Leaving `spanBudgetTokens` unset uses the default of `160000`. Setting it to `0` removes the replay limit on the first attempt. If the budget is `0` or above the default and automatic compaction fails without cancellation or a history replacement, the plugin retries once at the default without changing the saved setting. Budgets from `1` through `160000` do not get this extra retry. Model and proxy limits still apply; automatic thresholds, retention, manual `/compact`, and model-authored `compact` are unchanged.

### What a saved setting changes

Only the fields above are live: a save updates the running plugin in place. The
budget reaches every Span engine in the runtime, including the ones the preset
takeover installed, because the profile entry publishes it and each pass reads it
instead of the value captured when the preset was mounted. Tools and reminder
thresholds are read on every step.

Three limits are worth knowing:

- The budget bounds the replayed region of an **automatic** pass. It is not a cap
  on the whole request (system prompt, tool schemas and the retained tail are
  outside it) and it does not limit the manual `/compact`, which keeps the stock
  whole-range selection.
- A reminder is a suggestion to the model. It never compacts anything, and it is
  suppressed while the tools are disabled, because there would be nothing for the
  model to call.
- A reminder needs both `nudgeRatio` of the window and `nudgeMinTokens`; with an
  unknown window it needs twice `nudgeMinTokens`. It also waits `nudgeEverySteps`
  admitted steps and at least 2% growth since the previous reminder. Steps are
  counted across turns, so a turn boundary cannot suppress the next reminder.

## Development and CI

Use Node.js 24.22.3 to reproduce CI locally:

```sh
npm ci --ignore-scripts
npm run check
```

The [CI workflow](.github/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatch. It checks the Host and client builds, type checks, and runs the tests. It then boots each published DSH version admitted by `engines.dsh` with a temporary profile and links the local plugin to verify activation and tool registration. After all checks pass, it attaches an npm tarball to the workflow run without publishing a package or release.
