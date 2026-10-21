# TFT Set 18 — Champions Knowledge Base

> Baza wiedzy dla AI — wszyscy championowie Set 18 z traitami, kosztami i mechanikami.
> Wygenerowane z bazy po `php artisan tft:import --set=18` (2026-10-20, CDragon `latest`).
> Formy Lux (Avatar) i ewolucje Kha'Zixa są listowane jako osobne wpisy — wykluczają się nawzajem.

## Legenda

- **Cost**: koszt w gold (1-5)
- **Role**: rola **wyinferowana** przez `RoleInferenceHook` (Set 18 nie ma ról w danych Riot) — zasięg + typ obrażeń umiejętności
- **Traits**: traity; `×2` = champion liczy się podwójnie do traitu (`mLinkedTraits[].Amount` z binu)
- **Slot**: ile slotów zajmuje w drużynie (domyślnie 1)

---

## 1-Cost Champions

| Champion | apiName | Role | Traits | Slot | Notes |
|----------|---------|------|--------|------|-------|
| Akali | DA_18_Akali_AD | ADFighter | Adaptor, Inferno, Ravager | 1 |  |
| Camille | DA_18_Camille | ADFighter | Coven, Ravager | 1 |  |
| Cinderling | DA_Cinderling18 | ADCarry | Hunter, Riftbeast | 1 |  |
| Karma | DA_Karma18 | APCaster | Blossom, Spellweaver | 1 |  |
| Kobuko | DA_18_Kobuko | APTank | Brawler, Sprykin | 1 |  |
| Leona | DA_18_Leona | APTank | Defender, Solar | 1 |  |
| Ornn | DA_18_Ornn | APTank | Defender, Elderwood | 1 |  |
| Pebbles | DA_18_Sentry | APCaster | Invoker, Riftbeast | 1 |  |
| Rakan | DA_18_Rakan | APTank | Fae, Juggernaut, Vanguard | 1 |  |
| Rek'Sai | DA_18_RekSai | APTank | Blackthorn, Brawler | 1 |  |
| Varus | DA_18_Varus | ADCarry | Inferno, Rapidfire | 1 |  |
| Veigar | DA_18_Veigar | APCaster | Blackthorn, Spellweaver, Sprykin | 1 |  |
| Xayah | DA_18_Xayah | ADCarry | Elderwood, Fae, Rapidfire | 1 |  |
| Yorick | DA_18_Yorick | ADTank | Blossom, Juggernaut, Summoner | 1 |  |

## 2-Cost Champions

| Champion | apiName | Role | Traits | Slot | Notes |
|----------|---------|------|--------|------|-------|
| Alistar | DA_18_Alistar | APTank | Brawler, Elderwood | 1 |  |
| Caitlyn | DA_18_Caitlyn | ADCarry | Coven, Hunter | 1 |  |
| Elise | DA_18_Elise | APTank | Coven, Vanguard | 1 |  |
| Gromp | DA_Gromp18_AP | APCaster | Adaptor, Riftbeast | 1 |  |
| Kayle | DA_18_Kayle | APCaster | Rapidfire, Solar | 1 |  |
| LeBlanc | DA_18_LeBlanc | APCaster | Elderwood, Spellweaver | 1 |  |
| Murkwolf | DA_Murkwolf18 | ADFighter | Ravager, Riftbeast | 1 |  |
| Scuttlecrab | DA_Scuttlecrab18 | ADTank | Juggernaut, Riftbeast | 1 |  |
| Sejuani | DA_18_Sejuani | APTank | Juggernaut, Solar | 1 |  |
| Shen | DA_18_Shen | APTank | Defender, Inferno | 1 |  |
| Teemo | DA_18_Teemo | APCaster | Invoker, Sprykin | 1 |  |
| Warwick | DA_18_Warwick | ADFighter | Blackthorn, Ravager | 1 |  |
| Yunara | DA_18_Yunara | ADCarry | Blossom, Executioner | 1 |  |

## 3-Cost Champions

| Champion | apiName | Role | Traits | Slot | Notes |
|----------|---------|------|--------|------|-------|
| Azir | DA_18_Azir | APCaster | Blackthorn, Executioner, Summoner | 1 |  |
| Cassiopeia | DA_18_Cassiopeia | APCaster | Coven, Spellweaver | 1 |  |
| Diana | DA_18_Diana | APFighter | Lunar, Ravager, Vanguard | 1 |  |
| Fiddlesticks | DA_Fiddlesticks18 | APTank | Defender, Flora Fatalis, Spellweaver | 1 |  |
| Hecarim | DA_18_Hecarim | APTank | Elderwood, Vanguard | 1 |  |
| Kha'Zix | DA_18_KhaZix | APFighter | Rival | 1 | nieewoluowany; 4 ewolucje poniżej (wykluczają się z nim) |
| Kha'Zix (Executioner) | DA_18_KhaZix_Executioner | APFighter | Rival, Executioner | 1 | ewolucja (`TraitEvolutionHook`) |
| Kha'Zix (Rapidfire) | DA_18_KhaZix_Rapidfire | APFighter | Rival, Rapidfire | 1 | ewolucja (`TraitEvolutionHook`) |
| Kha'Zix (Ravager) | DA_18_KhaZix_Ravager | APFighter | Rival, Ravager | 1 | ewolucja (`TraitEvolutionHook`) |
| Kha'Zix (Spellweaver) | DA_18_KhaZix_Spellweaver | APFighter | Rival, Spellweaver | 1 | ewolucja (`TraitEvolutionHook`) |
| Kog'Maw | DA_KogMaw18_AD | ADCarry | Caustic, Adaptor, Invoker | 1 |  |
| Krug | DA_Krug18 | HTank | Brawler, Riftbeast | 1 |  |
| Mama Beak | DA_CrimsonRaptor18 | HCaster | Rapidfire, Riftbeast, Summoner | 1 |  |
| Master Yi | DA_18_MasterYi_AD | APFighter | Adaptor, Blossom | 1 |  |
| Rammus | DA_18_Rammus | ADTank | Defender, Sprykin | 1 |  |
| Rengar | DA_18_Rengar | ADFighter | Rival | 1 |  |
| Tristana | DA_18_Tristana | ADCarry | Fae, Hunter, Sprykin | 1 |  |
| Vi | DA_Vi18 | APTank | Juggernaut, Primal | 1 |  |

## 4-Cost Champions

| Champion | apiName | Role | Traits | Slot | Notes |
|----------|---------|------|--------|------|-------|
| Ahri | DA_18_Ahri | APCaster | Blossom, Spellweaver | 1 |  |
| Amumu | DA_Amumu18 | APTank | Inferno, Juggernaut | 1 |  |
| Aphelios | DA_18_Aphelios | ADCarry | Lunar, Rapidfire | 1 |  |
| Brambleback | DA_Brambleback18 | ADFighter | Ravager, Riftbeast | 1 |  |
| Ezreal | DA_18_Ezreal | ADCarry | Elderwood, Executioner | 1 |  |
| Lillia | DA_18_Lillia | APTank | Defender, Fae | 1 |  |
| Malphite | DA_18_Malphite | APTank | Monolith, Blackthorn | 1 |  |
| Morgana | DA_18_Morgana | APTank | Coven, Invoker | 1 |  |
| Nidalee | DA_Nidalee18_AP | APFighter | Adaptor, Primal | 1 |  |
| Sentinel | DA_Sentinel18 | APTank | Invoker, Riftbeast, Vanguard | 1 |  |
| Sett | DA_18_Sett | ADTank | Blossom, Brawler | 1 |  |
| Sivir | DA_18_Sivir | ADCarry | Hunter, Primal | 1 |  |
| Soraka | DA_18_Soraka | APCaster | Executioner, Flora Fatalis | 1 |  |
| Zyra | DA_18_Zyra | APCaster | Thornmaiden, Summoner | 1 |  |

## 5-Cost Champions

| Champion | apiName | Role | Traits | Slot | Notes |
|----------|---------|------|--------|------|-------|
| Alune | DA_18_Alune | APCaster | Attuned, Lunar, Spellweaver | 1 |  |
| Ashe | DA_18_Ashe | ADCarry | Blossom, Hunter | 1 |  |
| Draven | DA_Draven18 | ADCarry | Bounty Seeker | 1 |  |
| Elder Dragon | DA_18_ElderDragon | ADTank | Apex Predator, Riftbeast ×2 | 2 |  |
| Gnar | DA_18_GnarSmall | ADTank | Brawler, Elderwood, Sprykin | 1 |  |
| Ivern | DA_18_Ivern | APTank | Greenfather | 1 |  |
| Kennen | DA_18_Kennen | APTank | Executioner, Inferno | 1 |  |
| Lux | DA_Lux18_Base | HCaster | Avatar | 1 | rekord bazowy, niegrywalny (planner/MetaTFT) |
| Lux (Blackthorn) | DA_Lux18_Blackthorn | APCaster | Avatar, Blackthorn ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Blossom) | DA_Lux18_Blossom | APCaster | Avatar, Blossom ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Coven) | DA_18_Lux_Coven | APCaster | Avatar, Coven ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Elderwood) | DA_18_Lux_Elderwood | APCaster | Avatar, Elderwood ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Fae) | DA_18_Lux_Fae | APCaster | Avatar, Fae ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Inferno) | DA_18_Lux_Inferno | APCaster | Avatar, Inferno ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Lunar) | DA_18_Lux_Moonbeam | APCaster | Avatar, Lunar ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Primal) | DA_18_Lux_Primal | APCaster | Avatar, Primal ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Lux (Solar) | DA_18_Lux_Sunbeam | APCaster | Avatar, Solar ×2 | 1 | forma `DA_Lux18_Base` (wyklucza inne formy) |
| Maokai | DA_18_Maokai | APTank | Old Growth, Juggernaut | 1 |  |
| Taric | DA_Taric18 | APTank | Emerald Aspect, Vanguard | 1 |  |
