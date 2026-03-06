# Implementation Plan: Remove MongoDB

**Branch**: `002-remove-mongodb` | **Date**: 2026-03-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-remove-mongodb/spec.md`

## Summary

Replace all MongoDB persistence with a two-layer approach: **server-side in-memory store** (plain JS objects replacing Mongoose calls) + **client-side IndexedDB** (cross-session persistence). Bundle bot configurations as static JSON. Remove mongoose, firebase-admin, and Firebase Client SDK (`firebase`, `firebaseui`) dependencies entirely. Replace the OAuth login flow with a local username input + UUID identity system. Delete 17 multiplayer-only models and 4 server-side services. Minimum-change approach: reuse existing type shapes and interface names.

## Technical Context

**Language/Version**: TypeScript 5.7, Node.js >=20.16.0
**Primary Dependencies**: `idb` (IndexedDB wrapper, ~1KB gzip) — only new dependency (client-side only)
**Storage**: Server: in-memory Maps/objects; Client: IndexedDB via `idb`; Bots: static JSON
**Testing**: vitest (existing)
**Target Platform**: Modern browsers (IndexedDB supported since 2012)
**Project Type**: Web application (Colyseus + React + Phaser, transitioning to SPA)
**Performance Goals**: Startup not degraded >500ms; storage <10MB
**Constraints**: Offline-capable, zero MongoDB/Firebase dependencies (both server and client)
**Scale/Scope**: ~51 files with mongoose imports; 20 model files to remove; 5 services to delete, 1 to simplify, 1 to keep

## Architecture Note

**Phase 1 runs while the Colyseus server still exists** (Phase 2 removes Colyseus, Phase 3 removes the server). IndexedDB is a browser-only API and cannot replace Mongoose in server-side Node.js code. The correct two-layer approach:

```
Startup:
  Client → check IndexedDB for existing profile
    → IF exists: load profile (incl. pokemonCollection) → send to Server via Colyseus onJoin()
    → IF not exists: show username input → player enters name → generate UUID (crypto.randomUUID())
      → save new profile to IndexedDB → send to Server via Colyseus onJoin()
  Server → store in local-store (global in-memory singleton, accessible by all rooms)

During game:
  Server → in-memory store (plain JS objects, replaces Mongoose calls)
  game-room.ts onCreate → read pokemonCollection from local-store (NOT from MongoDB)

Game end:
  Server → send updated profile to Client → Client saves to IndexedDB

Bot data:
  Static JSON → imported at server startup (replaces BotV2.find())
```

### onAuth Mock Specification

All 4 rooms' `onAuth()` currently call `admin.auth().verifyIdToken(token)` → `admin.auth().getUser(uid)` and return a Firebase `UserRecord`. The returned object is assigned to `client.auth` and its properties are **actively used as guard checks**:

- `client.auth.displayName` — guard in game-room.ts:679 and lobby-commands.ts:155: `if (client && client.auth && client.auth.displayName)`. If missing, onLeave logic is SKIPPED entirely (ghost players).
- `client.auth.metadata.language` — causes TypeError if undefined
- `client.auth.email` and `client.auth.photoURL` — read at preparation-commands.ts:119: `auth.email === undefined && auth.photoURL === undefined` determines the `anonymous` flag on GameUser. Must provide non-undefined values so local player is NOT marked anonymous.

The replacement `onAuth()` must return a mock object with this shape:
```typescript
{
  uid: string,              // crypto.randomUUID(), generated on first username input, stored in IndexedDB
  displayName: string,      // from player's username input (stored in IndexedDB). MUST be truthy (guard check gates onLeave logic).
  email: string,            // "local@player" — prevents anonymous=true at preparation-commands.ts:119
  photoURL: string,         // "" — same guard as email
  metadata: { language: string }  // from local-store, default "en". metadata OBJECT must exist (not undefined).
}
```

### pokemonCollection Transfer Gap

**Problem**: `IGameUser` (the interface used to pass data between Preparation → Game rooms) only has 10 fields: uid, name, avatar, ready, isBot, elo, games, title, role, anonymous. It does NOT include `pokemonCollection`. Currently, `game-room.ts` onCreate (L262-314) re-queries MongoDB independently for each human player to get pokemonCollection (needed for PokemonCustoms and emotesUnlocked).

**Solution**: In the new architecture, `local-store.ts` is a **global singleton** accessible by all rooms. `game-room.ts` onCreate reads pokemonCollection directly from `localStore.currentPlayer.pokemonCollection` instead of querying MongoDB. This is safe because single-player mode has exactly one human player.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Zero External Dependencies | PASS | Removing mongoose + firebase-admin + firebase + firebaseui; `idb` is a browser-native wrapper |
| II. Game Engine Independence | PASS | No changes to game engine; only persistence layer changes |
| III. Gameplay Fidelity | PASS | All game mechanics preserved; only storage backend changes |
| IV. Atomic Traceability | PASS | Plan follows commit-per-logical-change discipline |
| V. Incremental Viability | PASS | After this phase: game works without MongoDB (local persistence) |
| VI. Simplicity Over Abstraction | PASS | Server: plain objects in Map. Client: thin `idb` wrapper. No adapter patterns. |

**Post-design re-check**: All gates still pass. Server-side Mongoose calls become Map get/set. Client-side persistence via `idb`. No new abstractions.

## Project Structure

### Documentation (this feature)

```text
specs/002-remove-mongodb/
├── plan.md              # This file
├── research.md          # MongoDB usage inventory, Firebase analysis, library selection
├── data-model.md        # PlayerProfile, GameHistoryEntry, BotConfiguration entities
├── quickstart.md        # Validation scenarios and build verification
├── checklists/
│   └── requirements.md  # Spec quality checklist (all passing)
└── tasks.md             # Task list (generated by /speckit.tasks)
```

### Source Code (repository root)

```text
# Files to CREATE
app/models/local-store.ts               # Server-side in-memory store (Map<string, object>)
app/public/src/persistence/local-db.ts   # Client-side IndexedDB setup (idb wrapper)
app/public/src/assets/bots.json          # Static bot data (exported from MongoDB)
app/public/src/pages/component/auth/username-input.tsx  # First-launch username input (replaces Firebase login)

# Files to MODIFY — Server-side (replace Mongoose with in-memory store)
app/rooms/custom-lobby-room.ts           # Remove onAuth firebase-admin, use in-memory store
                                         # Note: this.users Map already acts as in-memory cache —
                                         # point it at local-store instead of MongoDB as truth source
app/rooms/preparation-room.ts            # Remove onAuth, simplify bot loading from static JSON
app/rooms/game-room.ts                   # Remove onAuth, replace UserMetadata/DetailledStatistic with in-memory
                                         # DELETE: bot ELO update code (L794-805) — bots are static, ELO immutable
                                         # DELETE: eventPoints/maxEventPoints/eventFinishTime writes (L981-990)
                                         # DELETE: countDocuments aggregation query (L992-993) — multiplayer only
                                         # DELETE: leaderboard notification code (L994-1000) — multiplayer only
app/rooms/after-game-room.ts             # Remove onAuth, replace post-game stat writes with in-memory
app/rooms/commands/game-commands.ts      # Replace UserMetadata operations with in-memory store
app/rooms/commands/lobby-commands.ts     # Remove chat/tournament/ban MongoDB operations
                                         # DELETE: BanUserCommand, UnbanUserCommand — multiplayer admin
                                         # DELETE: tournament-related commands — multiplayer feature
app/rooms/commands/preparation-commands.ts # Replace BotV2 query with static JSON lookup
                                         # InitializeBotsCommand: NOT dead code (used by auto-fill flow)
                                         # — change its BotV2.find() + UserMetadata.findOne() to local-store
app/rooms/states/lobby-state.ts          # RUNTIME import of chatV2 and tournament Mongoose models
                                         # Remove Mongoose model imports; replace chatV2.create/deleteMany
                                         # and tournament.create/findByIdAndDelete with in-memory or delete
app/rooms/states/preparation-state.ts    # RUNTIME import of chatV2 Mongoose model
                                         # Remove import; replace chatV2.create with in-memory or delete
app/core/bot.ts                          # Replace BotV2.findOne({id}, ["steps"]) with in-memory bot store lookup
                                         # This is CRITICAL — bot behavior during gameplay depends on this query
app/core/collection.ts                   # RUNTIME import { HydratedDocument } from "mongoose"
                                         # Replace with plain TypeScript type (no Mongoose dependency)
app/core/bot-logic.ts                    # import { IBot, IDetailledPokemon, IStep } from mongo-models (non type-only)
                                         # Change import path to preserved interface file
app/services/bots.ts                     # Simplify: read-only static JSON lookup (remove create/delete/approve)
                                         # Also remove discordService import and calls
app/app.config.ts                        # Remove mongoose.connect() (L604-606)
                                         # Remove admin.initializeApp() (L607-613)
                                         # Remove import of migrateShardsOfAltForms from core/collection
                                         # Remove Helmet CSP Firebase entries (L148-149)
                                         # Replace authUser() function (L475-492) with local-store lookup
                                         #   (authUser uses firebase-admin to verify tokens in REST endpoints)
                                         # KEEP REST endpoints with changed data source (minimum client change):
                                         #   /game-history/:uid → read from in-memory gameHistory array
                                         #   /bots, /bots/:id → read from in-memory botList (static JSON)
                                         #   /profile → read from local-store
                                         #   /titles → can be precomputed/static (currently TitleStatistic.find)
                                         # DELETE REST endpoints (multiplayer-only):
                                         #   /meta/*, /leaderboards/*, /dendrogram
                                         #   /chat-history/:playerUid — no persistent chat in single-player
                                         #   /players — player search (multiplayer)
                                         #   POST /bots, DELETE /bots/:id, POST /bots/:id/approve — bot admin CRUD
                                         #   ban/unban endpoints
app/index.ts                             # Remove imports: initCronJobs, fetchLeaderboards, fetchMetaReports
                                         # Remove their invocations at startup
                                         # KEEP: CronJob for checkLobby (not MongoDB-dependent)

# Files to MODIFY — Client-side (remove Firebase Client SDK + add IndexedDB persistence)
app/public/src/network.ts                # Remove firebase import + initializeApp + onAuthStateChanged + getIdToken
                                         # Replace with local identity from IndexedDB (uid + displayName)
app/public/src/pages/lobby.tsx           # Remove firebase.auth().signOut() + getIdToken
app/public/src/pages/preparation.tsx     # Remove firebase.auth().currentUser?.getIdToken()
app/public/src/pages/game.tsx            # Remove firebase.auth().currentUser?.getIdToken()
app/public/src/game/scenes/game-scene.ts # Remove firebase.auth().currentUser?.uid → use local uid
app/public/src/game/lobby-logic.ts       # Remove firebase.auth().currentUser?.getIdToken()
app/public/src/pages/component/preparation/preparation-menu.tsx  # Remove getIdToken
app/public/src/pages/component/room-menu/game-rooms-menu.tsx     # Remove getIdToken
app/public/src/pages/component/profile/profile.tsx               # Remove getIdToken
app/public/src/pages/component/bot-builder/bot-builder.tsx       # Remove getIdToken
app/public/src/pages/component/bot-builder/bot-manager-panel.tsx # Remove getIdToken
app/public/src/stores/NetworkStore.ts    # Remove User type import from @firebase/auth-types
                                         # logIn reducer: change PayloadAction<User> to plain { uid, displayName, email }
app/public/src/pages/auth.tsx            # Update import: Login → username-input component
                                         # This is the route entry point for "/" — wires up the new auth flow
app/public/src/pages/                    # Load/save profile via IndexedDB on connect/disconnect
                                         # NOTE: ~9 meta-report files + title-tab.tsx import runtime fetch*
                                         # functions from mongo-models (fetchMetaTypes, fetchMetadata,
                                         # fetchMetaPokemons, fetchMetaItems, fetchMetaRegions, fetchMetaV2,
                                         # fetchDendrogram, fetchTitles). These are NOT type-only imports.
                                         # The fetch* functions are thin wrappers around fetch() calls —
                                         # extract to standalone API utility file or inline.
                                         # ~13 bot-builder/game files import { IBot, IDetailledPokemon }
                                         # (non type-only) from mongo-models — update import paths to
                                         # preserved interface files.

# Files to DELETE (multiplayer-only + Firebase Client SDK)
app/models/mongo-models/                 # Entire directory (20 files)
app/services/meta.ts                     # Server analytics
app/services/discord.ts                  # Discord webhooks
app/services/cronjobs.ts                 # Scheduled jobs (ELO decay, cleanup)
app/services/leaderboard.ts              # Global leaderboard (UserMetadata.find top 100) — meaningless in single-player
scheduled/                               # Scheduled job runners
db-commands/                             # Database migration scripts
app/public/src/pages/component/auth/login.tsx               # Firebase OAuth login page (replaced by username-input.tsx)
app/public/src/pages/component/auth/styled-firebase-auth.tsx # FirebaseUI wrapper component
app/public/src/pages/component/auth/anonymous-button.tsx     # Firebase anonymous sign-in button
app/public/src/style/firebase-ui.css                        # Firebase UI CSS overrides (.firebaseui-idp-button etc.)
app/public/src/pages/component/auth/login.css               # Firebase login styles (evaluate if #play-panel reusable by username-input)

# Files to MODIFY — Client-side (CSS cleanup)
app/public/src/style/index.css                              # Remove @import "./firebase-ui.css" (line 7)

# Files to KEEP (no changes needed)
app/services/notifications.ts            # Already in-memory, no MongoDB dependency

# Type files to PRESERVE (extract interfaces from Mongoose models before deletion)
app/types/interfaces/UserMetadata.ts     # Keep interfaces, remove Mongoose-specific types
                                         # Interfaces needed: IUserMetadata, IUserMetadataMongo (→ rename),
                                         # IUserMetadataClient, IPokemonCollectionItem, IPokemonCollectionItemMongo
# Must also extract and preserve from bot-v2.ts before deletion:
#   IBot, IBotLight, IStep, IDetailledPokemon — used by ~15 client files + core/bot.ts + core/bot-logic.ts
# Must also extract fetch* functions from mongo-models before deletion:
#   fetchMetaTypes, fetchMetadata, fetchMetaPokemons, fetchMetaItems, fetchMetaRegions,
#   fetchMetaV2, fetchDendrogram, fetchTitles — used by ~9 client meta-report files
#   These are thin fetch() wrappers, NOT Mongoose-dependent — relocate to api utility
```

**Structure Decision**: Existing monorepo structure preserved. New files:
- `local-store.ts` (server-side in-memory store, replaces Mongoose)
- `local-db.ts` (client-side IndexedDB, cross-session persistence)
- `bots.json` (static bot data)
- Interface extraction files (preserve IBot, IStep, IDetailledPokemon, IBotLight from bot-v2.ts; IDetailledStatistic from detailled-statistic-v2.ts — relocate to app/types/ or standalone file)
- Relocated fetch* functions (thin fetch() wrappers currently in mongo-model files — move to app/public/src/api/ or inline)
No new architectural patterns introduced.

## Complexity Tracking

> No constitution violations. No complexity justification needed.

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| Server-side storage | Plain Map<string, object> in memory | Single player = single user = one global object. Simplest possible. |
| Client-side persistence | `idb` (~1KB) wrapping IndexedDB | Thinnest possible wrapper for cross-session persistence. |
| Bot data format | Static JSON (including steps) | Read-only, loaded into memory at startup. core/bot.ts reads from memory. |
| Type preservation | Keep existing interfaces (IUserMetadata, IDetailledStatistic, IBot) | Same shapes, remove only Mongoose dependency. Minimum change. |
| Data flow | Client IDB ↔ Colyseus messages ↔ Server memory | Natural split: browser persists, server operates. |
| REST endpoints | Keep `/game-history`, `/bots`, `/bots/:id`, `/profile`, `/titles`; delete ~15 others | Client code unchanged for kept endpoints. Delete: /meta/*, /leaderboards/*, /dendrogram, /chat-history, /players, bot CRUD. |
| Lobby this.users | Point at local-store as truth source | Lobby already has in-memory Map cache; unify with local-store instead of MongoDB. |
| Atomic Mongoose ops | Replace with plain if/mutate | Single player = single user = no concurrency. `findOneAndUpdate` → `if (x > 0) x--`. |
| Bot ELO | Immutable (static JSON) | Delete bot ELO update code in game-room.ts. Bots are read-only. |
| onAuth mock | Return object with uid, displayName, email, photoURL, metadata.language | Guard checks use displayName; TypeError if metadata.language undefined. |
| pokemonCollection access | game-room reads from local-store global singleton | IGameUser doesn't carry pokemonCollection; game-room currently re-queries MongoDB. |
| index.ts cleanup | Remove 3 MongoDB-dependent imports, keep checkLobby CronJob | initCronJobs, fetchLeaderboards, fetchMetaReports all depend on deleted services. |
| npm dependencies | Remove: mongoose, firebase-admin, firebase, firebaseui, @firebase/auth-types, discord.js. Keep: cron (used by lobby) | cron used by custom-lobby-room.ts for non-MongoDB stale room cleanup. |
| Auth replacement | Username input + crypto.randomUUID() replaces Firebase OAuth | One input field + one button. Net deletion of ~3 auth component files, ~13 firebase client imports. Simplest possible identity system. |
| Interface extraction | Extract IBot/IStep/IDetailledPokemon + fetch* functions before deleting mongo-models | ~28 client+server files import from mongo-models; paths break on deletion. |
| State file cleanup | lobby-state.ts + preparation-state.ts: remove chatV2/tournament Mongoose imports | Runtime imports of Mongoose models in Colyseus state files — compilation fails. |
| anonymous flag | onAuth mock provides email="local@player" so player is NOT anonymous | preparation-commands.ts:119 checks email===undefined && photoURL===undefined. |
