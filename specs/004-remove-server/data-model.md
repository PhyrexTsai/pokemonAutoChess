# Data Model: Remove Server

**Feature**: 004-remove-server
**Date**: 2026-03-08

## Overview

This phase introduces no new data entities. All data models remain unchanged from Phases 0–2. The only change is the **access path** — data that was previously fetched via HTTP endpoints is now accessed via direct function calls to existing modules.

## Data Access Migration

### Before (Server-mediated)

```
Client → fetch("/bots") → Express → fetchBotsList() → local-store → response → Client
Client → fetch("/tilemap/map") → Express → initTilemap() → response → Client
Client → fetch("/game-history/uid") → Express → getGameHistoryByPlayer() → response → Client
```

### After (Direct)

```
Client → fetchBotsList() → local-store → Client
Client → initTilemap(map) → Client
Client → getGameHistoryByPlayer(uid) → local-store → Client
```

## Existing Entities (Unchanged)

| Entity | Module | Storage | Notes |
|--------|--------|---------|-------|
| `IBot` | `app/types/interfaces/bot.ts` | `local-store` (in-memory, loaded from `bots.json`) | Bot AI data for opponent selection |
| `IDetailledStatistic` | `app/types/interfaces/detailled-statistic.ts` | `local-store` (in-memory) + IndexedDB | Game history records |
| `IUserMetadataMongo` | `app/types/interfaces/UserMetadata.ts` | `local-store` (in-memory) + IndexedDB | Player profile |
| `GameRecord` | `app/models/colyseus-models/game-record.ts` | Derived from `IDetailledStatistic` | Display-friendly game history |
| `DesignTiled` | `app/core/design.ts` | Generated at runtime | Tilemap data (not persisted) |

## Initialization Change

**Before**: `loadBotsFromJson()` called in `app/app.config.ts` at server startup
**After**: `loadBotsFromJson()` called during client initialization (in `network.ts` or app entry)
