# Nelflow 0.9.1 — Runtime repair and packaging

## Summary

Repair release restoring automatic NelCine presentation for supported real
Strikes, verifying Toolbelt 3.53.1 Target Helper compatibility, fixing the
damage-claim static-check false positive, correcting stale 0.7.0 install docs,
and producing a local installable ZIP.

## Root cause (Strikes not appearing in NelCine)

Installed worlds still on NelFlow **0.7.0** lack the NelCine bridges. Even in
0.9.0 source, ordinary Strike results were never emitted on
`nelflow.strikeResolved` — only the optional impact-sync broadcast existed, and
it defaults **off**.

## Delivery paths (mutually exclusive)

1. **Presentation only** (`nelcineStrikeCinematics`, default true):
   `Hooks.callAll("nelflow.strikeResolved", payload)`
2. **Impact sync** (`nelcineImpactSync`, default false):
   `broadcastStrike(..., { authoritativeImpact: true })`

One transaction uses exactly one path. Exactly-once delivery is keyed by
transaction ID.

## Toolbelt 3.53.1

Versions **3.52.0–3.53.1** are capability-validated. Changelog review shows
Target Helper flag semantics remain compatible; 3.53.1 only fixes spell DC roll
options. Unverified versions fail open. Debug logging may print:

`NelFlow | Toolbelt 3.53.1 compatibility: supported`

## Packaging

```powershell
npm run package
```

Produces `dist/nelflow-0.9.1.zip` / `dist/nelflow.zip` with `module.json` at
the ZIP root. Published release download:

`https://github.com/nelthegm/NelFlow/releases/download/v0.9.1/nelflow.zip`

Install via Foundry using:

`https://raw.githubusercontent.com/nelthegm/NelFlow/main/module.json`

## Manual test order

See README and `dist/RELEASE_README.txt`. Start with ordinary Strike cinematics
(impact sync Off), then Toolbelt 3.53.1, then optional impact sync / save batch.
