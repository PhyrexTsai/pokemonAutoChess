import { ArraySchema } from "@colyseus/schema"
import React, { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { AutoSizer } from "react-virtualized-auto-sizer"
import { List, useDynamicRowHeight } from "react-window"
import { SynergyTriggers } from "../../../../../config"
import { IPokemonRecord } from "../../../../../models/colyseus-models/game-record"
import { getGameHistoryByPlayer } from "../../../../../models/local-store"
import { IDetailledStatistic } from "../../../../../types/interfaces/detailled-statistic"
import { computeSynergies } from "../../../../../models/colyseus-models/synergies"
import PokemonFactory from "../../../../../models/pokemon-factory"
import { Synergy } from "../../../../../types/enum/Synergy"
import { formatDate } from "../../utils/date"
import Team from "../after/team"
import { GameModeIcon } from "../icons/game-mode-icon"
import SynergyIcon from "../icons/synergy-icon"
import { EloBadge } from "./elo-badge"
import "./game-history.css"

const ROW_HEIGHT = 72

export default function GameHistory(props: {
  uid: string
  onUpdate?: (history: IDetailledStatistic[]) => void
}) {
  const { t } = useTranslation()
  const [gameHistory, setGameHistory] = useState<IDetailledStatistic[]>([])

  useEffect(() => {
    if (props.onUpdate) {
      props.onUpdate(gameHistory)
    }
  }, [gameHistory, props.onUpdate])

  useEffect(() => {
    const records = getGameHistoryByPlayer(props.uid)
      .sort((a, b) => b.time - a.time)
    setGameHistory(records)
  }, [props.uid])

  const dynamicRowHeight = useDynamicRowHeight({
    defaultRowHeight: ROW_HEIGHT,
    key: gameHistory.length
  })

  return (
    <article className="game-history-list">
      <h2>{t("game_history")}</h2>
      <div style={{ flex: 1, minHeight: 0 }}>
        {(!gameHistory || gameHistory.length === 0) && (
          <p>{t("no_history_found")}</p>
        )}
        {gameHistory && gameHistory.length > 0 && (
          <AutoSizer
            renderProp={({ height, width }) => {
              if (height === undefined || width === undefined) return null
              return (
                <List<HistoryRowData>
                  style={{ height, width }}
                  rowCount={gameHistory.length}
                  rowHeight={dynamicRowHeight}
                  rowComponent={GameHistoryRow}
                  rowProps={{
                    gameHistory,
                    t
                  }}
                />
              )
            }}
          />
        )}
      </div>
    </article>
  )
}

type HistoryRowData = {
  gameHistory: IDetailledStatistic[]
  t: (key: string) => string
}

function GameHistoryRow({
  index,
  style,
  gameHistory,
  t
}: {
  ariaAttributes: object
  index: number
  style: React.CSSProperties
} & HistoryRowData): React.ReactElement | null {
  const r = gameHistory[index]

  return (
    <div style={style}>
      <div className="my-box game-history">
        <span className="top">
          <GameModeIcon gameMode={r.gameMode} />
          {t("top")} {r.rank}
        </span>
        <EloBadge elo={r.elo} />
        <ul className="synergies">
          {getTopSynergies(r.pokemons).map(([type, value]) => (
            <li key={r.time + type}>
              <SynergyIcon type={type} />
              <span>{value}</span>
            </li>
          ))}
        </ul>
        <p className="date">{formatDate(r.time)}</p>
        <Team team={r.pokemons}></Team>
      </div>
    </div>
  )
}

function getTopSynergies(
  team: IPokemonRecord[] | ArraySchema<IPokemonRecord>
): [Synergy, number][] {
  const synergies = computeSynergies(
    team.map((pkmRecord) => {
      const pkm = PokemonFactory.createPokemonFromName(pkmRecord.name)
      pkm.positionY = 1 // just to not be counted on bench
      pkmRecord.items.forEach((item) => {
        pkm.items.add(item)
      })
      return pkm
    })
  )

  const topSynergies = [...synergies.entries()]
    .sort((a, b) => {
      const [typeA, valueA] = a
      const [typeB, valueB] = b
      const aTriggerReached = SynergyTriggers[typeA].filter(
        (n) => valueA >= n
      ).length
      const bTriggerReached = SynergyTriggers[typeB].filter(
        (n) => valueB >= n
      ).length
      return aTriggerReached !== bTriggerReached
        ? bTriggerReached - aTriggerReached
        : valueB - valueA
    })
    .slice(0, 4)
  return topSynergies
}
