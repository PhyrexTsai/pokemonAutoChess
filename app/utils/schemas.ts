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
