# Quickstart: Remove Colyseus Implementation

## Prerequisites

- Phase 0 (Extract Game Engine) complete — `Simulation.update()` returns `BattleEvent[]`
- Phase 1 (Remove MongoDB) complete — IndexedDB persistence, static bot JSON
- Branch: `003-remove-colyseus`

## Implementation Strategy: Maximum Reuse, Minimum Change

The core strategy is **extract, don't rewrite**:

1. Game logic from `game-commands.ts` → extracted as plain functions into `local-engine.ts`
2. Game loop from `game-room.ts` → `setInterval` in `local-engine.ts`
3. State sync via **Schema encode/decode loopback** — `Encoder`/`Decoder` pair syncs `engineState` → `clientState` locally, all existing Schema listeners fire automatically. `game.tsx` / `game-container.ts` change only 1 line each (`getDecoderStateCallbacks(decoder)` replaces `getStateCallbacks(room)`)
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
| `app/public/src/pages/game.tsx` | Replace `getStateCallbacks(room)` with `getDecoderStateCallbacks(decoder)` | ~1 line changed |
| `app/public/src/game/game-container.ts` | Replace `getStateCallbacks(room)` with `getDecoderStateCallbacks(decoder)` | ~1 line changed |
| `app/public/src/game/lobby-logic.ts` | Simplify: remove room connection, add "Start Game" | ~200 lines changed |
| `app/public/src/pages/preparation.tsx` | DELETE entirely | -265 lines |
| `app/public/src/pages/after-game.tsx` | Read from engine state instead of room | ~30 lines changed |
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
