/**
 * state-tracker.ts
 * Lightweight reactive state tracker replacing @colyseus/schema's
 * Encoder/Decoder/getDecoderStateCallbacks with snapshot-diff.
 *
 * Preserves the identical $ callback API so UI consumers (game.tsx,
 * game-container.ts) require zero code changes.
 *
 * Design constraints (from plan.md):
 *   C1: Dual collection detection (instanceof + constructor.name)
 *   C2: Retroactive onAdd with opt-out (immediate param)
 *   C3: Array per-index onChange tracking
 *   C4: Auto listener cleanup on collection removal
 *   C5: Zero-allocation fast-path on no-change flush
 */

// ==================== Collection Detection (C1) ====================
// Schema types implement but do NOT extend native types.
// Check instanceof first (native), fall back to constructor.name (Schema).

function isMapLike(obj: unknown): boolean {
  if (obj instanceof Map) return true
  return (obj as any)?.constructor?.name === "MapSchema"
}

function isSetLike(obj: unknown): boolean {
  if (obj instanceof Set) return true
  return (obj as any)?.constructor?.name === "SetSchema"
}

function isArrayLike(obj: unknown): boolean {
  if (Array.isArray(obj)) return true
  return (obj as any)?.constructor?.name === "ArraySchema"
}

// ==================== Types ====================

type Cb = (...args: any[]) => void

interface ScalarListener {
  obj: any
  prop: string
  cb: (value: any, prev: any) => void
  last: any
  dead: boolean
}

interface MapTracker {
  ref: any
  snap: Map<any, any>
  add: Cb[]
  rem: Cb[]
  chg: Cb[]
}

interface SetTracker {
  ref: any
  snap: Set<any>
  add: Cb[]
  rem: Cb[]
  chg: Cb[]
}

interface ArrayTracker {
  ref: any
  snap: any[]
  chg: Cb[]
}

// ==================== Public API ====================

export type StateCallbackProxy = <T>(instance: T) => any

export function createStateTracker(): {
  $: StateCallbackProxy
  flush: () => void
} {
  // --- Storage ---
  const scalars: ScalarListener[] = []
  const maps = new Map<any, MapTracker>()
  const sets = new Map<any, SetTracker>()
  const arrays = new Map<any, ArrayTracker>()
  const schemaCbs = new Map<any, Cb[]>() // obj → onChange callbacks
  const children = new Map<object, Set<object>>() // parent → nested objects
  const changed = new Set<object>() // reused per flush

  // --- Collection Tracker Getters ---

  function mapTracker(ref: any): MapTracker {
    let t = maps.get(ref)
    if (!t) {
      const snap = new Map<any, any>()
      ref.forEach((v: any, k: any) => snap.set(k, v))
      t = { ref, snap, add: [], rem: [], chg: [] }
      maps.set(ref, t)
    }
    return t
  }

  function setTracker(ref: any): SetTracker {
    let t = sets.get(ref)
    if (!t) {
      const snap = new Set<any>()
      ref.forEach((v: any) => snap.add(v))
      t = { ref, snap, add: [], rem: [], chg: [] }
      sets.set(ref, t)
    }
    return t
  }

  function arrTracker(ref: any): ArrayTracker {
    let t = arrays.get(ref)
    if (!t) {
      t = { ref, snap: Array.from(ref), chg: [] }
      arrays.set(ref, t)
    }
    return t
  }

  // --- Child Tracking & Cleanup (C4) ---

  function trackChild(parent: object, child: object) {
    let s = children.get(parent)
    if (!s) {
      s = new Set()
      children.set(parent, s)
    }
    s.add(child)
  }

  function cleanup(obj: object) {
    // Mark scalar listeners dead
    for (const l of scalars) {
      if (l.obj === obj) l.dead = true
    }
    // Remove schema onChange
    schemaCbs.delete(obj)
    // Remove collection trackers for this object (if it IS a collection)
    maps.delete(obj)
    sets.delete(obj)
    arrays.delete(obj)
    // Recurse children
    const kids = children.get(obj)
    if (kids) {
      for (const kid of kids) cleanup(kid)
      children.delete(obj)
    }
  }

  function removeCb(arr: Cb[], cb: Cb) {
    const i = arr.indexOf(cb)
    if (i >= 0) arr.splice(i, 1)
  }

  // --- Proxy Creation ---

  function proxy(instance: any): any {
    if (isMapLike(instance)) return mapProxy(instance)
    if (isSetLike(instance)) return setProxy(instance)
    if (isArrayLike(instance)) return arrProxy(instance)
    return schemaProxy(instance)
  }

  function schemaProxy(instance: any): any {
    const target: Record<string, any> = {
      listen(
        prop: string,
        cb: (value: any, prev: any) => void,
        immediate = false
      ) {
        const l: ScalarListener = {
          obj: instance,
          prop,
          cb,
          last: instance[prop],
          dead: false
        }
        scalars.push(l)
        if (immediate) cb(instance[prop], undefined)
        return () => {
          l.dead = true
        }
      },
      onChange(cb: Cb) {
        let arr = schemaCbs.get(instance)
        if (!arr) {
          arr = []
          schemaCbs.set(instance, arr)
        }
        arr.push(cb)
        return () => removeCb(arr!, cb)
      }
    }
    return new Proxy(target, {
      get(t, prop) {
        if (typeof prop === "symbol") return undefined
        const method = t[prop as string]
        if (method !== undefined) return method
        const val = instance[prop as string]
        if (val != null && typeof val === "object") {
          trackChild(instance, val)
          return proxy(val)
        }
        return undefined
      }
    })
  }

  function mapProxy(map: any): any {
    return {
      onAdd(cb: Cb, immediate = true) {
        const t = mapTracker(map)
        t.add.push(cb)
        // C2: retroactive fire for existing elements
        if (immediate) map.forEach((v: any, k: any) => cb(v, k))
        return () => removeCb(t.add, cb)
      },
      onRemove(cb: Cb) {
        const t = mapTracker(map)
        t.rem.push(cb)
        return () => removeCb(t.rem, cb)
      },
      onChange(cb: Cb) {
        const t = mapTracker(map)
        t.chg.push(cb)
        return () => removeCb(t.chg, cb)
      }
    }
  }

  function setProxy(set: any): any {
    return {
      onAdd(cb: Cb, immediate = true) {
        const t = setTracker(set)
        t.add.push(cb)
        // C2: retroactive fire
        if (immediate) set.forEach((v: any) => cb(v, v))
        return () => removeCb(t.add, cb)
      },
      onRemove(cb: Cb) {
        const t = setTracker(set)
        t.rem.push(cb)
        return () => removeCb(t.rem, cb)
      },
      onChange(cb: Cb) {
        const t = setTracker(set)
        t.chg.push(cb)
        return () => removeCb(t.chg, cb)
      }
    }
  }

  function arrProxy(arr: any): any {
    return {
      // C3: Array per-index onChange
      onChange(cb: Cb) {
        const t = arrTracker(arr)
        t.chg.push(cb)
        return () => removeCb(t.chg, cb)
      },
      onAdd(cb: Cb, immediate = true) {
        arrTracker(arr) // ensure tracker exists
        if (immediate) {
          for (let i = 0; i < arr.length; i++) cb(arr[i], i)
        }
        return () => {}
      },
      onRemove(_cb: Cb) {
        return () => {}
      }
    }
  }

  // --- flush() ---

  function flush() {
    changed.clear()

    // 1. Scalar listeners — O(N) reference comparisons
    const n = scalars.length // freeze length: new listeners added during callbacks skip this flush
    let compact = false
    for (let i = 0; i < n; i++) {
      const l = scalars[i]
      if (l.dead) {
        compact = true
        continue
      }
      const cur = l.obj[l.prop]
      if (cur !== l.last) {
        const prev = l.last
        l.last = cur
        l.cb(cur, prev)
        changed.add(l.obj)
      }
    }

    // Compact dead entries (C5: only when needed)
    if (compact) {
      let w = 0
      for (let r = 0; r < scalars.length; r++) {
        if (!scalars[r].dead) scalars[w++] = scalars[r]
      }
      scalars.length = w
    }

    // 2. Schema onChange — fire for objects with any scalar change
    for (const [obj, cbs] of schemaCbs) {
      if (changed.has(obj)) {
        for (const cb of cbs) cb()
      }
    }

    // 3. Map trackers
    for (const t of maps.values()) {
      if (t.add.length === 0 && t.rem.length === 0 && t.chg.length === 0)
        continue

      // Removed keys — fire onRemove, then cleanup (C4)
      for (const [key, oldVal] of t.snap) {
        if (!t.ref.has(key)) {
          t.snap.delete(key)
          for (const cb of t.rem) cb(oldVal, key)
          if (oldVal != null && typeof oldVal === "object") cleanup(oldVal)
        }
      }

      // Added & changed keys
      t.ref.forEach((val: any, key: any) => {
        if (!t.snap.has(key)) {
          t.snap.set(key, val)
          for (const cb of t.add) cb(val, key)
        } else if (t.snap.get(key) !== val) {
          t.snap.set(key, val)
          for (const cb of t.chg) cb(val, key)
        }
      })
    }

    // 4. Set trackers
    for (const t of sets.values()) {
      if (t.add.length === 0 && t.rem.length === 0 && t.chg.length === 0)
        continue

      // Removed values
      for (const val of t.snap) {
        if (!t.ref.has(val)) {
          t.snap.delete(val)
          for (const cb of t.rem) cb(val, val)
          for (const cb of t.chg) cb(val, val)
        }
      }

      // Added values
      t.ref.forEach((val: any) => {
        if (!t.snap.has(val)) {
          t.snap.add(val)
          for (const cb of t.add) cb(val, val)
          for (const cb of t.chg) cb(val, val)
        }
      })
    }

    // 5. Array trackers (C3: per-index onChange)
    for (const t of arrays.values()) {
      if (t.chg.length === 0) continue

      const len = Math.max(t.ref.length, t.snap.length)
      let dirty = false
      for (let i = 0; i < len; i++) {
        const cur = i < t.ref.length ? t.ref[i] : undefined
        const prev = i < t.snap.length ? t.snap[i] : undefined
        if (cur !== prev) {
          dirty = true
          for (const cb of t.chg) cb(cur, i)
        }
      }
      // C5: only allocate new snapshot when changes detected
      if (dirty) t.snap = Array.from(t.ref)
    }
  }

  return { $: proxy as StateCallbackProxy, flush }
}
