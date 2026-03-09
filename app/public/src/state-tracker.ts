/**
 * state-tracker.ts
 * Proxy-interception reactive state tracker.
 *
 * Instead of snapshot-diff (polling), this wraps state objects with ES6 Proxy
 * so every property write is intercepted at mutation time. flush() then fires
 * only the callbacks for fields that actually changed.
 *
 * Design:
 *   - Plain objects: ES6 Proxy with set/deleteProperty traps
 *   - Map/Set: method patching (set, delete, clear, add)
 *   - Array: Proxy with set trap + method patching (push, splice, pop, etc.)
 *   - $ callback API identical to previous implementation
 *   - Auto listener cleanup on collection removal (C4)
 */

// ==================== Types ====================

type Cb = (...args: any[]) => void

interface ScalarChange {
  obj: any
  prop: string
  oldVal: any
  newVal: any
}

interface CollectionChange {
  type: "add" | "remove" | "change"
  collection: any
  key: any
  value: any
  oldValue?: any
}

interface ScalarListener {
  obj: any
  prop: string
  cb: (value: any, prev: any) => void
  dead: boolean
}

interface MapTracker {
  ref: any
  add: Cb[]
  rem: Cb[]
  chg: Cb[]
}

interface SetTracker {
  ref: any
  add: Cb[]
  rem: Cb[]
  chg: Cb[]
}

interface ArrayTracker {
  ref: any
  add: Cb[]
  rem: Cb[]
  chg: Cb[]
  lastLength: number
}

// ==================== Public API ====================

export type StateCallbackProxy = <T>(instance: T) => any

export function createStateTracker(): {
  $: StateCallbackProxy
  flush: () => void
  wrap: <T extends object>(obj: T) => T
} {
  // --- Dirty tracking ---
  const scalarChanges: ScalarChange[] = []
  const collectionChanges: CollectionChange[] = []

  // --- Listener storage ---
  const scalars: ScalarListener[] = []
  const maps = new Map<any, MapTracker>()
  const sets = new Map<any, SetTracker>()
  const arrays = new Map<any, ArrayTracker>()
  const schemaCbs = new Map<any, Cb[]>()
  const children = new Map<object, Set<object>>()

  // --- Proxy cache: original → proxy ---
  const proxyCache = new WeakMap<object, object>()
  // --- Reverse map: proxy → original ---
  const proxyToRaw = new WeakMap<object, object>()

  // ==================== Object Wrapping ====================

  function wrap<T extends object>(obj: T): T {
    if (obj == null || typeof obj !== "object") return obj

    // Already a proxy?
    if (proxyToRaw.has(obj)) return obj
    // Already wrapped?
    const cached = proxyCache.get(obj)
    if (cached) return cached as T

    if (obj instanceof Map) return wrapMap(obj) as unknown as T
    if (obj instanceof Set) return wrapSet(obj) as unknown as T
    if (Array.isArray(obj)) return wrapArray(obj) as unknown as T
    return wrapObject(obj) as T
  }

  function wrapObject<T extends object>(obj: T): T {
    const proxy = new Proxy(obj, {
      set(target, prop, value, receiver) {
        if (typeof prop === "symbol") {
          return Reflect.set(target, prop, value, receiver)
        }
        const key = prop as string
        const oldVal = (target as any)[key]
        // Unwrap if value is a proxy
        const rawValue = proxyToRaw.has(value) ? proxyToRaw.get(value) : value

        // Wrap new object values
        const wrappedValue =
          rawValue != null && typeof rawValue === "object"
            ? wrap(rawValue)
            : rawValue

        if (oldVal === wrappedValue) return true

        Reflect.set(target, key, wrappedValue, receiver)

        scalarChanges.push({
          obj: proxy,
          prop: key,
          oldVal,
          newVal: wrappedValue
        })

        return true
      },

      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver)
        // Auto-wrap nested objects on access (lazy wrapping)
        if (
          value != null &&
          typeof value === "object" &&
          typeof prop === "string" &&
          !proxyToRaw.has(value) &&
          !proxyCache.has(value)
        ) {
          // Check if it's an own data property (not a getter/method)
          const desc = Object.getOwnPropertyDescriptor(target, prop)
          if (desc && "value" in desc && typeof desc.value !== "function") {
            const wrapped = wrap(value)
            if (wrapped !== value) {
              Reflect.set(target, prop, wrapped, receiver)
            }
            return wrapped
          }
        }
        return value
      }
    })

    proxyCache.set(obj, proxy)
    proxyToRaw.set(proxy, obj)
    return proxy
  }

  function wrapMap<K, V>(map: Map<K, V>): Map<K, V> {
    const origSet = map.set.bind(map)
    const origDelete = map.delete.bind(map)
    const origClear = map.clear.bind(map)

    map.set = function (key: K, value: V): Map<K, V> {
      const had = map.has(key)
      const oldVal = had ? map.get(key) : undefined
      // Wrap object values
      const wrapped =
        value != null && typeof value === "object"
          ? (wrap(value as object) as unknown as V)
          : value
      origSet(key, wrapped)
      if (!had) {
        collectionChanges.push({
          type: "add",
          collection: map,
          key,
          value: wrapped
        })
      } else if (oldVal !== wrapped) {
        collectionChanges.push({
          type: "change",
          collection: map,
          key,
          value: wrapped,
          oldValue: oldVal
        })
      }
      return map
    }

    map.delete = function (key: K): boolean {
      if (!map.has(key)) return false
      const oldVal = map.get(key)
      const result = origDelete(key)
      if (result) {
        collectionChanges.push({
          type: "remove",
          collection: map,
          key,
          value: oldVal
        })
      }
      return result
    }

    map.clear = function (): void {
      // Fire remove for each entry
      const entries = Array.from(map.entries())
      origClear()
      for (const [key, value] of entries) {
        collectionChanges.push({
          type: "remove",
          collection: map,
          key,
          value
        })
      }
    }

    // Wrap existing values
    const entries = Array.from(map.entries())
    for (const [key, value] of entries) {
      if (value != null && typeof value === "object") {
        const wrapped = wrap(value as object) as unknown as V
        if (wrapped !== value) {
          origSet(key, wrapped)
        }
      }
    }

    proxyCache.set(map, map) // Map is self (patched, not proxied)
    return map
  }

  function wrapSet<V>(set: Set<V>): Set<V> {
    const origAdd = set.add.bind(set)
    const origDelete = set.delete.bind(set)
    const origClear = set.clear.bind(set)

    set.add = function (value: V): Set<V> {
      if (set.has(value)) return set
      origAdd(value)
      collectionChanges.push({
        type: "add",
        collection: set,
        key: value,
        value
      })
      return set
    }

    set.delete = function (value: V): boolean {
      if (!set.has(value)) return false
      const result = origDelete(value)
      if (result) {
        collectionChanges.push({
          type: "remove",
          collection: set,
          key: value,
          value
        })
      }
      return result
    }

    set.clear = function (): void {
      const values = Array.from(set)
      origClear()
      for (const value of values) {
        collectionChanges.push({
          type: "remove",
          collection: set,
          key: value,
          value
        })
      }
    }

    proxyCache.set(set, set) // Set is self (patched, not proxied)
    return set
  }

  function wrapArray<T>(arr: T[]): T[] {
    // Track array for index-level onChange
    if (!arrays.has(arr)) {
      arrays.set(arr, {
        ref: arr,
        add: [],
        rem: [],
        chg: [],
        lastLength: arr.length
      })
    }

    // Wrap existing object elements
    for (let i = 0; i < arr.length; i++) {
      const el = arr[i]
      if (el != null && typeof el === "object") {
        const wrapped = wrap(el as object) as unknown as T
        if (wrapped !== el) arr[i] = wrapped
      }
    }

    const proxy = new Proxy(arr, {
      set(target, prop, value) {
        if (typeof prop === "symbol") {
          return Reflect.set(target, prop, value)
        }

        const index = Number(prop)
        if (!Number.isNaN(index) && Number.isInteger(index) && index >= 0) {
          const oldVal = target[index]
          const wrapped =
            value != null && typeof value === "object"
              ? wrap(value as object)
              : value
          target[index] = wrapped

          if (oldVal !== wrapped) {
            collectionChanges.push({
              type: "change",
              collection: arr,
              key: index,
              value: wrapped,
              oldValue: oldVal
            })
          }
          return true
        }

        // length or other properties
        if (prop === "length") {
          const oldLength = target.length
          Reflect.set(target, prop, value)
          const newLength = target.length
          // Elements removed by length truncation
          if (newLength < oldLength) {
            for (let i = newLength; i < oldLength; i++) {
              collectionChanges.push({
                type: "remove",
                collection: arr,
                key: i,
                value: undefined
              })
            }
          }
          return true
        }

        return Reflect.set(target, prop, value)
      }
    })

    // Patch mutating methods to record changes
    const origPush = arr.push.bind(arr)
    const origSplice = arr.splice.bind(arr)
    const origPop = arr.pop.bind(arr)
    const origShift = arr.shift.bind(arr)
    const origUnshift = arr.unshift.bind(arr)

    ;(proxy as any).push = function (...items: T[]) {
      const startIndex = arr.length
      const wrappedItems = items.map((item) =>
        item != null && typeof item === "object"
          ? (wrap(item as object) as unknown as T)
          : item
      )
      const result = origPush(...wrappedItems)
      for (let i = 0; i < wrappedItems.length; i++) {
        collectionChanges.push({
          type: "add",
          collection: arr,
          key: startIndex + i,
          value: wrappedItems[i]
        })
      }
      return result
    }

    ;(proxy as any).splice = function (
      start: number,
      deleteCount?: number,
      ...items: T[]
    ) {
      const actualStart = start < 0 ? Math.max(arr.length + start, 0) : start
      const actualDelete =
        deleteCount === undefined
          ? arr.length - actualStart
          : Math.min(deleteCount, arr.length - actualStart)

      // Record removals
      for (let i = 0; i < actualDelete; i++) {
        collectionChanges.push({
          type: "remove",
          collection: arr,
          key: actualStart + i,
          value: arr[actualStart + i]
        })
      }

      const wrappedItems = items.map((item) =>
        item != null && typeof item === "object"
          ? (wrap(item as object) as unknown as T)
          : item
      )
      const result = origSplice(start, actualDelete, ...wrappedItems)

      // Record additions
      for (let i = 0; i < wrappedItems.length; i++) {
        collectionChanges.push({
          type: "add",
          collection: arr,
          key: actualStart + i,
          value: wrappedItems[i]
        })
      }
      return result
    }

    ;(proxy as any).pop = function () {
      if (arr.length === 0) return undefined
      const removed = origPop()
      collectionChanges.push({
        type: "remove",
        collection: arr,
        key: arr.length,
        value: removed
      })
      return removed
    }

    ;(proxy as any).shift = function () {
      if (arr.length === 0) return undefined
      const removed = origShift()
      collectionChanges.push({
        type: "remove",
        collection: arr,
        key: 0,
        value: removed
      })
      return removed
    }

    ;(proxy as any).unshift = function (...items: T[]) {
      const wrappedItems = items.map((item) =>
        item != null && typeof item === "object"
          ? (wrap(item as object) as unknown as T)
          : item
      )
      const result = origUnshift(...wrappedItems)
      for (let i = 0; i < wrappedItems.length; i++) {
        collectionChanges.push({
          type: "add",
          collection: arr,
          key: i,
          value: wrappedItems[i]
        })
      }
      return result
    }

    // Update cache: use arr (the raw array) as the key
    proxyCache.set(arr, proxy)
    proxyToRaw.set(proxy, arr)

    return proxy
  }

  // ==================== Listener Cleanup (C4) ====================

  function trackChild(parent: object, child: object) {
    let s = children.get(parent)
    if (!s) {
      s = new Set()
      children.set(parent, s)
    }
    s.add(child)
  }

  function cleanup(obj: object) {
    for (const l of scalars) {
      if (l.obj === obj) l.dead = true
    }
    schemaCbs.delete(obj)
    maps.delete(obj)
    sets.delete(obj)
    arrays.delete(obj)
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

  // ==================== $ Callback Proxy ====================

  function proxy(instance: any): any {
    if (instance instanceof Map) return mapProxy(instance)
    if (instance instanceof Set) return setProxy(instance)
    if (Array.isArray(instance)) return arrProxy(instance)
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
        let t = maps.get(map)
        if (!t) {
          t = { ref: map, add: [], rem: [], chg: [] }
          maps.set(map, t)
        }
        t.add.push(cb)
        if (immediate) map.forEach((v: any, k: any) => cb(v, k))
        return () => removeCb(t!.add, cb)
      },
      onRemove(cb: Cb) {
        let t = maps.get(map)
        if (!t) {
          t = { ref: map, add: [], rem: [], chg: [] }
          maps.set(map, t)
        }
        t.rem.push(cb)
        return () => removeCb(t!.rem, cb)
      },
      onChange(cb: Cb) {
        let t = maps.get(map)
        if (!t) {
          t = { ref: map, add: [], rem: [], chg: [] }
          maps.set(map, t)
        }
        t.chg.push(cb)
        return () => removeCb(t!.chg, cb)
      }
    }
  }

  function setProxy(set: any): any {
    return {
      onAdd(cb: Cb, immediate = true) {
        let t = sets.get(set)
        if (!t) {
          t = { ref: set, add: [], rem: [], chg: [] }
          sets.set(set, t)
        }
        t.add.push(cb)
        if (immediate) set.forEach((v: any) => cb(v, v))
        return () => removeCb(t!.add, cb)
      },
      onRemove(cb: Cb) {
        let t = sets.get(set)
        if (!t) {
          t = { ref: set, add: [], rem: [], chg: [] }
          sets.set(set, t)
        }
        t.rem.push(cb)
        return () => removeCb(t!.rem, cb)
      },
      onChange(cb: Cb) {
        let t = sets.get(set)
        if (!t) {
          t = { ref: set, add: [], rem: [], chg: [] }
          sets.set(set, t)
        }
        t.chg.push(cb)
        return () => removeCb(t!.chg, cb)
      }
    }
  }

  function arrProxy(arr: any): any {
    // Resolve to raw array if it's a proxy
    const raw = proxyToRaw.has(arr) ? proxyToRaw.get(arr) : arr
    return {
      onChange(cb: Cb) {
        let t = arrays.get(raw)
        if (!t) {
          t = { ref: raw, add: [], rem: [], chg: [], lastLength: raw.length }
          arrays.set(raw, t)
        }
        t.chg.push(cb)
        return () => removeCb(t!.chg, cb)
      },
      onAdd(cb: Cb, immediate = true) {
        let t = arrays.get(raw)
        if (!t) {
          t = { ref: raw, add: [], rem: [], chg: [], lastLength: raw.length }
          arrays.set(raw, t)
        }
        t.add.push(cb)
        if (immediate) {
          for (let i = 0; i < raw.length; i++) cb(raw[i], i)
        }
        return () => removeCb(t!.add, cb)
      },
      onRemove(cb: Cb) {
        let t = arrays.get(raw)
        if (!t) {
          t = { ref: raw, add: [], rem: [], chg: [], lastLength: raw.length }
          arrays.set(raw, t)
        }
        t.rem.push(cb)
        return () => removeCb(t!.rem, cb)
      }
    }
  }

  // ==================== flush() ====================

  function flush() {
    // 1. Process scalar changes — fire listen callbacks
    const changed = new Set<object>()

    if (scalarChanges.length > 0) {
      // Drain the queue (new changes during callbacks go to next flush)
      const changes = scalarChanges.splice(0)

      for (const change of changes) {
        changed.add(change.obj)
        for (const l of scalars) {
          if (l.dead) continue
          if (l.obj === change.obj && l.prop === change.prop) {
            l.cb(change.newVal, change.oldVal)
          }
        }
      }
    }

    // 2. Schema onChange — fire for objects with any scalar change
    for (const [obj, cbs] of schemaCbs) {
      if (changed.has(obj)) {
        for (const cb of cbs) cb()
      }
    }

    // 3. Process collection changes
    if (collectionChanges.length > 0) {
      const changes = collectionChanges.splice(0)

      for (const change of changes) {
        const { type, collection, key, value, oldValue } = change

        if (collection instanceof Map) {
          const t = maps.get(collection)
          if (!t) continue
          if (type === "add") {
            for (const cb of t.add) cb(value, key)
          } else if (type === "remove") {
            for (const cb of t.rem) cb(value, key)
            // C4: cleanup listeners on removed objects
            if (value != null && typeof value === "object") cleanup(value)
          } else if (type === "change") {
            for (const cb of t.chg) cb(value, key)
            // Cleanup old value if it was an object
            if (oldValue != null && typeof oldValue === "object")
              cleanup(oldValue)
          }
        } else if (collection instanceof Set) {
          const t = sets.get(collection)
          if (!t) continue
          if (type === "add") {
            for (const cb of t.add) cb(value, value)
            for (const cb of t.chg) cb(value, value)
          } else if (type === "remove") {
            for (const cb of t.rem) cb(value, value)
            for (const cb of t.chg) cb(value, value)
          }
        } else if (Array.isArray(collection)) {
          const t = arrays.get(collection)
          if (!t) continue
          if (type === "change") {
            for (const cb of t.chg) cb(value, key)
          } else if (type === "add") {
            for (const cb of t.add) cb(value, key)
            for (const cb of t.chg) cb(value, key)
          } else if (type === "remove") {
            for (const cb of t.rem) cb(value, key)
            for (const cb of t.chg) cb(value, key)
          }
        }
      }
    }

    // 4. Compact dead scalar listeners
    let hasDead = false
    for (const l of scalars) {
      if (l.dead) {
        hasDead = true
        break
      }
    }
    if (hasDead) {
      let w = 0
      for (let r = 0; r < scalars.length; r++) {
        if (!scalars[r].dead) scalars[w++] = scalars[r]
      }
      scalars.length = w
    }
  }

  return { $: proxy as StateCallbackProxy, flush, wrap }
}
