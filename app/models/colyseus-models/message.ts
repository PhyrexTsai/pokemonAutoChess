import { IChatV2 } from "../../types/index"

export default class Message implements IChatV2 {
  id: string
  payload: string
  authorId: string
  author: string
  avatar: string
  time: number

  constructor(
    id: string,
    payload: string,
    authorId: string,
    author: string,
    avatar: string,
    time: number
  ) {
    this.id = id
    this.payload = payload
    this.authorId = authorId
    this.author = author
    this.avatar = avatar
    this.time = time
  }
}
