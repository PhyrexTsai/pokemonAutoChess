import { Dispatcher } from "@colyseus/command"
import { Client, CloseCode, Room } from "colyseus"
import { getPlayer } from "../models/local-store"
import AfterGamePlayer from "../models/colyseus-models/after-game-player"
import { IAfterGamePlayer } from "../types"
import { GameMode } from "../types/enum/Game"
import { logger } from "../utils/logger"
import AfterGameState from "./states/after-game-state"

export default class AfterGameRoom extends Room<{ state: AfterGameState }> {
  dispatcher: Dispatcher<this>
  constructor() {
    super()
    this.dispatcher = new Dispatcher(this)
  }

  onCreate(options: {
    players: IAfterGamePlayer[]
    idToken: string
    eligibleToXP: boolean
    eligibleToELO: boolean
    gameMode: GameMode
  }) {
    logger.info("Create AfterGame ", this.roomId)

    this.state = new AfterGameState(options)
    // logger.debug('before', this.state.players);
    if (options.players) {
      options.players.forEach((plyr: IAfterGamePlayer) => {
        const player = new AfterGamePlayer(
          plyr.id,
          plyr.name,
          plyr.avatar,
          plyr.rank,
          plyr.pokemons,
          plyr.title,
          plyr.role,
          plyr.synergies,
          plyr.elo,
          plyr.games,
          plyr.moneyEarned,
          plyr.playerDamageDealt,
          plyr.rerollCount
        )
        this.state.players.set(player.id, player)
      })
    }
    this.clock.setTimeout(() => {
      // dispose the room automatically after 120 second
      this.disconnect()
    }, 120 * 1000)
  }

  async onAuth(client: Client, options, context) {
    try {
      super.onAuth(client, options, context)
      const player = getPlayer()
      const uid = options.uid ?? options.idToken ?? player?.uid ?? "local"
      const displayName = options.displayName ?? player?.displayName
      if (!displayName) {
        throw "No display name"
      }
      return {
        uid,
        displayName,
        email: "local@player",
        photoURL: "",
        metadata: { language: player?.language ?? "en" }
      }
    } catch (error) {
      logger.error(error)
    }
  }

  onJoin(client: Client) {
    //logger.info(`${client.auth.email} join after game`)
  }

  async onDrop(client: Client, code: number) {
    // allow disconnected client to reconnect into this room until 20 seconds
    await this.allowReconnection(client, 20)
  }

  async onLeave(client: Client, code: number) {
    // player not coming back
    /*if (client && client.auth && client.auth.displayName) {
        logger.info(`${client.auth.displayName} leave after game room`)
    }*/
  }

  onDispose() {
    logger.info("dispose AfterGame ", this.roomId)
    this.dispatcher.stop()
  }
}
