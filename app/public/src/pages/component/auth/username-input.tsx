import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import { throttle } from "../../../../../utils/function"
import { joinLobbyRoom } from "../../../game/lobby-logic"
import { useAppDispatch, useAppSelector } from "../../../hooks"
import { logIn, logOut } from "../../../stores/NetworkStore"
import {
  loadProfile,
  saveProfile,
  PlayerProfile
} from "../../../persistence/local-db"

import "./login.css"

export default function UsernameInput() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const navigate = useNavigate()
  const uid = useAppSelector((state) => state.network.uid)
  const displayName = useAppSelector((state) => state.network.displayName)
  const [name, setName] = useState("")
  const [prejoining, setPrejoining] = useState(false)
  const [loading, setLoading] = useState(true)

  React.useEffect(() => {
    loadProfile().then((profile) => {
      if (profile) {
        dispatch(
          logIn({
            uid: profile.uid,
            displayName: profile.displayName,
            email: "local@player"
          })
        )
      }
      setLoading(false)
    })
  }, [dispatch])

  const preJoinLobby = throttle(async function prejoin() {
    setPrejoining(true)
    return joinLobbyRoom(dispatch, navigate)
      .then(() => navigate("/lobby"))
      .catch(() => setPrejoining(false))
  }, 1000)

  async function handleStart() {
    const trimmed = name.trim()
    if (!trimmed) return
    const newUid = crypto.randomUUID()
    const profile: PlayerProfile = {
      uid: newUid,
      displayName: trimmed,
      elo: 1000,
      level: 0,
      exp: 0,
      wins: 0,
      games: 0,
      avatar: "0019/Normal",
      booster: 0,
      language: navigator.language?.split("-")[0] || "en",
      pokemonCollection: {},
      schemaVersion: 1
    }
    await saveProfile(profile)
    dispatch(
      logIn({ uid: newUid, displayName: trimmed, email: "local@player" })
    )
  }

  if (loading) {
    return <div id="play-panel"><p>{t("loading")}</p></div>
  }

  if (!uid) {
    return (
      <div id="play-panel">
        <p>{t("enter_name_to_play")}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            handleStart()
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("display_name")}
            maxLength={32}
            autoFocus
          />
          <ul className="actions">
            <li>
              <button
                type="submit"
                className="bubbly green"
                disabled={!name.trim()}
              >
                {t("start")}
              </button>
            </li>
          </ul>
        </form>
      </div>
    )
  }

  return (
    <div id="play-panel">
      <p>
        {t("authenticated_as")}: {displayName}
      </p>
      <ul className="actions">
        <li>
          <button
            className="bubbly green"
            onClick={preJoinLobby}
            disabled={prejoining}
          >
            {prejoining ? t("connecting") : t("join_lobby")}
          </button>
        </li>
        <li>
          <button
            className="bubbly red"
            disabled={prejoining}
            onClick={() => dispatch(logOut())}
          >
            {t("sign_out")}
          </button>
        </li>
      </ul>
    </div>
  )
}
