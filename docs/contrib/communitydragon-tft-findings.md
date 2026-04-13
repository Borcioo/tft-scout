# TFT data extraction — notes from a downstream consumer

> A collection of empirical findings we hit while building a TFT data
> importer on top of CommunityDragon. Sharing them upstream because
> several aren't in `CommunityDragon/Docs`, `CommunityDragon/Data`
> hashlists, or `cdtb` source — and a few might be straightforward
> wins for everyone consuming TFT data.
>
> We don't import via Python or use `cdtb` as a runtime dependency,
> so a bunch of this is "stuff we re-discovered the hard way" that
> probably already lives in maintainer heads. Treat it as input,
> not criticism — CDragon is the only reason any of this is feasible
> in the first place. Happy to file PRs against `CommunityDragon/Data`
> or `CommunityDragon/Docs` for any of the findings below if useful.

Game scope: TFT Set 17 (PBE, April 2026). Some findings will apply to
older sets as well; called out where verified.

## Table of contents

1. [TFT character data path](#1-tft-character-data-path)
2. [Trait reference binpath pattern](#2-trait-reference-binpath-pattern-mlinkedtraits)
3. [TraitClone "form selection" mechanism](#3-traitclone-form-selection-mechanism)
4. [Hero Augment alternative spells](#4-hero-augment-alternative-spells)
5. [Universal CharacterRecord stat field hashes](#5-universal-characterrecord-stat-field-hashes)
6. [Undocumented mSpellCalculations node types](#6-undocumented-mspellcalculations-node-types)
7. [`SubPartScaledProportionalToStat` AP scaling convention](#7-subpartscaledproportionaltostat-ap-scaling-convention)
8. [`mStat` enum mapping (partial)](#8-mstat-enum-mapping-partial)
9. [TFT BIN array slot convention (star levels)](#9-tft-bin-array-slot-convention-star-levels)
10. [Spell loc keys live as plaintext](#10-spell-loc-keys-live-as-plaintext)
11. [Riot template bugs spotted in stringtable](#11-riot-template-bugs-spotted-in-stringtable)
12. [Suggested hashlist additions](#12-suggested-hashlist-additions)

---

## 1. TFT character data path

CDragon's `assets.md` says:

> Detailed champion data are available in bin files, usually from
> `game/data/characters/<name>/<name>.bin.json`.

That's true for LoL champions and historically true for older TFT sets,
but TFT17 PBE characters do **not** have a `<name>.bin.json` at the
root of `game/data/characters/{name}/`. Only `skins/` and `animations/`
subdirectories, and `skins/skin0.bin.json` is overwhelmingly VFX data —
no `TFTCharacterRecord`, no `mLinkedTraits`, no useful spell objects.

The actually useful file lives at:

```
game/characters/{name_lowercase}.cdtb.bin.json
```

Note: parallel `game/characters/` tree (no `data/`), `.cdtb.bin.json`
suffix. Examples:

```
game/characters/tft17_aatrox.cdtb.bin.json
game/characters/tft17_missfortune.cdtb.bin.json
game/characters/tft17_missfortune_traitclone.cdtb.bin.json
```

Each file is ~25 KB and contains in one place:
- The `TFTCharacterRecord` (top-level `__type`)
- Every `SpellObject` for the champion (primary, hero augment, basic
  attacks, missiles, helpers — typically 5–14 entries)
- All `mSpell.DataValues` and `mSpellCalculations`
- `mClientData.mTooltipData.mLocKeys` for each spell

For consumers like us this is *the* file you want. Suggestion: a small
note in `assets.md` pointing TFT integrators at `game/characters/` with
the `.cdtb.bin.json` suffix would save people from spelunking through
`skins/skin0.bin.json` looking for things that aren't there.

A directory listing to quickly enumerate what's in there:

```
GET https://raw.communitydragon.org/json/{channel}/game/characters/
```

(filter by `tft{N}_` prefix client-side).

---

## 2. Trait reference binpath pattern (`mLinkedTraits`)

A `TFTCharacterRecord` carries an `mLinkedTraits[]` list of
`TFTTraitContributionData` entries:

```json
"mLinkedTraits": [
    { "TraitData": "{e57dbbed}", "__type": "TFTTraitContributionData" },
    { "TraitData": "{15312cd7}", "__type": "TFTTraitContributionData" }
]
```

Those `TraitData` hashes don't appear in `hashes.binentries.txt`,
`hashes.binhashes.txt`, `hashes.binfields.txt`, or `hashes.bintypes.txt`
(checked Apr 2026 snapshot). They're computed via FNV-1a 32 lowercase
of an unusual binpath:

```
Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/{trait_api_name}
```

Verification (TFT17 Aatrox):

| `TraitData` hash | Pre-image (lowercased FNV-1a 32 input) | api_name |
|---|---|---|
| `{e57dbbed}` | `Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_DRX` | `TFT17_DRX` |
| `{15312cd7}` | `Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_ResistTank` | `TFT17_ResistTank` |

5/5 hits across Miss Fortune (5 main + clone refs), 2/2 across Aatrox,
2/2 across Jinx, plus matches for every other TFT17 champion with
linked traits we tested.

**Suggested addition to `hashes.binentries.txt`** — one line per TFT17
trait api_name:

```
e57dbbed Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_DRX
15312cd7 Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_ResistTank
50b1701f Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_MissFortuneUniqueTrait
97b1fb0a Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_MissFortuneUndeterminedTrait
c09777da Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_ManaTrait
1d6a1207 Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_ASTrait
8c63e914 Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_APTrait
... (full list ~44 entries for TFT17, derivable from any en_us.json trait list)
```

Generation snippet (any language):

```
for trait_api_name in tft17_trait_api_names:
    binpath = f"Maps/Shipping/Map22/Sets/TFTSet17/Traits/{trait_api_name}"
    h = fnv1a32(binpath.lower())
    print(f"{h:08x} {binpath}")
```

We don't know if Riot uses the same `Maps/Shipping/Map22/Sets/TFTSet{N}/Traits/`
layout for older sets — would be worth verifying against TFT15 / TFT16
trait references.

---

## 3. TraitClone "form selection" mechanism

Some champions ship a sibling bin file:

```
game/characters/{api_name_lower}_traitclone.cdtb.bin.json
```

This second file holds another `TFTCharacterRecord` that the game uses
as a virtual entity to encode "pick one of N traits" mechanics — TFT15
Lee Sin and TFT17 Miss Fortune are the two confirmed cases.

Detection rule: HEAD request `{api_name}_TraitClone.cdtb.bin.json`. 200
→ champion has selectable form variants.

The clone's `mLinkedTraits` lists the selectable variants. For Miss
Fortune Set 17:

```
TFT17_ManaTrait    → Conduit Mode
TFT17_ASTrait      → Challenger Mode
TFT17_APTrait      → Replicator Mode
```

The clone usually has dummy assets (`Cube.skn`, recycled animation
graphs) — it's never spawned on the board in its own form, just used
as a data carrier for the variant trait list.

Each variant trait then maps to a stance spell **inside the main
character bin**, named `{primary_script_name}_{StanceName}`:

```
TFT17_MissFortuneSpell_ManaTraitStance     ← Conduit
TFT17_MissFortuneSpell_ASTraitStance       ← Challenger
TFT17_MissFortuneSpell_FlexTraitStance     ← Replicator
```

Note the Riot internal name "FlexTraitStance" doesn't directly match
the trait `TFT17_APTrait` — there's no consistent naming convention
linking variant trait → stance spell name. Consumers need a manual
mapping or have to inspect the spell's loc keys to figure it out.

User-facing variant names live in `tft.stringtable.json`:

```
Spell_TFT17_MissFortuneSpell_ManaTraitStance_Name → "Conduit Mode"
Spell_TFT17_MissFortuneSpell_ASTraitStance_Name   → "Challenger Mode"
Spell_TFT17_MissFortuneSpell_FlexTraitStance_Name → "Replicator Mode"
```

Each stance has its own `mClientData.mTooltipData.mLocKeys` so the
descriptions resolve via the standard RST hash → stringtable path.

---

## 4. Hero Augment alternative spells

A separate variant mechanism that lives **inside** the main character
bin (no sibling file). Detection: a `SpellObject` with `mScriptName`
ending in `Hero` next to the primary spell.

Example for TFT17 Aatrox:

```
TFT17_AatroxSpell        ← primary, "Stellar Slash"
TFT17_AatroxSpellHero    ← hero augment alt, "Stellar Combo"
```

The hero spell is fully separate: own `mClientData.mTooltipData.mLocKeys`,
own `DataValues`, own `mSpellCalculations`, often with completely
different mechanics (Aatrox's is a rotating Strike/Sweep/Slam combo).

Verified champions with hero spells in TFT17:

```
TFT17_Aatrox       → TFT17_AatroxSpellHero       (Stellar Combo)
TFT17_Gragas       → TFT17_GragasSpellHero       (Self Destruct)
TFT17_Jax          → TFT17_JaxSpellHero          (Reach for the Stars)
TFT17_Nasus        → TFT17_NasusSpellHero        (Bonk!)
TFT17_Poppy        → TFT17_PoppySpellHero        (Termeepnal Velocity)
TFT17_IvernMinion  → TFT17_IvernMinionSpellHero  (The Big Bang)
```

These are unrelated to the DRX trait's N.O.V.A. Strike capstone passive
(which is encoded as a `<ShowIf.TFT17_DRX_CapstoneActive>` block inside
the *primary* spell's description template, not as a separate spell).
A champion can have neither, one, or both: Aatrox has both, Akali has
only DRX trait, Gragas has only Hero Augment, Annie has neither.

---

## 5. Universal CharacterRecord stat field hashes

Both `TFTCharacterRecord` (TFT) and `CharacterRecord` (LoL) share a
set of hashed numeric stat fields wrapped in a `{ce9b917b}` typed
container:

```json
"{8662cf12}": {
    "{b35aa769}": 590.0,
    "__type": "{ce9b917b}"
}
```

`{b35aa769}` is the inner value field — FNV-1a 32 of `baseValue`
(verified, that's the only short candidate that hashes to it).

The container type `{ce9b917b}` and the field hashes themselves are
**not** in `hashes.binfields.txt` / `hashes.bintypes.txt` (Apr 2026).
Empirical mapping verified by cross-referencing LoL Ahri's known base
stats against the value at each hashed field:

| Hash | Stat (semantic) | Verified against |
|---|---|---|
| `{8662cf12}` | base HP | Ahri 590 ✓, MF 650 ✓, Aatrox stays consistent |
| `{4d37af28}` | hp per level | Ahri 104 |
| `{9eedebad}` | hp regen / 5s ÷ 10 (per-second) | Ahri 0.5 |
| `{913157bb}` | hp regen per level | Ahri 0.12 |
| `{4af40dc3}` | base AD | Ahri 53, MF 50 |
| `{e2b5d80d}` | AD per level | Ahri 3 |
| `{ea6100d5}` | base armor | Ahri 21, MF 30 |
| `{18956a21}` | armor per level | Ahri 4.2 |
| `{33c0bf27}` | base spell block (= MR) | Ahri 30, MF 30 |
| `{01262a25}` | MR per level | Ahri 1.3 |
| `{e62d9d92}` | base move speed | Ahri 330, MF 500 |
| `{7bd4b298}` | attack range (units) | Ahri 550, MF 1080 (= 6 hex × 180) |
| `{836cc82a}` | attack speed ratio | Ahri 0.668, MF 0.75 |
| `{4f89c991}` | base attack speed | Ahri 0.625, MF 0.7 |
| `{b9f2b365}` | attack speed per level | Ahri 2.2 |

**Guesses at plaintext names** (none verified by hashing back yet —
none of `baseHP`, `BaseHP`, `mBaseHP`, `mBaseHp`, `baseHealth`,
`mBaseHealth`, `MaxHealth` etc. produce `{8662cf12}` under our FNV-1a
32 implementation). The names probably exist only in compiled C++
code, not in any string literal that survives into the BIN files.

`cdtb/tftdata.py` master branch confirms this — it's hardcoded on the
hash side:

```python
"hp":   hp_struct.getv("BaseValue") if (hp_struct := record.getv(0x8662cf12)) is not None else record.getv("baseHP"),
"damage": damage_struct.getv("BaseValue") if (damage_struct := record.getv(0x4af40dc3)) is not None else record.getv("BaseDamage"),
...
```

If anyone has a way to recover the plaintext field names (string
extraction from `League of Legends.exe`, debug builds, internal docs
leak, anything) those 15 hashes would be a high-value addition to
`hashes.binfields.txt`. Right now every consumer has to either
hardcode the magic numbers or do value-matching against a known
champion to guess them.

We tried `strings` on the live LoL exe (33 MB Windows PE) — 57k
identifier-shaped strings extracted, zero of them hash to any of the
15 targets. The plaintext apparently doesn't survive into the release
binary.

---

## 6. Undocumented mSpellCalculations node types

`hextechdocs.dev` has a brief overview of the calculation tree but
doesn't enumerate node types. We hit several types not covered in
`cdtb/tftdata.py`'s comment header that are necessary to fully
evaluate TFT17 spells:

| `__type` | Shape | Semantics |
|---|---|---|
| `SumOfSubPartsCalculationPart` | `{mSubparts: [...]}` | Sum children |
| `ProductOfSubPartsCalculationPart` | `{mPart1, mPart2}` ⚠ | Binary multiplication. **Note**: uses `mPart1` / `mPart2` keys, not `mSubparts`. Riot naming inconsistency vs Sum/Clamp. |
| `ExponentSubPartsCalculationPart` | `{part1, part2}` ⚠ | `part1 ^ part2`. **Note**: lowercase keys (no `m` prefix), unlike Product's `mPart1` / `mPart2`. Internally inconsistent. |
| `ClampSubPartsCalculationPart` | `{mSubparts, mFloor, mCeiling}` | `clamp(sum(mSubparts), mFloor, mCeiling)`. Either bound can be `null` → unbounded. |
| `SubPartScaledProportionalToStat` | `{mSubpart, mRatio, mStat?}` | See section 7 below |
| `NamedDataValueCalculationPart` | `{mDataValue}` | Direct DataValue lookup, name or hash |
| `NumberCalculationPart` | `{mNumber}` | Literal constant |
| `StatByCoefficientCalculationPart` | `{mStat, mStatFormula, mCoefficient}` | `mCoefficient × championStat[mStat]` |
| `StatBySubPartCalculationPart` | `{mStat, mSubpart}` | Like `StatByCoefficient` but with a calc subtree as the multiplier instead of a flat coefficient. Observed in TFT17 Gragas. |
| `BuffCounterByNamedDataValueCalculationPart` | `{mBuffName, mDataValue}` | Runtime: `current_buff_stack_count × dataValue`. Tooltip semantic: per-stack display value. Observed in Meepsie & Poppy hero spells. |
| `{f3cbe7b2}` (`ByNamedSpellCalculationSubPart`?) | `{mSpellCalculationKey}` | Recursive lookup of another entry in the same `mSpellCalculations` map. Detected by presence of `mSpellCalculationKey` rather than `__type` since the type itself is a hashed name. |

The `__type: "{f3cbe7b2}"` hash is suspicious — could be
`ByNamedSpellCalculationSubPart` or similar but none of the obvious
candidates match. Documentation of this node type would be a real win.

`mDisplayAsPercent: true` on the parent `GameCalculation` is a flag
we observed but don't fully respect yet — when set, the result should
probably be multiplied by 100 for display. Used by Poppy's
`{cb7b0bb4}` calc (which we now reverse-resolve to `ModifiedMeepBonus`).

---

## 7. `SubPartScaledProportionalToStat` AP scaling convention

This node has a subtle two-mode behaviour we figured out by matching
calculator output to MetaTFT's per-star damage breakdowns:

**Mode A — `mStat` present** (e.g. `mStat: 3` for AD-flagged subparts):
`dataValue × mRatio` is **already the displayed flat amount**. No
champion stat multiplication needed at tooltip time. The `mStat` value
is a hint about which stat the damage *conceptually* scales with so
TFT can render the "(scales with AD)" caption — but the numeric value
is already cooked.

**Mode B — `mStat` absent**: `dataValue × mRatio` is a **scaling
coefficient against the implicit base AP stat (= 100 in TFT)**.
Multiply by 100 to get the displayed contribution.

Worked example — Miss Fortune Set 17 Conduit Mode `ModifiedDamagePerSecond`:

```
SubPartScaledProportionalToStat:
    mSubpart.mDataValue = "DamageAD"   → values [_, 65, 100, 155, ...]
    mRatio = 1.0
    mStat = 3                           → mode A → display value = 65/100/155

SubPartScaledProportionalToStat:
    mSubpart.mDataValue = "DamageAP"   → values [_, 10, 15, 25, ...]
    mRatio = 0.01
    (no mStat)                          → mode B → display value = 10/15/25
                                          (= 10 × 0.01 × 100)

Total = SumOfSubParts = 75 / 115 / 180
```

These match MetaTFT's published values for MF Conduit at 1/2/3-star
exactly, which gave us confidence in the convention. Verified the same
pattern across Conduit/Challenger/Replicator and Aatrox.

If we missed the ×100 factor the AP contribution comes out as 0.1
instead of 10 and the total renders nonsensically. Worth documenting.

---

## 8. `mStat` enum mapping (partial)

`StatByCoefficientCalculationPart` and `SubPartScaledProportionalToStat`
both reference an `mStat` integer enum. We've only verified one entry
empirically:

| `mStat` | Stat | Verification |
|---|---|---|
| 4 | attack speed | TFT17 Jinx `ModifiedNumRockets` formula = `BaseBullets + (1/ASPerBullet) × clamp(AS × 1.0, 0, 6.143)`. With Jinx base AS = 0.75: 16 + (1/0.35) × 0.75 = 18.14, matching player-visible "~18 rockets" tooltip. |

Other values we've seen but can't decode without more data:

- `mStat = 1` — appears in subparts referencing armor scaling
  (`DamagePercentArmor` etc.). Possibly "bonus armor" or "total armor".
- `mStat = 3` — appears in subparts referencing AD (`DamageAD`,
  `BaseDamage`). Behaves as "value already in display units" (mode A
  in section 7).
- `mStat = 12` — observed in TFT17 Gragas `ModifiedDamage` sub-calc
  `{a49ddcc9}`. Could be percent of target max HP.
- `mStat = 31` — observed in TFT17 Jinx `{a49ddcc9}` calc with
  `mStatFormula: 2`. Possibly attack range or another stat.

`mStatFormula` enum (0/1/2 observed) — we suspect 0=base, 1=bonus,
2=total but haven't verified.

A documented mapping in `cdtb/tftdata.py` (or hextechdocs) would be
valuable. Even partial — confirming the well-known LoL stat enum
values would help everyone.

---

## 9. TFT BIN array slot convention (star levels)

`DataValues[].values` arrays are always 7 elements long. The TFT17
convention we observed across every champion bin we inspected:

```
values[0]   placeholder / sentinel
values[1]   1-star
values[2]   2-star
values[3]   3-star
values[4]   4-star (Hero Augment / "ascended" form)
values[5]   unused trail
values[6]   unused trail
```

Slot 0 is *not* a meaningful zero-th tier — it's a placeholder that
either:

- Repeats at slots 5/6 as a self-similar sentinel (Miss Fortune,
  Jinx use this — e.g. `[2.5, 65, 100, 155, 265, 2.5, 2.5]`)
- Is a different non-zero value unrelated to the trailing slots
  (Caitlyn — e.g. `[145, 170, 255, 510, 875, 455, 455]`)
- Is literal `0` (legacy TFT en_us.json convention from earlier sets)

In all cases real data starts at `values[1]`. We initially tried to
auto-detect this with several heuristics but eventually just hardcoded
"start at index 1" for TFT17 — every champion we inspected matches.

If this is documented somewhere we missed, please point at it. Otherwise
a one-line note in the wiki saying "TFT 1-star = `values[1]`, slot 0
is a placeholder" would save downstream consumers some experimentation.

---

## 10. Spell loc keys live as plaintext

Inside any `SpellObject.mSpell.mClientData.mTooltipData.mLocKeys`:

```json
{
  "keyName": "Spell_TFT17_MissFortuneSpell_ManaTraitStance_Name",
  "keyTooltip": "Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc"
}
```

These are **plaintext UTF-8 strings**, not hashed. They feed directly
into `tft.stringtable.json` lookup via:

```
xxh3_64(key.lower()) & ((1 << 38) - 1)
```

(38-bit mask for game version >= 15.02).

This is wonderful for downstream consumers: even though the
stringtable's *resolved* keys aren't in `hashes.rst.xxh3.txt` for
fresh PBE content, you don't need them — the spell BIN gives you the
plaintext key, and you compute the hash yourself.

For TFT17 Miss Fortune we resolved 8/8 spell descriptions (main +
3 stance spells, both name and tooltip per spell) this way without a
single entry in the public RST hashlist.

Worth highlighting in the docs as the recommended path for resolving
spell text. Maybe a short snippet in `assets.md` or a dedicated TFT
section.

---

## 11. Riot template bugs spotted in stringtable

While iterating against real templates, we hit one Riot-side bug:

**TFT17 Miss Fortune `Spell_TFT17_MissFortuneSpell_ASTraitStance_Desc`
("Challenger Mode")** has a malformed scale icon marker at the end of
the damage span:

```
"Fire a shot at the target that deals
 <physicalDamage>@ModifiedDamage@&nbsp;(%i:scaleAD%%i:scaleAP)</physicalDamage>
 physical damage and ricochets..."
```

Note `%i:scaleAP)` at the end — the closing `%` before the `)` is
missing. Should be `%i:scaleAP%)`. Other MF mode templates (Conduit,
Replicator) close it properly, and other champions' similar patterns
are all closed.

Probably a copy-paste typo on Riot's content team. Doesn't affect game
runtime since the in-game tooltip system likely tolerates it, but it
does break consumers that parse markers strictly. Worth flagging to
Riot via whatever channel CDragon uses.

We worked around it client-side by inserting a closing `%` when
`%i:\w+` isn't immediately followed by `%` or another word char.

---

## 12. Suggested hashlist additions

If any of the maintainers want concrete PRs to take to
`CommunityDragon/Data`, the highest-leverage additions are:

### 12a. `hashes.binentries.txt` — TFT17 trait binpaths

Generated by hashing each trait api_name from the TFT17 trait list
under the binpath `Maps/Shipping/Map22/Sets/TFTSet17/Traits/{name}`.
~44 entries, all derivable from a single en_us.json fetch.

We can provide a generation script in any language if useful (we
have one in PHP, the algorithm is trivial in Python too).

### 12b. `hashes.binfields.txt` — `baseValue`

```
b35aa769 baseValue
```

One entry. Used as the inner value field of every `{ce9b917b}` stat
container on `CharacterRecord` / `TFTCharacterRecord`.

### 12c. `hashes.binfields.txt` — `TraitData`

```
053a1f33 TraitData
```

The field name on `TFTTraitContributionData` entries inside
`mLinkedTraits`. Already verifiable via FNV-1a 32 of `TraitData`.

### 12d. The 15 universal CharacterRecord stat hashes

These are the hardest because we don't know the plaintext names
(see section 5). If anyone can recover them we can drop them straight
into `hashes.binfields.txt`. Until then they live as magic numbers in
every consumer.

### 12e. `hashes.bintypes.txt` — `{ce9b917b}`

The wrapper class name that holds champion stat values. Plaintext
unknown (none of `BaseStatProvider`, `StatProvider`, `StatOverride`,
`CharacterStatOverride` etc. hash to `{ce9b917b}`).

---

## How to reproduce / verify

We're happy to provide the test scaffolding we used to verify any of
the claims above. Quick recipes:

```bash
# 1. Fetch a champion bin
curl -sS https://raw.communitydragon.org/pbe/game/characters/tft17_aatrox.cdtb.bin.json \
    | python -m json.tool > aatrox.json

# 2. Find the TFTCharacterRecord
python -c "
import json
d = json.load(open('aatrox.json'))
for k, v in d.items():
    if isinstance(v, dict) and v.get('__type') == 'TFTCharacterRecord':
        print(k); print(json.dumps(v, indent=2)[:2000])
        break
"

# 3. List SpellObjects
python -c "
import json
d = json.load(open('aatrox.json'))
for k, v in d.items():
    if isinstance(v, dict) and v.get('__type') == 'SpellObject':
        print(v.get('mScriptName'))
"

# 4. Test the trait binpath FNV match
python -c "
def fnv1a32(s):
    h = 0x811c9dc5
    for b in s.lower().encode():
        h ^= b
        h = (h * 0x01000193) & 0xffffffff
    return f'{{{h:08x}}}'
print(fnv1a32('Maps/Shipping/Map22/Sets/TFTSet17/Traits/TFT17_DRX'))
# → {e57dbbed}, matches Aatrox mLinkedTraits[0].TraitData
"

# 5. Stringtable lookup via xxh3 (needs the xxhash library)
python -c "
from xxhash import xxh3_64_intdigest
key = 'Spell_TFT17_MissFortuneSpell_ManaTraitStance_Desc'
h = xxh3_64_intdigest(key.lower()) & ((1 << 38) - 1)
print(f'{{{h:010x}}}')   # → {0644ef3f06}, lookup in tft.stringtable.json entries
"
```

Our PHP implementation of all of this is open source at
**https://github.com/Borcioo/tft-scout** if you want a second
reference besides `cdtb/`. The relevant files are under
`app/Services/Tft/` (algorithms) and `app/Services/Import/SetHooks/`
(orchestration). The full pipeline is documented in
[`docs/champion-ability-pipeline.md`](https://github.com/Borcioo/tft-scout/blob/main/docs/champion-ability-pipeline.md).

---

## TL;DR for maintainers

Three things that would help the broadest set of TFT consumers, in
descending order of effort-to-impact:

1. **One-paragraph TFT addendum to `assets.md`** pointing at
   `game/characters/{name}.cdtb.bin.json` as the canonical TFT
   character data location, plus the
   `mClientData.mTooltipData.mLocKeys` plaintext-key path as the
   recommended way to resolve spell descriptions.

2. **Adding the trait binpath hashes** (section 12a) and `baseValue` /
   `TraitData` (12b/12c) to the existing hashlists. ~46 lines total,
   no semantic decisions needed.

3. **A short reference for `mSpellCalculations` node types** (table
   in section 6) — preferably under `CommunityDragon/Docs` or as
   docstrings inside `cdtb/binfile.py` next to the existing
   structural docs.

Happy to file these as PRs against `CommunityDragon/Data` and/or
`CommunityDragon/Docs` if it's the right channel — let me know.

Thanks for everything CDragon makes possible. None of this work would
exist without the project.
