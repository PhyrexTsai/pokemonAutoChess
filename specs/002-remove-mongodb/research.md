# Research: Remove MongoDB

**Feature**: 002-remove-mongodb | **Date**: 2026-03-06

## R1: MongoDB Model Usage Inventory

**Decision**: Keep 3 models (UserMetadata, DetailledStatisticV2, BotV2), delete 17 models.

**Rationale**: Only 3 models contain data needed in single-player mode. The remaining 17 are multiplayer-only (chat, tournaments, bans, analytics, monitoring).

**Findings**:

| Model | Files Using It | Operations | Disposition |
|-------|---------------|------------|-------------|
| UserMetadata | ~25+ sites across rooms, commands, services | findOne, save, updateMany, find | Replace with in-memory store |
| DetailledStatisticV2 | after-game-room.ts, game-commands.ts, app.config.ts | create, find (sorted, limited) | Replace with in-memory array (capped 100) |
| BotV2 | preparation-commands.ts, game-room.ts, core/bot.ts, bots.ts | find with ELO filter, findOne for steps | Replace with static JSON bundle |
| ChatV2 | lobby-room.ts, lobby-commands.ts, lobby-state.ts, preparation-state.ts | find, create, delete | Delete |
| Tournament | lobby-room.ts, lobby-commands.ts, lobby-state.ts | find, create, update, findByIdAndDelete | Delete |
| BannedUser | lobby-room.ts, lobby-commands.ts, game-room.ts | findOne, create | Delete |
| Meta / MetaV2 | meta.ts service, app.config.ts | aggregate, create | Delete |
| ItemsStatistic | meta.ts service | aggregate, create | Delete |
| ItemsStatisticV2 | meta.ts service | aggregate, create | Delete |
| PokemonsStatistic | meta.ts service | aggregate, create | Delete |
| PokemonsStatisticV2 | meta.ts service | aggregate, create | Delete |
| RegionStatistic | meta.ts service | aggregate | Delete |
| TitleStatistic | meta.ts service | aggregate | Delete |
| BotMonitoring | scheduled/monitor-bot.ts | create | Delete |
| EloBot | bots.ts, scheduled/ | find, update | Delete |
| SocialUser | lobby-commands.ts (minimal) | find | Delete |
| Chat (v1) | unused | — | Delete |
| ReportMetadata | lobby-commands.ts | create | Delete |
| Dendrogram | app.config.ts (visualization) | find | Delete |

## R2: Firebase Admin SDK Usage

**Decision**: Remove firebase-admin entirely. Replace room `onAuth()` with a no-op local identity.

**Rationale**: firebase-admin is used exclusively for server-side JWT token verification in 4 Colyseus room `onAuth()` methods. In single-player mode, there is no server-side auth to verify.

**Findings**:
- `app/rooms/custom-lobby-room.ts` — `onAuth()` calls `admin.auth().verifyIdToken(token)`
- `app/rooms/preparation-room.ts` — same pattern
- `app/rooms/game-room.ts` — same pattern
- `app/rooms/after-game-room.ts` — same pattern
- `app/app.config.ts` — `admin.initializeApp()` at server startup
- Total: ~8 firebase-admin API calls across 5 files

**onAuth mock requirements**: All 4 rooms' `onAuth()` returns a Firebase `UserRecord` assigned to `client.auth`. Multiple properties are actively used as guard checks:
- `client.auth.displayName` — used in `if (client && client.auth && client.auth.displayName)` guards (game-room.ts:679, lobby-commands.ts:155). If missing, onLeave logic is SKIPPED entirely (ghost players).
- `client.auth.metadata.language` — causes TypeError if undefined
- `client.auth.email` + `client.auth.photoURL` — read at preparation-commands.ts:119: `auth.email === undefined && auth.photoURL === undefined` sets `anonymous: true` on GameUser. Provide non-undefined values (e.g. `email: "local@player"`) so local player is not marked anonymous.
- Mock must return: `{ uid, displayName, email, photoURL, metadata: { language } }`

**REST authUser() function**: `app.config.ts` L475-492 defines `authUser()` that uses `admin.auth().verifyIdToken()` to protect REST endpoints. Must be replaced with local-store lookup.

**Alternatives considered**:
- Keep firebase-admin but make it optional → adds complexity, violates Principle VI (Simplicity)
- Replace with lightweight JWT library → unnecessary, no server-side auth in single-player

## R3: Service Layer Analysis

**Decision**: Delete 5 services entirely, simplify 1, keep 1 as-is.

**Rationale**: Most services exist to aggregate MongoDB data for analytics or integrate with Discord. None serve single-player gameplay.

| Service | Lines | Action | Reason |
|---------|-------|--------|--------|
| `meta.ts` | ~200 | Delete | Server-side analytics aggregation (fetches from 6 MongoDB collections) |
| `discord.ts` | ~150 | Delete | Discord webhook integration (ban/bot announcements) |
| `cronjobs.ts` | ~250 | Delete | Scheduled jobs: ELO decay, old history cleanup, title stats, event reset |
| `leaderboard.ts` | ~100 | Delete | Global leaderboard queries `UserMetadata.find()` for top 100 players. Single-player has one player — leaderboard concept doesn't apply. Player stats already visible on profile page. |
| `bots.ts` | ~160 | Simplify | Bot CRUD → simplify to read-only static JSON lookup (remove create/delete/approve) |
| `notifications.ts` | ~100 | Keep | Already in-memory (Map), no MongoDB dependency. No changes needed. |

## R4: Architecture — IndexedDB vs Server Reality

**Decision**: Two-layer storage: server-side in-memory objects + client-side IndexedDB.

**Rationale**: Phase 1 runs while the Colyseus server still exists (Phase 2 removes Colyseus). IndexedDB is a browser-only API — it cannot replace Mongoose in server-side Node.js code. The minimum-change approach:

1. **Server-side**: Replace `UserMetadata.findOne({uid})` → `playerStore.get(uid)` (plain Map)
2. **Server-side**: Replace `DetailledStatistic.create()` → `historyStore.push(entry)` (plain array)
3. **Server-side**: Replace `BotV2.find()` → `botList.filter(b => b.elo >= ...)` (static JSON in memory)
   - CRITICAL: `core/bot.ts` also queries `BotV2.findOne({id}, ["steps"])` during gameplay to load bot behavior scripts. Must read from in-memory botList instead.
   - Bot ELO updates in `game-room.ts` must be deleted — bots are immutable static data.
4. **Client-side**: IndexedDB stores profile + game history for cross-session persistence
5. **Data sync**: Client loads from IndexedDB on connect → sends to server; server sends updates back → client saves

This naturally becomes the client-only IndexedDB approach once the server is removed in Phase 3.

**pokemonCollection transfer gap**: `IGameUser` (Preparation → Game room transfer interface) only has 10 fields and does NOT include `pokemonCollection`. `game-room.ts` onCreate (L262-314) re-queries MongoDB independently for each human player to get pokemonCollection (needed for PokemonCustoms and emotesUnlocked). In the new architecture, `local-store.ts` is a global singleton — game-room reads pokemonCollection directly from the store instead of querying MongoDB.

## R9: Entry Point and Dependency Cleanup

**Decision**: Clean up index.ts imports, app.config.ts initialization, and remove unused npm packages.

**Rationale**: Server entry points have multiple MongoDB/Firebase-dependent imports and initialization calls that must be removed or replaced.

**Findings**:

`app/index.ts`:
- Imports `initCronJobs` (from cronjobs.ts — being deleted), `fetchLeaderboards` (from leaderboard.ts — being deleted), `fetchMetaReports` (from meta.ts — being deleted)
- These are called at server startup — must remove imports and invocations
- `CronJob` for `checkLobby` must be KEPT (not MongoDB-dependent, cleans stale rooms)

`app/app.config.ts`:
- `mongoose.connect()` (L604-606) — remove entirely
- `admin.initializeApp()` (L607-613) — remove entirely
- `authUser()` function (L475-492) — uses `admin.auth().verifyIdToken()` to protect REST endpoints. Replace with local-store lookup (single-player: always return current player).
- 25+ REST endpoints depend on MongoDB models — delete multiplayer-only endpoints, keep /game-history and /bots with changed data source

**npm packages**:
- `mongoose` — remove (core target of this phase)
- `firebase-admin` — remove (core target of this phase)
- `discord.js` — remove (only used by discord.ts service being deleted)
- `cron` — KEEP (used by custom-lobby-room.ts for non-MongoDB stale room cleanup)
- `dayjs` — only used in cronjobs.ts. Safe to remove after cronjobs.ts deletion.

## R10: Hidden Mongoose Dependencies (State Files + Core)

**Decision**: Three additional server files have runtime Mongoose imports not previously identified.

**Rationale**: Colyseus state files and core utility files were not in the original scan scope but contain runtime (non type-only) imports that will cause compilation failures when mongo-models/ is deleted.

**Findings**:

`app/rooms/states/lobby-state.ts`:
- `import chatV2 from "../../models/mongo-models/chat-v2"` — runtime Mongoose model
- `import tournament from "../../models/mongo-models/tournament"` — runtime Mongoose model
- Uses: `chatV2.create()`, `chatV2.deleteMany()`, `tournament.create()`, `tournament.findByIdAndDelete()`
- Action: Remove imports. Chat and tournament are multiplayer-only — replace with in-memory or delete.

`app/rooms/states/preparation-state.ts`:
- `import chatV2 from "../../models/mongo-models/chat-v2"` — runtime Mongoose model
- Uses: `chatV2.create()` for preparation room chat
- Action: Remove import. Replace with in-memory chat (already synced via Colyseus state).

`app/core/collection.ts`:
- `import { HydratedDocument } from "mongoose"` — runtime Mongoose type
- Uses: `HydratedDocument<IUserMetadataMongo>` as parameter type for `migrateShardsOfAltForms()`
- Action: Replace with plain TypeScript type. The function operates on in-memory objects.

`app/core/bot-logic.ts`:
- `import { IBot, IDetailledPokemon, IStep } from "../models/mongo-models/bot-v2"` — non type-only
- Action: Update import path to preserved interface file.

## R11: InitializeBotsCommand Status

**Decision**: InitializeBotsCommand is NOT dead code. It is used by the preparation room's auto-fill flow.

**Rationale**: Previous analysis incorrectly marked it as dead code. It is dispatched when the preparation room auto-starts and needs to fill bot slots. Its `BotV2.find()` and `UserMetadata.findOne()` calls must be changed to use local-store and static JSON respectively.

## R5: Client-Side MongoDB References

**Decision**: Client-side imports need path updates and function relocation. **Not all imports are type-only.**

**Rationale**: While no client file directly calls Mongoose, many import from `app/models/mongo-models/` paths that will be deleted. These imports are a mix of type-only and runtime — all paths will break when mongo-models/ is deleted.

**Findings**:

Runtime function imports (~9 files) — these import `fetch*` wrapper functions defined in mongo-model files:
- `synergy-report.tsx` → `fetchMetaTypes` from pokemons-statistic-v2
- `metadata-report.tsx` → `fetchMetadata` from report-metadata
- `pokemon-report.tsx` → `fetchMetaPokemons` from pokemons-statistic-v2
- `item-report.tsx` → `fetchMetaItems` from items-statistic-v2
- `region-report.tsx` → `fetchMetaRegions` from regions-statistic
- `composition-report.tsx`, `cluster-map.tsx` → `fetchMetaV2` from meta-v2
- `dendrogram-chart.tsx` → `fetchDendrogram` from dendrogram
- `title-tab.tsx` → `fetchTitles` from title-statistic
- These `fetch*` functions are thin `fetch()` wrappers (no Mongoose dependency) — must be extracted to a standalone API utility file before mongo-models deletion.

Interface imports (~13 files) — use `import { IBot }` (not `import type`):
- `network.ts`, `bot-select-modal.tsx`, `bot-builder.tsx`, `team-builder.tsx`, `team-editor.tsx`, `bot-avatar.tsx`, `bot-manager-panel.tsx`, `import-bot-modal.tsx`, `team-builder-modal.tsx` → IBot, IBotLight, IDetailledPokemon
- `game-store.tsx`, `game-pokemons-proposition.tsx` → IDetailledPokemon
- These will break with esbuild when mongo-models/ is deleted — must update import paths to preserved interface files.

Server-side non-room files also affected:
- `app/core/bot-logic.ts` → `import { IBot, IDetailledPokemon, IStep }` from mongo-models (non type-only)
- `app/core/collection.ts` → `import { HydratedDocument }` from mongoose (runtime import)

## R6: app.config.ts REST Endpoints

**Decision**: Keep gameplay-relevant REST endpoints (change data source from MongoDB to in-memory). Delete multiplayer-only endpoints.

**Rationale**: `app.config.ts` has ~15 REST endpoints. Some are used by client UI components (game history, bot list). For minimum client-side change, keep these endpoints functional but swap data source from MongoDB to the server's in-memory store / static JSON. Delete endpoints that serve multiplayer-only data.

**Endpoints to KEEP (change data source)**:
- `GET /game-history/:uid` — client's `game-history.tsx` fetches this. Change from `DetailledStatistic.find()` to in-memory array read. **Zero client change.**
- `GET /bots` — client's `bot-select-modal.tsx` fetches this. Change from `BotV2.find()` to static JSON filter. **Zero client change.**
- `GET /bots/:id` — bot detail. Change to static JSON lookup.
- `GET /profile` — user profile. Change from `UserMetadata.findOne()` to local-store.
- `GET /titles` — title statistics. Change from `TitleStatistic.find()` to precomputed/static data.

**Endpoints to DELETE** (multiplayer-only):
- `GET /meta/*` — server analytics (metadata, items, pokemons, regions, types)
- `GET /meta-v2` — meta aggregation
- `GET /leaderboards/*` — global ranking (elo, level, bots, event)
- `GET /dendrogram` — visualization
- `GET /chat-history/:playerUid` — persistent chat (no chat in single-player)
- `GET /players` — player search
- `POST /bots`, `DELETE /bots/:id`, `POST /bots/:id/approve` — bot admin CRUD
- All ban/unban endpoints

## R7: IndexedDB Library Selection

**Decision**: Use `idb` thin wrapper (~1KB gzipped) for client-side IndexedDB.

**Rationale**: The data model is simple (2 object stores: player, gameHistory). A full ORM like Dexie.js (~32KB) is overkill. The `idb` library provides Promise-based wrappers over the native IndexedDB API with zero overhead.

**Alternatives considered**:
- Raw IndexedDB API → verbose but zero dependencies. Acceptable fallback.
- `idb` (Jake Archibald) → tiny Promise wrapper. Preferred for readability.
- Dexie.js → full ORM, too heavy for 2 object stores. Rejected (Principle VI).
- localStorage → 5MB limit, no structured queries, no binary data. Rejected.

## R8: Bot Data Export Strategy

**Decision**: Export BotV2 collection from MongoDB to a static JSON file, bundled with the app.

**Rationale**: Bot data is read-only in single-player. A static JSON file avoids any runtime database dependency while preserving all bot configurations.

**Export details**:
- Filter: `approved === true` only
- Format: Array of `IBot` objects (matching existing interface from `bot-v2.ts`)
- Fields: id, name, avatar, author, elo, approved, steps (with board placements)
- The existing `toJSON` transform in the BotV2 schema already strips `_id` and `__v` — use `BotV2.find({approved: true}).lean()` + JSON transform for clean export
- Size estimate: ~2-5MB for full approved bot library (compressed ~500KB-1MB). Acceptable for client bundle.

## R12: Firebase Client SDK Usage

**Decision**: Remove Firebase Client SDK (`firebase`, `firebaseui`, `@firebase/auth-types`) entirely. Replace with local username input + `crypto.randomUUID()` identity.

**Rationale**: The Firebase Client SDK is used for OAuth login (Google, Email, Twitter, Anonymous) and token generation (`getIdToken()`). In single-player mode, there is no server to verify tokens against. A simple username input replacing the entire OAuth flow is the minimum viable identity system.

**Findings — 13 client files affected**:

| File | Firebase Usage | Replacement |
|------|---------------|-------------|
| `network.ts` | `firebase.initializeApp()`, `onAuthStateChanged()`, `getIdToken()` | Load uid/displayName from IndexedDB; no token needed |
| `lobby.tsx` | `firebase.auth().signOut()`, `getIdToken()` | Remove sign-out (local profile persists); remove token |
| `preparation.tsx` | `getIdToken()` | Remove token |
| `game.tsx` | `getIdToken()` | Remove token |
| `game-scene.ts` | `firebase.auth().currentUser?.uid` | Use uid from local store/Redux |
| `lobby-logic.ts` | `getIdToken()` | Remove token |
| `preparation-menu.tsx` | `getIdToken()` | Remove token |
| `game-rooms-menu.tsx` | `getIdToken()` | Remove token |
| `profile.tsx` | `getIdToken()` | Remove token |
| `bot-builder.tsx` | `getIdToken()` | Remove token |
| `bot-manager-panel.tsx` | `getIdToken()` | Remove token |
| `NetworkStore.ts` | `import { User } from "@firebase/auth-types"` | Remove type import; use plain `{ uid: string, displayName: string }` |
| `login.tsx` | Full Firebase OAuth UI (Google, Email, Twitter providers) | **DELETE** — replaced by `username-input.tsx` |

**Files to DELETE** (Firebase auth components):
- `styled-firebase-auth.tsx` — FirebaseUI React wrapper
- `login.tsx` — OAuth login page with Google/Email/Twitter providers
- `anonymous-button.tsx` — Firebase anonymous sign-in button

**npm packages to remove**:
- `firebase` (^10.0.0) — Firebase Client SDK
- `firebaseui` (^6.1.0) — Firebase UI components
- `@firebase/auth-types` — Firebase auth type definitions

**Routing and additional files**:
- `auth.tsx` is the route entry for `/` — imports `Login` from `./component/auth/login`. Must update to import the new `username-input` component.
- `firebase-ui.css` — Firebase UI CSS overrides (`.firebaseui-idp-button` etc.). Delete.
- `style/index.css` line 7 — `@import "./firebase-ui.css"`. Remove this line.
- `login.css` — contains `#play-panel` styles that may be reusable by `username-input.tsx`. Evaluate for reuse or delete.
- `authenticateUser()` in network.ts returns `Promise<User>` (Firebase type). When rewritten, `lobby-logic.ts:87` calls `user.getIdToken()` on the resolved value — this must be removed.
- `NetworkStore.ts` `logIn` reducer accepts `PayloadAction<User>` but only reads `.uid`, `.displayName`, `.email` — replace with plain `{ uid: string; displayName: string; email: string }`.

**Key observations**:
- `getIdToken()` is called in 10 call sites across 9 files (lobby-logic.ts and bot-manager-panel.tsx each have 2 sites). Since `authUser()` in app.config.ts is also being replaced (R2), these tokens serve no purpose — remove entirely.
- `onAuthStateChanged` in network.ts is the entry point for the entire auth flow. Replacing this single function with an IndexedDB profile check eliminates the Firebase dependency cascade.
- `firebase.auth().currentUser?.uid` in game-scene.ts is the only place uid is read from Firebase outside of token calls — replace with local uid from Redux store or IndexedDB.
