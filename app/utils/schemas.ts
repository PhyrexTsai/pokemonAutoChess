import {
  ArraySchema,
  CollectionSchema,
  MapSchema,
  Schema,
  SetSchema
} from "@colyseus/schema"

export function keys(schema: MapSchema): string[] {
  const keys: string[] = []
  schema.forEach((value, key) => keys.push(key))
  return keys
}

export function values<T>(
  schema: MapSchema<T> | SetSchema<T> | CollectionSchema<T> | ArraySchema<T>
): T[] {
  const values: T[] = []
  schema.forEach((value: T) => values.push(value))
  return values
}

export function entries<V, K extends string>(
  schema: MapSchema<V, K>
): [K, V][] {
  const entries: [K, V][] = []
  schema.forEach((value, key) => entries.push([key, value]))
  return entries
}

export function resetArraySchema<T>(
  schema: ArraySchema<T>,
  newArray: T[] | ArraySchema<T>
) {
  schema.clear()
  newArray.forEach((value: T) => schema.push(value))
}

export function deepCloneSchema<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj
  if (obj instanceof Date) return new Date(obj.getTime()) as T
  if (obj instanceof MapSchema) {
    const result = new Map()
    obj.forEach((v, k) => result.set(k, deepCloneSchema(v)))
    return result as T
  }
  if (obj instanceof SetSchema) {
    const result = new Set()
    obj.forEach((v) => result.add(deepCloneSchema(v)))
    return result as T
  }
  if (obj instanceof ArraySchema) {
    return Array.from(obj).map(deepCloneSchema) as T
  }
  if (obj instanceof Map) {
    const result = new Map()
    obj.forEach((v, k) => result.set(k, deepCloneSchema(v)))
    return result as T
  }
  if (obj instanceof Set) {
    const result = new Set()
    obj.forEach((v) => result.add(deepCloneSchema(v)))
    return result as T
  }
  if (Array.isArray(obj)) return obj.map(deepCloneSchema) as T
  const result = Object.create(Object.getPrototypeOf(obj))
  for (const key of Object.keys(obj)) {
    const val = (obj as any)[key]
    result[key] = typeof val === "function" ? val : deepCloneSchema(val)
  }
  return result
}

export function convertSchemaToRawObject(schema: any): any {
  if (schema instanceof ArraySchema) {
    const values: any[] = []
    schema.forEach((value) => values.push(convertSchemaToRawObject(value)))
    return values
  }
  if (schema instanceof CollectionSchema) {
    const values: any[] = []
    schema.forEach((value) => values.push(convertSchemaToRawObject(value)))
    return values
  }
  if (schema instanceof MapSchema) {
    const map = new Map()
    schema.forEach((val, key) => map.set(key, convertSchemaToRawObject(val)))
    return map
  }
  if (schema instanceof SetSchema) {
    const set = new Set()
    schema.forEach((val) => set.add(convertSchemaToRawObject(val)))
    return set
  }

  if (schema instanceof Schema === false) return schema

  const raw = {}
  Object.getOwnPropertyNames(schema).forEach((prop) => {
    if (prop.startsWith("_") === false && prop.startsWith("$") === false) {
      raw[prop] = convertSchemaToRawObject(schema[prop])
    }
  })

  return raw
}
