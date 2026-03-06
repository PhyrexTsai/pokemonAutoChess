# Data Model: Remove MongoDB

**Feature**: 002-remove-mongodb | **Date**: 2026-03-06

## Overview

Three data domains persist in single-player mode:
- **PlayerProfile**: Server in-memory + Client IndexedDB (cross-session)
- **GameHistoryEntry**: Server in-memory + Client IndexedDB (capped 100)
- **BotConfiguration**: Static JSON bundle (read-only)

Field names and types match the existing Mongoose schemas exactly to minimize change.

## Entity: PlayerProfile

**Server storage**: In-memory `Map<string, PlayerProfile>` (replaces `UserMetadata.findOne()`)
**Client storage**: IndexedDB object store `player`
**Replaces**: MongoDB `UserMetadata` model + `IUserMetadataMongo` interface
**Cardinality**: Exactly 1 record (single-player)

**Lobby cache note**: `custom-lobby-room.ts` already maintains `this.users: Map<string, IUserMetadataMongo>` as an in-memory cache with write-through to MongoDB. In the new architecture, `local-store.ts` becomes the single truth source and lobby's `this.users` should reference it directly (or be removed in favor of the store).

**Colyseus state file note**: `lobby-state.ts` and `preparation-state.ts` have runtime imports of chatV2 and tournament Mongoose models for persistent chat/tournament storage. These must be removed — chat messages in single-player are transient (already synced via Colyseus state), and tournaments are multiplayer-only.

| Field | Type | Default | Source |
|-------|------|---------|--------|
| uid | string | crypto.randomUUID() on first launch | Primary key (generated after username input, replaces Firebase UID) |
| displayName | string | user input on first launch (required, non-empty) | Player's display name (entered via username input screen) |
| language | string | "en" (browser detect) | UI language |
| avatar | string | "0019/Normal" | Pokemon avatar ID |
| wins | number | 0 | Total games won |
| games | number | 0 | Total games played |
| exp | number | 0 | Experience points |
| level | number | 0 | Player level |
| elo | number | 1000 | Current ELO rating |
| maxElo | number | 1000 | Highest ELO ever reached |
| booster | number | 0 | Booster currency |
| title | string | "" | Currently equipped title |
| titles | Title[] | [] | Earned titles |
| role | string | Role.BASIC | Player role |
| pokemonCollection | Map<string, PokemonCollectionItem> | {} | Per-Pokemon unlock state |
| schemaVersion | number | 1 | Data format version for future migrations |

**Fields removed from UserMetadata** (multiplayer-only):
- `banned` — account ban (admin feature)
- `eventPoints`, `maxEventPoints`, `eventFinishTime` — multiplayer events

### Nested: PokemonCollectionItem

Field names match existing `IPokemonCollectionItemMongo` / `IPokemonCollectionItem`.

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| id | string | — | Pokemon ID key |
| dust | number | 0 | Dust currency for this Pokemon |
| unlocked | Buffer (server) / base64 string (client) | 5 zero bytes | 5-byte bitfield: emotion/shiny unlock status (40 bits) |
| selectedEmotion | Emotion \| null | null | Currently selected emotion |
| selectedShiny | boolean | false | Whether shiny variant selected |
| played | number | 0 | Times this Pokemon used in games |

**Legacy fields** (from Mongoose schema, lines 99-124):
- `emotions: Emotion[]` — legacy array, migrated to `unlocked` buffer
- `shinyEmotions: Emotion[]` — legacy array, migrated to `unlocked` buffer
- These can be dropped in the new local format since migration to `unlocked` is already complete.

**Validation Rules**:
- `elo` >= 0
- `booster` >= 0
- `unlocked` bitfield: existing 5-byte encoding preserved as-is
- `schemaVersion` must be present for migration support
- Server stores `unlocked` as Uint8Array (replaces Node.js Buffer)
- Client IndexedDB stores `unlocked` as base64 string (matches `IPokemonCollectionItemClient.unlockedb64`)

## Entity: GameHistoryEntry

**Server storage**: In-memory array (capped 100)
**Client storage**: IndexedDB object store `gameHistory`
**Replaces**: MongoDB `DetailledStatisticV2` model + `IDetailledStatistic` interface
**Cardinality**: Max 100 records per player (FIFO cap)

Field names match existing `IDetailledStatistic` interface exactly.

| Field | Type | Notes |
|-------|------|-------|
| id | string | Primary key (auto-generated, replaces MongoDB _id) |
| playerId | string | Player's uid |
| elo | number | Player's ELO at end of game |
| time | number | Game duration in milliseconds |
| name | string | Player display name at time of game |
| rank | number | Final placement (1-8) |
| nbplayers | number | Total players in match |
| avatar | string | Player's avatar ID at time of game |
| pokemons | Pokemon[] | Team composition (see nested) |
| synergies | Map<Synergy, number> | Map of synergy type to trigger level |
| regions | DungeonPMDO[] | Dungeon/region enum values |
| gameMode | GameMode | Game mode enum value |

### Nested: Pokemon (array items in `pokemons`)

Matches existing `Pokemon` interface from `detailled-statistic-v2.ts:8-12`.

| Field | Type | Notes |
|-------|------|-------|
| name | string | Pokemon species (Pkm enum value) |
| avatar | string | Pokemon avatar variant |
| items | string[] | Equipped item names (Item enum values) |

**Validation Rules**:
- `rank` between 1 and 8
- When count exceeds 100, delete oldest by insertion order
- `synergies` stored as plain object `{ [key: string]: number }` in IndexedDB (Map not directly serializable)

**Dead data note**: The REST endpoint `/game-history/:uid` only returns 5 fields to the client: `pokemons`, `time`, `rank`, `elo`, `gameMode`. Fields `synergies`, `regions`, `nbplayers`, `name`, `avatar` are stored by game-room but never read by the client (client recalculates synergies from `pokemons`). These fields are kept for schema compatibility but could be omitted in a future optimization.

## Entity: BotConfiguration

**Storage**: Static JSON file bundled with app (`app/public/src/assets/bots.json`)
**Replaces**: MongoDB `BotV2` model + `IBot` interface
**Cardinality**: Read-only, hundreds of entries

Field names match existing `IBot` interface exactly.

| Field | Type | Notes |
|-------|------|-------|
| id | string | Unique bot ID (nanoid) |
| name | string | Bot display name |
| avatar | string | Bot avatar ID (required) |
| author | string | Bot creator UID (required) |
| elo | number | Bot ELO rating for matchmaking (required) |
| approved | boolean | Whether bot approved by staff |
| steps | IStep[] | Board states at each game stage |

**Export filter**: Only export bots where `approved === true` to the static JSON.

### Nested: IStep (array items in `steps`)

| Field | Type | Notes |
|-------|------|-------|
| board | IDetailledPokemon[] | Pokemon placements on board |
| roundsRequired | number | Rounds to execute this step (required) |

### Nested: IDetailledPokemon (array items in `board`)

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| name | Pkm | required | Pokemon species enum |
| x | number | min: 0, max: 7, required | Grid X position |
| y | number | min: 0, max: 3, required | Grid Y position |
| items | Item[] | — | Equipped items |
| emotion | Emotion | optional | Pokemon's emotion state |
| shiny | boolean | optional | Whether shiny variant |

**Validation Rules**:
- `x` between 0 and 7, `y` between 0 and 3
- Items per Pokemon max 3
- Each step must have valid Pokemon identifiers (Pkm enum values)

## Storage Schemas

### Server-side In-Memory Store

```typescript
// app/models/local-store.ts
// Single-player: one player, one history array, one bot list

let currentPlayer: IUserMetadata | null = null
const gameHistory: IDetailledStatistic[] = []  // capped at 100
let botList: IBot[] = []  // loaded from static JSON at startup
```

### Client-side IndexedDB

```typescript
// app/public/src/persistence/local-db.ts
// Database name: "pokemon-auto-chess"
// Version: 1

interface PACDatabase extends DBSchema {
  player: {
    key: string          // uid
    value: PlayerProfile // serialized (Buffer → base64, Map → object)
  }
  gameHistory: {
    key: string          // id
    value: GameHistoryEntry  // serialized (Map → object)
    indexes: { "by-time": number }  // for FIFO deletion
  }
}
```

## Data Flow

### PlayerProfile Lifecycle
```
First launch → Client: check IndexedDB for existing profile
              → IF not exists: show username input screen → player enters name
                → generate UUID (crypto.randomUUID()) → create profile with defaults in IndexedDB
              → Client: send full profile (incl. pokemonCollection) to Server via Colyseus onJoin()
              → Server: store in local-store global singleton (currentPlayer)

Room onAuth  → Returns mock UserRecord: { uid, displayName, email, photoURL, metadata: { language } }
              → client.auth.displayName gates onLeave logic (MUST be truthy)
              → client.auth.email must be non-undefined (prevents anonymous flag at preparation-commands.ts:119)

Game start   → game-room.ts onCreate: reads pokemonCollection from local-store
              → (Previously re-queried MongoDB; IGameUser does NOT carry pokemonCollection)

During game  → Server: mutate in-memory object (elo, wins, games, exp, collection)

Game end     → Server: send updated profile to Client
              → Client: save to IndexedDB

Next session → Client: load from IndexedDB → send to Server on join
```

### GameHistoryEntry Lifecycle
```
Game end     → Server: create entry in memory array (fire-and-forget, matching existing pattern)
              → Server: if count > 100, drop oldest
              → Server: send entry to Client via Colyseus message
              → Client: save to IndexedDB (also cap at 100)

History page → Client: fetch("/game-history/:uid") → Server: read from in-memory array
              (REST endpoint preserved, only data source changes — zero client change)

Next session → Client: load history from IndexedDB for display
              → Server: receives history from client on connect (restores in-memory array)
```

### BotConfiguration Lifecycle
```
Server start → import bots.json into in-memory botList (static, approved-only, includes steps)

Preparation  → Server: OnAddBotCommand filters botList by ELO range, picks random
              → Client: fetches /bots REST endpoint for bot selection UI
              (REST endpoint preserved, serves from in-memory botList — zero client change)

During game  → Server: core/bot.ts reads steps from in-memory botList (replaces BotV2.findOne)
              → Bot ELO is IMMUTABLE — delete bot ELO update code in game-room.ts

No mutation (read-only)
```
