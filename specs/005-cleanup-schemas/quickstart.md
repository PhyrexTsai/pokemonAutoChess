# Quickstart: Cleanup Colyseus Schemas

## What Changed

All `@colyseus/schema` usage has been removed. Game state classes are now plain TypeScript classes using native `Map`, `Set`, and `Array` instead of `MapSchema`, `SetSchema`, and `ArraySchema`.

UI reactivity (change callbacks) is now handled by a lightweight `StateTracker` in `app/public/src/state-tracker.ts` instead of Colyseus's Encoder/Decoder.

## For Developers

### Adding a New Pokemon

Same as before. The only difference is the type set declaration:

```typescript
// Before
types = new SetSchema<Synergy>([Synergy.WATER, Synergy.FLYING])

// After
types = new Set<Synergy>([Synergy.WATER, Synergy.FLYING])
```

### Adding a New Field to a Model

No more `@type()` decorators needed. Just add the TypeScript field:

```typescript
// Before
@type("uint8") newField: number = 0

// After
newField: number = 0
```

If the field needs UI reactivity (Phaser rendering reacts to changes), register a listener in `game-container.ts`:

```typescript
$pokemon.listen("newField", (value, previousValue) => {
  this.gameScene?.battle?.changePokemon(simulationId, pokemon, "newField", value, previousValue)
})
```

### Working with Collections

```typescript
// MapSchema → Map (identical API)
board.set(id, pokemon)    // same
board.get(id)             // same
board.delete(id)          // same
board.forEach((v, k) => ...)  // same

// SetSchema → Set (identical API)
items.add(Item.SCOPE_LENS)     // same
items.has(Item.SCOPE_LENS)     // same
items.delete(Item.SCOPE_LENS)  // same

// ArraySchema → Array (mostly same)
shop.push(Pkm.PIKACHU)   // same
shop[0]                   // same
shop.length               // same (was .length on ArraySchema too)
```

### Build & Run

```bash
npm run build    # Builds client bundle only (no server)
npm run dev      # Development mode with hot reload
```

No `@colyseus/schema` package is needed. `npm install` will not fetch any Colyseus packages.
