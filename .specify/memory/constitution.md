<!--
  Sync Impact Report
  Version change: 1.0.0 → 1.1.0
  Modified sections: Refactoring Phases (extracted to PHASE.md)
  Added files: PHASE.md (detailed roadmap with metrics)
  Templates requiring updates: N/A
  Follow-up TODOs: None
-->

# Pokemon Auto Chess — Single Player Edition Constitution

## Mission Statement

Refactor Pokemon Auto Chess from a multiplayer server-authoritative architecture (Colyseus + MongoDB + Firebase) into a **standalone single-player browser game** with zero external service dependencies. The game engine runs entirely in the browser. All gameplay — Pokemon battles, synergies, items, shop mechanics — MUST be preserved identically.

## Core Principles

### I. Zero External Dependencies

The final product MUST run as a static SPA with **no server, no database, no authentication service**. Concretely:

- No Colyseus, no WebSocket, no client-server protocol
- No MongoDB, no Mongoose, no external persistence
- No Firebase Auth, no token verification
- No Express, no Node.js runtime at serve-time
- No Redis, no external caching

Persistence uses browser-native APIs (IndexedDB/localStorage) exclusively. If it requires a running process beyond the browser, it is forbidden.

### II. Game Engine Independence

The battle simulation engine MUST be a **pure TypeScript module** with zero framework dependencies. Concretely:

- No `extends Schema` (Colyseus) on any game logic class
- No `room: GameRoom` references in simulation code
- No direct UI/rendering calls from game logic
- `BattleEngine.update(dt)` returns `BattleEvent[]` — it does not broadcast, render, or persist
- The engine MUST be independently instantiable: `new BattleEngine(config)` works without any external context

This is the **single most important principle**. Every other refactoring phase depends on this separation being clean.

### III. Gameplay Fidelity

All existing game mechanics MUST be preserved with **identical behavior**:

- All Pokemon, abilities, evolutions, and stat calculations
- All synergy triggers, thresholds, and effects
- All item combinations and effects
- Shop mechanics: reroll, lock, pool probabilities, level-up costs
- Battle simulation: damage, movement, targeting, status effects
- Phase management: preparation, battle, carousel, post-round

If the same board configuration produces different battle outcomes before and after refactoring, it is a **regression bug**. RNG seed reproducibility is encouraged but not mandatory.

### IV. Atomic Traceability

Every discrete change MUST be captured in a **git commit** before proceeding to the next change. Concretely:

- One logical change = one commit. Do not batch unrelated changes.
- Commit message format: `[spec-NNN] <type>: <description>` where type is one of: `extract`, `remove`, `replace`, `refactor`, `fix`, `cleanup`.
- Example: `[spec-001] extract: decouple Simulation from Colyseus Schema`
- After each commit, `npm run build` MUST succeed. A commit that breaks the build is forbidden.
- If a change spans multiple files but serves one purpose, it is ONE commit.
- If a change serves multiple purposes, split it into multiple commits.

This ensures the entire refactoring process is **reviewable, revertable, and bisectable**.

### V. Incremental Viability

At every phase boundary, the application MUST be in a **working state**. Concretely:

- Phase 0 complete: game still works as multiplayer (engine extracted but GameRoom still uses it)
- Phase 1 complete: game works without MongoDB (local persistence)
- Phase 2 complete: game works without Colyseus (local engine drives UI)
- Phase 3 complete: game works as pure static SPA

Never enter a state where "everything is broken and we'll fix it later." Each phase is a safe checkpoint you can ship from if needed.

### VI. Simplicity Over Abstraction

Follow the YAGNI principle ruthlessly during refactoring:

- Do NOT introduce adapter/strategy/factory patterns "for flexibility" — solve the concrete problem
- Do NOT add configuration for multiplayer/single-player switching — we are permanently removing multiplayer
- Do NOT preserve dead code "just in case" — if it serves no single-player purpose, delete it
- Prefer deleting 100 lines over adding 10 lines of abstraction
- If a module has zero imports after refactoring, delete the file entirely

## Deletion Manifest

The following dependencies and modules are **explicitly marked for removal** across the refactoring phases:

### npm packages to remove
- `@colyseus/core`, `@colyseus/tools`, `@colyseus/ws-transport`, `@colyseus/schema`, `@colyseus/monitor`
- `mongoose`, `mongodb`
- `firebase-admin`, `firebase` (client SDK)
- `express`, `helmet`, `cors` (if only used by Express server)
- `ioredis` or any Redis client

### Source modules to remove
- `app/rooms/` — all Colyseus room definitions and commands
- `app/models/mongo-models/` — all Mongoose schemas
- `app/services/` — all server-side services (leaderboard, meta, bots, cronjobs, Discord)
- `app/index.ts` — server entry point
- `app/app.config.ts` — Express + Colyseus server config
- `app/public/src/network.ts` — Colyseus client connection

### Source modules to preserve (refactored)
- `app/core/` — battle simulation (remove Schema inheritance)
- `app/config/game/` — balance data (keep as-is)
- `app/types/` — shared enums and types (keep as-is)
- `app/models/colyseus-models/pokemon.ts` — strip Colyseus decorators, keep Pokemon data
- `app/public/src/stores/` — Redux stores (change data source from network to local engine)
- `app/public/src/game/` — Phaser rendering (change listeners from Colyseus to local events)
- `app/public/src/pages/` — React UI (minimal changes, already Redux-based)

## Refactoring Phases

See **[PHASE.md](PHASE.md)** for the complete roadmap with dependency graph, per-phase Before/After states, impact analysis, file counts, and completion criteria.

Summary: 5 phases (extract engine → remove MongoDB → remove Colyseus → remove server → cleanup schemas). Phase 0 and Phase 1 are independent and may proceed in parallel.

## Development Workflow

### Per-Task Workflow

```
1. Read the task from tasks.md
2. Understand affected files (read before modify)
3. Make the change
4. Run: npm run build (MUST pass)
5. Run: npm run lint (SHOULD pass, fix if trivial)
6. Git commit with message: [spec-NNN] <type>: <description>
7. Mark task complete in tasks.md
8. Proceed to next task
```

### Per-Phase Workflow

```
1. /speckit.specify — define the spec (Before/After states)
2. /speckit.plan — generate implementation plan
3. /speckit.tasks — generate task list
4. /speckit.implement — execute tasks (with commits after each)
5. Verify: npm run build passes
6. Create phase completion commit: [spec-NNN] checkpoint: phase N complete
```

### Commit Discipline

- **Granularity**: One commit per logical change (not per file, not per line)
- **Build gate**: `npm run build` MUST succeed at every commit
- **Message format**: `[spec-NNN] <type>: <description>`
- **No squashing during refactoring** — the full history is the audit trail
- **Tag phase completions**: `git tag phase-N-complete` after each phase checkpoint

## Governance

This constitution is the **supreme authority** for all refactoring decisions. When in doubt:

1. Does it break gameplay? → Do not proceed (Principle III)
2. Does it add complexity? → Find the simpler path (Principle VI)
3. Does it leave the app broken? → Split into smaller steps (Principle V)
4. Is it committed and traceable? → If not, commit first (Principle IV)

Amendments to this constitution require updating this file with a version bump and a commit: `[constitution] amend: <reason>`.

**Version**: 1.1.0 | **Ratified**: 2026-03-05 | **Last Amended**: 2026-03-05
