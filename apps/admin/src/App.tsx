import type { Staff } from "@table/contracts";
import { Brand, Button, Field, Pill } from "@table/ui";
import { ApiError, api, time } from "@table/ui/client";
import { applyStoreTheme } from "@table/ui/theme";
import {
  Bell,
  BellOff,
  ChartNoAxesCombined,
  ChefHat,
  CircleHelp,
  CreditCard,
  LayoutGrid,
  LogOut,
  Menu as MenuIcon,
  Settings,
  UtensilsCrossed,
  Wifi,
} from "lucide-solid";
import { createEffect, createSignal, For, Match, onCleanup, onMount, Show, Switch } from "solid-js";
import { Portal } from "solid-js/web";
import { AdminProvider, type Notice, useAdmin } from "./context";
import { InsightsPage } from "./InsightsPage";
import { MenuPage } from "./MenuPage";
import { OrdersPage } from "./OrdersPage";
import { clearPending, readPending } from "./pending";
import { SettingsPage } from "./SettingsPage";
import { TablesPage } from "./TablesPage";

function Login(props: { onLogin: (user: Staff) => void }) {
  const [login, setLogin] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal("");
  return (
    <div class="login-page">
      <div class="login-card">
        <Brand />
        <h1>오늘도, 기분 좋은 영업.</h1>
        <p>
          손님과 음식에 집중하세요.
          <br />
          주문과 테이블은 오더가 챙길게요.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await api("/api/login", { login: login(), password: password() });
              props.onLogin(await api<Staff>("/api/me"));
            } catch (err) {
              setError(err instanceof ApiError ? err.message : "서버 연결을 확인해 주세요.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="아이디">
            <input
              required
              autocomplete="username"
              value={login()}
              onInput={(e) => setLogin(e.currentTarget.value)}
            />
          </Field>
          <Field label="비밀번호">
            <input
              required
              type="password"
              autocomplete="current-password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
            />
          </Field>
          <Show when={error()}>
            <p role="alert" class="error-box">
              {error()}
            </p>
          </Show>
          <Button type="submit" disabled={busy()}>
            {busy() ? "로그인 중…" : "매장으로 들어가기"}
          </Button>
        </form>
        <div class="login-foot">TABLE ORDER · 매장 전용</div>
      </div>
    </div>
  );
}
export function App() {
  const [user, setUser] = createSignal<Staff>();
  const [loading, setLoading] = createSignal(true);
  const [sessionError, setSessionError] = createSignal(false);
  const [notice, setNotice] = createSignal<Notice>();
  let dismiss: ReturnType<typeof setTimeout>;
  const notify = (n: Notice) => {
    clearTimeout(dismiss);
    setNotice(n);
    dismiss = setTimeout(() => setNotice(undefined), n.action ? 11000 : n.error ? 10000 : 4500);
  };
  let sessionRetry: ReturnType<typeof setTimeout>;
  let sessionFailures = 0;
  async function loadSession() {
    clearTimeout(sessionRetry);
    try {
      setUser(await api<Staff>("/api/me"));
      setLoading(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) setLoading(false);
      else {
        setSessionError(true);
        sessionFailures++;
        sessionRetry = setTimeout(
          () => void loadSession(),
          Math.min(30000, 3000 * sessionFailures),
        );
      }
    }
  }
  onMount(() => void loadSession());
  onCleanup(() => {
    clearTimeout(dismiss);
    clearTimeout(sessionRetry);
  });
  return (
    <>
      <Show
        when={!loading()}
        fallback={
          <div class="loading-page">
            {sessionError()
              ? "매장 연결을 다시 확인하고 있어요. 저장된 주문은 그대로 있어요."
              : "매장을 준비하고 있어요…"}
            <Show when={sessionError()}>
              <Button onClick={() => void loadSession()}>지금 다시 확인</Button>
            </Show>
          </div>
        }
      >
        <Show when={user()} fallback={<Login onLogin={setUser} />}>
          <AdminProvider enabled={() => !!user()} notify={notify}>
            <Workspace logout={() => setUser(undefined)} />
          </AdminProvider>
        </Show>
      </Show>
      <Show when={notice()} keyed>
        {(n) => (
          <Portal
            mount={
              Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(-1) ??
              document.body
            }
          >
            <div role="status" class={`toast ${n.error ? "error" : ""}`}>
              <span>{n.message}</span>
              <Show when={n.action}>
                <button
                  type="button"
                  onClick={() => {
                    n.action?.();
                    setNotice(undefined);
                  }}
                >
                  {n.actionLabel ?? "되돌리기"}
                </button>
              </Show>
            </div>
          </Portal>
        )}
      </Show>
    </>
  );
}
function Workspace(props: { logout: () => void }) {
  const ctx = useAdmin();
  const [view, setView] = createSignal(
    new URLSearchParams(location.search).get("view") ?? "tables",
  );
  const [navOpen, setNavOpen] = createSignal(false);
  const [sound, setSound] = createSignal(false);
  let audio: AudioContext | undefined;
  let lastSoundAt = 0;
  const playTone = () => {
    if (audio?.state !== "running" || Date.now() - lastSoundAt < 3000) return;
    lastSoundAt = Date.now();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.value = 740;
    gain.gain.setValueAtTime(0.15, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.7);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.7);
  };
  let previousPending: Set<string> | undefined;
  const nav = [
    { id: "tables", label: "테이블 현황", icon: LayoutGrid },
    { id: "orders", label: "주문 · 주방", icon: ChefHat },
    { id: "payments", label: "정산 내역", icon: CreditCard },
  ];
  const manage = [
    { id: "menus", label: "메뉴 관리", icon: UtensilsCrossed },
    { id: "insights", label: "매장 인사이트", icon: ChartNoAxesCombined },
    { id: "settings", label: "매장 설정", icon: Settings },
  ];
  function navigate(value: string) {
    setView(value);
    setNavOpen(false);
    history.replaceState(null, "", `${location.pathname}?view=${value}`);
  }
  const pending = () =>
    ctx.live
      .data()
      ?.orders.filter((o) => !o.acknowledgedAt && o.items.some((i) => i.quantity > i.cancelled)) ??
    [];
  createEffect(() => {
    const err = ctx.live.error();
    if (err instanceof ApiError && err.status === 401) props.logout();
  });
  createEffect(() => {
    const accent = ctx.live.data()?.settings.accent;
    if (accent) applyStoreTheme(accent);
  });
  createEffect(() => {
    if (ctx.live.data()?.staff.role === "staff" && !["tables", "orders"].includes(view()))
      navigate("tables");
  });
  createEffect(() => {
    const ids = new Set(pending().map((o) => o.id));
    const newCount = [...ids].filter((id) => !previousPending?.has(id)).length;
    if (previousPending && newCount && sound() && audio) {
      playTone();
      ctx.notify({ message: `확인할 새 주문 ${newCount}건이 있어요.` });
    }
    previousPending = ids;
  });
  onMount(() => {
    // Resolve an interrupted command using its original key, never generate a second one.
    let recovering = false;
    const timer = setInterval(async () => {
      const payload = readPending();
      if (!payload || ctx.busy() || recovering) return;
      recovering = true;
      try {
        if (!ctx.live.data()?.staff.id) return;
        // A pending action belongs to the employee who submitted it, including after login changes.
        if (payload.staffId !== ctx.live.data()?.staff.id) {
          clearPending();
          ctx.notify({
            message: "다른 직원의 이전 작업이 있어요. 주문 이력에서 처리 결과를 확인해 주세요.",
            error: true,
          });
          return;
        }
        await api("/api/admin/actions", payload);
        clearPending();
        await ctx.live.refresh();
        window.dispatchEvent(new Event("ongi:command-recovered"));
        ctx.notify({ message: "이전에 요청한 작업의 처리를 확인했어요." });
      } catch (e) {
        if (e instanceof ApiError && e.status < 500 && e.status !== 401) {
          clearPending();
          ctx.notify({ message: e.message, error: true });
        }
      } finally {
        recovering = false;
      }
    }, 6000);
    onCleanup(() => {
      clearInterval(timer);
      void audio?.close();
    });
  });
  return (
    <div class="admin-shell">
      <aside class={`sidebar ${navOpen() ? "open" : ""}`}>
        <Brand compact />
        <div class="store-chip">
          <span class="store-avatar">{ctx.live.data()?.settings.name.slice(0, 1) ?? "온"}</span>
          <span>
            <strong>{ctx.live.data()?.settings.name ?? "내 매장"}</strong>
            <small>매장 관리</small>
          </span>
          <span class="store-dot" />
        </div>
        <nav aria-label="매장 운영">
          <div class="nav-caption">매장 운영</div>
          <For
            each={nav.filter(
              (item) => item.id !== "payments" || ctx.live.data()?.staff.role === "owner",
            )}
          >
            {(item) => (
              <button
                type="button"
                class={`nav-item ${view() === item.id ? "active" : ""}`}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={19} />
                {item.label}
                <Show when={item.id === "orders" && pending().length}>
                  <span class="nav-count">{pending().length}</span>
                </Show>
              </button>
            )}
          </For>
          <Show when={ctx.live.data()?.staff.role === "owner"}>
            <div class="nav-caption management">매장 관리</div>
            <For each={manage}>
              {(item) => (
                <button
                  type="button"
                  class={`nav-item ${view() === item.id ? "active" : ""}`}
                  onClick={() => navigate(item.id)}
                >
                  <item.icon size={19} />
                  {item.label}
                </button>
              )}
            </For>
          </Show>
        </nav>
        <div class="sidebar-bottom">
          <div class="help-card">
            <CircleHelp size={18} />
            <span>
              조작은 간단하게,
              <br />
              영업은 편안하게.
            </span>
          </div>
          <button
            type="button"
            class="nav-item"
            onClick={async () => {
              await api("/api/logout", {});
              props.logout();
            }}
          >
            <LogOut size={18} />
            로그아웃
          </button>
          <span class="version">ONGI · TABLE ORDER</span>
        </div>
      </aside>
      <div class="workspace">
        <header class="topbar">
          <div class="row">
            <button
              type="button"
              class="icon-btn mobile-nav"
              aria-label="메뉴 열기"
              onClick={() => setNavOpen(!navOpen())}
            >
              <MenuIcon size={22} />
            </button>
            <span class="breadcrumb">
              내 매장 <span>/</span>{" "}
              <strong>{[...nav, ...manage].find((n) => n.id === view())?.label}</strong>
            </span>
          </div>
          <div class="row">
            <span class="today">
              {new Date().toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </span>
            <Pill tone={ctx.live.connection() === "live" ? "teal" : "orange"}>
              <Wifi size={12} />
              {ctx.live.connection() === "live" ? "연결됨" : "연결 확인 중"}
            </Pill>
            <button
              type="button"
              class={`icon-btn sound-btn ${sound() ? "on" : ""}`}
              aria-label={sound() ? "주문 알림 소리 끄기" : "주문 알림 소리 켜기"}
              title={sound() ? "알림 소리 켜짐" : "눌러서 알림 소리 켜기"}
              onClick={async () => {
                if (!audio) audio = new AudioContext();
                await audio.resume();
                setSound(!sound());
                if (sound()) playTone();
                ctx.notify({
                  message: sound()
                    ? "새 주문을 소리로 알려드릴게요."
                    : "알림 소리를 껐어요. 새 주문은 목록에 계속 표시돼요.",
                });
              }}
            >
              {sound() ? <Bell size={19} /> : <BellOff size={19} />}
            </button>
            <div class="staff-avatar">{ctx.live.data()?.staff.name.slice(0, 1) ?? "점"}</div>
          </div>
        </header>
        <Show
          when={ctx.live.connection() === "offline" || ctx.live.connection() === "reconnecting"}
        >
          <div class="connection-bar">
            연결을 다시 확인하고 있어요.{" "}
            {ctx.live.lastSuccess() ? `마지막 확인 ${time(ctx.live.lastSuccess() as Date)}` : ""} ·
            다시 연결되면 주문을 자동으로 불러와요.
          </div>
        </Show>
        <main class="main-content" id="main-content">
          <Show
            when={ctx.live.data()}
            fallback={
              <div class="loading-page">
                테이블과 주문을 불러오고 있어요…
                <Show when={ctx.live.error()}>
                  <p class="error-box">{ctx.live.error()?.message}</p>
                  <Button onClick={() => void ctx.live.refresh()}>다시 확인</Button>
                </Show>
              </div>
            }
          >
            <Switch>
              <Match when={view() === "tables"}>
                <TablesPage />
              </Match>
              <Match when={view() === "orders"}>
                <OrdersPage />
              </Match>
              <Match when={view() === "menus"}>
                <MenuPage />
              </Match>
              <Match when={view() === "payments" || view() === "insights"}>
                <InsightsPage mode={view() === "payments" ? "payments" : "insights"} />
              </Match>
              <Match when={view() === "settings"}>
                <SettingsPage />
              </Match>
            </Switch>
          </Show>
        </main>
      </div>
    </div>
  );
}
