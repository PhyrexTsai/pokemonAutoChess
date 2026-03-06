# Feature Specification: Remove MongoDB

**Feature Branch**: `002-remove-mongodb`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "參考 PHASE.md 開始進行 Phase 1: Remove MongoDB 的規劃。目標是用 IndexedDB 取代所有 MongoDB 持久化，移除 mongoose 和 firebase-admin 依賴。"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Player Progress Persists Across Sessions (Priority: P1)

A player launches the game, plays several rounds, earns ELO changes, unlocks new Pokemon emotions, and collects titles. When they close the browser and reopen the game later, all their progress — ELO rating, win/loss record, experience, level, Pokemon collection unlocks, equipped emotions, booster currency, and earned titles — is preserved exactly as they left it.

**Why this priority**: Without persistent player progress, the game has no sense of progression. This is the most fundamental data persistence requirement that enables all other features.

**Independent Test**: Create a new player profile, play one game to completion, close the browser, reopen — verify ELO, wins, level, collection state, and booster count match post-game values.

**Acceptance Scenarios**:

1. **Given** a first-time player opens the game, **When** the game loads, **Then** a username input screen is shown. After the player enters a name and confirms, a new local player profile is created with that display name, an auto-generated UUID, and default values (ELO 1000, 0 wins, level 0, empty collection).
2. **Given** a player finishes a game and earns +25 ELO, **When** they close and reopen the browser, **Then** their ELO reads 1025 and win count is incremented by 1.
3. **Given** a player unlocks a shiny emotion for Pikachu, **When** they revisit the collection screen next session, **Then** the shiny emotion for Pikachu is still marked as unlocked.
4. **Given** a player has accumulated 50 boosters, **When** they close the browser without spending them, **Then** 50 boosters are present next session.
5. **Given** the local storage is cleared or corrupted, **When** the player opens the game, **Then** a fresh profile is created with defaults (graceful recovery, no crash).

---

### User Story 2 - Bot Opponents Available Offline (Priority: P2)

A player can battle against AI opponents (bots) without any network connection. The game provides a library of pre-approved bot configurations that define board compositions at various stages of the game. The player experiences varied AI opponents across multiple games.

**Why this priority**: Bots are the core opponents in single-player mode. Without bot data available offline, there is no gameplay. This is second only to player progress because bot data is read-only (simpler migration).

**Independent Test**: Disconnect from internet, launch game, start a match — verify 7 bot opponents are assigned with valid board configurations and the game plays to completion.

**Acceptance Scenarios**:

1. **Given** no network connection, **When** the game starts a match, **Then** 7 bot opponents are loaded from bundled data with valid names, avatars, and board configurations.
2. **Given** the bundled bot library, **When** any bot's board configuration is loaded, **Then** all Pokemon placements are within valid grid bounds (x: 0-7, y: 0-3) and item counts do not exceed limits.
3. **Given** the game selects bots for a match, **When** bots are assigned, **Then** bot ELO ratings are used to select opponents appropriate to the player's current ELO range.

---

### User Story 3 - Game History Viewable (Priority: P3)

A player can view their recent game history — a list of past matches showing their final rank, team composition, synergies, and ELO change. The history is limited to the most recent 100 games to keep storage bounded.

**Why this priority**: Game history provides replay value and a sense of progression, but the game is fully functional without it. It's a quality-of-life feature that depends on the persistence layer from US1.

**Independent Test**: Play 3 games, open history screen — verify 3 entries with correct rank, team, synergies, and ELO. Play 101 games total — verify only the latest 100 appear.

**Acceptance Scenarios**:

1. **Given** a player finishes a game ranked 3rd with 5 Pokemon and 3 synergies, **When** they open the history screen, **Then** an entry shows rank 3, the 5 Pokemon with their items, the 3 synergies with their levels, and the ELO change.
2. **Given** a player has 100 game history entries, **When** they finish game 101, **Then** the oldest entry is removed and the new entry appears at the top, maintaining exactly 100 entries.
3. **Given** a player has no game history, **When** they open the history screen, **Then** an empty state message is displayed (no errors).

---

### User Story 4 - No Server Dependencies Required (Priority: P4)

The game application launches and runs without requiring MongoDB, Firebase Admin SDK, or any server-side database connections. All previously server-dependent data flows are replaced with local alternatives, and all multiplayer-only data models (chat, tournaments, bans, server analytics) are removed entirely.

**Why this priority**: This is the cleanup and validation story. It ensures the codebase is free of dead dependencies after US1-US3 are implemented. It validates the overall migration is complete.

**Independent Test**: Run the build process — verify no mongoose or firebase-admin imports remain. Start the application — verify no database connection errors or missing model warnings.

**Acceptance Scenarios**:

1. **Given** the application dependencies, **When** the build process runs, **Then** the build succeeds with zero references to mongoose or firebase-admin in the output bundle.
2. **Given** no MongoDB server running and no Firebase credentials configured, **When** the application starts, **Then** it launches successfully without connection errors.
3. **Given** all multiplayer-only models are removed, **When** searching the codebase for removed model names (ChatV2, Tournament, BannedUser, Meta, MetaV2, ItemsStatistic, PokemonsStatistic, RegionStatistic, TitleStatistic, BotMonitoring, EloBot, SocialUser, ReportMetadata, Dendrogram), **Then** zero references are found outside of migration/deletion commits.

---

### Edge Cases

- What happens when the browser's storage quota is exceeded? The game displays a user-friendly message and continues functioning with in-memory data for the current session.
- What happens when two browser tabs are open simultaneously? The most recent write wins; no corruption or crashes occur.
- What happens when the bundled bot data file is missing or corrupted? The game falls back to a minimal set of hardcoded bot configurations (at least 7 bots) to enable gameplay.
- What happens when the player's local storage format changes between game versions? A versioned migration system upgrades old data formats without data loss.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST persist player profile data (ELO, wins, games, experience, level, booster count, titles, avatar, display name, role) locally on the player's device, surviving browser close/reopen.
- **FR-002**: The system MUST persist the player's Pokemon collection state (per-Pokemon unlock bits, selected emotions, shiny status, dust, play count) locally.
- **FR-003**: The system MUST load AI opponent (bot) configurations from data bundled with the application, requiring no network access.
- **FR-004**: The system MUST record game history entries (rank, team, synergies, ELO, game mode, timestamp) locally after each completed game.
- **FR-005**: The system MUST cap game history at 100 entries per player, automatically removing the oldest entry when the limit is exceeded.
- **FR-006**: The system MUST remove all 17 multiplayer-only data models (ChatV2, Chat, Tournament, BannedUser, Meta, MetaV2, ItemsStatistic, ItemsStatisticV2, PokemonsStatistic, PokemonsStatisticV2, RegionStatistic, TitleStatistic, BotMonitoring, EloBot, SocialUser, ReportMetadata, Dendrogram) and their associated code paths.
- **FR-007**: The system MUST remove all mongoose and firebase-admin package imports from the codebase.
- **FR-008**: The system MUST remove all server-side analytics services (meta statistics, Pokemon statistics, item statistics, region statistics) and their scheduled jobs (cron tasks for ELO decay, old data cleanup).
- **FR-009**: The system MUST display a username input screen on first launch. After the player enters a non-empty name, the system generates a UUID (`crypto.randomUUID()`) as the player's uid and creates a local profile with sensible defaults (ELO 1000, level 0, 0 wins, empty collection, language detected from browser).
- **FR-010**: The system MUST handle corrupted or missing local data gracefully by creating a fresh profile without crashing.
- **FR-011**: The system MUST include a data format version number to support future schema migrations without data loss.
- **FR-012**: The build process MUST pass with zero mongoose or firebase-admin references after migration.
- **FR-015**: The system MUST remove the Firebase Client SDK (`firebase`, `firebaseui`, `@firebase/auth-types`) and replace the entire OAuth login flow with a local username input screen that generates a UUID on first launch. Subsequent launches auto-load the profile from IndexedDB and skip the login screen.
- **FR-013**: The system MUST remove the Discord webhook integration service, as it depends on server-side MongoDB queries and is multiplayer-only.
- **FR-014**: The system MUST remove the server-side leaderboard service, replacing it with a local-only display of the player's own stats.

### Key Entities

- **PlayerProfile**: Represents the local player's persistent state — identity, progression (ELO, level, wins, experience), currency (boosters), cosmetics (avatar, title, titles collection), and settings (language). Replaces the server-side UserMetadata model.
- **PokemonCollection**: A map of Pokemon identifiers to their unlock state — dust count, unlocked emotion/shiny bits (5-byte bitfield), selected emotion, selected shiny flag, and play count. Nested within PlayerProfile.
- **GameHistoryEntry**: A record of one completed game — final rank, player count, team composition (Pokemon names, items), active synergies with levels, ELO at time of game, game mode, and timestamp. Capped at 100 entries.
- **BotConfiguration**: A read-only definition of an AI opponent — name, avatar, ELO rating, and a sequence of board states (steps) describing their team at each game stage. Each step contains Pokemon placements with grid coordinates, items, and optional cosmetic variants.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Player progress (ELO, wins, collection, boosters) persists with 100% accuracy across browser close/reopen cycles, verified by automated tests.
- **SC-002**: The game launches and plays a complete match to completion with zero network requests to database or authentication services.
- **SC-003**: Game history displays the most recent 100 entries with correct data, and older entries are automatically pruned.
- **SC-004**: The production build completes with zero references to mongoose or firebase-admin packages.
- **SC-005**: Application startup time does not increase by more than 500ms compared to the pre-migration baseline (bot data loading must be efficient).
- **SC-006**: Local storage usage remains under 10 MB for a typical player with 100 game history entries and a full Pokemon collection.
- **SC-007**: Corrupted or missing local data is recovered gracefully in under 1 second with a fresh default profile, verified by automated test.

## Assumptions

- The game is transitioning to single-player mode; multiplayer features (chat, tournaments, leaderboards across players) are intentionally removed, not replaced.
- Firebase client SDK and Firebase Admin SDK are both removed in this phase. The entire OAuth login flow is replaced with a local username input + `crypto.randomUUID()` identity system. No Firebase dependency remains after this phase.
- Bot data is exported once from the current MongoDB database and bundled as a static asset. No dynamic bot creation/editing is needed in single-player mode.
- The existing 5-byte bitfield encoding for Pokemon collection unlocks is preserved as-is; no re-encoding is needed.
- ELO decay (scheduled cron job) is removed entirely in single-player mode — player ELO only changes through game results.
- The browser environment supports IndexedDB (all modern browsers since 2012). No fallback to localStorage or cookies is needed.
