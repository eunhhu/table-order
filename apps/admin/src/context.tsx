import type { Action, AdminSnapshot, CommandResult } from "@table/contracts";
import { ApiError, api, createLive } from "@table/ui/client";
import { type Accessor, createContext, createSignal, type JSX, useContext } from "solid-js";
import { clearPending, readPending, savePending } from "./pending";

export interface Notice {
  message: string;
  error?: boolean;
  action?: () => void;
  actionLabel?: string;
}
interface AdminState {
  data: Accessor<AdminSnapshot>;
  live: ReturnType<typeof createLive<AdminSnapshot>>;
  busy: Accessor<boolean>;
  notify: (notice: Notice) => void;
  run: (action: Action, success?: string) => Promise<CommandResult | null>;
}
const Context = createContext<AdminState>();
export const useAdmin = () => {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("Admin context missing");
  return ctx;
};
export function AdminProvider(props: {
  enabled: Accessor<boolean>;
  notify: (notice: Notice) => void;
  children: JSX.Element;
}) {
  const live = createLive<AdminSnapshot>(
    () => "/api/admin/snapshot",
    () => "/api/admin/events",
    props.enabled,
  );
  const [busy, setBusy] = createSignal(false);
  const data = () => {
    const value = live.data();
    if (!value) throw new Error("매장 정보를 불러오고 있어요.");
    return value;
  };
  async function run(action: Action, success?: string) {
    if (busy() || readPending()) {
      props.notify({ message: "직전 작업의 결과를 확인하고 있어요. 잠시만 기다려 주세요." });
      return null;
    }
    const payload = { requestId: crypto.randomUUID(), action, staffId: data().staff.id };
    // Keep a pending operational command across reloads, but never persist a staff password.
    if (action.type !== "user.save" && !savePending(payload)) {
      props.notify({
        message:
          "작업 정보를 안전하게 보관할 수 없어요. 브라우저의 사이트 저장을 허용해 주세요. 아직 작업하지 않았어요.",
        error: true,
      });
      return null;
    }
    setBusy(true);
    try {
      const result = await api<CommandResult>("/api/admin/actions", payload);
      clearPending();
      await live.refresh();
      if (success) props.notify({ message: success });
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status < 500) {
        clearPending();
        props.notify({ message: error.message, error: true });
      } else {
        props.notify({
          message:
            action.type === "user.save"
              ? "계정 변경 결과를 확인하지 못했어요. 계정 목록에서 변경 여부를 확인해 주세요."
              : "처리 결과를 확인하고 있어요. 같은 작업을 다시 누르지 않아도 돼요.",
          error: true,
        });
      }
      await live.refresh();
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ live, data, busy, run, notify: props.notify }}>
      {props.children}
    </Context.Provider>
  );
}
