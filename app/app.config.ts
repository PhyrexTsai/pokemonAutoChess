import cors from "cors"
import express, { ErrorRequestHandler } from "express"
import helmet from "helmet"
import path from "path"
import pkg from "../package.json"
import { SynergyTriggers } from "./config"
import { initTilemap } from "./core/design"
import { GameRecord } from "./models/colyseus-models/game-record"
import { getGameHistoryByPlayer, loadBotsFromJson } from "./models/local-store"
import { PRECOMPUTED_POKEMONS_PER_TYPE } from "./models/precomputed/precomputed-types"
import { fetchBot, fetchBotsList } from "./services/bots"
import { DungeonPMDO } from "./types/enum/Dungeon"
import { Item } from "./types/enum/Item"
import { Pkm, PkmIndex } from "./types/enum/Pokemon"
import { logger } from "./utils/logger"

const app = express()

const clientSrc = __dirname.includes("server")
  ? path.join(__dirname, "..", "..", "client")
  : path.join(__dirname, "public", "dist", "client")
const viewsSrc = path.join(clientSrc, "index.html")
const isDevelopment = process.env.MODE === "dev"

// Load bots at startup
loadBotsFromJson()

app.use(
  helmet({
    crossOriginOpenerPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: [
          "'self'",
          "https://*.pokemon-auto-chess.com",
          "wss://*.pokemon-auto-chess.com",
          "https://*.doubleclick.net",
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
          "https://*.doubleclick.net"
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
app.use(
  "/assets",
  express.static(path.join(__dirname, "public", "src", "assets"))
)

// SPA routes — serve index.html for all client routes
const spaRoutes = [
  "/",
  "/auth",
  "/lobby",
  "/game",
  "/after",
  "/bot-builder",
  "/bot-admin",
  "/sprite-viewer",
  "/map-viewer",
  "/gameboy"
]
spaRoutes.forEach((route) => {
  app.get(route, (req, res) => {
    res.sendFile(viewsSrc)
  })
})

// Static data APIs
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
    const tilemap = await initTilemap(req.params.map as DungeonPMDO)
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

app.get("/status", (req, res) => {
  const version = pkg.version
  res.send({ ccu: 1, maxCcu: 1, version })
})

app.get("/leaderboards", (req, res) => {
  res.send({ leaderboard: [] })
})

export const server = app
