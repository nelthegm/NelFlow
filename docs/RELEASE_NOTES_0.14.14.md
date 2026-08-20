# Nelflow 0.14.14 — PF2e Toolbelt 3.54.1 compatibility

Nelflow 0.14.14 restores the existing Target Helper basic-save integration for
PF2e Toolbelt **3.54.1**. The supported range is now exactly **3.52.0–3.54.1**.
Toolbelt 3.54.2 and later remain unsupported until explicitly audited.

## Official source audit

The audit compared the official `reonZ/pf2e-toolbelt` tags directly:

- 3.54.0: `dbbfe2e30e8ac22388057e6edd8dfd95be9df440`
- 3.54.1: `158d26ba7394b26f945c7807545e675822855eb4`

The only 3.54.1 Target Helper source change adds a user-scoped color-blind
palette setting and a body CSS class. Other release changes are CSS,
localization, release notes, and Foundry/PF2e compatibility metadata. The
durable schemas, save/reroll writers, damage projection, and same-message update
lifecycle consumed by Nelflow are byte-identical.

## Durable contract matrix

| Nelflow-consumed contract | Toolbelt 3.54.0 | Toolbelt 3.54.1 | Result |
| --- | --- | --- | --- |
| Flag namespace | `flags.pf2e-toolbelt.targetHelper` | Same | Unchanged |
| Save variants | `targetHelper.saveVariants[variantId]` | Same | Unchanged |
| Variant fields | `statistic`, `dc`, `basic`, `saves` | Same | Unchanged |
| Target identity | ordered token UUIDs in `targets`; save key is token ID | Same | Unchanged |
| Per-target save | `saveVariants[id].saves[tokenId]` | Same | Unchanged |
| Natural die | finite `die` (1–20) | Same | Unchanged |
| Total | finite `value` | Same | Unchanged |
| Degree | canonical `success` | Same | Unchanged |
| Modifiers | `modifiers[]` with `excluded`, `label`, `modifier`, `slug` | Same | Unchanged |
| Privacy | boolean `private` | Same | Unchanged |
| Reroll | optional `rerolled`; serialized `roll` replaced with kept roll | Same | Unchanged |
| Fingerprint source | `success` + `rerolled` + serialized `roll` | Same | Unchanged |
| Applied damage marker | `applied[targetId][rollIndex]` | Same | Unchanged |
| Save lifecycle | save callback builds durable result, queued update writes same ChatMessage | Same | Unchanged |
| Reroll lifecycle | reroll replaces that target's durable save on same ChatMessage | Same | Unchanged |
| Damage/apply controls | same structured Target Helper data and applied marker | Same; palette-only rendering change | Compatible |

No field moved or changed meaning. No adapter alias or fallback was added.

## Diagnostics

`game.nelflow.dev.getStatus().toolbelt` and
`game.nelflow.dev.getBasicSavePresentationStatus()` now report:

```js
{
  version: "3.54.1",
  supported: true,
  supportedRange: "3.52.0 - 3.54.1",
  targetHelperAvailable: true,
  schemaCompatibility: "3.54.1-audited"
}
```

Unsupported future versions still fail open to manual Target Helper controls
and retain the existing warning.

## Preserved behavior

- Toolbelt remains observe-only; Nelflow reads durable message flags and does
  not patch/fork Toolbelt or call its private APIs.
- `basicSavePresentation` remains protocol **3**, with unchanged resolved,
  applying, and applied hooks/payloads.
- The applying stage remains immediately before PF2e's existing application
  commit; applied damage remains actual normal plus temporary HP loss afterward.
- PF2e remains authoritative for save multipliers, IWR, and HP mutation.
- Multi-target identity, reroll fingerprinting, privacy suppression, guarded
  Undo, NelCine consumers, Strike protocol 4, spell-attack protocol 1, healing
  protocol 1, and `nelflow.damageApplied` remain unchanged.
- Existing local spell-attack runtime repairs and hardening are included and
  preserved as separate commits.

Foundry/Forge runtime acceptance is still required; follow
[`NELFLOW_0.14.14_TEST_PLAN.md`](NELFLOW_0.14.14_TEST_PLAN.md).
