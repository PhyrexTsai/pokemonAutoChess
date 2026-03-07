# Quickstart: Remove MongoDB

**Feature**: 002-remove-mongodb | **Date**: 2026-03-06

## Validation Scenarios

### VS1: Player Profile Persistence (US1)

**Setup**: Fresh browser (no existing IndexedDB data)

```
1. Open game → verify username input screen is shown
   → enter "TestPlayer" → click Start
   → verify profile created with displayName="TestPlayer", auto-generated UUID as uid
   - ELO = 1000, wins = 0, games = 0, level = 0, empty collection, booster = 0
2. Play one game to completion → verify:
   - ELO updated (±25 range)
   - Win count and games count both incremented
   - Experience gained
3. Close browser tab, reopen game → verify:
   - All values from step 2 are preserved exactly (loaded from IndexedDB)
4. Clear IndexedDB via DevTools → reopen game → verify:
   - Fresh profile created (no crash, no error)
   - Default values restored
```

### VS2: Bot Opponents Offline (US2)

**Setup**: Disconnect from internet (DevTools Network → Offline)

```
1. Launch game → verify no network errors on bot loading
2. Start a match → verify:
   - 7 bot opponents assigned
   - Each bot has valid name, avatar, board configurations
   - Bot ELO range appropriate for player ELO
   - All bots have approved === true
3. Play match to completion → verify:
   - All bot boards load valid Pokemon at valid grid positions (x: 0-7, y: 0-3)
   - Bots change team composition each round (core/bot.ts reads steps correctly)
   - Game completes without errors
4. Play another match → verify bot ELOs unchanged (static, immutable)
```

### VS3: Game History (US3)

```
1. Play 3 games → open history screen → verify:
   - 3 entries visible
   - Each shows: rank, team composition (pokemons with items), synergies (Map), ELO
   - time, name, avatar, regions, gameMode all present
2. Verify entries are ordered newest-first
3. Close/reopen browser → verify history persists (loaded from IndexedDB)
4. (Extended) Play 101 games → verify only 100 entries remain
```

### VS4: No Server Dependencies (US4)

```
1. Run: npm run build
   → verify zero references to mongoose, firebase-admin, or firebase in output
2. Run: grep -r "mongoose" app/ --include="*.ts" --include="*.js"
   → verify zero matches (excluding specs/ and node_modules/)
3. Run: grep -r "firebase-admin" app/ --include="*.ts" --include="*.js"
   → verify zero matches
4. Run: grep -r "from \"firebase" app/ --include="*.ts" --include="*.tsx"
   → verify zero matches (excluding specs/ and node_modules/)
5. Start application with no MongoDB and no Firebase credentials
   → verify it launches without connection errors
```

### VS5: Data Corruption Recovery (Edge Case)

```
1. Open IndexedDB in DevTools, manually corrupt player data
2. Reload game → verify:
   - No crash or unhandled error
   - Fresh profile created with defaults
   - Recovery completes in < 1 second
```

### VS6: Storage Constraints (SC-006)

```
1. Create a player with full Pokemon collection (all unlocks)
2. Fill game history to 100 entries
3. Check IndexedDB storage usage via DevTools
   → verify total < 10 MB
```

### VS7: Server-Client Data Sync (Architecture)

```
1. Launch game → verify client sends profile from IndexedDB to server on connect
2. Play a game → verify server's in-memory store is updated
3. Game ends → verify server sends updated profile back to client
4. Check IndexedDB → verify updated values are persisted
5. Restart server (keep browser open) → reconnect → verify client resends profile from IndexedDB
```

## Build Verification Commands

```bash
# Full build passes
npm run build

# No mongoose references in source
grep -r "mongoose" app/ --include="*.ts" | grep -v "node_modules" | grep -v "specs/"
# Expected: 0 results

# No firebase-admin references in source
grep -r "firebase-admin" app/ --include="*.ts" | grep -v "node_modules" | grep -v "specs/"
# Expected: 0 results

# No mongo-models imports remain
grep -r "mongo-models" app/ --include="*.ts" | grep -v "node_modules" | grep -v "specs/"
# Expected: 0 results

# No discord.js references in source
grep -r "discord.js" app/ --include="*.ts" | grep -v "node_modules" | grep -v "specs/"
# Expected: 0 results

# Verify removed packages not in dependencies
node -e "const p=require('./package.json'); ['mongoose','firebase-admin','firebase','firebaseui','@firebase/auth-types','discord.js'].forEach(d => { if(p.dependencies?.[d] || p.devDependencies?.[d]) console.error('FAIL: '+d+' still in package.json') })"

# Vitest passes
npm run test
```

## Integration Test Checklist

### Core Functionality
- [ ] Username input screen shown on first launch (no existing IndexedDB profile)
- [ ] Username input generates UUID and creates profile on submit
- [ ] Subsequent launches skip username input (profile loaded from IndexedDB)
- [ ] Profile persistence across browser sessions (IndexedDB)
- [ ] Server in-memory store loads profile from client on connect
- [ ] pokemonCollection accessible from game-room via local-store (not re-queried from MongoDB)
- [ ] Bot data loads from static JSON (no network, no MongoDB)
- [ ] Bot behavior works during gameplay (core/bot.ts reads steps from in-memory store)
- [ ] InitializeBotsCommand fills bots from static JSON (not dead code — used by auto-fill)
- [ ] Bot ELOs do not change after games (immutable static data)
- [ ] Game history records and caps at 100

### Auth Mock
- [ ] onAuth mock returns displayName (guard check passes, no ghost players)
- [ ] onAuth mock returns metadata.language (no TypeError)
- [ ] onAuth mock provides email so player is NOT marked anonymous (preparation-commands.ts:119)

### REST Endpoints
- [ ] Game history REST endpoint `/game-history/:uid` returns data from in-memory store
- [ ] Bot list REST endpoint `/bots` returns data from static JSON
- [ ] Profile endpoint `/profile` returns data from local-store

### Import Path Integrity
- [ ] lobby-state.ts compiles without chatV2/tournament Mongoose imports
- [ ] preparation-state.ts compiles without chatV2 Mongoose import
- [ ] core/collection.ts compiles without HydratedDocument from mongoose
- [ ] core/bot-logic.ts compiles with updated IBot/IStep/IDetailledPokemon import paths
- [ ] All ~9 meta-report client files compile with relocated fetch* functions
- [ ] All ~13 bot-builder client files compile with updated IBot import paths

### Firebase Client SDK Removal
- [ ] login.tsx, styled-firebase-auth.tsx, anonymous-button.tsx deleted
- [ ] username-input.tsx renders on first launch and creates profile
- [ ] All 13 client files no longer import from firebase/compat/app or firebase/auth
- [ ] network.ts uses local identity (uid from IndexedDB) instead of Firebase onAuthStateChanged
- [ ] All getIdToken() calls removed (lobby, preparation, game, bot-builder, profile pages)
- [ ] NetworkStore.ts no longer imports User type from @firebase/auth-types
- [ ] firebase, firebaseui, @firebase/auth-types removed from package.json

### Build & Cleanup
- [ ] Build completes with zero removed-dependency references
- [ ] Corrupted data triggers graceful recovery
- [ ] Storage under 10MB for full usage scenario
- [ ] index.ts starts without initCronJobs/fetchLeaderboards/fetchMetaReports
- [ ] app.config.ts starts without mongoose.connect/admin.initializeApp
