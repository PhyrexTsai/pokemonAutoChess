import { DungeonPMDO } from "../../../types/enum/Dungeon"
import { EloRank } from "../../../types/enum/EloRank"
import { Item } from "../../../types/enum/Item"
import { Pkm } from "../../../types/enum/Pokemon"
import { Synergy } from "../../../types/enum/Synergy"
import { Title } from "../../../types"

// --- Types re-exported from former mongo-model files ---

export type ITypeStatistics = {
  [tier in EloRank]: {
    [synergy: string]: {
      average_rank: number
      count: number
    }
  }
}

export interface IHistoryEntry {
  date: string
  value: number
}

export interface IPokemonStatV2 {
  rank: number
  count: number
  name: Pkm
  items: Item[]
  item_count: number
  rank_history?: IHistoryEntry[]
  count_history?: IHistoryEntry[]
  item_count_history?: IHistoryEntry[]
}

export interface IPokemonsStatisticV2 {
  tier: EloRank
  pokemons: Map<EloRank, IPokemonStatV2>
}

export interface IItemV2 {
  rank: number
  count: number
  name: Item
  pokemons: Pkm[]
  rank_history?: IHistoryEntry[]
  count_history?: IHistoryEntry[]
}

export interface IItemsStatisticV2 {
  tier: string
  items: Map<string, IItemV2>
}

export interface IRegionStatistic {
  name: DungeonPMDO
  count: number
  rank: number
  elo: number
  pokemons: string[]
}

export interface IMeanTeam {
  cluster_id: string
  rank: number
  pokemons: {
    [key in Pkm]?: {
      frequency: number
      mean_items: number
      items: string[]
    }
  }
  synergies: { [key in Synergy]?: number }
}

export interface ITopTeam {
  rank: number
  elo: number
  pokemons: Array<{
    name: Pkm
    items: string[]
  }>
}

export interface IMetaV2 {
  cluster_id: string
  count: number
  ratio: number
  winrate: number
  mean_rank: number
  synergies: { [key in Synergy]?: number }
  mean_team: IMeanTeam
  mean_items?: Array<{
    item: string
    frequency: number
  }>
  top_teams?: ITopTeam[]
  hull?: [number, number][]
  x: number
  y: number
  generated_at?: string
}

export interface IDendrogramNode {
  cluster1: number
  cluster2: number
  distance: number
  count: number
}

export interface IClusterProfile {
  cluster_id: number
  size: number
  synergies: Record<string, number>
  top_pokemons: Array<{
    name: string
    frequency: number
  }>
}

export interface IBranchProfile {
  branch_index: number
  merge_index: number
  merge_height: number
  total_size: number
  leaf_cluster_ids: number[]
  synergy: string
  top_pokemons: Array<{
    name: string
    count: number
  }>
}

export interface IDendrogram {
  linkage_method: string
  n_clusters: number
  n_samples: number
  linkage_matrix: IDendrogramNode[]
  cluster_profiles: IClusterProfile[]
  branch_profiles: IBranchProfile[]
  leaves: number[]
  leaf_to_cluster: number[]
  icoord: number[][]
  dcoord: number[][]
  generated_at: string
}

export interface ITitleStatistic {
  name: Title
  rarity: number
}

export interface IReportMetadata {
  created_at: string
  count: number
  time_limit: string
}

export interface ITeam {
  cluster_id: string
  rank: number
  x: number
  y: number
  pokemons: { [key in Pkm]?: number }
}

export interface IMeta {
  cluster_id: string
  count: number
  ratio: number
  winrate: number
  mean_rank: number
  types: { [key in Synergy]?: number }
  pokemons: { [key in Pkm]?: number }
  teams: ITeam[]
  x: number
  y: number
}

// --- Direct returns (no server) ---

export async function fetchMetaPokemons(): Promise<IPokemonsStatisticV2[]> {
  return []
}

export async function fetchMetaTypes(): Promise<ITypeStatistics> {
  return {} as ITypeStatistics
}

export async function fetchMetadata(): Promise<IReportMetadata[]> {
  return []
}

export async function fetchMetaItems(): Promise<IItemsStatisticV2[]> {
  return []
}

export async function fetchMetaRegions(): Promise<IRegionStatistic[]> {
  return []
}

export async function fetchMetaV2(): Promise<IMetaV2[]> {
  return []
}

export async function fetchDendrogram(): Promise<IDendrogram | null> {
  return null
}

export async function fetchTitles(): Promise<ITitleStatistic[]> {
  return []
}

export async function fetchMeta(): Promise<IMeta[]> {
  return []
}
