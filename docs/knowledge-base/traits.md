# TFT Set 17 — Traits Knowledge Base

> Baza wiedzy dla AI — zawiera wszystkie traity z breakpointami i mechanikami.

## Legenda

- **Breakpoints**: progi aktywacji (ilość championów z danym traitem)
- **Style**: 1=bronze, 3=gold, 5=prismatic, 6=unique/max
- **Type**: Shared (wiele championów) / Unique (1 champion)

---

## Shared Traits (Synergy)

Traity dzielone między wieloma championami — kluczowe do budowania kompozycji.

### Offensive Traits

| Trait | apiName | Breakpoints | Champions |
|-------|---------|-------------|-----------|
| **Challenger** | TFT17_ASTrait | 2 (bronze) → 3 (gold) → 4 (gold) → 5 (prismatic) | Bel'Veth, Jinx, Diana, Kindred + MF (Challenger) |
| **Marauder** | TFT17_MeleeTrait | 2 (bronze) → 4 (gold) → 6 (prismatic) | Akali, Bel'Veth, Pantheon, Urgot, Master Yi, Fiora |
| **Replicator** | TFT17_APTrait | 2 (bronze) → 4 (prismatic) | Lissandra, Veigar, Pantheon, Lulu, Nami + MF (Replicator) |
| **Rogue** | TFT17_AssassinTrait | 2 (bronze) → 3 (gold) → 4 (gold) → 5 (prismatic) | Briar, Talon, Gwen, Fizz, Kai'Sa, Riven |
| **Sniper** | TFT17_RangedTrait | 2 (bronze) → 3 (gold) → 4 (gold) | Ezreal, Gnar, Samira, Xayah, Jhin |

### Defensive Traits

| Trait | apiName | Breakpoints | Champions |
|-------|---------|-------------|-----------|
| **Bastion** | TFT17_ResistTank | 2 (bronze) → 4 (gold) → 6 (prismatic) | Aatrox, Poppy, Jax, Ornn, Rammus, Shen |
| **Brawler** | TFT17_HPTank | 2 (bronze) → 4 (gold) → 6 (prismatic) | Cho'Gath, Rek'Sai, Gragas, Pantheon, Urgot, Maokai, Tahm Kench |
| **Vanguard** | TFT17_ShieldTank | 2 (bronze) → 4 (gold) → 6 (prismatic) | Leona, Nasus, Mordekaiser, Illaoi, Nunu & Willump, Blitzcrank |

### Support / Utility Traits

| Trait | apiName | Breakpoints | Champions |
|-------|---------|-------------|-----------|
| **Arbiter** | TFT17_ADMIN | 2 (bronze) → 3 (prismatic) | Leona, Zoe, Diana, LeBlanc |
| **Conduit** | TFT17_ManaTrait | 2 (bronze) → 3 (gold) → 4 (gold) → 5 (prismatic) | Mordekaiser, Zoe, Viktor, Aurelion Sol, Bard + MF (Conduit) |
| **Fateweaver** | TFT17_Fateweaver | 2 (bronze) → 4 (prismatic) | Caitlyn, Twisted Fate, Milio, Corki |
| **Psionic** | TFT17_PsyOps | 2 (bronze) → 4 (prismatic) | Gragas, Pyke, Viktor, Master Yi, Sona |
| **Shepherd** | TFT17_SummonTrait | 3 (bronze) → 5 (gold) → 7 (prismatic) | Lissandra, Teemo, Meepsie, Illaoi, LeBlanc, Sona |
| **Voyager** | TFT17_FlexTrait | 2 (bronze) → 3 (gold) → 4 (gold) → 5 (gold) → 6 (prismatic) | Meepsie, Pyke, Aurora, Karma, The Mighty Mech |

### Origin / Thematic Traits

| Trait | apiName | Breakpoints | Champions |
|-------|---------|-------------|-----------|
| **Anima** | TFT17_AnimaSquad | 3 (bronze) → 6 (prismatic) | Briar, Jinx, Aurora, Illaoi, Fiora |
| **Dark Star** | TFT17_DarkStar | 2 (bronze) → 4 (gold) → 6 (prismatic) → 9 (unique) | Cho'Gath, Lissandra, Mordekaiser, Kai'Sa, Karma, Jhin |
| **Meeple** | TFT17_Astronaut | 3 (bronze) → 5 (gold) → 7 (prismatic) → 10 (unique) | Poppy, Veigar, Gnar, Meepsie, Fizz, Corki, Rammus, Bard |
| **N.O.V.A.** | TFT17_DRX | 2 (bronze) → 5 (prismatic) | Aatrox, Caitlyn, Akali, Maokai, Kindred |
| **Primordian** | TFT17_Primordian | 2 (bronze) → 3 (prismatic) | Briar, Rek'Sai, Bel'Veth |
| **Space Groove** | TFT17_SpaceGroove | 1 (bronze) → 3 (gold) → 5 (gold) → 7 (prismatic) → 10 (unique) | Nasus, Teemo, Gwen, Ornn, Samira, Nami, Blitzcrank |
| **Stargazer** | TFT17_Stargazer | 3 (bronze) → 5 (gold) → 7 (prismatic) | Talon, Twisted Fate, Jax, Lulu, Nunu & Willump, Xayah |
| **Timebreaker** | TFT17_Timebreaker | 2 (bronze) → 3 (gold) → 4 (prismatic) | Ezreal, Milio, Pantheon, Riven |

### Special Mechanic Trait

| Trait | apiName | Breakpoints | Champions | Mechanic |
|-------|---------|-------------|-----------|----------|
| **Mecha** | TFT17_Mecha | 3 (bronze) → 4 (gold) → 6 (prismatic) | Urgot, Aurelion Sol, The Mighty Mech | Enhanced = 2 slots, 2x trait count |

---

## Unique Traits (1 Champion)

Traity przypisane do jednego konkretnego championa — nie można ich stackować (chyba że emblem).

| Trait | apiName | Champion | Effect Summary |
|-------|---------|----------|----------------|
| **Bulwark** | TFT17_ShenUniqueTrait | Shen | Placeable relic: shield + AS for adjacent allies |
| **Commander** | TFT17_SonaUniqueTrait | Sona | Random Command Mods every X rounds |
| **Dark Lady** | TFT17_MorganaUniqueTrait | Morgana | Team ability damage reduction |
| **Divine Duelist** | TFT17_FioraUniqueTrait | Fiora | Player healing + always wins 1v1 |
| **Doomer** | TFT17_VexUniqueTrait | Vex | Steals AD/AP from all enemies |
| **Eradicator** | TFT17_JhinUniqueTrait | Jhin | Enemies lose % Armor/MR |
| **Factory New** | TFT17_GravesTrait | Graves | Permanent upgrades via armory |
| **Galaxy Hunter** | TFT17_ZedUniqueTrait | Zed | Bonus AD while clones alive |
| **Gun Goddess** | TFT17_MissFortuneUniqueTrait | Miss Fortune | Always active; mode determines 2nd trait |
| **Oracle** | TFT17_TahmKenchUniqueTrait | Tahm Kench | Periodic reward drops |
| **Party Animal** | TFT17_BlitzcrankUniqueTrait | Blitzcrank | Self-repair at low HP |
| **Redeemer** | TFT17_RhaastUniqueTrait | Rhaast | Team stats scale with active trait count |

---

## Meta Trait: Choose Trait (Miss Fortune)

| apiName | Name | Description |
|---------|------|-------------|
| TFT17_MissFortuneUndeterminedTrait | Choose Trait | Placeholder — gracz wybiera Conduit / Challenger / Replicator |

To nie jest prawdziwy trait — to marker w danych. W bazie wiedzy Miss Fortune ma 3 osobne warianty (patrz champions.md).

---

## Stargazer Variants

Stargazer ma **losową konstelację** w każdej grze. Warianty:

| Constellation | apiName | Key Mechanic |
|---------------|---------|--------------|
| The Boar (Wolf) | TFT17_Stargazer_Wolf | Gold on win + HP/AD/AP in hexes |
| The Medallion | TFT17_Stargazer_Medallion | Damage Amp + bonus per 3-star |
| The Huntress | TFT17_Stargazer_Huntress | AS + heal on marked kill |
| The Serpent | TFT17_Stargazer_Serpent | Durability + poison DoT |
| The Altar (Shield) | TFT17_Stargazer_Shield | Stacking HP/AS per champion death |
| The Fountain | TFT17_Stargazer_Fountain | Mana Regen + heal lowest ally |
| The Mountain | TFT17_Stargazer_Mountain | Progressive bonuses + free emblems |
| (Generic) | TFT17_Stargazer | Base definition |

> Konstelacja jest losowana per grę — nie można jej wybrać. Wszystkie warianty mają te same breakpointy (3/5/7) oprócz Medallion (3 only), Shield (3 only), Mountain (3-11 progressive).

---

## Trait Interaction Notes

1. **Mecha + Enhanced**: Enhanced champion counts 2x for Mecha breakpoint. 1 Enhanced + 1 Normal = 3 Mecha count.
2. **Redeemer (Rhaast)**: Bonuses scale with total unique active traits. Best in diverse teams (5+ traits).
3. **N.O.V.A.**: Effects depend on which N.O.V.A. champions are fielded (Aatrox, Caitlyn, Akali, Maokai, Kindred each give different buff).
4. **Space Groove**: Starts at 1 unit (unique among traits) — Nasus alone activates bronze.
5. **Dark Star 9**: Extreme late-game — "CONSUME EVERYONE" at level 10.
