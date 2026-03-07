import React, { useEffect, useRef, useState } from "react"
import { Navigate } from "react-router-dom"
import { useAppDispatch, useAppSelector } from "../hooks"
import { engine } from "../network"
import { preference } from "../preferences"
import {
  addPlayer,
  leaveAfter,
  setElligibilityToELO,
  setElligibilityToXP,
  setGameMode
} from "../stores/AfterGameStore"
import AfterMenu from "./component/after/after-menu"
import { playSound, SOUNDS } from "./utils/audio"
import { IAfterGamePlayer } from "../../../types"
import { GameMode } from "../../../types/enum/Game"

export default function AfterGame() {
  const dispatch = useAppDispatch()
  const currentPlayerId: string = useAppSelector((state) => state.network.uid)
  const initialized = useRef<boolean>(false)
  const [toLobby, setToLobby] = useState<boolean>(false)
  const [toAuth, setToAuth] = useState<boolean>(false)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true

    const afterData = (engine as any).__afterGameData as {
      players: IAfterGamePlayer[]
      eligibleToXP: boolean
      eligibleToELO: boolean
      gameMode: GameMode
    } | undefined

    if (!afterData) {
      setToLobby(true)
      return
    }

    // Dispatch after-game state
    afterData.players.forEach((player) => {
      dispatch(addPlayer(player))
      if (player.id === currentPlayerId) {
        playSound(
          SOUNDS[("FINISH" + player.rank) as keyof typeof SOUNDS],
          preference("musicVolume") / 100
        )
      }
    })
    dispatch(setElligibilityToELO(afterData.eligibleToELO))
    dispatch(setElligibilityToXP(afterData.eligibleToXP))
    dispatch(setGameMode(afterData.gameMode))
  })

  if (toLobby) {
    return <Navigate to="/lobby" />
  }
  if (toAuth) {
    return <Navigate to="/auth" />
  } else {
    return (
      <div className="after-game">
        <button
          className="bubbly blue"
          style={{ margin: "10px 0 0 10px" }}
          onClick={() => {
            dispatch(leaveAfter())
            delete (engine as any).__afterGameData
            setToLobby(true)
          }}
        >
          Back to Lobby
        </button>
        <AfterMenu />
      </div>
    )
  }
}
