import { monitor } from "@colyseus/monitor"
import {
  defineRoom,
  defineServer,
  matchMaker,
  RedisDriver,
  RedisPresence,
  ServerOptions
} from "colyseus"
import cors from "cors"
import express, { ErrorRequestHandler } from "express"
import basicAuth from "express-basic-auth"
import helmet from "helmet"
import path from "path"
import pkg from "../package.json"
import { MAX_CONCURRENT_PLAYERS_ON_SERVER, SynergyTriggers } from "./config"
import { getGameHistoryByPlayer, getPlayer, loadBotsFromJson } from "./models/local-store"
import { initTilemap } from "./core/design"
import { GameRecord } from "./models/colyseus-models/game-record"
import { PRECOMPUTED_POKEMONS_PER_TYPE } from "./models/precomputed/precomputed-types"
import AfterGameRoom from "./rooms/after-game-room"
import CustomLobbyRoom from "./rooms/custom-lobby-room"
import GameRoom from "./rooms/game-room"
import PreparationRoom from "./rooms/preparation-room"
import { fetchBot, fetchBotsList } from "./services/bots"
import { DungeonPMDO } from "./types/enum/Dungeon"
import { Item } from "./types/enum/Item"
import { Pkm, PkmIndex } from "./types/enum/Pokemon"
import { logger } from "./utils/logger"

const clientSrc = __dirname.includes("server")
  ? path.join(__dirname, "..", "..", "client")
  : path.join(__dirname, "public", "dist", "client")
const viewsSrc = path.join(clientSrc, "index.html")
const isDevelopment = process.env.MODE === "dev"

/**
 * Import your Room files
 */

let gameOptions: ServerOptions = {}

if (process.env.NODE_APP_INSTANCE) {
  const processNumber = Number(process.env.NODE_APP_INSTANCE || "0")
  const port = (Number(process.env.PORT) || 2569) + processNumber
  gameOptions = {
    presence: new RedisPresence(process.env.REDIS_URI),
    driver: new RedisDriver(process.env.REDIS_URI),
    publicAddress: `${port}.${process.env.SERVER_NAME}`,
    selectProcessIdToCreateRoom: async function (
      roomName: string,
      clientOptions: any
    ) {
      if (roomName === "lobby") {
        const lobbies = await matchMaker.query({ name: "lobby" })
        if (lobbies.length !== 0) {
          throw "Attempt to create one lobby"
        }
      }
      const stats = await matchMaker.stats.fetchAll()
      stats.sort((p1, p2) =>
        p1.roomCount !== p2.roomCount
          ? p1.roomCount - p2.roomCount
          : p1.ccu - p2.ccu
      )
      if (stats.length === 0) {
        throw "No process available"
      } else {
        return stats[0]?.processId
      }
    }
  }
  gameOptions.presence?.setMaxListeners(100) // extend max listeners to avoid memory leak warning
}

/*if (process.env.MODE === "dev") {
  gameOptions.devMode = true
}*/

export const server = defineServer({
  ...gameOptions,

  /* uWebSockets turned out to be unstable in production, so we are using the default transport
  2025-06-29T16:50:08: Error: Invalid access of closed uWS.WebSocket/SSLWebSocket.
  
  initializeTransport: function () {
    return new uWebSocketsTransport({
      compression: uWebSockets.SHARED_COMPRESSOR,
      idleTimeout: 0, // disable idle timeout
    })
  },*/

  rooms: {
    "after-game": defineRoom(AfterGameRoom),
    lobby: defineRoom(CustomLobbyRoom),
    preparation: defineRoom(PreparationRoom).enableRealtimeListing(),
    game: defineRoom(GameRoom).enableRealtimeListing()
  },

  express: (app) => {
    /**
     * Bind your custom express routes here:
     * Read more: https://expressjs.com/en/starter/basic-routing.html
     */

    app.use(
      helmet({
        crossOriginOpenerPolicy: false,
        contentSecurityPolicy: {
          directives: {
            defaultSrc: [
              "'self'",
              "https://*.pokemon-auto-chess.com",
              "wss://*.pokemon-auto-chess.com",
              "https://*.doubleclick.net", // google ads, required for youtube embedded
              "https://*.githubusercontent.com",
              "http://raw.githubusercontent.com",
              "https://*.youtube.com",
              "https://pokemon.darkatek7.com",
              "https://eternara.site",
              "https://www.penumbra-autochess.com",
              "https://pokechess.com.br",
              "https://uruwhy.online",
              "https://koala-pac.com",
              "https://pokev9.52kx.net"
            ],
            scriptSrc: [
              "'self'",
              "'unsafe-inline'",
              "'unsafe-eval'",
              "https://*.doubleclick.net" // google ads, required for youtube embedded
            ],
            imgSrc: [
              "'self'",
              "data:",
              "blob:",
              "https://www.gstatic.com",
              "http://raw.githubusercontent.com"
            ]
          }
        }
      })
    )

    app.use(((err, req, res, next) => {
      res.status(err.status).json(err)
    }) as ErrorRequestHandler)

    app.use(cors())
    app.use(express.json())
    app.use(express.static(clientSrc))
    app.use(express.static(path.join(clientSrc, "pokechess")))
    // serve raw src assets (ui/, etc.) not included in pokechess dist
    app.use("/assets", express.static(path.join(__dirname, "public", "src", "assets")))

    app.get("/", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/auth", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/lobby", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/preparation", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/game", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/after", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/bot-builder", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/bot-admin", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/sprite-viewer", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/map-viewer", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/gameboy", (req, res) => {
      res.sendFile(viewsSrc)
    })

    app.get("/pokemons", (req, res) => {
      res.send(Pkm)
    })

    app.get("/pokemons-index", (req, res) => {
      res.send(PkmIndex)
    })

    app.get("/types", (req, res) => {
      res.send(PRECOMPUTED_POKEMONS_PER_TYPE)
    })

    app.get("/items", (req, res) => {
      res.send(Item)
    })

    app.get("/types-trigger", (req, res) => {
      res.send(SynergyTriggers)
    })

    app.get("/titles", (req, res) => {
      res.send([])
    })

    app.get("/tilemap/:map", async (req, res) => {
      try {
        if (
          !req.params.map ||
          !Object.values(DungeonPMDO).includes(req.params.map as DungeonPMDO)
        ) {
          return res.status(400).send({ error: "Invalid map parameter" })
        }
        const tilemap = initTilemap(req.params.map as DungeonPMDO)
        res.send(tilemap)
      } catch (error) {
        logger.error("Error generating tilemap", { error, map: req.params.map })
        res.status(500).send({ error: "Error generating tilemap" })
      }
    })

    app.get("/game-history/:playerUid", (req, res) => {
      if (!isDevelopment) {
        res.set("Cache-Control", "no-cache")
      }
      const { playerUid } = req.params
      const { page = 1 } = req.query
      const limit = 10
      const skip = (Number(page) - 1) * limit

      const stats = getGameHistoryByPlayer(playerUid)
        .sort((a, b) => b.time - a.time)
        .slice(skip, skip + limit)

      const records = stats.map(
        (record) =>
          new GameRecord(
            record.time,
            record.rank,
            record.elo,
            record.pokemons,
            record.gameMode
          )
      )

      return res.status(200).json(records)
    })

    app.get("/bots", (req, res) => {
      const approved =
        req.query.approved === "true"
          ? true
          : req.query.approved === "false"
            ? false
            : undefined
      const botsData = fetchBotsList(approved, req.query.pkm?.toString())
      res.send(botsData)
    })

    app.get("/bots/:id", (req, res) => {
      res.send(fetchBot(req.params.id))
    })

    app.get("/profile", (req, res) => {
      const player = getPlayer()
      if (!player) return res.status(404).send("No player")
      if (!isDevelopment) {
        res.set("Cache-Control", "no-cache")
      }
      res.send(player)
    })

    app.get("/status", async (req, res) => {
      const ccu = await matchMaker.stats.getGlobalCCU()
      const version = pkg.version
      res.send({ ccu, maxCcu: MAX_CONCURRENT_PLAYERS_ON_SERVER, version })
    })

    const basicAuthMiddleware = basicAuth({
      // list of users and passwords
      users: {
        admin: process.env.ADMIN_PASSWORD
          ? process.env.ADMIN_PASSWORD
          : "Default Admin Password"
      },
      challenge: true
    })

    app.use("/colyseus", basicAuthMiddleware, monitor())

    /**
     * Use @colyseus/monitor
     * It is recommended to protect this route with a password
     * Read more: https://docs.colyseus.io/tools/monitor/#restrict-access-to-the-panel-using-a-password
     */
    app.use("/colyseus", monitor())
  },

  beforeListen: () => {
    loadBotsFromJson()
  }
})
