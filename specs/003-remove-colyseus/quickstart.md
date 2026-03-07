# Quickstart: Remove Colyseus Implementation

## Prerequisites

- Phase 0 (Extract Game Engine) complete — `Simulation.update()` returns `BattleEvent[]`
- Phase 1 (Remove MongoDB) complete — IndexedDB persistence, static bot JSON
- Branch: `003-remove-colyseus`

## Implementation Strategy: Maximum Reuse, Minimum Change

The core strategy is **extract, don't rewrite**:

1. Game logic from `game-commands.ts` → extracted as plain functions into `local-engine.ts`
2. Game loop from `game-room.ts` → `setInterval` in `local-engine.ts`
3. State sync via **Schema encode/decode loopback** — `Encoder`/`Decoder` pair syncs `engineState` → `clientState` locally, all existing Schema `.listen()` / `.onAdd()` / `.onChange()` callbacks fire automatically with zero changes. Only the `$` function source changes (1 line each). Other `room.*` refs (`.send()`, `.onMessage()`, `.state` reads) still need per-site modification.
4. Transfer messages (ABILITY, DAMAGE, etc.) → simple EventEmitter on engine
5. `network.ts` convenience functions → same names, body calls engine instead of room.send()

## Key Files to Create

| File | Purpose | Estimated Lines |
|------|---------|-----------------|
| `app/public/src/local-engine.ts` | LocalGameEngine class + game loop + loopback sync | ~1500 |

## Key Files to Modify

| File | Change | Scope |
|------|--------|-------|
| `app/public/src/network.ts` | Replace Colyseus client with engine calls | Full rewrite (~260 lines) |
| `app/public/src/pages/game.tsx` | Schema listeners untouched; replace `$` source (1 line), 15 `room.onMessage` → `engine.on`, 5 `room.state` → `clientState`, constructor | ~23 changes |
| `app/public/src/game/game-container.ts` | Schema listeners untouched; replace `$` source (1 line), 3 `room.send` → engine methods, 1 `room.onMessage` → `engine.on`, 4 `room.state` → `clientState`, constructor | ~11 changes |
| `app/public/src/game/scenes/game-scene.ts` | 8 `room.send` + 5 `room.state` reads + 1 `room.onMessage` → engine equivalents | ~14 changes |
| `app/public/src/game/components/berry-tree.ts` | 1 `room.send(Transfer.PICK_BERRY)` → engine method | ~1 change |
| `app/public/src/game/components/wanderers-manager.ts` | 3 `room.send(Transfer.WANDERER_CLICKED)` → engine method | ~3 changes |
| `app/public/src/game/components/minigame-manager.ts` | 1 `room.onMessage(Transfer.NPC_DIALOG)` → `engine.on` | ~1 change |
| `app/public/src/game/components/pokemon-avatar.ts` | `room.state` accesses → `engine.clientState` | ~3 changes |
| `app/public/src/game/components/loading-manager.ts` | `room.state` accesses → `engine.clientState` | ~2 changes |
| `app/public/src/game/components/sell-zone.ts` | `room.state` accesses → `engine.clientState` | ~2 changes |
| `app/public/src/game/lobby-logic.ts` | Simplify: remove room connection, add "Start Game" | ~200 lines changed |
| `app/public/src/pages/preparation.tsx` | DELETE entirely | -265 lines |
| `app/public/src/pages/after-game.tsx` | Full useEffect rewrite: remove Colyseus reconnection, read engine final state directly | ~60 lines rewritten |
| `app/core/simulation.ts` | Replace `room?: GameRoom` field with engine context interface | ~10 lines |
| `app/core/mini-game.ts` | Replace `room: GameRoom` constructor param with engine context | ~20 lines |
| `app/core/effects/effect.ts` | Replace `room?: GameRoom` in `OnStageStartEffectArgs` | ~3 lines |
| `app/core/abilities/hidden-power.ts` | Resolve 2 room references | ~20 lines |
| `app/core/abilities/abilities.ts` | Resolve 2 room references | ~15 lines |
| `app/core/effects/synergies.ts` | Resolve 1 room reference | ~5 lines |
| `app/core/effects/items.ts` | Resolve 4 room references | ~30 lines |
| `app/core/effects/passives.ts` | Resolve 1 room reference | ~10 lines |

## Key Files to Delete

| File/Directory | Reason |
|----------------|--------|
| `app/rooms/` (11 files) | All Colyseus room definitions |
| `app/core/tournament-logic.ts` | Multiplayer-only |

## Build & Verify

```bash
npm run build   # Must pass at every commit
npm run lint    # Should pass
```

## Reuse Checklist

Before writing new code, check if existing code already does what you need:

- [ ] `Simulation.update(dt)` — battle engine, fully reusable
- [ ] `PokemonFactory.createPokemonFromName()` — Pokemon creation
- [ ] `Shop` class — shop logic (assignShop, reroll, pool management)
- [ ] `BotManager` — bot AI board loading
- [ ] `computeElo()` — ELO calculation (app/core/elo.ts or similar)
- [ ] `computeRoundDamage()` — damage calculation
- [ ] `MiniGame` class — minigame logic
- [ ] `Player` class — player state management
- [ ] `GameState` class — game state container
- [ ] All game config data in `app/config/game/` — balance, shop, pokemons, items
