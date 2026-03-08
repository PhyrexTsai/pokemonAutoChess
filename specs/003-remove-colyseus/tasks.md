# Tasks: Remove Colyseus

**Input**: Design documents from `/specs/003-remove-colyseus/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/engine-api.md, quickstart.md

**Tests**: No automated test suite configured. Validation is manual play-testing.

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Move GameState to its new home, define the engine interface, and delete multiplayer-only code. Each task produces a build-passing commit.

- [x] T001 Move `app/rooms/states/game-state.ts` to `app/models/colyseus-models/game-state.ts` and update all import paths. Files to update: `app/core/matchmaking.ts`, `app/core/mini-game.ts`, `app/core/scribbles.ts`, `app/models/colyseus-models/pokemon.ts`, `app/models/colyseus-models/player.ts`, `app/models/shop.ts`, `app/public/src/game/game-container.ts`, `app/public/src/game/scenes/game-scene.ts`, `app/public/src/game/components/board-manager.ts`, `app/public/src/game/components/minigame-manager.ts`, `app/public/src/pages/game.tsx`, `app/public/src/pages/after-game.tsx`, `app/public/src/pages/lobby.tsx`, `app/public/src/network.ts`, `app/rooms/game-room.ts`, `app/public/src/pages/preparation.tsx`, `app/public/src/pages/component/room-menu/game-rooms-menu.tsx`. (These last 3 files will be deleted in later phases, but import paths must be valid for build to pass per SC-007.) Verify build passes.
- [x] T002 Add `IGameEngineContext` interface to `app/types/index.ts` per data-model.md definition (state, addDelayedAction, emit, spawnOnBench, spawnWanderingPokemon, checkEvolutionsAfterPokemonAcquired, checkEvolutionsAfterItemAcquired, getTeamSize). Also define `WanderingPokemonParams` type inline or as a separate interface (fields: pkm, type, behavior, player — infer from `game-room.ts` `spawnWanderingPokemon` usage). Leave existing GameRoom import intact (still used by rooms/ files).
- [x] T003 [P] Delete `app/core/tournament-logic.ts` and remove any imports referencing it across the codebase. Known importers: `app/rooms/commands/lobby-commands.ts` (deleted in T034), `app/public/src/pages/component/room-menu/tournament-item.tsx` (must also remove this import or delete the file — tournament UI is multiplayer-only). Also check `tournaments-list.tsx` which imports `tournament-item.tsx`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Resolve all `room` references in core game logic files and build the LocalGameEngine. MUST complete before any user story work.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Core room reference resolution

Replace all `GameRoom` / `room.*` references with `IGameEngineContext` in core logic files. Each task modifies one file. See research.md R4 for detailed reference counts and replacement patterns.

- [x] T004 [P] Replace `room?: GameRoom` field with `context?: IGameEngineContext` in `app/core/simulation.ts` (~5 refs). Also update the `ISimulation` interface in `app/types/index.ts` to use `context?: IGameEngineContext` instead of `room?: GameRoom`. Change all internal `this.room.*` accesses to `this.context.*`.
- [x] T005 [P] Replace `room?: GameRoom` with `context?: IGameEngineContext` in `app/core/effects/effect.ts` — update `OnStageStartEffectArgs` and `OnItemDroppedEffectArgs` interfaces (~3 refs).
- [x] T006 [P] Replace room refs in `app/core/mini-game.ts` — change constructor param from `room: GameRoom` to `context: IGameEngineContext`, replace all 8 `room.*` usages (`room.state` → `context.state`, `room.clients` → single-player equivalent, `room.broadcast` → `context.emit`, `room.clock.setTimeout` → `context.addDelayedAction`). Also replace `import { logger } from "colyseus"` with `console`.
- [x] T007 [P] Replace room refs in `app/core/effects/items.ts` — 7 refs: `room.clock.setTimeout` (2×) → `context.addDelayedAction`, `room.broadcast` (1×) → `context.emit`, `room.state` (3×) → `context.state`, `room.spawnOnBench` (1×) → `context.spawnOnBench`. Update function signatures to accept `IGameEngineContext`.
- [x] T008 [P] Replace room refs in `app/core/effects/passives.ts` — 3 refs: `room.clock.setTimeout` (2×) → `context.addDelayedAction`, `room.broadcast` (1×) → `context.emit`. Update function signatures.
- [x] T009 [P] Replace room refs in `app/core/effects/synergies.ts` — 1 ref: `pokemon.simulation.room.clock.setTimeout` (line 218) → `context.addDelayedAction`. Update function signatures.
- [x] T010 [P] Replace room refs in `app/core/abilities/abilities.ts` — 6 refs accessed via `pokemon.simulation.room`: guard check + `room.clock.setTimeout` (lines 292-298), `room.state.shop.magnetPull` + `room.spawnWanderingPokemon` (lines 13520-13525). Replace all with `pokemon.simulation.context.*` (`context.addDelayedAction`, `context.state.shop`, `context.spawnWanderingPokemon`). Change access pattern from `pokemon.simulation.room` to `pokemon.simulation.context`.
- [x] T011 [P] Replace room refs in `app/core/abilities/hidden-power.ts` — 5 refs accessed via `unown.simulation.room`: guard check (line 111), `room.state.shop.pickFish` (line 113), `room.state` (line 116), `room.spawnOnBench` (line 118), `room.checkEvolutionsAfterPokemonAcquired` (line 406). Replace all with `unown.simulation.context.*` (`context.state.shop`, `context.state`, `context.spawnOnBench`, `context.checkEvolutionsAfterPokemonAcquired`).

### Engine creation

Extract game logic from `game-commands.ts` and `game-room.ts` into 3 new engine files. See research.md R3 (command reuse), R1 (game loop), R2 (Schema loopback), R7 (syncState timing), R8 (processBattleEvent), and engine-api.md for the full API contract.

- [x] T012 [P] Create `app/public/src/game-engine-commands.ts` (~1000 lines) — extract player action functions from `app/rooms/commands/game-commands.ts` as plain functions. Each function accepts `(state: GameState, player: Player, context: IGameEngineContext, params)` and mutates state in-place. Extract from Command classes: buyPokemon (OnBuyPokemonCommand), sellPokemon (OnSellPokemonCommand), rerollShop (OnShopRerollCommand), levelUp (OnLevelUpCommand), lockShop (OnLockCommand), dragDropPokemon (OnDragDropPokemonCommand), dragDropItem (OnDragDropItemCommand), dragDropCombine (OnDragDropCombineCommand), pickBerry (OnPickBerryCommand), wandererClicked (OnPokemonCatchCommand), switchBenchAndBoard (OnSwitchBenchAndBoardCommand), removeFromShop (OnRemoveFromShopCommand). Note: pickPokemonProposition, pickItem are inline logic within OnUpdatePhaseCommand (extract to game-engine-phases.ts or implement directly in local-engine.ts). showEmote, reportLoadingProgress, reportLoadingComplete, sendVector are NOT Command classes — implement directly as simple state mutations or event emissions in local-engine.ts. Replace all ~49 `this.room` refs with context parameter, all ~167 `this.state` refs with state parameter, all 25 `client.send()` calls with `context.emit()`. Delete multiplayer-only commands (OnJoinCommand, OnLeaveCommand, chat, spectate, tournament, admin).
- [x] T013 [P] Create `app/public/src/game-engine-phases.ts` (~1200 lines) — extract `OnUpdatePhaseCommand` logic (1195 lines) from `app/rooms/commands/game-commands.ts` as plain functions. Functions for each phase transition: PICK→FIGHT, FIGHT→PICK, FIGHT→TOWN, TOWN→PICK. Accept `(state: GameState, context: IGameEngineContext)` parameters. Replace all `this.room.*` and `this.state.*` refs. Reuse existing Simulation, Shop, Player, MiniGame classes.
- [x] T014 Create `app/public/src/local-engine.ts` (~800 lines) — LocalGameEngine class implementing `IGameEngineContext`. Fields: engineState, clientState, encoder, decoder, intervalId, eventEmitter, humanPlayerId, botManager, miniGame, delayedActions, elapsedTime. Implement: startGame(config) with encodeAll()+discardChanges() initialization per R2; tick(deltaTime) with setInterval+performance.now() per R1, processing delayedActions queue; syncState() with encode→decode→discardChanges loopback per R7 (call after tick AND after each player action); on(event,cb)/emit(event,data) for Transfer events; all 19 player action methods delegating to game-engine-commands.ts; processBattleEvent per R8; dispose() saving to IndexedDB. Import from game-engine-commands.ts and game-engine-phases.ts.

**Checkpoint**: Foundation ready — LocalGameEngine exists, all core logic accepts IGameEngineContext. Client wiring can now begin.

---

## Phase 3: User Story 1 — Complete Game Playable In-Browser (Priority: P1) 🎯 MVP

**Goal**: A player can start and complete a full game (15+ rounds) against 7 bot opponents entirely in the browser with no server process.

**Independent Test**: Kill any running server process. Open the game in a browser. Start a match with 7 bots. Play through at least 5 rounds (buy Pokemon, position them, watch fights). Verify gold changes, HP changes, phase transitions, and battle outcomes all function correctly.

### Implementation for User Story 1

- [x] T015 [US1] Rewrite `app/public/src/network.ts` — replace Colyseus Client and room management with a LocalGameEngine singleton. Export the same convenience function names (buyPokemon, sellPokemon, rerollShop, levelUp, etc.) but bodies call engine methods instead of room.send(). Remove `@colyseus/sdk` import, remove `Client` instantiation, remove `rooms` object. Export engine instance and convenience functions. Full rewrite (~260 lines).
- [x] T016 [US1] Modify `app/public/src/game/game-container.ts` (~12 changes) and `app/public/src/game/components/board-manager.ts` (~3 changes) — in game-container.ts: replace constructor param from `Room<GameState>` to `LocalGameEngine`. Replace `getStateCallbacks(room)` with `getDecoderStateCallbacks(engine.decoder)`. Replace `SchemaCallbackProxy` type with inferred type. Replace 4 `room.send(Transfer.*)` with engine method calls. Replace 1 `room.onMessage(Transfer.DRAG_DROP_CANCEL)` with `engine.on(Transfer.DRAG_DROP_CANCEL)`. Replace 3 `room.state` reads with `engine.clientState`. Remove `room.onError`. Remove `@colyseus/sdk` imports. In board-manager.ts: update constructor type to match game-container's new LocalGameEngine param.
- [x] T017 [US1] Modify `app/public/src/game/scenes/game-scene.ts` (~27 changes) — change `room` property type from `Room<GameState>` to `LocalGameEngine`. Replace 9 `this.room?.send(Transfer.*)` calls with engine method calls (LOADING_PROGRESS, LOADING_COMPLETE, LOCK, REFRESH, LEVEL_UP, SELL_POKEMON, REMOVE_FROM_SHOP, SWITCH_BENCH_AND_BOARD, VECTOR). Replace 16 `this.room.state` / `this.room?.state` reads with `this.engine.clientState` (manager initializations at lines 124-159, phase checks at lines 185/287/327/463/528/570/648/729, specialGameRule at lines 539/579, players at line 677). Replace 1 `this.room!.onMessage` with `this.engine.on`. Remove `Room` type import from `@colyseus/sdk`.
- [x] T018 [US1] Modify `app/public/src/pages/game.tsx` (~46 changes) — replace `getStateCallbacks(room)` with `getDecoderStateCallbacks(engine.decoder)`. Replace 16 `room.onMessage(Transfer.*)` listeners with `engine.on(Transfer.*)`. Replace ~20 `room.state` / `room?.state` / `gameContainer.room?.state` reads with `engine.clientState` (direct reads: players.size, gameFinished, players.forEach, stageLevel ×2, noElo, gameMode, phase ×3, additionalPokemons; gameContainer refs at lines 111/126-131; spectated player refs at lines 835-840). Remove 6 lifecycle refs (`room.leave()`, `room.onDrop()`, `room.onReconnect()`, `room.onLeave()`, `room.reconnectionToken`, `room.roomId`). Update GameContainer creation to pass engine instead of room. Remove `Room` type import from `@colyseus/sdk`. Remove `AfterGameState` import (no longer used for room creation).
- [x] T019 [P] [US1] Modify `app/public/src/pages/after-game.tsx` (~60 lines rewritten) — remove Colyseus reconnection logic (reconnectionToken, roomId, room.leave). Replace full useEffect with reading engine final state directly from the LocalGameEngine instance. Remove `@colyseus/sdk` Room type import. Remove AfterGameState import.
- [x] T020 [P] [US1] Modify `app/public/src/game/components/berry-tree.ts` — replace 1 `room.send(Transfer.PICK_BERRY)` with `engine.pickBerry(index)`.
- [x] T021 [P] [US1] Modify `app/public/src/game/components/wanderers-manager.ts` — replace 3 `room.send(Transfer.WANDERER_CLICKED)` with `engine.wandererClicked(id)`.
- [x] T022 [P] [US1] Modify `app/public/src/game/components/minigame-manager.ts` — replace 1 `room.onMessage(Transfer.NPC_DIALOG)` with `engine.on(Transfer.NPC_DIALOG)`. Also replace 3 `room.state` / `room?.state` accesses with `engine.clientState` (players at line 97, specialGameRule at line 606, stageLevel at line 615).
- [x] T023 [P] [US1] Modify `app/public/src/game/components/pokemon-avatar.ts` — replace `room.state` accesses with `engine.clientState` (~3 changes).
- [x] T024 [P] [US1] Modify `app/public/src/game/components/loading-manager.ts` — replace 1 `room.state` access with `engine.clientState` (players iteration at line 97).
- [x] T025 [P] [US1] Modify `app/public/src/game/components/sell-zone.ts` — replace 1 `room.state` access with `engine.clientState` (specialGameRule at line 55).
- [x] T026 [US1] Update Redux stores — in `app/public/src/stores/LobbyStore.ts` remove `RoomAvailable` type import from `@colyseus/sdk` and replace with plain interface; in `app/public/src/stores/NetworkStore.ts` replace `leaveAllRooms` with `engine.dispose()`, remove `rooms` object references (5 `rooms.lobby?.send()` calls). Note: `GameStore.ts` has zero Colyseus imports (already clean).
- [x] T027 [US1] Strip Colyseus from server entry points — in `app/index.ts` remove Colyseus server initialization (`listen()`, `matchMaker`, `Encoder.BUFFER_SIZE`, `checkLobby()` cron — keep Express static file serving for Phase 3); in `app/app.config.ts` remove all 4 room definitions and Colyseus monitor middleware. Keep static API routes: `/pokemons`, `/pokemons-index`, `/types`, `/types-trigger`, `/items`, `/titles`. Also keep dynamic routes still functional after Phase 1: `/tilemap/:map` (game rendering), `/status` (health check), `/game-history/:playerUid` (uses `getGameHistoryByPlayer` — already converted to local storage in Phase 1), `/bots` and `/bots/:id` (uses `fetchBotsList`/`fetchBot` — already converted to static JSON in Phase 1), `/profile` (uses `getPlayer` — already converted to local storage in Phase 1). All retained routes are removed in Phase 3.

**Checkpoint**: At this point, the game should be fully playable in-browser with no server dependency. All game commands (buy, sell, drag-drop, reroll, level-up, lock shop) work locally. Phase transitions, battle simulation, income, damage, and ranking all function.

---

## Phase 4: User Story 2 — Battle Visuals and Events Render Correctly (Priority: P2)

**Goal**: All combat visuals (ability animations, damage/heal numbers, status icons, weather effects, board events) render identically to the pre-refactoring version.

**Independent Test**: Play a game with Pokemon that have diverse abilities (projectile, AoE, status-inflicting). Verify every ability animation plays, damage numbers float correctly, status icons appear, weather effects render, and board events display.

### Implementation for User Story 2

- [x] T028 [US2] Verify all 18 Transfer event emissions in `app/public/src/local-engine.ts` match the contract in `specs/003-remove-colyseus/contracts/engine-api.md`. Ensure `processBattleEvent` correctly emits ABILITY, POKEMON_DAMAGE, POKEMON_HEAL events. Ensure phase transition logic emits PLAYER_DAMAGE, PLAYER_INCOME, FINAL_RANK, GAME_END, SIMULATION_STOP, BOARD_EVENT, CLEAR_BOARD_EVENT, CLEAR_BOARD. Ensure item/passive effects emit COOK, DIG via `context.emit`. Ensure minigame emits NPC_DIALOG, PRELOAD_MAPS. Ensure SHOW_EMOTE, LOADING_COMPLETE, DRAG_DROP_CANCEL are emitted at correct points. Fix any missing or incorrect emissions.

**Note**: US2 coverage is largely provided by US1's event wiring in T015-T018 (which connects the event pipeline). T028 is a verification/fix task — ensuring all 18 event types are correctly emitted, not new implementation.

**Checkpoint**: Battle visuals render identically to pre-refactoring version. Schema loopback automatically handles state-based rendering (HP bars, positions, status icons, weather). Event emissions handle RPC-style visuals (ability animations, floating numbers).

---

## Phase 5: User Story 3 — Game Setup Flow Without Lobby/Preparation Rooms (Priority: P3)

**Goal**: Simplified lobby page with "Start Game" button and bot configuration. No preparation room step.

**Independent Test**: Open the game. On the simplified lobby page, verify profile and collection are accessible. Click "Start Game", select bot difficulty, start the game. Verify the game launches with the selected configuration.

### Implementation for User Story 3

- [x] T029 [US3] Modify `app/public/src/pages/lobby.tsx` — remove multiplayer elements (room list, chat, player search, tournament UI). Retain profile and Pokemon collection features. Add "Start Game" button that opens a configuration panel with bot difficulty selection (Easy/Medium/Hard) and optional special game rules (SpecialGameRule enum). On confirm, call `engine.startGame(config)` with a `GameConfig` object and navigate to game page. Also delete all tournament UI files (multiplayer-only): `app/public/src/pages/component/room-menu/tournament-item.tsx` + CSS, `app/public/src/pages/component/events-menu/tournaments-list.tsx` + CSS, `app/public/src/pages/component/tournaments-admin/tournaments-admin.tsx` + CSS. Remove tournament imports from `events-menu.tsx` (imports `TournamentsList`) and `main-sidebar.tsx` (imports `TournamentsAdmin`).
- [x] T030 [US3] Modify `app/public/src/game/lobby-logic.ts` — remove Colyseus room connection logic (lobby room join, preparation room creation, game room joining). Remove reconnection logic (reconnectionToken, roomId persistence). Simplify to local flow: lobby page shows profile/collection, "Start Game" creates LocalGameEngine and navigates to game. Remove `LobbyState` and `PreparationState` imports.
- [x] T031 [P] [US3] Delete `app/public/src/pages/preparation.tsx` and remove all references to it (route definition, imports, navigation). The preparation step is eliminated — engine auto-starts with selected bots.
- [x] T032 [P] [US3] Delete `app/public/src/stores/PreparationStore.ts` and remove all imports/usage across the codebase. Remove preparation-related Redux state from root store.
- [x] T033 [P] [US3] Delete `app/public/src/pages/component/room-menu/game-rooms-menu.tsx` and `app/public/src/pages/component/room-menu/game-room-item.tsx`. Remove all imports/usage of these multiplayer room listing components from lobby and other pages.

**Checkpoint**: Three-screen flow works: Lobby (with Start Game) → Game → AfterGame. Player can start new games with different bot configurations without page reload.

---

## Phase 6: User Story 4 — All Colyseus Dependencies Removed (Priority: P4)

**Goal**: Zero Colyseus networking dependencies in codebase. Clean build with only `@colyseus/schema` retained.

**Independent Test**: Run `npm run build`. Search codebase for `colyseus` imports. Verify zero matches outside `node_modules` and `@colyseus/schema`. Verify `app/rooms/` directory does not exist.

### Implementation for User Story 4

- [x] T034 [US4] Delete `app/rooms/` directory entirely — remove all 4 room files (`game-room.ts`, `custom-lobby-room.ts`, `preparation-room.ts`, `after-game-room.ts`), all 3 command files (`game-commands.ts`, `lobby-commands.ts`, `preparation-commands.ts`), and remaining 3 state files (`lobby-state.ts`, `preparation-state.ts`, `after-game-state.ts`). Remove `GameRoom` import from `app/types/index.ts`. Remove any remaining imports of room/command/state files across the codebase.
- [x] T035 [US4] Remove 9 Colyseus npm packages from `package.json` — uninstall `colyseus`, `@colyseus/command`, `@colyseus/monitor`, `@colyseus/redis-driver`, `@colyseus/redis-presence`, `@colyseus/sdk`, `@colyseus/testing`, `@colyseus/tools`, `@colyseus/ws-transport`. Retain `@colyseus/schema` (Phase 4 removal). Run `npm install` to update lock file.
- [x] T036 [US4] Final build and lint verification — run `npm run build` and `npm run lint`. Grep entire `app/` directory (excluding `node_modules` and `dist/`) for any remaining `colyseus` imports that are NOT `@colyseus/schema`. Verify zero matches. Verify `app/rooms/` directory does not exist. Verify `package.json` contains no Colyseus packages except `@colyseus/schema`.

**Checkpoint**: Codebase is fully clean. Only `@colyseus/schema` remains (deferred to Phase 4 of the overall migration plan).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation of all user stories working together.

- [x] T037 Manual play-test validation per spec.md acceptance scenarios — play a full game (15+ rounds) against 7 bot opponents with no server running. Verify: US1 (game loop, shop, drag-drop, battle, income, damage, ranking, ELO saved to IndexedDB), US2 (ability animations, damage/heal floating numbers, status icons, weather effects, board events), US3 (lobby Start Game flow, bot difficulty selection, return to lobby after game), US4 (build passes, zero stale references). Document any issues found and create fix tasks if needed.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 completion — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (engine must exist before client wiring)
- **US2 (Phase 4)**: Depends on Phase 3 (event pipeline must be wired)
- **US3 (Phase 5)**: Depends on Phase 3 (engine startGame flow must work)
- **US4 (Phase 6)**: Depends on Phase 3 + 5 (all references must be migrated before deletion)
- **Polish (Phase 7)**: Depends on all phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational — no dependency on other stories
- **US2 (P2)**: Depends on US1 — event pipeline must be wired before verification
- **US3 (P3)**: Depends on US1 — engine must exist for lobby to start games
- **US4 (P4)**: Depends on US1 + US3 — all references must be migrated before cleanup

### Within Each Phase

- Setup: T001 → T002 (interface needs GameState moved first), T003 is parallel
- Foundational: T004-T011 all parallel, then T012 [P] + T013 [P] parallel, then T014 (depends on T012+T013)
- US1: T015 first (network.ts — other files import from it), then T016→T017→T018 sequential (game-container→game-scene→game.tsx coupling), T019-T025 parallel with T016-T018 (independent components), T026-T027 after all client files updated

### Parallel Opportunities

```
Phase 2 — 8 core files in parallel:
  T004 (simulation.ts)  T005 (effect.ts)     T006 (mini-game.ts)
  T007 (items.ts)        T008 (passives.ts)   T009 (synergies.ts)
  T010 (abilities.ts)    T011 (hidden-power.ts)

Phase 2 — 2 engine files in parallel:
  T012 (game-engine-commands.ts)    T013 (game-engine-phases.ts)

Phase 3 — 6 components in parallel (after T015):
  T020 (berry-tree)      T021 (wanderers)     T022 (minigame-mgr)
  T023 (pokemon-avatar)  T024 (loading-mgr)   T025 (sell-zone)

Phase 5 — 3 deletions in parallel:
  T031 (preparation.tsx)  T032 (PreparationStore)  T033 (room-menu)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T014)
3. Complete Phase 3: User Story 1 (T015-T027)
4. **STOP and VALIDATE**: Play a full game in-browser — buy, sell, drag, fight, phase transitions, ranking
5. Game is playable at this point (MVP)

### Incremental Delivery

1. Setup + Foundational → Engine ready
2. Add US1 → Game playable in-browser → **MVP!**
3. Add US2 → Battle visuals verified
4. Add US3 → Lobby simplified, clean start flow
5. Add US4 → Codebase cleaned, all Colyseus networking removed
6. Each story adds value without breaking previous stories

---

## Notes

- [P] tasks = different files, no dependencies between them
- [Story] label maps task to specific user story for traceability
- Build must pass at every commit (SC-007)
- Commit after each task
- `@colyseus/schema` is intentionally retained — removed in Phase 4 of overall migration
- Schema encode/decode loopback means ~500 lines of .listen()/.onAdd()/.onChange() callbacks remain UNTOUCHED
- The "rooms/ still exists" during Phases 1-5 is intentional — old code serves as reference until US4 cleanup
