import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { IGameUser } from "../../../models/colyseus-models/game-user"
import { setBotList } from "../../../models/local-store"
import { Role } from "../../../types"
import { BotDifficulty, GameMode } from "../../../types/enum/Game"
import { SpecialGameRule } from "../../../types/enum/SpecialGameRule"
import { fetchBot, fetchBotsList } from "../../../services/bots"
import { IBot } from "../../../types/interfaces/bot"
import { shuffleArray } from "../../../utils/random"
import { useAppDispatch, useAppSelector } from "../hooks"
import { GameConfig } from "../local-engine"
import { engine, fetchProfile } from "../network"
import store from "../stores"
import {
  clearNotification,
  logOut,
  setConnectionStatus,
  setErrorAlertMessage
} from "../stores/NetworkStore"
import { ConnectionStatus } from "../../../types/enum/ConnectionStatus"
import { MainSidebar } from "./component/main-sidebar/main-sidebar"
import { Modal } from "./component/modal/modal"
import { NotificationModal } from "./component/notifications/notification-modal"
import "./lobby.css"

export default function Lobby() {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const networkError = useAppSelector((state) => state.network.error)
  const notifications = useAppSelector((state) => state.network.notifications)
  const { t } = useTranslation()

  useEffect(() => {
    fetchProfile()
    dispatch(setConnectionStatus(ConnectionStatus.CONNECTED))
  }, [])

  const signOut = useCallback(async () => {
    const { deleteProfile } = await import("../persistence/local-db")
    await deleteProfile()
    dispatch(logOut())
    navigate("/")
  }, [dispatch])

  const handleNotificationClose = (notificationId: string) => {
    dispatch(clearNotification(notificationId))
  }

  return (
    <main className="lobby">
      <MainSidebar
        page="main_lobby"
        leave={signOut}
        leaveLabel={t("sign_out")}
      />
      <div className="lobby-container">
        <StartGamePanel />
      </div>
      <NotificationModal
        notifications={notifications}
        onClose={handleNotificationClose}
      />
      <Modal
        show={networkError != null}
        onClose={() => {
          dispatch(setErrorAlertMessage(null))
        }}
        className="is-dark basic-modal-body"
        body={<p style={{ padding: "1em" }}>{networkError}</p>}
      />
    </main>
  )
}

function StartGamePanel() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const [difficulty, setDifficulty] = useState<BotDifficulty>(
    BotDifficulty.MEDIUM
  )
  const [specialRule, setSpecialRule] = useState<SpecialGameRule | null>(null)
  const [numBots, setNumBots] = useState(7)
  const [starting, setStarting] = useState(false)

  const startGame = async () => {
    if (starting) return
    setStarting(true)

    try {
      // Determine ELO range based on difficulty
      let minElo = 0
      let maxElo = Infinity
      switch (difficulty) {
        case BotDifficulty.EASY:
          maxElo = 800
          break
        case BotDifficulty.MEDIUM:
          minElo = 800
          maxElo = 1100
          break
        case BotDifficulty.HARD:
          minElo = 1100
          maxElo = 1400
          break
        case BotDifficulty.EXTREME:
          minElo = 1400
          break
      }

      // Get bot list directly
      const botList = fetchBotsList(true)

      // Filter by ELO range
      let eligible = botList.filter(
        (b) => b.elo >= minElo && b.elo <= maxElo
      )
      if (eligible.length < numBots) {
        // Fallback: use all approved bots if not enough in range
        eligible = botList
      }

      // Shuffle and pick N bots
      shuffleArray(eligible)
      const selected = eligible.slice(0, numBots)

      // Fetch full bot data (with steps) for selected bots
      const fullBots: IBot[] = selected
        .map((b) => fetchBot(b.id))
        .filter((b): b is IBot => b !== null)

      // Load into local-store so Bot class can find them via getBotById
      setBotList(fullBots)

      // Build users map
      const users: Record<string, IGameUser> = {}

      // Human player
      const profile = store.getState().network.profile
      if (profile) {
        users[profile.uid] = {
          uid: profile.uid,
          name: profile.displayName,
          avatar: profile.avatar,
          ready: true,
          isBot: false,
          elo: profile.elo,
          games: profile.games ?? 0,
          title: profile.title ?? "",
          role: profile.role ?? Role.BASIC,
          anonymous: false
        }
      }

      // Bot players
      for (const bot of fullBots) {
        users[bot.id] = {
          uid: bot.id,
          name: bot.name,
          avatar: bot.avatar,
          ready: true,
          isBot: true,
          elo: bot.elo,
          games: 99,
          title: "",
          role: Role.BOT,
          anonymous: false
        }
      }

      // Build game config and start
      const config: GameConfig = {
        users,
        name: "Single Player",
        noElo: true,
        gameMode: specialRule ? GameMode.SCRIBBLE : GameMode.CLASSIC,
        specialGameRule: specialRule,
        minRank: null,
        maxRank: null
      }

      engine.startGame(config)
      navigate("/game")
    } catch (error) {
      console.error("Failed to start game:", error)
      dispatch(setErrorAlertMessage("Failed to start game"))
      setStarting(false)
    }
  }

  return (
    <div className="main-lobby">
      <div className="my-container custom-bg" style={{ padding: "2em" }}>
        <h2>{t("new_game")}</h2>

        <div style={{ margin: "1em 0" }}>
          <label style={{ display: "block", marginBottom: "0.5em" }}>
            {t("pokeguesser.difficulty")}
          </label>
          <select
            className="my-select"
            value={difficulty}
            onChange={(e) =>
              setDifficulty(Number(e.target.value) as BotDifficulty)
            }
          >
            <option value={BotDifficulty.EASY}>
              {t("pokeguesser.easy")}
            </option>
            <option value={BotDifficulty.MEDIUM}>
              {t("pokeguesser.normal")}
            </option>
            <option value={BotDifficulty.HARD}>
              {t("pokeguesser.hard")}
            </option>
            <option value={BotDifficulty.EXTREME}>
              {t("extreme")}
            </option>
          </select>
        </div>

        <div style={{ margin: "1em 0" }}>
          <label style={{ display: "block", marginBottom: "0.5em" }}>
            {t("opponents")}
          </label>
          <select
            className="my-select"
            value={numBots}
            onChange={(e) => setNumBots(Number(e.target.value))}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        <div style={{ margin: "1em 0" }}>
          <label style={{ display: "block", marginBottom: "0.5em" }}>
            {t("special_rule")}
          </label>
          <select
            className="my-select"
            value={specialRule ?? ""}
            onChange={(e) =>
              setSpecialRule(
                e.target.value ? (e.target.value as SpecialGameRule) : null
              )
            }
          >
            <option value="">{t("none")}</option>
            {Object.values(SpecialGameRule).map((rule) => (
              <option key={rule} value={rule}>
                {t(`scribble.${rule}`)}
              </option>
            ))}
          </select>
        </div>

        <button
          className="bubbly green play-button"
          onClick={startGame}
          disabled={starting}
          style={{ marginTop: "1em" }}
        >
          {starting ? t("loading") : t("start_game")}
        </button>
      </div>
    </div>
  )
}
