# Feature Specification: Remove Colyseus

**Feature Branch**: `003-remove-colyseus`
**Created**: 2026-03-07
**Status**: Draft
**Input**: Phase 2 of multiplayer to single-player refactoring. Replace the Colyseus networking layer with a local game engine that runs entirely in the browser. Client Redux stores and Phaser renderer connect directly to the local engine instead of receiving state over WebSocket.

## Clarifications

### Session 2026-03-07

- Q: @colyseus/schema package scope — remove in Phase 2 or retain for Phase 4? → A: Retain `@colyseus/schema` in Phase 2. Only remove networking packages (`@colyseus/sdk`, `colyseus`, `@colyseus/tools`, `@colyseus/drivers`). Schema/MapSchema/ArraySchema/SetSchema/@type() cleanup is deferred to Phase 4.
- Q: Express server scope — remove in Phase 2 or defer to Phase 3? → A: Retain Express server in Phase 2, only strip Colyseus room definitions and networking routes. Full server removal is Phase 3.
- Q: Game setup UX — new screen, simplified existing, or keep two-page flow? → A: Simplify existing lobby page. Remove multiplayer elements (room list, chat, player search). Retain profile and collection. Add "Start Game" button with bot difficulty + special rules panel. Delete preparation page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Complete Game Playable In-Browser Without Server (Priority: P1)

A player launches the game in their browser, starts a match against bots, and plays a full game to completion — buying Pokemon from the shop, positioning them on the board, watching battles play out, earning gold and experience, leveling up, and seeing a final ranking — all without any server process running. The game loop (phase transitions: PICK to FIGHT to PICK), shop system, drag-drop, battle simulation, player damage, income, and ELO calculation all execute locally in the browser.

**Why this priority**: This is the core deliverable. Without the game loop running locally, nothing else matters. Every other story depends on this working first.

**Independent Test**: Kill any running server process. Open the game in a browser. Start a match with 7 bots. Play through at least 5 rounds (buy Pokemon, position them, watch fights). Verify gold changes, HP changes, phase transitions, and battle outcomes all function correctly.

**Acceptance Scenarios**:

1. **Given** no server process running, **When** a player starts a new game with 7 bot opponents, **Then** the game initializes with 8 players (1 human + 7 bots), assigns starting gold, and enters the first PICK phase.
2. **Given** a PICK phase, **When** the player buys a Pokemon from the shop, drags it to the board, and the timer expires, **Then** the phase transitions to FIGHT, a battle simulation runs against the matched opponent, and the player sees battle animations, damage numbers, and ability effects.
3. **Given** a FIGHT phase completes, **When** the simulation ends, **Then** the winning side is determined, the loser takes HP damage proportional to surviving enemy Pokemon, both players receive income (interest + streak + base), and the phase transitions back to PICK.
4. **Given** a full game in progress, **When** a player is eliminated (HP reaches 0), **Then** they receive a final rank, ELO is recalculated, game history is saved to IndexedDB, and the after-game screen displays results.
5. **Given** a game in PICK phase, **When** the player rerolls the shop, locks the shop, sells a Pokemon, levels up, equips an item, or combines items, **Then** each action produces the same outcome as the previous multiplayer version (gold deducted, XP gained, item applied, etc.).

---

### User Story 2 - Battle Visuals and Events Render Correctly (Priority: P2)

During battles, the Phaser renderer displays all combat visuals identically to the previous networked version — Pokemon movement, attack animations, ability effects (projectiles, AoE, buffs), damage/heal floating numbers, weather effects, status conditions (burn, freeze, paralysis icons), and board events (berry tree, flame orb, etc.). The visual fidelity is indistinguishable from the multiplayer version.

**Why this priority**: The game is technically playable without visuals (US1), but without correct rendering it's unplayable in practice. This validates that the event pipeline from local engine to Phaser works correctly.

**Independent Test**: Play a game with Pokemon that have diverse abilities (projectile, AoE, status-inflicting). Verify every ability animation plays, damage numbers float correctly, status icons appear, weather effects render, and board events display.

**Acceptance Scenarios**:

1. **Given** a battle where a Pokemon uses an ability, **When** the local engine emits an ABILITY event, **Then** the Phaser scene renders the correct animation at the correct position with correct orientation.
2. **Given** a battle where a Pokemon takes damage, **When** the local engine emits a POKEMON_DAMAGE event, **Then** a floating damage number appears above the Pokemon sprite with the correct value and damage type color.
3. **Given** a battle where a Pokemon heals, **When** the local engine emits a POKEMON_HEAL event, **Then** a floating heal number appears in green above the Pokemon sprite.
4. **Given** a battle with weather active, **When** the simulation weather changes, **Then** the Phaser scene updates the weather overlay effect.
5. **Given** a battle where a Pokemon gains a status condition (burn, freeze, charm, etc.), **When** the status is applied, **Then** the corresponding status icon appears on the Pokemon sprite.

---

### User Story 3 - Game Setup Flow Works Without Lobby/Preparation Rooms (Priority: P3)

The existing lobby page is simplified for single-player: multiplayer elements (room list, chat, player search, tournament) are removed, while profile and Pokemon collection are retained. A "Start Game" button opens a configuration panel for bot difficulty and optional special rules, then launches directly into a game. The preparation page is deleted entirely — no waiting-for-players step needed.

**Why this priority**: The game setup UX can be simplified significantly since there are no other human players to coordinate with. This is lower priority because a hardcoded default setup would still allow testing US1 and US2.

**Independent Test**: Open the game. On the simplified lobby page, verify profile and collection are accessible. Click "Start Game", select bot difficulty, start the game. Verify the game launches with the selected configuration.

**Acceptance Scenarios**:

1. **Given** the player is on the lobby page, **When** they view the interface, **Then** profile and Pokemon collection features are accessible, and multiplayer elements (room list, chat, player search, tournaments) are absent.
2. **Given** the player clicks "Start Game", **When** the configuration panel opens, **Then** they can select bot difficulty and optionally set special game rules.
3. **Given** game configuration is set, **When** the player confirms, **Then** the local engine initializes a game with the selected settings and transitions directly to the first PICK phase (no preparation room step).
4. **Given** the player finishes a game, **When** the after-game screen is shown, **Then** the player can return to the lobby page and start a new game without page reload.

---

### User Story 4 - All Colyseus Dependencies Removed From Codebase (Priority: P4)

The application builds and runs with zero Colyseus networking dependencies. All server-side room files (`app/rooms/`), the Colyseus client SDK (`@colyseus/sdk`), server package (`colyseus`), and tooling (`@colyseus/tools`, `@colyseus/drivers`) are removed from `package.json`. The `@colyseus/schema` package is retained as a data structure library (removed in Phase 4). The `app/public/src/network.ts` file is replaced.

**Why this priority**: This is the cleanup/validation story. It ensures the migration is truly complete and no dead code remains. It depends on US1-US3 being functional first.

**Independent Test**: Run `npm run build`. Search the entire codebase for any `colyseus` import. Verify zero matches outside of `node_modules`. Verify `package.json` contains no `colyseus` or `@colyseus` dependencies.

**Acceptance Scenarios**:

1. **Given** the refactored codebase, **When** `npm run build` is executed, **Then** the build succeeds with zero Colyseus-related imports.
2. **Given** the refactored codebase, **When** searching for `colyseus` in all source files, **Then** zero matches are found.
3. **Given** `package.json`, **When** inspecting dependencies and devDependencies, **Then** no `colyseus`, `@colyseus/sdk`, `@colyseus/tools`, or `@colyseus/drivers` packages are listed. `@colyseus/schema` is retained (removed in Phase 4).
4. **Given** the `app/rooms/` directory, **When** checking its existence, **Then** it does not exist (fully deleted).

---

### Edge Cases

- What happens when the browser tab loses focus during a battle? The game loop continues via `setInterval` with delta-time compensation; no WebSocket timeout to worry about.
- What happens when a bot's board configuration references a Pokemon or item that doesn't exist in the current game data? The engine skips invalid entries gracefully and logs a warning, continuing with valid pieces.
- What happens when the player refreshes the page mid-game? The current game state is lost (no server to reconnect to). The player returns to the main screen and can start a new game. Game history is only saved on game completion.
- What happens when the local engine's game loop produces events faster than Phaser can render? Events are queued and processed on the next render frame; no events are dropped.
- What happens when the player's device is slow and `deltaTime` spikes? Delta time is capped (existing `MAX_SIMULATION_DELTA_TIME` logic preserved) to prevent physics glitches.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a local game engine that runs the complete game loop (phase transitions, shop, simulation, income, damage, ranking) in the browser without any server process or WebSocket connection.
- **FR-002**: All client-side `room.send(Transfer.*)` calls (20+ command types across `network.ts`) MUST be replaced with direct method calls on the local engine (e.g., `room.send(Transfer.SHOP, {id})` becomes `engine.buyPokemon(id)`).
- **FR-003**: All Colyseus Schema state listeners in `game-container.ts` (~150 listeners), `game.tsx` (~200 listeners), `lobby-logic.ts` (~50 listeners), and `preparation.tsx` (~20 listeners) MUST be served by the Schema encode/decode loopback — the `$` function source changes from `getStateCallbacks(room)` to `getDecoderStateCallbacks(engine.decoder)` (1 line each), and all existing `.listen()` / `.onAdd()` / `.onChange()` callbacks remain untouched, producing identical data flow to Redux stores and Phaser scenes. Other `room.*` references (`.send()`, `.onMessage()`, `.state` reads) are modified separately.
- **FR-004**: The local engine MUST emit typed events matching the current `Transfer` enum message types (ABILITY, POKEMON_DAMAGE, POKEMON_HEAL, BOARD_EVENT, CLEAR_BOARD_EVENT, SIMULATION_STOP, PLAYER_DAMAGE, PLAYER_INCOME, SHOW_EMOTE, FINAL_RANK, etc.) so that Phaser rendering code receives data in the same format.
- **FR-005**: The local engine MUST preserve all single-player game commands from `game-commands.ts` (2280 lines): buy/sell Pokemon, shop reroll, lock shop, level up, drag-drop Pokemon/items/combine, pick Pokemon proposition, pick item, Pokemon catch, berry pick. Multiplayer-only commands (spectate, chat, admin overwrite) are deleted.
- **FR-006**: The local engine MUST run bot AI logic — loading bot board configurations from static JSON (implemented in Phase 1) and applying them at the correct game stages.
- **FR-007**: The local engine MUST compute ELO changes and save game history to IndexedDB (using the persistence layer from Phase 1) when a game completes.
- **FR-008**: The 4 Colyseus room files (`custom-lobby-room.ts`, `preparation-room.ts`, `game-room.ts`, `after-game-room.ts`), 3 command files (`game-commands.ts`, `lobby-commands.ts`, `preparation-commands.ts`), and 3 state files (`preparation-state.ts`, `lobby-state.ts`, `after-game-state.ts`) MUST be deleted. `game-state.ts` is MOVED to `app/models/colyseus-models/game-state.ts` (not deleted — still used by engine and Schema loopback).
- **FR-009**: The `app/public/src/network.ts` file MUST be replaced with a local engine module that exports the same convenience functions (same function names where applicable) to minimize call-site changes in React components.
- **FR-010**: All 9 Colyseus networking packages MUST be removed from `package.json`: `colyseus`, `@colyseus/command`, `@colyseus/monitor`, `@colyseus/redis-driver`, `@colyseus/redis-presence`, `@colyseus/sdk`, `@colyseus/testing`, `@colyseus/tools`, `@colyseus/ws-transport`. The `@colyseus/schema` package is retained as a data structure library for MapSchema/ArraySchema/SetSchema/Schema — its removal is deferred to Phase 4.
- **FR-011**: The `app/app.config.ts` server configuration MUST be stripped of all Colyseus room definitions and networking routes. The Express server and `app/index.ts` are retained as a static file server for development — their full removal is deferred to Phase 3. Express API endpoints that serve static game data (`/pokemons`, `/items`, `/types`, `/titles`) are retained in Phase 2 (removed in Phase 3).
- **FR-012**: The local engine MUST handle the minigame phase (Pokemon catching between rounds) that currently runs in the TOWN phase of `game-room.ts`.
- **FR-013**: All room references in core files (`simulation.ts`, `mini-game.ts`, `effect.ts`, `items.ts`, `passives.ts`, `synergies.ts`, `abilities.ts`, `hidden-power.ts` — 38 refs across 8 files) MUST be fully resolved by replacing `GameRoom` with `IGameEngineContext` interface — either reimplemented without room dependency or removed if the functionality is multiplayer-only.
- **FR-014**: The build process MUST pass (`npm run build`) with zero Colyseus-related imports after migration.
- **FR-015**: Redux stores (`GameStore`, `LobbyStore`, `PreparationStore`, `AfterGameStore`, `NetworkStore`) MUST be updated to remove Colyseus Schema type imports and use plain TypeScript types instead.

### Key Entities

- **LocalGameEngine**: The central game controller that replaces all 4 Colyseus rooms. Manages game lifecycle (setup to game-over), runs the game loop via timer, delegates battle simulation to the existing `Simulation` class, and emits typed events for the UI layer. Provides public methods for all player actions (buy, sell, drag-drop, level-up, etc.).
- **EventEmitter** (field within LocalGameEngine): A typed event bus that replaces Colyseus broadcast. Emits events matching the `Transfer` enum types so Phaser and React listeners receive data in the same format. Exposed via `engine.on(event, callback)` and internally via `engine.emit(event, data)`. Not a separate class — it is the `eventEmitter` field of LocalGameEngine.
- **GameConfig**: Configuration object for starting a new game — bot selections, special game rules, player profile. Replaces the preparation room's state accumulation.

### Assumptions

- Phase 0 (Extract Game Engine) is complete: `Simulation.update(dt)` returns `BattleEvent[]` without requiring a `GameRoom` instance. The engine can run standalone.
- Phase 1 (Remove MongoDB) is complete: Player profiles and game history persist via IndexedDB. Bot data is bundled as static JSON.
- The `@colyseus/schema` imports in `app/models/colyseus-models/` (17 files with `@type()` decorators and `extends Schema`) are handled in Phase 4. Phase 2 removes the networking layer but Schema stripping is a separate concern.
- MapSchema, ArraySchema, and SetSchema usage in core engine files (`simulation.ts`, `pokemon-entity.ts`, etc.) is retained in Phase 2. These are Colyseus data structures that still function without a network connection. Phase 4 replaces them with native Map/Array/Set.
- The game timer/clock that currently runs via Colyseus's `setSimulationInterval` can be replaced with a standard timer loop with equivalent delta-time behavior.
- Tournament functionality (`app/core/tournament-logic.ts`, tournament-related commands) is multiplayer-only and is removed entirely.
- Chat functionality is multiplayer-only and is removed entirely.
- Admin commands (ban, unban, give role, give title, give booster, heap snapshot) are multiplayer-only and are removed entirely.
- The Colyseus `Presence` system (Redis-based cross-room communication) is not needed and is removed entirely.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A player can start and complete a full game (15+ rounds) against 7 bot opponents entirely in the browser with no server process running, achieving the same gameplay experience as the multiplayer version.
- **SC-002**: All battle visuals (ability animations, damage/heal numbers, status icons, weather effects, board events) render identically to the pre-refactoring version, verified by visual comparison of the same battle scenarios.
- **SC-003**: The production build succeeds with zero references to `@colyseus/sdk`, `@colyseus/tools`, `@colyseus/drivers`, or `colyseus` (server) in source files or `package.json`. `@colyseus/schema` imports are permitted (deferred to Phase 4).
- **SC-004**: The `app/rooms/` directory does not exist after refactoring (10 files deleted + 1 file moved to `app/models/colyseus-models/`, ~7040 lines removed from `rooms/`).
- **SC-005**: The `app/public/src/network.ts` Colyseus client module is replaced with a local engine module. All 20+ message-sending functions are converted to direct engine method calls.
- **SC-006**: Game actions (buy, sell, drag-drop, reroll, level-up, lock shop, pick proposition, pick item) produce identical state changes as the server-validated versions, verified by playing through diverse game scenarios.
- **SC-007**: Every incremental change compiles successfully (`npm run build` passes at every commit).
