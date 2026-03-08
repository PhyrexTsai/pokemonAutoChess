import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import { IChatV2 } from "../../../../../types"
import ChatHistory from "../chat/chat-history"

export function ProfileChatHistory(props: { uid: string }) {
  const { t } = useTranslation()
  const [chatHistory] = useState<IChatV2[]>([])

  return (
    <article className="chat-history">
      <h2>{t("chat_history")}</h2>
      <div>
        {(!chatHistory || chatHistory.length === 0) && (
          <p>{t("no_history_found")}</p>
        )}
        {chatHistory && (
          <ChatHistory messages={chatHistory} source="preparation" />
        )}
      </div>
    </article>
  )
}
