import { ArraySchema, Schema, type } from "@colyseus/schema"
import { nanoid } from "nanoid"
import Message from "../../models/colyseus-models/message"
import { TournamentSchema } from "../../models/colyseus-models/tournament"
import { logger } from "../../utils/logger"

export default class LobbyState extends Schema {
  @type([Message]) messages = new ArraySchema<Message>()
  @type([TournamentSchema]) tournaments = new ArraySchema<TournamentSchema>()
  @type("number") ccu = 0

  addMessage(
    payload: string,
    authorId: string,
    author: string,
    avatar: string
  ) {
    const id = nanoid()
    const time = Date.now()
    const message = new Message(id, payload, authorId, author, avatar, time)
    this.messages.push(message)
  }

  removeMessage(id: string) {
    const messageIndex = this.messages.findIndex((m) => m.id === id)
    if (messageIndex !== -1) {
      this.messages.splice(messageIndex, 1)
    }
  }

  removeMessages(authorId: string) {
    let i = this.messages.length
    while (i--) {
      if (this.messages[i]?.authorId === authorId) {
        this.messages.splice(i, 1)
      }
    }
  }

  addAnnouncement(message: string) {
    this.addMessage(message, "server", "Server Announcement", "0294/Joyous")
  }

  async createTournament(name: string, startDate: string) {
    const id = nanoid()
    logger.debug(`creating tournament id ${id}`)
    // tournaments are multiplayer-only — noop in single-player
  }

  removeTournament(id: string) {
    const tournamentIndex = this.tournaments.findIndex((m) => m.id === id)
    if (tournamentIndex !== -1) {
      this.tournaments.splice(tournamentIndex, 1)
    }
  }
}
