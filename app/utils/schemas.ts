export function keys<K extends string>(map: Map<K, any>): K[] {
  return Array.from(map.keys())
}

export function values<T>(
  collection: Map<string, T> | Set<T> | T[]
): T[] {
  if (Array.isArray(collection)) return collection.slice()
  const result: T[] = []
  collection.forEach((value: T) => result.push(value))
  return result
}

export function entries<V, K extends string>(
  map: Map<K, V>
): [K, V][] {
  return Array.from(map.entries()) as [K, V][]
}

export function resetArraySchema<T>(
  arr: T[],
  newArr: T[]
) {
  arr.length = 0
  arr.push(...newArr)
}

export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj
  if (obj instanceof Date) return new Date(obj.getTime()) as T
  if (obj instanceof Map) {
    const result = new Map()
    obj.forEach((v, k) => result.set(k, deepClone(v)))
    return result as T
  }
  if (obj instanceof Set) {
    const result = new Set()
    obj.forEach((v) => result.add(deepClone(v)))
    return result as T
  }
  if (Array.isArray(obj)) return obj.map(deepClone) as T
  const result = Object.create(Object.getPrototypeOf(obj))
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key]
    result[key] = typeof val === "function" ? val : deepClone(val)
  }
  return result
}
