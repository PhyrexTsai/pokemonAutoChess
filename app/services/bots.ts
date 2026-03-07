import { getBotById, getBotList } from "../models/local-store"
import { IBot } from "../types/interfaces/bot"

export type IBotListItem = Omit<IBot, "steps">

export function fetchBotsList(
  approved?: boolean,
  usingPkm?: string
): IBotListItem[] {
  let bots = getBotList()
  if (approved !== undefined) {
    bots = bots.filter((b) => b.approved === approved)
  }
  if (usingPkm) {
    bots = bots.filter((b) =>
      b.steps.some((s) => s.board.some((p) => p.name === usingPkm))
    )
  }
  return bots
    .sort((a, b) => b.elo - a.elo)
    .map(({ steps, ...rest }) => rest)
}

export function fetchBot(id: string): IBot | null {
  return getBotById(id) ?? null
}
