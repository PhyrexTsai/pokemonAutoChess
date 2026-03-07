# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pokemon Auto Chess — a real-time multiplayer auto-battler built with **Colyseus** (server), **Phaser 3** (game rendering), **React 19** (UI), and **MongoDB** (persistence). Full-stack TypeScript (~104K lines). Server-authoritative: clients are "dumb terminals" that send commands and render synced state.

## Commands

```bash
npm run dev              # Start client + server in watch mode (http://localhost:9000)
npm run dev-client       # Client only (esbuild watch)
npm run dev-server       # Server only (ts-node-dev)
npm run build            # Production build (client esbuild + server tsc)
npm start                # Run production build
npm run lint             # Biome linter
npm run format           # Biome formatter
npm run check            # Biome check with auto-fix
npm run assetpack        # Pack sprite textures (run after asset changes)
npm run download-music   # Fetch music assets from external repo
```

No test suite is configured. CI runs `npm install && npm run build` on push to master.

## Architecture

### Client-Server Data Flow

```
Client (Browser)                         Server (Node.js)
┌─────────────────────┐                 ┌──────────────────────┐
│ React App + Redux    │  ── commands ─→ │ Colyseus Room        │
│ Phaser 3 Renderer    │  ←─ state sync  │ └─ Simulation Engine │
│                      │    (WebSocket)  │ └─ MongoDB           │
└─────────────────────┘                 └──────────────────────┘
```

- **Colyseus Schema** objects auto-sync from server to all clients (delta-encoded)
- Client sends commands (buy, drag-drop, level-up); server validates and mutates state
- Battle simulation runs server-side only (Matter.js physics, ability execution, RNG)

### Room Lifecycle

Four Colyseus rooms, each a game phase:
1. **CustomLobbyRoom** (`custom-lobby-room.ts`) — matchmaking, chat
2. **PreparationRoom** (`preparation-room.ts`) — team selection before match
3. **GameRoom** (`game-room.ts`, 44KB) — main gameplay loop
4. **AfterGameRoom** (`after-game-room.ts`) — post-match stats

### Key Directories

| Path | Purpose |
|------|---------|
| `app/types/enum/` | **Shared enums** (Pokemon, Item, Ability, Synergy, etc.) — single source of truth for client & server |
| `app/models/colyseus-models/` | Colyseus Schema classes (networked state). `pokemon.ts` is 435KB with all Pokemon definitions |
| `app/models/mongo-models/` | Mongoose schemas (persistent data: users, bots, stats, tournaments) |
| `app/core/` | Server-side game simulation engine (`simulation.ts`, `pokemon-entity.ts`, `pokemon-state.ts`) |
| `app/core/abilities/` | Ability implementations |
| `app/rooms/commands/` | Colyseus command handlers (game-commands.ts, lobby-commands.ts) |
| `app/config/game/` | Balance data: Pokemon stats, synergy bonuses, items, shop mechanics, ELO |
| `app/public/src/` | Client source: React pages, Phaser scenes, Redux stores |
| `app/public/src/game/` | Phaser game code: scenes, components (Pokemon sprites, battle manager, animations) |
| `app/public/src/stores/` | Redux stores: GameStore, LobbyStore, NetworkStore, PreparationStore, AfterGameStore |
| `app/services/` | Business logic: leaderboards, meta stats, bots, Discord integration |
| `gen/` | Code generation for Pokemon data |
| `edit/` | Content editing tools (add Pokemon, etc.) |

### Entry Points

- **Server**: `app/index.ts` → `app/app.config.ts` (Express + Colyseus setup)
- **Client**: `app/public/src/index.tsx` (React) → `app/public/src/game/` (Phaser)
- **Network**: `app/public/src/network.ts` (Colyseus client connection)

### State Management

- **Networked state**: Colyseus Schema (`app/rooms/states/`) — auto-synced to clients
- **Client UI state**: Redux Toolkit (`app/public/src/stores/`)
- **Persistent data**: MongoDB via Mongoose (`app/models/mongo-models/`)
- **Auth**: Firebase (client SDK + Admin SDK for server-side token verification)

## Conventions

- **Linter**: Biome (not ESLint). Config in `biome.json`. 2-space indent, 80-char lines.
- **Build**: esbuild for client (`esbuild.js`), tsc for server. Output in `app/public/dist/`.
- **TypeScript**: Strict mode, target es2016, commonjs modules. TSConfig includes `app/`, `scheduled/`, `edit/`, `db-commands/`.
- **Precomputed data**: `app/models/precomputed/precomputed-pokemon-data.ts` contains baked Pokemon data to avoid runtime queries. Regenerate with `npm run precompute`.
- **i18n**: i18next with translation files. Use `npm run translate` for machine translation via inlang.

## Important Patterns

- Adding a new Pokemon involves: enum in `Pokemon.ts`, stats in config, Colyseus model entry in `pokemon.ts`, factory entry, and precomputed data update. Use `npm run add-pokemon` helper.
- Synergy/type system defined in `app/types/enum/Synergy.ts` with bonuses configured in `app/config/game/synergies.ts`.
- Game commands follow the Colyseus Command pattern — see `app/rooms/commands/` for how client actions are processed server-side.
- Pokemon balance data lives in `app/config/game/pokemons.ts`, not in the model files.

## Environment Requirements

- Node.js >=20.16.0
- MongoDB (local or Atlas)
- Firebase project (for auth — needs `.env` with Firebase config)
- See `.env` template in README for required variables

## Active Technologies
- TypeScript 5.x (strict mode, target es2016, commonjs) + Colyseus 0.15.x (Schema, MapSchema), Phaser 3, React 19, Redux Toolki (001-extract-game-engine)
- N/A for this phase (001-extract-game-engine)
- TypeScript 5.7, Node.js >=20.16.0 + `idb` (IndexedDB wrapper, ~1KB gzip) — only new dependency (002-remove-mongodb)
- IndexedDB (browser-native) for player profile + game history; static JSON for bots (002-remove-mongodb)
- TypeScript 5.7, Node.js >=20.16.0 + `idb` (IndexedDB wrapper, ~1KB gzip) — only new dependency (client-side only) (002-remove-mongodb)
- Server: in-memory Maps/objects; Client: IndexedDB via `idb`; Bots: static JSON (002-remove-mongodb)

## Recent Changes
- 001-extract-game-engine: Added TypeScript 5.x (strict mode, target es2016, commonjs) + Colyseus 0.15.x (Schema, MapSchema), Phaser 3, React 19, Redux Toolki
