import { getDecoderStateCallbacks } from "@colyseus/schema"
import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { toast } from "react-toastify"
import { MinStageForGameToCount, RegionDetails } from "../../../config"
import { IPokemonRecord } from "../../../models/colyseus-models/game-record"
import { Wanderer } from "../../../models/colyseus-models/wanderer"
import { PVEStages } from "../../../models/pve-stages"
import GameState from "../../../models/colyseus-models/game-state"
import {
  IAfterGamePlayer,
  IBoardEvent,
  IDps,
  IDragDropCombineMessage,
  IDragDropItemMessage,
  IDragDropMessage,
  IExperienceManager,
  IPlayer,
  Role,
  Transfer
} from "../../../types"
import { GamePhaseState, Team } from "../../../types/enum/Game"
import { Item } from "../../../types/enum/Item"
import { Passive } from "../../../types/enum/Passive"
import { Pkm } from "../../../types/enum/Pokemon"
import { Synergy } from "../../../types/enum/Synergy"
import type { NonFunctionPropNames } from "../../../types/HelperTypes"
import { getAvatarString } from "../../../utils/avatar"
import { logger } from "../../../utils/logger"
import { values } from "../../../utils/schemas"
import GameContainer from "../game/game-container"
import GameScene from "../game/scenes/game-scene"
import {
  selectConnectedPlayer,
  selectSpectatedPlayer,
  useAppDispatch,
  useAppSelector
} from "../hooks"
import { engine } from "../network"
import store from "../stores"
import {
  addDpsMeter,
  addPlayer,
  changeDpsMeter,
  changePlayer,
  changeShop,
  leaveGame,
  removeDpsMeter,
  removePlayer,
  setAdditionalPokemons,
  setEmotesUnlocked,
  setGameMode,
  setInterest,
  setItemsProposition,
  setLife,
  setLoadingProgress,
  setMaxInterest,
  setMoney,
  setNoELO,
  setPhase,
  setPodium,
  setPokemonProposition,
  setRoundTime,
  setShopFreeRolls,
  setShopLocked,
  setSpecialGameRule,
  setStageLevel,
  setStreak,
  setSynergies,
  setWeather,
  updateExperienceManager
} from "../stores/GameStore"
import {
  setConnectionStatus
} from "../stores/NetworkStore"
import GameDpsMeter from "./component/game/game-dps-meter"
import GameFinalRank from "./component/game/game-final-rank"
import GameItemsProposition from "./component/game/game-items-proposition"
import GameLoadingScreen from "./component/game/game-loading-screen"
import GamePlayers from "./component/game/game-players"
import GamePokemonsProposition from "./component/game/game-pokemons-proposition"
import GameShop from "./component/game/game-shop"
import GameSpectatePlayerInfo from "./component/game/game-spectate-player-info"
import GameStageInfo from "./component/game/game-stage-info"
import GameSynergies from "./component/game/game-synergies"
import GameToasts from "./component/game/game-toasts"
import { MainSidebar } from "./component/main-sidebar/main-sidebar"
import { ConnectionStatusNotification } from "./component/system/connection-status-notification"
import { saveHistoryEntry } from "../persistence/local-db"
import { playMusic, preloadMusic } from "./utils/audio"
import { ConnectionStatus } from "../../../types/enum/ConnectionStatus"

let gameContainer: GameContainer

export function getGameScene(): GameScene | undefined {
  return gameContainer?.game?.scene?.getScene<GameScene>("gameScene") as
    | GameScene
    | undefined
}

export function getGameContainer(): GameContainer {
  return gameContainer
}

export function cyclePlayers(amt: number) {
  const players = values(engine.clientState.players)
  playerClick(
    players[
      (players.findIndex((p) => p === gameContainer.player) +
        amt +
        players.length) %
        players.length
    ].id
  )
}

export function playerClick(id: string) {
  const scene = getGameScene()
  // In single-player, spectate is a local operation
  if (scene?.spectate) {
    if (engine.clientState?.players) {
      const spectatedPlayer = engine.clientState.players.get(id)
      if (spectatedPlayer) {
        gameContainer.setPlayer(spectatedPlayer)

        const simulation = engine.clientState.simulations.get(
          spectatedPlayer.simulationId
        )
        if (simulation) {
          gameContainer.setSimulation(simulation)
        }
      }

      gameContainer?.gameScene?.board?.updateScoutingAvatars()
    }
  }
}

function showMoneyToast(value: number) {
  toast(
    <div className="toast-player-income">
      <span style={{ verticalAlign: "middle" }}>+{value}</span>
      <img className="icon-money" src="/assets/icons/money.svg" alt="$" />
    </div>,
    { containerId: "toast-money" }
  )
}

export default function Game() {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const uid: string = useAppSelector((state) => state.network.uid)
  const spectatedPlayerId: string = useAppSelector(
    (state) => state.game.playerIdSpectated
  )
  const connectedPlayer = useAppSelector(selectConnectedPlayer)
  const spectatedPlayer = useAppSelector(selectSpectatedPlayer)
  const spectate = spectatedPlayerId !== uid || !spectatedPlayer?.alive

  const initialized = useRef<boolean>(false)
  const [loaded, setLoaded] = useState<boolean>(false)
  const [connectError, setConnectError] = useState<string>("")
  const [finalRank, setFinalRank] = useState<number>(0)
  enum FinalRankVisibility {
    HIDDEN,
    VISIBLE,
    CLOSED
  }
  const [finalRankVisibility, setFinalRankVisibility] =
    useState<FinalRankVisibility>(FinalRankVisibility.HIDDEN)
  const container = useRef<HTMLDivElement>(null)

  const leave = useCallback(async () => {
    const afterPlayers = new Array<IAfterGamePlayer>()

    if (gameContainer && gameContainer.game) {
      gameContainer.game.destroy(true)
    }

    const state = engine.clientState
    const nbPlayers = state.players.size ?? 0
    const hasLeftBeforeEnd =
      connectedPlayer?.alive === true && state.gameFinished === false

    if (nbPlayers > 0) {
      state.players.forEach((p) => {
        const afterPlayer: IAfterGamePlayer = {
          elo: p.elo,
          games: p.games,
          name: p.name,
          id: p.id,
          rank: p.rank,
          avatar: p.avatar,
          title: p.title,
          role: p.role,
          pokemons: new Array<IPokemonRecord>(),
          synergies: new Array<{ name: Synergy; value: number }>(),
          moneyEarned: p.totalMoneyEarned,
          playerDamageDealt: p.totalPlayerDamageDealt,
          rerollCount: p.rerollCount
        }

        const allSynergies = new Array<{ name: Synergy; value: number }>()
        p.synergies.forEach((v, k) => {
          allSynergies.push({ name: k as Synergy, value: v })
        })

        allSynergies.sort((a, b) => b.value - a.value)
        afterPlayer.synergies = allSynergies.slice(0, 5)

        if (p.board && p.board.size > 0) {
          p.board.forEach((pokemon) => {
            if (
              pokemon.positionY != 0 &&
              pokemon.passive !== Passive.INANIMATE
            ) {
              afterPlayer.pokemons.push({
                avatar: getAvatarString(
                  pokemon.index,
                  pokemon.shiny,
                  pokemon.emotion
                ),
                items: pokemon.items.toArray(),
                name: pokemon.name
              })
            }
          })
        }

        afterPlayers.push(afterPlayer)
      })
    }

    const eligibleToXP =
      nbPlayers >= 2 && (state.stageLevel ?? 0) >= MinStageForGameToCount
    const eligibleToELO =
      nbPlayers >= 2 &&
      ((state.stageLevel ?? 0) >= MinStageForGameToCount ||
        hasLeftBeforeEnd) &&
      !state.noElo &&
      afterPlayers.filter((p) => p.role !== Role.BOT).length >= 2
    const gameMode = state.gameMode

    // Save game history entry to IndexedDB
    const me = afterPlayers.find((p) => p.id === uid)
    if (me) {
      saveHistoryEntry({
        id: crypto.randomUUID(),
        playerId: uid,
        elo: me.elo,
        time: Date.now(),
        name: me.name,
        rank: me.rank,
        nbplayers: nbPlayers,
        avatar: me.avatar,
        pokemons: me.pokemons.map((p) => ({
          name: p.name,
          avatar: p.avatar,
          items: Array.from(p.items) as string[]
        })),
        synergies: Object.fromEntries(
          me.synergies.map((s) => [s.name, s.value])
        ),
        regions: [],
        gameMode: gameMode ?? "NORMAL"
      }).catch(() => {})
    }

    // Store after-game data in engine for after-game page to read
    ;(engine as any).__afterGameData = {
      players: afterPlayers,
      eligibleToXP,
      eligibleToELO,
      gameMode
    }

    engine.dispose()
    dispatch(leaveGame(0))
    navigate("/after")
  }, [dispatch, connectedPlayer, uid])

  const spectateTillTheEnd = () => {
    setFinalRankVisibility(FinalRankVisibility.CLOSED)
    gameContainer.spectate = true
    if (gameContainer.gameScene) {
      gameContainer.gameScene.spectate = true
      // rerender to make items and units not dragable anymore
      gameContainer.gameScene?.board?.renderBoard(false)
      gameContainer.gameScene?.itemsContainer?.render(
        gameContainer.player!.items
      )
    }
  }

  useEffect(() => {
    // create a history entry to prevent back button switching page immediately, and leave game properly instead
    window.history.pushState(null, "", window.location.href)
    const confirmLeave = () => {
      if (confirm("Do you want to leave game ?")) {
        leave()
      } else {
        // push again another entry to prevent back button from switching page, effectively canceling the back action
        window.history.pushState(null, "", window.location.href)
      }
    }
    // when pressing back button, properly leave game
    window.addEventListener("popstate", confirmLeave)
    return () => {
      window.removeEventListener("popstate", confirmLeave)
    }
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        getGameScene()?.board?.clearBoard()
      } else {
        getGameScene()?.board?.renderBoard(false)
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    dispatch(setPodium([]))
  }, [])

  useEffect(() => {
    if (
      !initialized.current &&
      container?.current
    ) {
      logger.debug("initializing game")
      initialized.current = true
      dispatch(setConnectionStatus(ConnectionStatus.CONNECTED))

      gameContainer = new GameContainer(container.current, uid, engine)

      const gameElm = document.getElementById("game")
      gameElm?.addEventListener(Transfer.DRAG_DROP, ((
        event: CustomEvent<IDragDropMessage>
      ) => {
        gameContainer.onDragDrop(event)
      }) as EventListener)
      gameElm?.addEventListener(Transfer.DRAG_DROP_ITEM, ((
        event: CustomEvent<IDragDropItemMessage>
      ) => {
        gameContainer.onDragDropItem(event)
      }) as EventListener)
      gameElm?.addEventListener(Transfer.DRAG_DROP_COMBINE, ((
        event: CustomEvent<IDragDropCombineMessage>
      ) => {
        gameContainer.onDragDropCombine(event)
      }) as EventListener)

      engine.on(Transfer.LOADING_COMPLETE, () => {
        setLoaded(true)
      })
      engine.on(Transfer.FINAL_RANK, (finalRank) => {
        setFinalRank(finalRank)
        setFinalRankVisibility(FinalRankVisibility.VISIBLE)
      })
      engine.on(Transfer.PRELOAD_MAPS, async (maps) => {
        logger.info("preloading maps", maps)
        const gameScene = getGameScene()
        if (gameScene) {
          await gameScene.preloadMaps(maps)
          gameScene.load
            .once("complete", () => {
              if (engine.clientState.phase !== GamePhaseState.TOWN) {
                // map loaded after the end of the portal carousel stage, we swap it now. better later than never
                gameContainer &&
                  gameContainer.player &&
                  gameScene.setMap(gameContainer.player.map)
              }
            })
            .start()
        }
      })
      engine.on(Transfer.SHOW_EMOTE, (message) => {
        const g = getGameScene()
        if (
          g?.minigameManager?.pokemons?.size &&
          g.minigameManager.pokemons.size > 0
        ) {
          // early return here to prevent showing animation twice
          return g.minigameManager?.showEmote(message.id, message?.emote)
        }

        if (g && g.board) {
          g.board.showEmote(message.id, message?.emote)
        }
      })
      engine.on(
        Transfer.COOK,
        (message: { pokemonId: string; dishes: Item[] }) => {
          const g = getGameScene()
          if (g && g.board) {
            const pokemon = g.board.pokemons.get(message.pokemonId)
            if (pokemon) {
              pokemon.cookAnimation(message.dishes)
            }
          }
        }
      )

      engine.on(
        Transfer.DIG,
        (message: { pokemonId: string; buriedItem: Item | null }) => {
          setTimeout(() => {
            const g = getGameScene()
            if (g && g.board) {
              const pokemon = g.board.pokemons.get(message.pokemonId)
              if (pokemon) {
                pokemon.digAnimation(message.buriedItem)
              }
            }
          }, 500)
        }
      )

      engine.on(Transfer.POKEMON_DAMAGE, (message) => {
        gameContainer.handleDisplayDamage(message)
      })

      engine.on(Transfer.ABILITY, (message) => {
        gameContainer.handleDisplayAbility(message)
      })

      engine.on(Transfer.POKEMON_HEAL, (message) => {
        gameContainer.handleDisplayHeal(message)
      })

      engine.on(Transfer.PLAYER_DAMAGE, (value) => {
        toast(
          <div className="toast-player-damage">
            <span style={{ verticalAlign: "middle" }}>-{value}</span>
            <img className="icon-life" src="/assets/ui/heart.png" alt="❤" />
          </div>,
          { containerId: "toast-life" }
        )
      })

      engine.on(Transfer.PLAYER_INCOME, showMoneyToast)

      engine.on(Transfer.BOARD_EVENT, (event: IBoardEvent) => {
        if (gameContainer.game) {
          const g = getGameScene()
          if (g?.battle?.simulation?.id === event.simulationId) {
            g.battle.displayBoardEvent(event)
          }
        }
      })

      engine.on(Transfer.CLEAR_BOARD_EVENT, (event: IBoardEvent) => {
        if (gameContainer.game) {
          const g = getGameScene()
          if (g?.battle?.simulation?.id === event.simulationId) {
            g.battle.removeBoardEvent(event)
          }
        }
      })

      engine.on(
        Transfer.CLEAR_BOARD,
        (event: { simulationId: string }) => {
          if (gameContainer.game) {
            const g = getGameScene()
            if (g?.battle?.simulation?.id === event.simulationId) {
              g.battle.clearBoardEvents()
            }
          }
        }
      )

      engine.on(Transfer.SIMULATION_STOP, () => {
        if (gameContainer.game) {
          const g = getGameScene()
          if (g && g.battle) {
            g.battle.clear()
          }
        }
      })

      engine.on(Transfer.GAME_END, leave)

      const $ = getDecoderStateCallbacks(engine.decoder)
      const $state = $<GameState>(engine.clientState)

      $state.listen("gameMode", (mode) => {
        dispatch(setGameMode(mode))
      })

      $state.listen("roundTime", (value) => {
        dispatch(setRoundTime(value))
        const stageLevel = engine.clientState.stageLevel ?? 0
        if (
          engine.clientState.phase === GamePhaseState.PICK &&
          stageLevel in PVEStages === false &&
          value < 5 &&
          gameContainer.gameScene?.board &&
          !gameContainer.gameScene.board.portal
        ) {
          gameContainer.gameScene.board.addPortal()
        }
      })

      $state.listen("phase", (newPhase, previousPhase) => {
        if (gameContainer.game) {
          const g = getGameScene()
          if (g) {
            g.updatePhase(newPhase, previousPhase)
          }
        }
        dispatch(setPhase(newPhase))
      })

      $state.listen("stageLevel", (value) => {
        dispatch(setStageLevel(value))
      })

      $state.listen("noElo", (value) => {
        dispatch(setNoELO(value))
      })

      $state.listen("specialGameRule", (value) => {
        dispatch(setSpecialGameRule(value))
      })

      $state.additionalPokemons.onChange(() => {
        dispatch(setAdditionalPokemons(values(engine.clientState.additionalPokemons)))
      })

      $state.simulations.onRemove(() => {
        gameContainer.resetSimulation()
      })

      $state.simulations.onAdd((simulation) => {
        gameContainer.initializeSimulation(simulation)
        const $simulation = $(simulation)

        $simulation.listen("weather", (value) => {
          dispatch(setWeather({ id: simulation.id, value: value }))
        })

        const teams = [Team.BLUE_TEAM, Team.RED_TEAM]
        teams.forEach((team) => {
          const $dpsMeter =
            team === Team.BLUE_TEAM
              ? $simulation.blueDpsMeter
              : $simulation.redDpsMeter
          $dpsMeter.onAdd((dps) => {
            dispatch(addDpsMeter({ value: dps, id: simulation.id, team }))
            const $dps = $(dps)
            const fields = [
              "id",
              "name",
              "physicalDamage",
              "specialDamage",
              "trueDamage",
              "heal",
              "shield",
              "physicalDamageReduced",
              "specialDamageReduced",
              "shieldDamageTaken"
            ] satisfies NonFunctionPropNames<IDps>[]
            fields.forEach((field) => {
              $dps.listen(field, (value) => {
                dispatch(
                  changeDpsMeter({
                    id: dps.id,
                    team,
                    field: field,
                    value: value,
                    simulationId: simulation.id
                  })
                )
              })
            })
          })

          $dpsMeter.onRemove((dps) => {
            dispatch(
              removeDpsMeter({ id: dps.id, team, simulationId: simulation.id })
            )
          })
        })
      })

      $state.players.onAdd((player) => {
        dispatch(addPlayer(player))
        gameContainer.initializePlayer(player)
        const $player = $(player)

        if (player.id == uid) {
          dispatch(setInterest(player.interest))
          dispatch(setMaxInterest(player.maxInterest))
          dispatch(setStreak(player.streak))
          dispatch(setShopLocked(player.shopLocked))
          dispatch(setShopFreeRolls(player.shopFreeRolls))
          dispatch(setEmotesUnlocked(player.emotesUnlocked))

          $player.listen("interest", (value) => {
            dispatch(setInterest(value))
          })
          $player.listen("maxInterest", (value) => {
            dispatch(setMaxInterest(value))
          })
          // Dispatch initial shop values (already populated before callback registration)
          player.shop.forEach((pkm: Pkm, index: number) => {
            dispatch(changeShop({ value: pkm, index }))
          })
          $player.shop.onChange((pkm: Pkm, index: number) => {
            dispatch(changeShop({ value: pkm, index }))
          })
          $player.listen("shopLocked", (value) => {
            dispatch(setShopLocked(value))
          })
          $player.listen("shopFreeRolls", (value) => {
            dispatch(setShopFreeRolls(value))
          })
          $player.listen("money", (value, previousValue) => {
            dispatch(setMoney(value))
            if (value - previousValue >= 30) {
              // show income toast for significant income only
              showMoneyToast(value - previousValue)
            }
          })
          $player.listen("streak", (value) => {
            dispatch(setStreak(value))
          })
        }
        $player.listen("life", (value, previousValue) => {
          dispatch(setLife({ id: player.id, value: value }))
          if (
            value <= 0 &&
            value !== previousValue &&
            player.id === uid &&
            !spectate &&
            finalRankVisibility === FinalRankVisibility.HIDDEN
          ) {
            setFinalRankVisibility(FinalRankVisibility.VISIBLE)
            getGameScene()?.input.keyboard?.removeAllListeners()
          }
        })
        $player.listen("experienceManager", (experienceManager) => {
          const $experienceManager = $(experienceManager)
          if (player.id === uid) {
            dispatch(updateExperienceManager(experienceManager))
            const fields = [
              "experience",
              "expNeeded",
              "level"
            ] satisfies NonFunctionPropNames<IExperienceManager>[]
            fields.forEach((field) => {
              $experienceManager.listen(field, (value) => {
                dispatch(
                  updateExperienceManager({
                    ...experienceManager,
                    [field]: value
                  } as IExperienceManager)
                )
              })
            })
          }
          $experienceManager.listen("level", (value) => {
            if (value > 1) {
              toast(
                <p>
                  {t("level")} {value}
                </p>,
                {
                  containerId: player.rank.toString(),
                  className: "toast-level-up"
                }
              )
            }
          })
        })
        $player.listen("loadingProgress", (value) => {
          dispatch(setLoadingProgress({ id: player.id, value: value }))
        })
        $player.listen("map", (newMap) => {
          if (player.id === store.getState().game.playerIdSpectated) {
            const gameScene = getGameScene()
            if (gameScene) {
              gameScene.setMap(newMap)
              const alreadyLoading = gameScene.load.isLoading()
              if (!alreadyLoading) {
                gameScene.load.reset()
              }
              preloadMusic(gameScene, RegionDetails[newMap].music)
              gameScene.load.once("complete", () =>
                playMusic(gameScene, RegionDetails[newMap].music)
              )
              if (!alreadyLoading) {
                gameScene.load.start()
              }
            }
          }
          dispatch(changePlayer({ id: player.id, field: "map", value: newMap }))
        })

        $player.listen("spectatedPlayerId", (spectatedPlayerId) => {
          if (engine.clientState?.players) {
            const spectatedPlayer = engine.clientState.players.get(spectatedPlayerId)
            if (spectatedPlayer && player.id === uid) {
              gameContainer.setPlayer(spectatedPlayer)

              const simulation = engine.clientState.simulations.get(
                spectatedPlayer.simulationId
              )
              if (simulation) {
                gameContainer.setSimulation(simulation)
              }
            }

            gameContainer.gameScene?.board?.updateScoutingAvatars()
          }
        })

        const fields = [
          "name",
          "avatar",
          "boardSize",
          "experienceManager",
          "money",
          "history",
          "life",
          "opponentId",
          "opponentName",
          "opponentAvatar",
          "opponentTitle",
          "rank",
          "regionalPokemons",
          "streak",
          "title",
          "rerollCount",
          "totalMoneyEarned",
          "totalPlayerDamageDealt",
          "eggChance",
          "goldenEggChance",
          "cellBattery"
        ] satisfies NonFunctionPropNames<IPlayer>[]

        fields.forEach((field) => {
          $player.listen(field, (value) => {
            dispatch(
              changePlayer({ id: player.id, field: field, value: value })
            )
          })
        })

        $player.synergies.onChange(() => {
          dispatch(setSynergies({ id: player.id, value: player.synergies }))
        })

        $player.itemsProposition.onChange((value, index) => {
          if (player.id == uid) {
            dispatch(setItemsProposition(values(player.itemsProposition)))
          }
        })

        $player.pokemonsProposition.onChange((value, index) => {
          if (player.id == uid) {
            dispatch(setPokemonProposition(values(player.pokemonsProposition)))
          }
        })

        $player.groundHoles.onChange((value) => {
          if (player.id === store.getState().game.playerIdSpectated) {
            const gameScene = getGameScene()
            if (gameScene?.board && engine.clientState.phase === GamePhaseState.PICK) {
              gameScene.board.renderGroundHoles()
            }
          }
        })

        $player.listen("mulch", (value) => {
          dispatch(changePlayer({ id: player.id, field: "mulch", value }))
          getGameScene()?.board?.updateMulchCount()
        })
        $player.listen("mulchCap", (value) => {
          dispatch(changePlayer({ id: player.id, field: "mulchCap", value }))
          getGameScene()?.board?.updateMulchCount()
        })

        $player.wanderers.onAdd((wanderer: Wanderer) => {
          if (
            gameContainer.game &&
            player.id === store.getState().network.uid
          ) {
            const g = getGameScene()
            if (g && g.wandererManager) {
              g.wandererManager.addWanderer(wanderer)
            }
          }
        })
      })

      $state.players.onRemove((player) => {
        dispatch(removePlayer(player))
      })

      $state.spectators.onAdd((uid) => {
        gameContainer.initializeSpectactor(uid)
      })
    }
  }, [
    initialized,
    dispatch,
    uid,
    spectatedPlayerId,
    leave
  ])

  return (
    <main id="game-wrapper" onContextMenu={(e) => e.preventDefault()}>
      <div id="game" ref={container}></div>
      {loaded ? (
        <>
          <MainSidebar page="game" leave={leave} leaveLabel={t("leave_game")} />
          <GameFinalRank
            rank={finalRank}
            hide={spectateTillTheEnd}
            leave={leave}
            visible={finalRankVisibility === FinalRankVisibility.VISIBLE}
          />
          {spectate ? <GameSpectatePlayerInfo /> : <GameShop />}
          <GameStageInfo />
          <GamePlayers click={(id: string) => playerClick(id)} />
          <GameSynergies />
          <GameItemsProposition />
          <GamePokemonsProposition />
          <GameDpsMeter />
          <GameToasts />
        </>
      ) : (
        <GameLoadingScreen connectError={connectError} />
      )}
      <ConnectionStatusNotification />
    </main>
  )
}
