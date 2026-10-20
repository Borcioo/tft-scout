# TFT Set 17 — Champions Knowledge Base

> Baza wiedzy dla AI — zawiera wszystkich championów z ich traitami, kosztami i specjalnymi mechanikami.
> Warianty (Mecha Enhanced, Miss Fortune modes) są listowane jako osobne wpisy.

## Legenda

- **Cost**: koszt w gold (1-5)
- **Role**: rola w drużynie (ADCarry, APCaster, APTank, etc.)
- **Traits**: aktywne traity championów
- **Slot**: ile slotów zajmuje w drużynie (domyślnie 1)
- **Exclusive**: z jakimi wariantami się wyklucza (nie mogą być w teamie jednocześnie)

---

## 1-Cost Champions

| Champion | apiName | Cost | Role | Traits | Notes |
|----------|---------|------|------|--------|-------|
| Aatrox | TFT17_Aatrox | 1 | ADTank | Bastion, N.O.V.A. | |
| Briar | TFT17_Briar | 1 | ADFighter | Anima, Rogue, Primordian | |
| Caitlyn | TFT17_Caitlyn | 1 | ADSpecialist | Fateweaver, N.O.V.A. | |
| Cho'Gath | TFT17_Chogath | 1 | APTank | Dark Star, Brawler | |
| Ezreal | TFT17_Ezreal | 1 | ADCaster | Timebreaker, Sniper | |
| Leona | TFT17_Leona | 1 | APTank | Vanguard, Arbiter | |
| Lissandra | TFT17_Lissandra | 1 | APCaster | Replicator, Dark Star, Shepherd | |
| Nasus | TFT17_Nasus | 1 | APTank | Vanguard, Space Groove | |
| Poppy | TFT17_Poppy | 1 | APTank | Bastion, Meeple | |
| Rek'Sai | TFT17_Reksai | 1 | APTank | Primordian, Brawler | |
| Talon | TFT17_Talon | 1 | ADReaper | Rogue, Stargazer | |
| Teemo | TFT17_Teemo | 1 | APCarry | Space Groove, Shepherd | |
| Twisted Fate | TFT17_TwistedFate | 1 | APCaster | Fateweaver, Stargazer | |
| Veigar | TFT17_Veigar | 1 | APCaster | Replicator, Meeple | |

## 2-Cost Champions

| Champion | apiName | Cost | Role | Traits | Notes |
|----------|---------|------|------|--------|-------|
| Akali | TFT17_Akali | 2 | ADFighter | Marauder, N.O.V.A. | |
| Bel'Veth | TFT17_Belveth | 2 | ADFighter | Challenger, Marauder, Primordian | |
| Gnar | TFT17_Gnar | 2 | ADSpecialist | Meeple, Sniper | |
| Gragas | TFT17_Gragas | 2 | APTank | Psionic, Brawler | |
| Gwen | TFT17_Gwen | 2 | APReaper | Rogue, Space Groove | |
| Jax | TFT17_Jax | 2 | APTank | Bastion, Stargazer | |
| Jinx | TFT17_Jinx | 2 | ADCarry | Challenger, Anima | |
| Meepsie | TFT17_IvernMinion | 2 | APTank | Shepherd, Meeple, Voyager | |
| Milio | TFT17_Milio | 2 | APCaster | Timebreaker, Fateweaver | |
| Mordekaiser | TFT17_Mordekaiser | 2 | APTank | Vanguard, Dark Star, Conduit | |
| Pantheon | TFT17_Pantheon | 2 | ADTank | Replicator, Timebreaker, Brawler | |
| Pyke | TFT17_Pyke | 2 | ADReaper | Psionic, Voyager | |
| Zoe | TFT17_Zoe | 2 | APCaster | Arbiter, Conduit | |

## 3-Cost Champions

| Champion | apiName | Cost | Role | Traits | Notes |
|----------|---------|------|------|--------|-------|
| Aurora | TFT17_Aurora | 3 | APCaster | Anima, Voyager | |
| Diana | TFT17_Diana | 3 | APFighter | Challenger, Arbiter | |
| Fizz | TFT17_Fizz | 3 | APReaper | Rogue, Meeple | |
| Illaoi | TFT17_Illaoi | 3 | APTank | Vanguard, Anima, Shepherd | |
| Kai'Sa | TFT17_Kaisa | 3 | ADCaster | Rogue, Dark Star | |
| Lulu | TFT17_Lulu | 3 | APCaster | Replicator, Stargazer | |
| Maokai | TFT17_Maokai | 3 | APTank | Brawler, N.O.V.A. | |
| Ornn | TFT17_Ornn | 3 | APTank | Space Groove, Bastion | |
| Rhaast | TFT17_Rhaast | 3 | ADTank | Redeemer | Unique trait: scales with number of active traits in team |
| Samira | TFT17_Samira | 3 | ADCaster | Space Groove, Sniper | |
| Urgot | TFT17_Urgot | 3 | ADFighter | Marauder, Brawler, Mecha | Has Enhanced variant |
| Viktor | TFT17_Viktor | 3 | APCaster | Psionic, Conduit | |

### Miss Fortune — 3-Cost (Selectable Trait)

Miss Fortune to specjalna postać z mechaniką **Choose Trait**. Gracz wybiera jeden z 3 trybów, który determinuje jej trait i ability. Traktowane jako 3 osobne warianty — **wzajemnie się wykluczające** (tylko jeden w drużynie):

| Wariant | apiName | Cost | Role | Traits | Slot | Exclusive |
|---------|---------|------|------|--------|------|-----------|
| Miss Fortune (Conduit) | TFT17_MissFortune_Conduit | 3 | APCaster | **Conduit**, Gun Goddess | 1 | MF Challenger, MF Replicator |
| Miss Fortune (Challenger) | TFT17_MissFortune_Challenger | 3 | ADCarry | **Challenger**, Gun Goddess | 1 | MF Conduit, MF Replicator |
| Miss Fortune (Replicator) | TFT17_MissFortune_Replicator | 3 | APCaster | **Replicator**, Gun Goddess | 1 | MF Conduit, MF Challenger |

> **Gun Goddess** to jej stały unique trait. Wybrany trait (Conduit/Challenger/Replicator) działa normalnie i liczy się do synergii.

## 4-Cost Champions

| Champion | apiName | Cost | Role | Traits | Notes |
|----------|---------|------|------|--------|-------|
| Aurelion Sol | TFT17_AurelionSol | 4 | APCaster | Conduit, Mecha | Has Enhanced variant |
| Corki | TFT17_Corki | 4 | ADCaster | Fateweaver, Meeple | |
| Karma | TFT17_Karma | 4 | APCaster | Dark Star, Voyager | |
| Kindred | TFT17_Kindred | 4 | ADCarry | Challenger, N.O.V.A. | |
| LeBlanc | TFT17_Leblanc | 4 | APCarry | Arbiter, Shepherd | |
| Master Yi | TFT17_MasterYi | 4 | ADFighter | Psionic, Marauder | |
| Nami | TFT17_Nami | 4 | APCaster | Replicator, Space Groove | |
| Nunu & Willump | TFT17_Nunu | 4 | APTank | Vanguard, Stargazer | |
| Rammus | TFT17_Rammus | 4 | APTank | Bastion, Meeple | |
| Riven | TFT17_Riven | 4 | HFighter | Timebreaker, Rogue | |
| Tahm Kench | TFT17_TahmKench | 4 | APTank | Brawler, Oracle | Unique trait: gives rewards every X rounds |
| The Mighty Mech | TFT17_Galio | 4 | ADTank | Mecha, Voyager | Has Enhanced variant |
| Xayah | TFT17_Xayah | 4 | ADCarry | Stargazer, Sniper | |

## 5-Cost Champions

| Champion | apiName | Cost | Role | Traits | Notes |
|----------|---------|------|------|--------|-------|
| Bard | TFT17_Bard | 5 | APCaster | Meeple, Conduit | |
| Blitzcrank | TFT17_Blitzcrank | 5 | APFighter | Vanguard, Space Groove, Party Animal | Unique trait |
| Fiora | TFT17_Fiora | 5 | ADFighter | Marauder, Anima, Divine Duelist | Unique trait: always wins 1v1 |
| Graves | TFT17_Graves | 5 | ADCarry | Factory New | Unique trait: permanent upgrades via armory |
| Jhin | TFT17_Jhin | 5 | ADCarry | Eradicator, Dark Star, Sniper | Unique trait: enemies lose resists |
| Morgana | TFT17_Morgana | 5 | APFighter | Dark Lady | Unique trait: team ability damage reduction |
| Shen | TFT17_Shen | 5 | APFighter | Bulwark, Bastion | Unique trait: placeable relic |
| Sona | TFT17_Sona | 5 | APCaster | Psionic, Commander, Shepherd | Unique trait: Command Mods |
| Vex | TFT17_Vex | 5 | APCarry | Doomer | Unique trait: steals AD/AP from enemies |
| Zed | TFT17_Zed | 5 | ADFighter | Galaxy Hunter | Unique trait: from augment only |

---

## Mecha Enhanced Variants

Championów z traitem **Mecha** można transformować w Enhanced formę za pomocą itemu Mecha-Former. Enhanced forma:
- Zajmuje **2 sloty** zamiast 1
- Liczy się **2x** do traitu Mecha
- Zyskuje +100% HP i ulepszoną ability

Każdy wariant Enhanced jest **osobnym wpisem** — wyklucza się z wersją normalną:

| Wariant | apiName | Cost | Role | Traits | Slot | Exclusive |
|---------|---------|------|------|--------|------|-----------|
| Urgot (Enhanced) | TFT17_Urgot_enhanced | 3 | ADFighter | Marauder, Brawler, Mecha | **2** | Urgot (normal) |
| Aurelion Sol (Enhanced) | TFT17_AurelionSol_enhanced | 4 | APCaster | Conduit, Mecha | **2** | Aurelion Sol (normal) |
| The Mighty Mech (Enhanced) | TFT17_Galio_enhanced | 4 | ADTank | Mecha, Voyager | **2** | The Mighty Mech (normal) |

> **Mecha trait breakpoints**: 3 (silver), 4 (gold), 6 (prismatic: +1 max team size).
> Enhanced champion counting 2x means: 1 Enhanced + 1 normal = 3 Mecha count.

---

## Special Units (Not Playable)

| Unit | apiName | Notes |
|------|---------|-------|
| Mini Black Hole | TFT17_DarkStar_FakeUnit | Summoned by Dark Star trait, not a real champion |

---

## Exclusion Rules Summary

1. **Miss Fortune variants**: Only one MF variant per team (Conduit OR Challenger OR Replicator)
2. **Mecha Enhanced**: Enhanced version excludes normal version of same champion (same unit, different form)
3. **Zed**: Only obtainable via Invader Zed augment — may not appear in normal shop
