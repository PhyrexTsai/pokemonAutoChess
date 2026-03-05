# Quickstart Validation: Extract Game Engine

## Validation Scenarios

### 1. Build passes after every commit

```bash
npm run build
# Expected: exits 0, no errors
```

### 2. computeRoundDamage extracted and tested

```bash
npx vitest run app/core/__tests__/compute-round-damage.test.ts
# Expected: all tests pass
```

### 3. Simulation.update() returns events

```bash
npx vitest run app/core/__tests__/simulation-events.test.ts
# Expected: update(dt) returns BattleEvent[] with ability/damage/heal events
```

### 4. Zero room.broadcast()/room.clients in core engine

```bash
grep -rn "room\.broadcast\|room\.clients" app/core/
# Expected: zero matches

grep -rn "\.room\." app/core/
# Expected: exactly 8 matches, ALL in these files only:
#   app/core/abilities/abilities.ts (3 matches — lines 291, 13519, 13523)
#   app/core/abilities/hidden-power.ts (4 matches — lines 112, 115, 117, 405)
#     Note: lines 112 and 115 are the same pickFish() call spanning multiple lines
#   app/core/effects/synergies.ts (1 match — line 216)
# All must have null guards (if (!...room) return) before each room access block
```

### 5. Multiplayer game works identically

```bash
npm run dev
# Manual test: start a game, play through battle phase
# Expected: ability animations, damage numbers, heal effects, battle results
# all display identically to pre-refactoring behavior
```

### 6. Simulation instantiable without GameRoom

```typescript
// This must work in a test file:
const sim = new Simulation(
  "test-1",
  blueBoard, redBoard,
  bluePlayer, redPlayer,
  5, Weather.NEUTRAL, null, false
)
const events = sim.update(16)
// events is BattleEvent[], no errors thrown
```
