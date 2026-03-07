import { Command } from "@colyseus/command"
import { Client, matchMaker } from "colyseus"
import { nanoid } from "nanoid"
import { writeHeapSnapshot } from "v8"
import {
  BoosterPriceByRarity,
  DUST_PER_BOOSTER,
  DUST_PER_SHINY,
  EloRankThreshold,
  getBaseAltForm,
  getEmotionCost,
  MAX_PLAYERS_PER_GAME,
  MAX_USER_NAME_LENGTH,
  PkmAltForms,
  PkmAltFormsByPkm,
  USERNAME_REGEXP
} from "../../config"
import { CollectionUtils, createBooster } from "../../core/collection"
import { getPendingGame } from "../../core/pending-game-manager"
import { ArraySchema } from "@colyseus/schema"
import {
  TournamentBracketSchema,
  TournamentPlayerSchema
} from "../../models/colyseus-models/tournament"
import type {
  ITournament,
  ITournamentBracket
} from "../../types/interfaces/Tournament"

function getRemainingPlayers(
  tournament: ITournament
): (ITournamentPlayer & { id: string })[] {
  const remainingPlayers: (ITournamentPlayer & { id: string })[] = []
  tournament.players.forEach((player, playerId) => {
    if (!player.eliminated)
      remainingPlayers.push({ id: playerId, ...player })
  })
  return remainingPlayers
}

function getTournamentStage(tournament: ITournament): string {
  if (tournament.finished) return "Finished"
  const remainingPlayers = getRemainingPlayers(tournament)
  if (remainingPlayers.length <= 8) return "FINALS"
  if (remainingPlayers.length <= 16) return "Semi-Finals"
  if (remainingPlayers.length <= 32) return "Quarter-Finals"
  const n = Math.floor(Math.log(remainingPlayers.length) / Math.log(2))
  return `Round of ${Math.pow(2, n)}`
}

function makeBrackets(tournament: ITournament): ITournamentBracket[] {
  const remainingPlayers = getRemainingPlayers(tournament)
  remainingPlayers.sort((a, b) => b.elo - a.elo)
  let minDelta = 8
  let idealNbPerBracket = 8
  for (let nbPerBracket = 5; nbPerBracket <= 8; nbPerBracket++) {
    let delta = Math.abs(
      Math.round(remainingPlayers.length / nbPerBracket) -
        remainingPlayers.length / nbPerBracket
    )
    delta += 8 - nbPerBracket
    if (delta <= minDelta) {
      minDelta = delta
      idealNbPerBracket = nbPerBracket
    }
  }
  const nbBrackets = Math.ceil(remainingPlayers.length / idealNbPerBracket)
  const brackets: ITournamentBracket[] = []
  for (let i = 0; i < nbBrackets; i++) {
    let bracketName = getTournamentStage(tournament)
    if (nbBrackets > 1) bracketName += ` #${i + 1}`
    const bracket: ITournamentBracket = {
      name: bracketName,
      playersId: new ArraySchema(),
      finished: false
    }
    brackets.push(bracket)
  }
  let b = 0
  while (remainingPlayers.length > 0) {
    const bracket = brackets[b]
    if (remainingPlayers.length > 0)
      bracket.playersId.push(remainingPlayers.shift()!.id)
    if (remainingPlayers.length > nbBrackets - b - 1)
      bracket.playersId.push(remainingPlayers.pop()!.id)
    b = (b + 1) % nbBrackets
  }
  return brackets
}
import { getPlayer, updatePlayer } from "../../models/local-store"
import { getPokemonData } from "../../models/precomputed/precomputed-pokemon-data"
import { notificationsService } from "../../services/notifications"
import {
  CollectionEmotions,
  Emotion,
  IPlayer,
  ISuggestionUser,
  PkmWithCustom,
  Role,
  Title,
  Transfer
} from "../../types"
import { CloseCodes } from "../../types/enum/CloseCodes"
import { EloRank } from "../../types/enum/EloRank"
import { GameMode } from "../../types/enum/Game"
import { Language } from "../../types/enum/Language"
import {
  NonPkm,
  Pkm,
  PkmByIndex,
  PkmIndex,
  Unowns
} from "../../types/enum/Pokemon"
import type { ITournamentPlayer } from "../../types/interfaces/Tournament"
import {
  IPokemonCollectionItemMongo,
  IUserMetadataJSON,
  IUserMetadataMongo
} from "../../types/interfaces/UserMetadata"
import { getPortraitSrc } from "../../utils/avatar"
import { getRank } from "../../utils/elo"
import { logger } from "../../utils/logger"
import { cleanProfanity } from "../../utils/profanity-filter"
import { values } from "../../utils/schemas"
import CustomLobbyRoom from "../custom-lobby-room"

function toUserMetadataJSON(user: IUserMetadataMongo): IUserMetadataJSON {
  const pokemonCollection: {
    [index: string]: IUserMetadataJSON["pokemonCollection"][string]
  } = {}
  user.pokemonCollection.forEach((item, index) => {
    pokemonCollection[index] = CollectionUtils.toCollectionItemClient(item)
  })
  const { pokemonCollection: _pc, ...rest } = user
  return {
    ...rest,
    pokemonCollection
  } as IUserMetadataJSON
}

export class OnJoinCommand extends Command<
  CustomLobbyRoom,
  {
    client: Client
    user: IUserMetadataMongo | null
  }
> {
  async execute({
    client,
    user
  }: {
    client: Client
    user: IUserMetadataMongo | null
  }) {
    try {
      //logger.info(`${client.auth.displayName} ${client.id} join lobby room`)
      client.send(Transfer.ROOMS, this.room.rooms)
      client.userData = { joinedAt: Date.now() }

      if (!user) return // player not initialized yet (profile created in username-input)

      // load existing account
      this.room.users.set(client.auth.uid, user)
      const pendingGame = await getPendingGame(
        this.room.presence,
        client.auth.uid
      )
      if (pendingGame != null && !pendingGame.isExpired) {
        client.send(Transfer.RECONNECT_PROMPT, pendingGame.gameId)
      }

      // Send any pending notifications
      const notifications = notificationsService.getNotifications(
        client.auth.uid
      )
      if (notifications.length > 0) {
        client.send(Transfer.NOTIFICATIONS, notifications)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class OnLeaveCommand extends Command<
  CustomLobbyRoom,
  { client: Client }
> {
  execute({ client }: { client: Client }) {
    try {
      if (client && client.auth && client.auth.displayName && client.auth.uid) {
        //logger.info(`${client.auth.displayName} ${client.id} leave lobby`)
        this.room.users.delete(client.auth.uid)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class GiveTitleCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string; title: Title }
> {
  async execute({
    client,
    uid,
    title
  }: {
    client: Client
    uid: string
    title: Title
  }) {
    try {
      const u = this.room.users.get(client.auth.uid)
      const targetUser = this.room.users.get(uid)

      if (u && u.role && u.role === Role.ADMIN) {
        const user = getPlayer()
        if (user && user.titles && !user.titles.includes(title)) {
          user.titles.push(title)

          if (targetUser) {
            targetUser.titles.push(title)
          }
        }
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class DeleteAccountCommand extends Command<CustomLobbyRoom> {
  async execute({ client }: { client: Client }) {
    try {
      if (client.auth.uid) {
        logger.info(
          `User ${client.auth.displayName} [${client.auth.uid}] has deleted their account`
        )
        // noop in single-player mode — no persistent account to delete
        client.leave(CloseCodes.USER_DELETED)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class HeapSnapshotCommand extends Command<CustomLobbyRoom> {
  execute() {
    logger.info("writing heap snapshot")
    writeHeapSnapshot()
  }
}

export class GiveBoostersCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string; numberOfBoosters: number }
> {
  async execute({
    client,
    uid,
    numberOfBoosters = 1
  }: {
    client: Client
    uid: string
    numberOfBoosters: number
  }) {
    try {
      const u = this.room.users.get(client.auth.uid)
      const targetUser = this.room.users.get(uid)

      if (u && u.role && u.role === Role.ADMIN) {
        const user = getPlayer()
        if (user) {
          user.booster += numberOfBoosters

          if (targetUser) {
            targetUser.booster = user.booster
          }
        }
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class GiveRoleCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string; role: Role }
> {
  async execute({
    client,
    uid,
    role
  }: {
    client: Client
    uid: string
    role: Role
  }) {
    try {
      const u = this.room.users.get(client.auth.uid)
      const targetUser = this.room.users.get(uid)
      // logger.debug(u.role, uid)
      if (u && u.role === Role.ADMIN) {
        const user = getPlayer()
        if (user) {
          user.role = role

          if (targetUser) {
            targetUser.role = user.role
          }
        }
      }
    } catch (error) {
      logger.error(error)
    }
  }
}
export class OnNewMessageCommand extends Command<
  CustomLobbyRoom,
  { client: Client; message: string }
> {
  execute({ client, message }: { client: Client; message: string }) {
    try {
      const MAX_MESSAGE_LENGTH = 250
      message = cleanProfanity(message.substring(0, MAX_MESSAGE_LENGTH))

      const user = this.room.users.get(client.auth.uid)
      if (
        user &&
        [Role.ADMIN, Role.MODERATOR].includes(user.role) &&
        message != ""
      ) {
        this.state.addMessage(message, user.uid, user.displayName, user.avatar)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class RemoveMessageCommand extends Command<
  CustomLobbyRoom,
  { client: Client; messageId: string }
> {
  execute({ client, messageId }: { client: Client; messageId: string }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (
        user &&
        user.role &&
        (user.role === Role.ADMIN || user.role === Role.MODERATOR)
      ) {
        this.state.removeMessage(messageId)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class OpenBoosterCommand extends Command<
  CustomLobbyRoom,
  { client: Client }
> {
  async execute({ client }: { client: Client }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (!user) return

      if (user.booster <= 0) return // No boosters available

      // Decrement booster count
      user.booster -= 1

      // Generate booster cards and apply directly to in-memory user
      const boosterContent = createBooster(user)
      boosterContent.forEach((card) => {
        const index = PkmIndex[card.name]
        const existingItem = user.pokemonCollection.get(index)

        if (!existingItem) {
          // Create new collection item
          const newCollectionItem: IPokemonCollectionItemMongo = {
            id: index,
            unlocked: Buffer.alloc(5, 0),
            dust: 0,
            selectedEmotion: Emotion.NORMAL,
            selectedShiny: false,
            played: 0
          }
          CollectionUtils.unlockEmotion(
            newCollectionItem.unlocked,
            card.emotion,
            card.shiny
          )
          user.pokemonCollection.set(index, newCollectionItem)
        } else {
          // Check if already unlocked
          const hasUnlocked = CollectionUtils.hasUnlocked(
            existingItem.unlocked,
            card.emotion,
            card.shiny
          )

          if (hasUnlocked) {
            // Add dust to the base form
            const dustGain = card.shiny ? DUST_PER_SHINY : DUST_PER_BOOSTER
            const shardIndex = PkmIndex[getBaseAltForm(card.name)]
            const shardItem = user.pokemonCollection.get(shardIndex)
            if (shardItem) {
              shardItem.dust += dustGain
            }
          } else {
            // Add new emotion
            CollectionUtils.unlockEmotion(
              existingItem.unlocked,
              card.emotion,
              card.shiny
            )
          }
        }
      })

      checkTitlesAfterEmotionUnlocked(user, boosterContent)
      client.send(Transfer.BOOSTER_CONTENT, boosterContent)
      client.send(Transfer.USER_PROFILE, toUserMetadataJSON(user))
    } catch (error) {
      logger.error(error)
    }
  }
}

export class ChangeNameCommand extends Command<
  CustomLobbyRoom,
  { client: Client; name: string }
> {
  async execute({ client, name }: { client: Client; name: string }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (!user) return
      if (USERNAME_REGEXP.test(name)) {
        logger.info(`${client.auth.displayName} changed name to ${name}`)
        user.displayName = name
        updatePlayer((p) => { p.displayName = name })
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class ChangeTitleCommand extends Command<
  CustomLobbyRoom,
  { client: Client; title: Title | "" }
> {
  async execute({ client, title }: { client: Client; title: Title | "" }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (title !== "" && user?.titles.includes(title) === false) {
        throw new Error("User does not have this title unlocked")
      }
      if (user) {
        user.title = title
        updatePlayer((p) => { p.title = title })
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class ChangeSelectedEmotionCommand extends Command<
  CustomLobbyRoom,
  { client: Client; index: string; emotion: Emotion | null; shiny: boolean }
> {
  async execute({
    client,
    emotion,
    index,
    shiny
  }: {
    client: Client
    index: string
    emotion: Emotion | null
    shiny: boolean
  }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (!user) return
      const pokemonCollectionItem = user.pokemonCollection.get(index)
      if (!pokemonCollectionItem) return
      if (
        emotion === pokemonCollectionItem.selectedEmotion &&
        shiny === pokemonCollectionItem.selectedShiny
      ) {
        return // No change needed
      }

      if (
        emotion === null ||
        CollectionUtils.hasUnlocked(
          pokemonCollectionItem.unlocked,
          emotion,
          shiny
        )
      ) {
        pokemonCollectionItem.selectedEmotion = emotion
        pokemonCollectionItem.selectedShiny = shiny
        updatePlayer((p) => {
          const item = p.pokemonCollection.get(index)
          if (item) {
            item.selectedEmotion = emotion
            item.selectedShiny = shiny
          }
        })
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class ChangeAvatarCommand extends Command<
  CustomLobbyRoom,
  { client: Client; index: string; emotion: Emotion; shiny: boolean }
> {
  async execute({
    client,
    index,
    emotion,
    shiny
  }: {
    client: Client
    index: string
    emotion: Emotion
    shiny: boolean
  }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (!user) return
      const collectionItem = user.pokemonCollection.get(index)
      if (
        !collectionItem ||
        !CollectionUtils.hasUnlocked(collectionItem.unlocked, emotion, shiny)
      )
        return
      const portrait = getPortraitSrc(index, shiny, emotion)
        .replace("/assets/portraits/", "")
        .replace(".png", "")
      user.avatar = portrait
      updatePlayer((p) => { p.avatar = portrait })
    } catch (error) {
      logger.error(error)
    }
  }
}

export class BuyEmotionCommand extends Command<
  CustomLobbyRoom,
  { client: Client; index: string; emotion: Emotion; shiny: boolean }
> {
  async execute({
    client,
    emotion,
    index,
    shiny
  }: {
    client: Client
    index: string
    emotion: Emotion
    shiny: boolean
  }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      const cost = getEmotionCost(emotion, shiny)
      if (!user || !PkmByIndex.hasOwnProperty(index)) return

      // If an alt form is bought, shards must be taken from the base form
      const shardIndex = PkmIndex[getBaseAltForm(PkmByIndex[index])]
      const pokemonCollectionItem = user.pokemonCollection.get(index)
      const shardCollectionItem = user.pokemonCollection.get(shardIndex)
      if (!pokemonCollectionItem || !shardCollectionItem) return

      // Check if emotion is already unlocked
      if (
        CollectionUtils.hasUnlocked(
          pokemonCollectionItem.unlocked,
          emotion,
          shiny
        )
      ) {
        return // Already unlocked
      }

      if (shardCollectionItem.dust < cost) return

      // Add the emotion using optimized storage
      CollectionUtils.unlockEmotion(
        pokemonCollectionItem.unlocked,
        emotion,
        shiny
      )
      pokemonCollectionItem.selectedEmotion = emotion
      pokemonCollectionItem.selectedShiny = shiny

      // Deduct cost
      shardCollectionItem.dust -= cost

      checkTitlesAfterEmotionUnlocked(user, [
        { name: PkmByIndex[index], emotion, shiny }
      ])
      client.send(Transfer.USER_PROFILE, toUserMetadataJSON(user))
    } catch (error) {
      logger.error(error)
    }
  }
}

function checkTitlesAfterEmotionUnlocked(
  player: IUserMetadataMongo,
  unlocked: PkmWithCustom[]
) {
  const newTitles: Title[] = []
  if (!player.titles.includes(Title.SHINY_SEEKER)) {
    // update titles
    let numberOfShinies = 0
    player.pokemonCollection.forEach((c) => {
      const { shinyEmotions } = CollectionUtils.getEmotionsUnlocked(c)
      numberOfShinies += shinyEmotions.length
    })
    if (numberOfShinies >= 30) {
      newTitles.push(Title.SHINY_SEEKER)
    }
  }

  if (!player.titles.includes(Title.DUKE)) {
    if (
      Object.values(Pkm)
        .filter(
          (p) =>
            NonPkm.includes(p) === false && PkmAltForms.includes(p) === false
        )
        .every((pkm) => {
          const baseForm = getBaseAltForm(pkm)
          const accepted: Pkm[] =
            baseForm in PkmAltFormsByPkm
              ? [baseForm, ...PkmAltFormsByPkm[baseForm]]
              : [baseForm]
          return accepted.some((form) => {
            const item = player.pokemonCollection.get(PkmIndex[form])
            if (!item) return false
            const { emotions, shinyEmotions } =
              CollectionUtils.getEmotionsUnlocked(item)
            return emotions.length > 0 || shinyEmotions.length > 0
          })
        })
    ) {
      newTitles.push(Title.DUKE)
    }
  }

  if (
    unlocked.some((p) => p.emotion === Emotion.ANGRY && p.name === Pkm.ARBOK) &&
    !player.titles.includes(Title.DENTIST)
  ) {
    newTitles.push(Title.DENTIST)
  }

  if (
    !player.titles.includes(Title.ARCHEOLOGIST) &&
    Unowns.some((unown) => unlocked.map((p) => p.name).includes(unown)) &&
    Unowns.every((name) => {
      const unownIndex = PkmIndex[name]
      const item = player.pokemonCollection.get(unownIndex)
      const isBeingUnlockedRightNow = unlocked.some((p) => p.name === name)
      let isAlreadyUnlocked = false
      if (item) {
        const { emotions, shinyEmotions } =
          CollectionUtils.getEmotionsUnlocked(item)
        isAlreadyUnlocked = emotions.length > 0 || shinyEmotions.length > 0
      }
      return isAlreadyUnlocked || isBeingUnlockedRightNow
    })
  ) {
    newTitles.push(Title.ARCHEOLOGIST)
  }

  if (!player.titles.includes(Title.DUCHESS)) {
    if (
      unlocked.some((p) => {
        const item = player.pokemonCollection.get(PkmIndex[p.name])
        if (!item) return false
        const { emotions, shinyEmotions } =
          CollectionUtils.getEmotionsUnlocked(item)
        return (
          shinyEmotions.length >= CollectionEmotions.length &&
          emotions.length >= CollectionEmotions.length
        )
      })
    ) {
      newTitles.push(Title.DUCHESS)
    }
  }

  if (newTitles.length > 0) {
    player.titles.push(...newTitles) // mutates in-memory user directly
  }
}

export class BuyBoosterCommand extends Command<
  CustomLobbyRoom,
  { client: Client; index: string }
> {
  async execute({ client, index }: { client: Client; index: string }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (!user) return

      const pkm = PkmByIndex[index]
      if (!pkm) return

      const rarity = getPokemonData(pkm).rarity
      const boosterCost = BoosterPriceByRarity[rarity]

      const shardIndex = PkmIndex[getBaseAltForm(pkm)]

      const pokemonCollectionItem = user.pokemonCollection.get(shardIndex)
      if (!pokemonCollectionItem) return
      if (pokemonCollectionItem.dust < boosterCost) return

      // Direct in-memory mutation
      pokemonCollectionItem.dust -= boosterCost
      user.booster += 1
      client.send(Transfer.USER_PROFILE, toUserMetadataJSON(user))
    } catch (error) {
      logger.error(error)
    }
  }
}

export class OnSearchByIdCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string }
> {
  async execute({ client, uid }: { client: Client; uid: string }) {
    try {
      const user = getPlayer()
      if (user && user.uid === uid) {
        client.send(Transfer.USER, user)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class BanUserCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string; reason: string }
> {
  async execute({
    client,
    uid,
    reason
  }: {
    client: Client
    uid: string
    reason: string
  }) {
    // noop in single-player mode — no banning needed
  }
}

export class UnbanUserCommand extends Command<
  CustomLobbyRoom,
  { client: Client; uid: string; name: string }
> {
  async execute({
    client,
    uid,
    name
  }: {
    client: Client
    uid: string
    name: string
  }) {
    // noop in single-player mode — no unbanning needed
  }
}

export class SelectLanguageCommand extends Command<
  CustomLobbyRoom,
  { client: Client; message: Language }
> {
  async execute({ client, message }: { client: Client; message: Language }) {
    try {
      const u = this.room.users.get(client.auth.uid)
      if (client.auth.uid && u) {
        u.language = message
        updatePlayer((p) => { p.language = message })
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class JoinOrOpenRoomCommand extends Command<
  CustomLobbyRoom,
  { client: Client; gameMode: GameMode }
> {
  async execute({ client, gameMode }: { client: Client; gameMode: GameMode }) {
    const user = this.room.users.get(client.auth.uid)
    if (!user) return

    switch (gameMode) {
      case GameMode.CUSTOM_LOBBY:
        return [new OpenGameCommand().setPayload({ gameMode, client })]

      case GameMode.CLASSIC: {
        const existingClassicLobby = this.room.rooms?.find(
          (room) =>
            room.name === "preparation" &&
            room.metadata?.gameMode === GameMode.CLASSIC &&
            room.clients < MAX_PLAYERS_PER_GAME
        )
        if (existingClassicLobby) {
          client.send(Transfer.REQUEST_ROOM, existingClassicLobby.roomId)
        } else {
          return [new OpenGameCommand().setPayload({ gameMode, client })]
        }
        break
      }

      case GameMode.RANKED: {
        const userRank = getRank(user.elo)
        let minRank = EloRank.LEVEL_BALL
        let maxRank = EloRank.BEAST_BALL
        switch (userRank) {
          case EloRank.LEVEL_BALL:
          case EloRank.NET_BALL:
            // 0- 1099
            minRank = EloRank.LEVEL_BALL
            maxRank = EloRank.NET_BALL
            break
          case EloRank.SAFARI_BALL:
          case EloRank.LOVE_BALL:
            // 1050-1200
            minRank = EloRank.NET_BALL
            maxRank = EloRank.LOVE_BALL
            break
          case EloRank.PREMIER_BALL:
          case EloRank.QUICK_BALL:
            // 1150-1299
            minRank = EloRank.LOVE_BALL
            maxRank = EloRank.QUICK_BALL
            break
          case EloRank.POKE_BALL:
          case EloRank.SUPER_BALL:
          case EloRank.ULTRA_BALL:
          case EloRank.MASTER_BALL:
          case EloRank.BEAST_BALL:
            // 1250+
            minRank = EloRank.QUICK_BALL
            maxRank = EloRank.BEAST_BALL
            break
        }
        const existingRanked = this.room.rooms?.find((room) => {
          const { minRank, maxRank, gameMode } = room.metadata ?? {}
          const minElo = minRank ? EloRankThreshold[minRank] : 0
          const maxRankThreshold = maxRank
            ? EloRankThreshold[maxRank]
            : Infinity
          return (
            room.name === "preparation" &&
            gameMode === GameMode.RANKED &&
            user.elo >= minElo &&
            (user.elo <= maxRankThreshold || userRank === maxRank) &&
            room.clients < MAX_PLAYERS_PER_GAME
          )
        })
        if (existingRanked) {
          client.send(Transfer.REQUEST_ROOM, existingRanked.roomId)
        } else {
          return [
            new OpenGameCommand().setPayload({
              gameMode,
              client,
              minRank,
              maxRank
            })
          ]
        }
        break
      }

      case GameMode.SCRIBBLE: {
        const existingScribble = this.room.rooms?.find(
          (room) =>
            room.name === "preparation" &&
            room.metadata?.gameMode === GameMode.SCRIBBLE &&
            room.clients < MAX_PLAYERS_PER_GAME
        )
        if (existingScribble) {
          client.send(Transfer.REQUEST_ROOM, existingScribble.roomId)
        } else {
          return [new OpenGameCommand().setPayload({ gameMode, client })]
        }
        break
      }
    }
  }
}

export class OpenGameCommand extends Command<
  CustomLobbyRoom,
  {
    gameMode: GameMode
    client: Client
    minRank?: EloRank
    maxRank?: EloRank
  }
> {
  async execute({
    gameMode,
    client,
    minRank,
    maxRank
  }: {
    gameMode: GameMode
    client: Client
    minRank?: EloRank
    maxRank?: EloRank
  }) {
    const user = this.room.users.get(client.auth.uid)
    if (!user) return
    let roomName = `${user.displayName}'${user.displayName.endsWith("s") ? "" : "s"} room`
    let noElo: boolean = true
    let password: string | null = null
    let ownerId: string | null = null

    if (gameMode === GameMode.RANKED) {
      roomName = "Ranked Match"
      noElo = false
    } else if (gameMode === GameMode.SCRIBBLE) {
      roomName = "Smeargle's Scribble"
    } else if (gameMode === GameMode.CUSTOM_LOBBY) {
      ownerId = user.uid
      password = Math.random().toString(36).substring(2, 6).toUpperCase()
    } else if (gameMode === GameMode.CLASSIC) {
      roomName = "Classic"
    }

    const newRoom = await matchMaker.createRoom("preparation", {
      gameMode,
      minRank,
      maxRank,
      noElo,
      password,
      ownerId,
      roomName
    })
    client.send(Transfer.REQUEST_ROOM, newRoom.roomId)
  }
}

export class OnCreateTournamentCommand extends Command<
  CustomLobbyRoom,
  { client: Client; name: string; startDate: string }
> {
  async execute({
    client,
    name,
    startDate
  }: {
    client: Client
    name: string
    startDate: string
  }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (user && user.role && user.role === Role.ADMIN) {
        await this.state.createTournament(name, startDate)
        await this.room.fetchTournaments()
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class DeleteTournamentCommand extends Command<
  CustomLobbyRoom,
  { client: Client; tournamentId: string }
> {
  execute({ client, tournamentId }: { client: Client; tournamentId: string }) {
    try {
      const user = this.room.users.get(client.auth.uid)
      if (user && user.role && user.role === Role.ADMIN) {
        this.state.removeTournament(tournamentId)
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class ParticipateInTournamentCommand extends Command<
  CustomLobbyRoom,
  { client: Client; tournamentId: string; participate: boolean }
> {
  async execute({
    client,
    tournamentId,
    participate
  }: {
    client: Client
    tournamentId: string
    participate: boolean
  }) {
    try {
      // noop in single-player mode — tournaments are multiplayer-only
    } catch (error) {
      logger.error(error)
    }
  }
}

export class NextTournamentStageCommand extends Command<
  CustomLobbyRoom,
  { tournamentId: string }
> {
  async execute({ tournamentId }: { tournamentId: string }) {
    try {
      logger.debug(`Tournament ${tournamentId} is moving to next stage`)
      const tournament = this.state.tournaments.find(
        (t) => t.id === tournamentId
      )
      if (!tournament)
        return logger.error(`Tournament not found: ${tournamentId}`)

      const remainingPlayers = getRemainingPlayers(tournament)
      if (
        remainingPlayers.length <= 4 &&
        remainingPlayers.some((p) => p.ranks.length > 0)
      ) {
        // finals ended
        return [new EndTournamentCommand().setPayload({ tournamentId })]
      } else {
        return [
          new CreateTournamentLobbiesCommand().setPayload({ tournamentId })
        ]
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class CreateTournamentLobbiesCommand extends Command<
  CustomLobbyRoom,
  { client?: Client; tournamentId: string }
> {
  async execute({
    tournamentId,
    client
  }: {
    tournamentId: string
    client?: Client
  }) {
    try {
      if (client) {
        const user = this.room.users.get(client.auth.uid)
        if (!user || !user.role || user.role !== Role.ADMIN) {
          return
        }
      }

      logger.debug(`Creating tournament lobbies for tournament ${tournamentId}`)
      const tournament = this.state.tournaments.find(
        (t) => t.id === tournamentId
      )
      if (!tournament)
        return logger.error(`Tournament not found: ${tournamentId}`)

      this.state.addAnnouncement(
        `${tournament.name} ${getTournamentStage(tournament)} are starting !`
      )

      const brackets = makeBrackets(tournament)
      tournament.brackets.clear()

      for (const bracket of brackets) {
        const bracketId = nanoid()
        logger.info(`Creating tournament game ${bracket.name} id: ${bracketId}`)
        tournament.brackets.set(
          bracketId,
          new TournamentBracketSchema(bracket.name, bracket.playersId)
        )

        await matchMaker.createRoom("preparation", {
          gameMode: GameMode.TOURNAMENT,
          noElo: true,
          ownerId: null,
          roomName: bracket.name,
          autoStartDelayInSeconds: 10 * 60,
          whitelist: bracket.playersId,
          tournamentId,
          bracketId
        })
        //await wait(1000)
      }

      tournament.pendingLobbiesCreation = false
    } catch (error) {
      logger.error(error)
    }
  }
}

export class RemakeTournamentLobbyCommand extends Command<
  CustomLobbyRoom,
  { client?: Client; tournamentId: string; bracketId: string }
> {
  async execute({
    tournamentId,
    bracketId,
    client
  }: {
    tournamentId: string
    bracketId: string
    client?: Client
  }) {
    try {
      if (client) {
        const user = this.room.users.get(client.auth.uid)
        if (!user || !user.role || user.role !== Role.ADMIN) {
          return
        }
      }

      const tournament = this.state.tournaments.find(
        (t) => t.id === tournamentId
      )
      if (!tournament)
        return logger.error(`Tournament not found: ${tournamentId}`)

      const bracket = tournament.brackets.get(bracketId)
      if (!bracket)
        return logger.error(`Tournament bracket not found: ${bracketId}`)

      logger.info(`Remaking tournament game ${bracket.name} id: ${bracketId}`)
      tournament.brackets.set(
        bracketId,
        new TournamentBracketSchema(bracket.name, bracket.playersId)
      )

      await matchMaker.createRoom("preparation", {
        gameMode: GameMode.TOURNAMENT,
        noElo: true,
        ownerId: null,
        roomName: bracket.name,
        autoStartDelayInSeconds: 10 * 60,
        whitelist: bracket.playersId,
        tournamentId,
        bracketId
      })

      tournament.pendingLobbiesCreation = false
    } catch (error) {
      logger.error(error)
    }
  }
}

export class EndTournamentMatchCommand extends Command<
  CustomLobbyRoom,
  {
    tournamentId: string
    bracketId: string
    players: { id: string; rank: number }[]
  }
> {
  async execute({
    tournamentId,
    bracketId,
    players
  }: {
    tournamentId: string
    bracketId: string
    players: IPlayer[]
  }) {
    logger.debug(`Tournament ${tournamentId} bracket ${bracketId} has ended`)
    try {
      const tournament = this.state.tournaments.find(
        (t) => t.id === tournamentId
      )
      if (!tournament)
        return logger.error(`Tournament not found: ${tournamentId}`)

      const bracket = tournament.brackets.get(bracketId)
      if (!bracket)
        return logger.error(`Tournament bracket not found: ${bracketId}`)

      bracket.finished = true

      players.forEach((p) => {
        const player = tournament.players.get(p.id)
        if (player) {
          player.ranks.push(p.rank)
          if (p.rank > 4) {
            // eliminate players whose rank is > 4
            player.eliminated = true
          }
        }
      })

      bracket.playersId.forEach((playerId) => {
        const player = tournament.players.get(playerId)
        if (player && players.every((p) => p.id !== playerId)) {
          // eliminate players who did not attend their bracket
          player.eliminated = true
        }
      })

      if (
        !tournament.pendingLobbiesCreation &&
        values(tournament.brackets).every((b) => b.finished)
      ) {
        tournament.pendingLobbiesCreation = true // prevent executing command multiple times
        return [new NextTournamentStageCommand().setPayload({ tournamentId })]
      }
    } catch (error) {
      logger.error(error)
    }
  }
}

export class EndTournamentCommand extends Command<
  CustomLobbyRoom,
  { tournamentId: string }
> {
  async execute({ tournamentId }: { tournamentId: string }) {
    try {
      logger.debug(`Tournament ${tournamentId} is finished`)
      const tournament = this.state.tournaments.find(
        (t) => t.id === tournamentId
      )
      if (!tournament)
        return logger.error(`Tournament not found: ${tournamentId}`)

      let finalists: (ITournamentPlayer & { id: string })[] = [],
        nbMatchsPlayed = 0

      tournament.players.forEach((player, playerId) => {
        if (player.ranks.length > nbMatchsPlayed) {
          finalists = []
          nbMatchsPlayed = player.ranks.length
        }
        if (player.ranks.length === nbMatchsPlayed) {
          finalists.push({
            id: playerId,
            ...player
          })
        }
      })

      const winner = finalists.find((p) => p.ranks.at(-1) === 1)
      if (winner) {
        this.room.presence.publish(
          "announcement",
          `${winner.name} won the tournament !`
        )
      }

      for (const player of finalists) {
        const rank = player.ranks.at(-1) ?? 1
        const user = this.room.users.get(player.id)
        if (!user) continue

        logger.debug(
          `Tournament ${tournamentId} finalist ${player.name} finished with rank ${rank}, distributing rewards`
        )

        user.booster += 3 // 3 boosters for top 8
        if (!user.titles.includes(Title.ACE_TRAINER)) {
          user.titles.push(Title.ACE_TRAINER)
        }

        if (rank <= 4) {
          user.booster += 3 // 6 boosters for top 4
          if (!user.titles.includes(Title.ELITE_FOUR_MEMBER)) {
            user.titles.push(Title.ELITE_FOUR_MEMBER)
          }
        }

        if (rank === 1) {
          user.booster += 4 // 10 boosters for top 1
          if (!user.titles.includes(Title.CHAMPION)) {
            user.titles.push(Title.CHAMPION)
          }
        }
      }

      tournament.brackets.clear()
      tournament.finished = true
    } catch (error) {
      logger.error(error)
    }
  }
}

export class DeleteRoomCommand extends Command<
  CustomLobbyRoom,
  {
    client: Client
    roomId?: string
    tournamentId?: string
    bracketId?: string
  }
> {
  async execute({ client, roomId, tournamentId, bracketId }) {
    try {
      if (client) {
        const user = this.room.users.get(client.auth.uid)
        if (!user || !user.role || user.role !== Role.ADMIN) {
          return
        }
      }

      const roomsIdToDelete: string[] = []
      if (roomId) {
        roomsIdToDelete.push(roomId)
      } else if (tournamentId) {
        const tournament = this.state.tournaments.find(
          (t) => t.id === tournamentId
        )
        if (!tournament)
          return logger.error(
            `DeleteRoomCommand ; Tournament not found: ${tournamentId}`
          )

        const allRooms = await matchMaker.query({})
        roomsIdToDelete.push(
          ...allRooms
            .filter(
              (result) =>
                result.metadata?.tournamentId === tournamentId &&
                (bracketId === "all" ||
                  result.metadata?.bracketId === bracketId)
            )
            .map((result) => result.roomId)
        )
      }

      if (roomsIdToDelete.length === 0) {
        return logger.error(
          `DeleteRoomCommand ; room not found with query: roomId: ${roomId} tournamentId: ${tournamentId} bracketId: ${bracketId}`
        )
      }

      roomsIdToDelete.forEach((roomIdToDelete) => {
        this.room.presence.publish("room-deleted", roomIdToDelete)
      })
    } catch (error) {
      logger.error(`DeleteRoomCommand error:`, error)
    }
  }
}
