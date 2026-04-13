# TFT Set 17 — Special Mechanics

> Mechaniki specjalne, które wpływają na budowanie drużyn i wymagają osobnego traktowania w algorytmie.

---

## 1. Mecha Enhanced

**Opis**: Championów z traitem Mecha można transformować w Enhanced formę za pomocą itemu Mecha-Former.

**Zasady**:
- Enhanced champion zajmuje **2 sloty** zamiast 1
- Liczy się **2x** do traitu Mecha (1 Enhanced = 2 Mecha count)
- Zyskuje +100% HP i ulepszoną ability
- Gracz sam decyduje, którego Mecha transformuje

**Eligible Champions**: Urgot, Aurelion Sol, The Mighty Mech

**Modeling w bazie**: Każdy Mecha champion ma dwa wpisy:
- `TFT17_Urgot` — normalny (1 slot, 1x Mecha)
- `TFT17_Urgot_enhanced` — enhanced (2 sloty, 2x Mecha)
- Wzajemnie się wykluczają (ta sama postać, inna forma)

**Breakpoint math examples**:
- 1 Enhanced Urgot + 1 Normal ASol = 3 Mecha → bronze active
- 1 Enhanced Urgot + 1 Enhanced ASol = 4 Mecha → gold active (2 slots each = 4 slots used)
- 3 Enhanced = 6 Mecha → prismatic (+1 team size) but uses 6 slots

---

## 2. Miss Fortune — Choose Trait

**Opis**: Miss Fortune pozwala graczowi wybrać jeden z 3 trybów przy wstawieniu na planszę.

**Tryby**:
| Mode | Dodany Trait | Ability Type | Suggested Role |
|------|-------------|--------------|----------------|
| Conduit Mode | Conduit (TFT17_ManaTrait) | Mana-based | APCaster |
| Challenger Mode | Challenger (TFT17_ASTrait) | Attack speed | ADCarry |
| Replicator Mode | Replicator (TFT17_APTrait) | Double-cast | APCaster |

**Stały trait**: Gun Goddess (TFT17_MissFortuneUniqueTrait) — zawsze aktywny niezależnie od trybu.

**Modeling w bazie**: 3 osobne wpisy championów:
- `TFT17_MissFortune_Conduit` — traits: Conduit, Gun Goddess
- `TFT17_MissFortune_Challenger` — traits: Challenger, Gun Goddess
- `TFT17_MissFortune_Replicator` — traits: Replicator, Gun Goddess
- Wzajemnie się wykluczają (ta sama postać, inny tryb)

**W algorytmie**: Scout powinien rozważyć wszystkie 3 warianty niezależnie i wybrać ten, który najlepiej pasuje do budowanej synergii.

---

## 3. Redeemer (Rhaast)

**Opis**: Rhaast zyskuje bonusy skalujące z liczbą aktywnych traitów w drużynie.

**Zasady**:
- Bonus zaczyna działać powyżej 5 aktywnych traitów
- Każdy trait powyżej 5 daje +1.0 bonus score
- Preferuje diverse teams z wieloma różnymi traitami
- Nie ma sensu w mono-trait teamach (np. 6 Brawler + Rhaast = mało traitów)

---

## 4. N.O.V.A. — Champion-Dependent Buffs

**Opis**: N.O.V.A. daje różne buffy zależnie od tego, którzy championowie N.O.V.A. są w drużynie.

| Champion | Buff |
|----------|------|
| Aatrox | Shred + Sunder enemies |
| Caitlyn | Attack Speed for allies |
| Akali | Precision for allies |
| Maokai | Heal allies |
| Kindred | Shield strongest tank |
| Emblem | Bonus true damage |

At 5 units (prismatic) — gain a Striker selector to activate one champion's Strike ability.

---

## 5. Stargazer — Random Constellation

**Opis**: Każda gra losuje inną konstelację, która zmienia działanie traitu Stargazer.

Konstelacja jest niezmienna w trakcie gry. AI powinno wiedzieć, że Stargazer jest zmienny, ale bez znajomości aktualnej konstelacji nie może ocenić pełnej siły traitu.

---

## 6. Zed — Augment-Only Champion

**Opis**: Zed (Galaxy Hunter) jest dostępny wyłącznie przez augment "Invader Zed". Nie pojawia się w normalnym shopie.

**Implikacja**: Scout nie powinien generować kompów z Zedem w standardowym trybie, chyba że gracz zaznaczył go jako locked.

---

## 7. Exclusion Groups Summary

| Group | Members | Rule |
|-------|---------|------|
| Miss Fortune | MF Conduit, MF Challenger, MF Replicator | Max 1 per team |
| Urgot forms | Urgot, Urgot Enhanced | Max 1 per team |
| Aurelion Sol forms | ASol, ASol Enhanced | Max 1 per team |
| The Mighty Mech forms | TMM, TMM Enhanced | Max 1 per team |
