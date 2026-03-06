# Tasks: Remove MongoDB

**Input**: Design documents from `/specs/002-remove-mongodb/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Organization**: Tasks grouped by user story. Sequential execution recommended (single-developer refactoring with minimum-change constraint).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1–US4)
- Exact file paths included in descriptions

---

## Phase 1: Setup

**Purpose**: Install new dependency and prepare static bot data asset

- [x] T001 Install `idb` npm dependency — client-side IndexedDB Promise wrapper (~1KB gzip)
- [x] T002 [P] Create app/public/src/assets/bots.json — export approved bots from MongoDB (`BotV2.find({approved: true}).lean()`) as IBot[] array with fields: id, name, avatar, author, elo, approved, steps (including board placements). If no MongoDB access, create placeholder with at least 7 valid bots (matching bot-v2.ts IBot schema, each with valid steps/boards) to ensure playability.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Create replacement infrastructure and extract interfaces from mongo-models BEFORE any file modifications or deletions

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T003 Extract IBot, IBotLight, IStep, IDetailledPokemon interfaces from app/models/mongo-models/bot-v2.ts to app/types/interfaces/bot.ts — preserve exact field names and types, remove Mongoose Schema dependencies (keep only plain TypeScript types)
- [x] T004 [P] Extract IDetailledStatistic and Pokemon interfaces from app/models/mongo-models/detailled-statistic-v2.ts to app/types/interfaces/detailled-statistic.ts — preserve exact field shapes
- [x] T005 [P] Extract fetch* wrapper functions (fetchMetaTypes, fetchMetadata, fetchMetaPokemons, fetchMetaItems, fetchMetaRegions, fetchMetaV2, fetchDendrogram, fetchTitles) from their respective mongo-model files to app/public/src/api/meta.ts — these are thin fetch() wrappers with no Mongoose dependency, just relocate
- [x] T006 Create app/models/local-store.ts — server-side in-memory store: `currentPlayer: IUserMetadata | null`, `gameHistory: IDetailledStatistic[]` (capped 100), `botList: IBot[]` (loaded from bots.json). Export getter/setter/mutator functions. Import types from newly extracted interface files (T003, T004).
- [x] T007 [P] Create app/public/src/persistence/local-db.ts — client-side IndexedDB via `idb`: database "pokemon-auto-chess" v1, object stores: `player` (key: uid), `gameHistory` (key: id, index: "by-time"). Export functions: loadProfile(), saveProfile(), loadHistory(), saveHistoryEntry(), capHistory(100). Handle corrupted data gracefully (delete and return null). Catch QuotaExceededError on writes — log warning and continue with in-memory only (no crash). On loadProfile(): check `schemaVersion` field — if missing or !== CURRENT_VERSION, run migration (v1 = no-op, but the check MUST exist for future upgrades).
- [x] T008 [P] Create app/public/src/pages/component/auth/username-input.tsx — text input for display name + Start button. On submit: validate non-empty name, generate uid via `crypto.randomUUID()`, create default PlayerProfile (elo:1000, level:0, wins:0, games:0, empty pokemonCollection, language from `navigator.language`, avatar:"0019/Normal", booster:0, schemaVersion:1), save to IndexedDB via local-db.ts, dispatch to NetworkStore.

**Checkpoint**: Foundation ready — local-store.ts, local-db.ts, username-input.tsx exist. Interfaces extracted. User story implementation can begin.

---

## Phase 3: User Story 1 — Player Profile Persistence (Priority: P1) 🎯 MVP

**Goal**: Player progress (ELO, wins, collection, boosters) persists across browser sessions via IndexedDB. Firebase auth replaced with local username input + crypto.randomUUID().

**Independent Test**: Create new player via username input, play one game, close browser, reopen — verify all values preserved from IndexedDB.

### Server-side: Room Auth & Data Layer

- [x] T009 [US1] Replace onAuth() in all 4 room files to return mock UserRecord from local-store — app/rooms/custom-lobby-room.ts, app/rooms/preparation-room.ts, app/rooms/game-room.ts, app/rooms/after-game-room.ts. Mock shape: `{ uid, displayName, email: "local@player", photoURL: "", metadata: { language } }`. Remove all `firebase-admin` imports. displayName MUST be truthy (gates onLeave at game-room.ts:679). email MUST be non-undefined (prevents anonymous flag at preparation-commands.ts:119).
- [x] T010 [US1] Modify app/rooms/custom-lobby-room.ts — replace UserMetadata MongoDB calls (findOne, save, updateMany) with local-store get/set. Point `this.users` Map at local-store as truth source instead of MongoDB write-through cache.
- [x] T011 [US1] Modify app/rooms/game-room.ts — replace UserMetadata.findOne() with local-store reads. Fix pokemonCollection gap: read from `localStore.currentPlayer.pokemonCollection` instead of re-querying MongoDB (L262-314). Delete eventPoints/maxEventPoints/eventFinishTime writes (L981-990). Delete countDocuments aggregation (L992-993). Delete leaderboard notification code (L994-1000).
- [x] T012 [P] [US1] Modify app/rooms/commands/game-commands.ts — replace all UserMetadata operations (findOne, save, findByIdAndUpdate) with local-store get/set/mutate.
- [x] T013 [P] [US1] Modify app/rooms/commands/lobby-commands.ts — delete BanUserCommand, UnbanUserCommand, tournament-related commands. Remove chatV2/BannedUser/SocialUser/ReportMetadata/Tournament MongoDB operations. Replace remaining UserMetadata calls with local-store.
- [x] T014 [US1] Modify app/rooms/commands/preparation-commands.ts — replace UserMetadata.findOne() calls with local-store in InitializeBotsCommand (L668-712) and other commands. Keep InitializeBotsCommand functional (used by auto-fill flow, NOT dead code).
- [x] T015 [P] [US1] Modify app/rooms/states/lobby-state.ts — remove runtime imports of chatV2 and tournament Mongoose models. Delete or replace chatV2.create()/deleteMany() and tournament.create()/findByIdAndDelete() with noop (chat is transient via Colyseus state, tournaments are multiplayer-only).
- [x] T016 [P] [US1] Modify app/rooms/states/preparation-state.ts — remove runtime import of chatV2 Mongoose model. Delete or replace chatV2.create() with noop.
- [x] T017 [P] [US1] Modify app/core/collection.ts — replace `import { HydratedDocument } from "mongoose"` with plain TypeScript type for `migrateShardsOfAltForms()` parameter.

### Client-side: Firebase Removal & IndexedDB Identity

- [x] T018 [US1] Modify app/public/src/network.ts — remove `firebase.initializeApp()`, `onAuthStateChanged()`, `getIdToken()`. Replace `authenticateUser()` with IndexedDB profile load via local-db.ts (check for existing profile → if exists, return { uid, displayName }; if not, show username input). This is the single entry point that eliminates the Firebase dependency cascade.
- [x] T019 [US1] Modify app/public/src/stores/NetworkStore.ts — remove `import { User } from "@firebase/auth-types"`. Change logIn reducer from `PayloadAction<User>` to `PayloadAction<{ uid: string; displayName: string; email: string }>` (only 3 properties are actually read).
- [x] T020 [US1] Modify app/public/src/pages/auth.tsx — update import from `Login` (login.tsx) to new `UsernameInput` (username-input.tsx). This is the route entry point for "/" that wires the new auth flow.
- [x] T021 [US1] Remove getIdToken() and firebase.auth() calls from 9 client files — app/public/src/pages/lobby.tsx (also remove firebase.auth().signOut()), preparation.tsx, game.tsx, game/lobby-logic.ts (has 2 getIdToken sites), pages/component/preparation/preparation-menu.tsx, component/room-menu/game-rooms-menu.tsx, component/profile/profile.tsx, component/bot-builder/bot-builder.tsx, component/bot-builder/bot-manager-panel.tsx (has 2 getIdToken sites). Remove associated firebase/compat/app imports.
- [x] T022 [US1] Modify app/public/src/game/scenes/game-scene.ts — replace `firebase.auth().currentUser?.uid` with local uid from Redux store (NetworkStore). Remove firebase import.
- [x] T023 [US1] Delete Firebase auth components and CSS: app/public/src/pages/component/auth/login.tsx, styled-firebase-auth.tsx, anonymous-button.tsx, app/public/src/style/firebase-ui.css. Remove `@import "./firebase-ui.css"` from app/public/src/style/index.css (line 7). Evaluate app/public/src/pages/component/auth/login.css — reuse `#play-panel` styles in username-input.tsx or delete.

**Checkpoint**: Player profile persists via IndexedDB. Firebase auth fully replaced with username input. All room onAuth mocks return valid UserRecord shape. No Firebase client SDK imports remain.

---

## Phase 4: User Story 2 — Bot Opponents Available Offline (Priority: P2)

**Goal**: Bot data loaded from static JSON at startup. Bot behavior works during gameplay without network. No MongoDB bot queries.

**Independent Test**: Disconnect from internet, start match — verify 7 bots assigned with valid boards and ELO range. Game plays to completion with bots changing compositions each round.

- [x] T024 [US2] Wire bots.json loading into local-store at server startup — in app/models/local-store.ts or app/app.config.ts, import bots.json from app/public/src/assets/bots.json and populate `localStore.botList` array on init. Add fallback: if bots.json fails to load (missing/corrupted), use a minimal hardcoded 7-bot array embedded as constant in local-store.ts to ensure gameplay is always possible.
- [x] T025 [US2] Modify app/rooms/commands/preparation-commands.ts — replace BotV2.find() with local-store `botList.filter(b => b.elo >= min && b.elo <= max)` in OnAddBotCommand and InitializeBotsCommand. Replace BotV2.findOne() in other commands with local-store lookup.
- [x] T026 [US2] Modify app/core/bot.ts — replace `BotV2.findOne({id}, ["steps"])` with local-store botList lookup (`botList.find(b => b.id === id)`). CRITICAL: this is how bot behavior scripts are loaded during gameplay.
- [x] T027 [P] [US2] Modify app/core/bot-logic.ts — update import path for IBot, IDetailledPokemon, IStep from `../models/mongo-models/bot-v2` to `../../types/interfaces/bot` (or correct relative path to extracted interfaces).
- [x] T028 [P] [US2] Simplify app/services/bots.ts — remove bot CRUD operations (create, delete, approve), remove discordService import/calls. Keep read-only `getBotsList()` returning from local-store botList.
- [x] T029 [US2] Delete bot ELO update code in app/rooms/game-room.ts (L794-805) — bots are immutable static data, ELO must never change.

**Checkpoint**: Bots load from static JSON. core/bot.ts reads steps from in-memory botList. Bot ELOs are immutable. Game plays offline with bot opponents.

---

## Phase 5: User Story 3 — Game History Viewable (Priority: P3)

**Goal**: Game history stored in server in-memory array + client IndexedDB. REST endpoint /game-history/:uid preserved. Capped at 100 entries FIFO.

**Independent Test**: Play 3 games, open history screen — verify 3 entries with correct rank/team/synergies/ELO. Close/reopen browser — verify persistence.

- [x] T030 [US3] Modify app/rooms/after-game-room.ts — replace `DetailledStatistic.create()` with local-store `gameHistory.push(entry)`. Implement FIFO cap: if `gameHistory.length > 100`, remove oldest. Remove mongoose/DetailledStatistic imports.
- [x] T031 [P] [US3] Modify game history writes in app/rooms/game-room.ts — replace any remaining DetailledStatistic MongoDB calls with local-store operations (if not already handled by after-game-room).
- [x] T032 [US3] Modify app/app.config.ts — update `GET /game-history/:uid` endpoint to read from `localStore.gameHistory` instead of `DetailledStatistic.find()`. Keep response format unchanged (zero client change).
- [x] T033 [US3] Add client-side history persistence — in app/public/src/network.ts (on Colyseus message receive, consistent with profile persistence pattern), on game end save GameHistoryEntry to IndexedDB via local-db.ts. On connect/startup, load history from IndexedDB and send to server to restore in-memory array. Cap at 100 on client side too.

**Checkpoint**: Game history records, caps at 100, persists across sessions. REST endpoint returns correct data.

---

## Phase 6: User Story 4 — No Server Dependencies (Priority: P4)

**Goal**: Complete removal of MongoDB, Firebase, Discord, and all multiplayer-only code. Clean build with zero dead references.

**Independent Test**: `npm run build` — zero mongoose/firebase/discord references. Start app without MongoDB/Firebase credentials — no errors.

### REST Endpoint & Entry Point Cleanup

- [x] T034 [US4] Modify app/app.config.ts — update remaining kept endpoints: GET /bots and /bots/:id → read from local-store botList; GET /profile → read from local-store; GET /titles → static/precomputed data. Replace `authUser()` function (L475-492) with local-store lookup (always returns current player in single-player). Remove `mongoose.connect()` (L604-606), `admin.initializeApp()` (L607-613), `migrateShardsOfAltForms` import, Helmet CSP Firebase entries (L148-149).
- [x] T035 [US4] Delete multiplayer-only REST endpoints from app/app.config.ts: GET /meta/*, GET /leaderboards/*, GET /dendrogram, GET /chat-history/:playerUid, GET /players, POST /bots, DELETE /bots/:id, POST /bots/:id/approve, all ban/unban endpoints.
- [x] T036 [US4] Modify app/index.ts — remove imports of `initCronJobs` (from cronjobs.ts), `fetchLeaderboards` (from leaderboard.ts), `fetchMetaReports` (from meta.ts) and their startup invocations. Keep CronJob for `checkLobby` (not MongoDB-dependent).

### Import Path Updates (Client)

- [x] T037 [US4] Update ~9 meta-report client files to import fetch* functions from app/public/src/api/meta.ts instead of mongo-models: synergy-report.tsx, metadata-report.tsx, pokemon-report.tsx, item-report.tsx, region-report.tsx, composition-report.tsx, cluster-map.tsx, dendrogram-chart.tsx, title-tab.tsx
- [x] T038 [P] [US4] Update ~13 bot-builder/game client files to import IBot/IBotLight/IDetailledPokemon from app/types/interfaces/bot.ts instead of mongo-models: network.ts, bot-select-modal.tsx, bot-builder.tsx, team-builder.tsx, team-editor.tsx, bot-avatar.tsx, bot-manager-panel.tsx, import-bot-modal.tsx, team-builder-modal.tsx, game-store.tsx, game-pokemons-proposition.tsx (+ any others found during implementation)

### File Deletion

- [x] T039 [US4] Delete app/models/mongo-models/ directory (20 Mongoose model files)
- [x] T040 [P] [US4] Delete server services: app/services/meta.ts, app/services/discord.ts, app/services/cronjobs.ts, app/services/leaderboard.ts
- [x] T041 [P] [US4] Delete scheduled/ directory and db-commands/ directory entirely

### Dependency Removal

- [x] T042 [US4] Remove npm packages via `npm uninstall`: mongoose, firebase-admin, firebase, firebaseui, @firebase/auth-types, discord.js, dayjs (only used in deleted cronjobs.ts). Verify package.json clean.

**Checkpoint**: Build passes with zero references to removed packages. App starts without database connection errors.

---

## Phase 7: Polish & Verification

**Purpose**: Final validation and build verification

- [x] T043 Run `npm run build` — verify zero compilation errors
- [x] T044 Run build verification commands from quickstart.md — grep for mongoose, firebase-admin, firebase, mongo-models, discord.js in app/ (excluding specs/ and node_modules/) — verify zero matches
- [x] T045 Verify removed packages not in package.json: `node -e "const p=require('./package.json'); ['mongoose','firebase-admin','firebase','firebaseui','@firebase/auth-types','discord.js','dayjs'].forEach(d => { if(p.dependencies?.[d] || p.devDependencies?.[d]) console.error('FAIL: '+d) })"`
- [x] T046 Run `npm run lint` and fix any linting errors introduced by changes
- [ ] T047 Run quickstart.md validation scenarios and integration test checklist (manual):
  - VS1: Player profile persistence (username input → play → close/reopen → verify)
  - VS2: Bot opponents offline (disconnect → start match → verify 7 bots)
  - VS3: Game history (play 3 games → verify entries → close/reopen → verify persistence)
  - VS4: No server dependencies (grep verification — already covered by T044)
  - VS5: Data corruption recovery — corrupt IndexedDB manually → reload → verify fresh profile created in **<1 second** (SC-007)
  - VS6: Storage constraints — full collection + 100 history entries → verify IndexedDB usage **<10MB** (SC-006)
  - VS7: Server-client data sync (connect → play → verify round-trip)
  - **Startup timing**: Measure app startup time → verify **<500ms degradation** vs pre-migration baseline (SC-005)
  - Integration checklist: Core Functionality (11), Auth Mock (3), REST Endpoints (3), Import Path Integrity (6), Firebase Client SDK Removal (7), Build & Cleanup (5)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1)**: Depends on Phase 2 — core player data & auth flow
- **Phase 4 (US2)**: Depends on Phase 2 + T009 (onAuth mocks from US1)
- **Phase 5 (US3)**: Depends on Phase 2 + T009 (onAuth mocks from US1)
- **Phase 6 (US4)**: Depends on US1 + US2 + US3 — deletion/cleanup phase
- **Phase 7 (Polish)**: Depends on Phase 6

### User Story Dependencies

- **US1 (P1)**: Start after Phase 2. Largest story — all auth and player data.
- **US2 (P2)**: Start after Phase 2 + T009. Bot-specific changes only.
- **US3 (P3)**: Start after Phase 2 + T009. History-specific changes only.
- **US4 (P4)**: MUST wait for US1 + US2 + US3 — deletes old files that earlier phases reference during development.

### File Conflict Notes (Must Run Sequentially)

- **game-room.ts**: T009 (onAuth) → T011 (US1 player data) → T029 (US2 bot ELO) → T031 (US3 history)
- **preparation-commands.ts**: T014 (US1 UserMetadata) → T025 (US2 BotV2)
- **app.config.ts**: T032 (US3 history endpoint) → T034 (US4 remaining endpoints) → T035 (US4 endpoint deletion)
- **bot-builder.tsx, bot-manager-panel.tsx**: T021 (US1 remove getIdToken) → T038 (US4 update IBot import)

### Parallel Opportunities

- **Phase 2**: T003 ∥ T004 ∥ T005 (extractions). Then T006 ∥ T007 ∥ T008 (new files).
- **Phase 3**: T012 ∥ T013 (commands). T015 ∥ T016 ∥ T017 (states/core).
- **Phase 4**: T027 ∥ T028 (independent files).
- **Phase 6**: T037 ∥ T038 (import updates). T039 ∥ T040 ∥ T041 (deletions).

---

## Implementation Strategy

### MVP First (US1 Only)

1. Phase 1: Setup (idb install, bots.json)
2. Phase 2: Foundational (local-store, local-db, interfaces, username-input)
3. Phase 3: US1 — Player Profile Persistence
4. **STOP and VALIDATE**: Player can create profile via username input, play game, close/reopen browser — all data persists via IndexedDB
5. This is the minimum viable single-player experience

### Full Incremental Delivery

1. Setup + Foundational → Infrastructure ready
2. US1 (Phase 3) → Player profile + auth works → Validate (MVP!)
3. US2 (Phase 4) → Bots load from static JSON → Validate
4. US3 (Phase 5) → Game history persists → Validate
5. US4 (Phase 6) → All old code deleted, build clean → Validate
6. Polish (Phase 7) → Final verification → **DONE**

### Recommended Execution (Single Developer)

Execute strictly sequentially: Phase 1 → 2 → 3 → 4 → 5 → 6 → 7

Each phase builds on the previous. US4 (cleanup/deletion) MUST be last because earlier phases may still reference old files during development. Commit after each phase for safe rollback points.

---

## Notes

- [P] tasks = different files, no shared dependencies — safe to run in parallel
- [Story] label maps task to spec.md user stories for traceability
- **Commit discipline** (Constitution Principle IV): Each task = one commit. Format: `[spec-002] <type>: <description>` where type ∈ {extract, remove, replace, refactor, fix, cleanup}. `npm run build` MUST pass at every commit.
- game-room.ts is the most complex file (~44KB, touched by US1/US2/US3) — extra care needed
- "以最小改動" constraint: reuse existing type shapes, keep REST endpoint signatures, change only data source
- When encountering `import { X } from "mongo-models/..."` — check if type-only or runtime. Runtime imports break esbuild on deletion.
