import { NavigateFunction } from "react-router-dom"
import { ConnectionStatus } from "../../../types/enum/ConnectionStatus"
import { fetchProfile } from "../network"
import { AppDispatch } from "../stores"
import { setConnectionStatus, setErrorAlertMessage } from "../stores/NetworkStore"

export async function joinLobbyRoom(
  dispatch: AppDispatch,
  navigate: NavigateFunction
): Promise<void> {
  try {
    await fetchProfile()
    dispatch(setConnectionStatus(ConnectionStatus.CONNECTED))
  } catch (err: any) {
    dispatch(setErrorAlertMessage(err?.message ?? "Failed to load profile"))
    navigate("/")
  }
}
