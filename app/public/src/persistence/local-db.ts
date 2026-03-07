import { openDB, IDBPDatabase } from "idb"

const DB_NAME = "pokemon-auto-chess"
const DB_VERSION = 1
const CURRENT_SCHEMA_VERSION = 1
const HISTORY_CAP = 100

export interface PlayerProfile {
  uid: string
  displayName: string
  elo: number
  level: number
  exp: number
  wins: number
  games: number
  avatar: string
  booster: number
  language: string
  pokemonCollection: Record<string, unknown>
  schemaVersion: number
}

export interface GameHistoryEntry {
  id: string
  playerId: string
  elo: number
  time: number
  name: string
  rank: number
  nbplayers: number
  avatar: string
  pokemons: Array<{ name: string; avatar: string; items: string[] }>
  synergies: Record<string, number>
  regions: string[]
  gameMode: string
}

function getDB(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("player")) {
        db.createObjectStore("player", { keyPath: "uid" })
      }
      if (!db.objectStoreNames.contains("gameHistory")) {
        const store = db.createObjectStore("gameHistory", { keyPath: "id" })
        store.createIndex("by-time", "time")
      }
    }
  })
}

function migrateProfile(profile: PlayerProfile): PlayerProfile {
  // v1: no-op (baseline schema)
  // Future migrations: if (profile.schemaVersion < 2) { ... }
  profile.schemaVersion = CURRENT_SCHEMA_VERSION
  return profile
}

export async function loadProfile(): Promise<PlayerProfile | null> {
  try {
    const db = await getDB()
    const tx = db.transaction("player", "readonly")
    const store = tx.objectStore("player")
    const cursor = await store.openCursor()
    if (!cursor) return null
    const profile = cursor.value as PlayerProfile
    if (
      !profile ||
      typeof profile.uid !== "string" ||
      !profile.schemaVersion
    ) {
      await db.delete("player", cursor.key)
      return null
    }
    if (profile.schemaVersion !== CURRENT_SCHEMA_VERSION) {
      const migrated = migrateProfile(profile)
      await safeWrite(() => db.put("player", migrated))
      return migrated
    }
    return profile
  } catch {
    return null
  }
}

export async function saveProfile(profile: PlayerProfile): Promise<void> {
  await safeWrite(async () => {
    const db = await getDB()
    await db.put("player", profile)
  })
}

export async function deleteProfile(): Promise<void> {
  try {
    const db = await getDB()
    await db.clear("player")
  } catch {
    // best-effort
  }
}

export async function loadHistory(): Promise<GameHistoryEntry[]> {
  try {
    const db = await getDB()
    const entries = await db.getAllFromIndex(
      "gameHistory",
      "by-time"
    )
    return entries as GameHistoryEntry[]
  } catch {
    return []
  }
}

export async function saveHistoryEntry(
  entry: GameHistoryEntry
): Promise<void> {
  await safeWrite(async () => {
    const db = await getDB()
    await db.put("gameHistory", entry)
  })
  await capHistory()
}

async function capHistory(): Promise<void> {
  try {
    const db = await getDB()
    const tx = db.transaction("gameHistory", "readwrite")
    const index = tx.store.index("by-time")
    const count = await tx.store.count()
    if (count <= HISTORY_CAP) return
    const toDelete = count - HISTORY_CAP
    let cursor = await index.openCursor()
    let deleted = 0
    while (cursor && deleted < toDelete) {
      await cursor.delete()
      deleted++
      cursor = await cursor.continue()
    }
    await tx.done
  } catch {
    // cap is best-effort
  }
}

async function safeWrite(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err: unknown) {
    if (
      err instanceof DOMException &&
      err.name === "QuotaExceededError"
    ) {
      console.warn("[local-db] QuotaExceededError — continuing in-memory only")
      return
    }
    throw err
  }
}
