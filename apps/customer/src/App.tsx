import {
  type CommandResult,
  type GuestOrder,
  type GuestSnapshot,
  guestOrderSchema,
  type Menu,
  orderTotal,
  remaining,
  won,
} from "@table/contracts";
import { Button, Empty, Field, FoodImage, Modal, Pill, Quantity } from "@table/ui";
import { ApiError, api, createLive, readDraft, storeDraft, time } from "@table/ui/client";
import { applyStoreTheme } from "@table/ui/theme";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Clock3,
  MapPin,
  Plus,
  QrCode,
  UtensilsCrossed,
  X,
} from "lucide-solid";
import { createEffect, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { z } from "zod";

interface CartLine {
  key: string;
  menuId: string;
  name: string;
  price: number;
  image: string;
  quantity: number;
  note: string;
}
interface Pending {
  request: GuestOrder;
  visitId: string;
  submittedAt: string;
}
const cartSchema = z
  .array(
    z.object({
      key: z.uuid(),
      menuId: z.uuid(),
      name: z.string(),
      price: z.number().int().min(0),
      image: z.string(),
      quantity: z.number().int().min(1).max(99),
      note: z.string().max(500),
    }),
  )
  .max(50);
const pendingSchema = z.object({
  request: guestOrderSchema,
  visitId: z.uuid(),
  submittedAt: z.iso.datetime(),
});
export function App() {
  const qr = location.pathname.match(/^\/t\/([a-f0-9]{32})\/?$/)?.[1] ?? "";
  return (
    <Show
      when={qr}
      fallback={
        <div class="customer-landing">
          <Empty
            icon={<QrCode size={36} />}
            title="테이블의 QR로 만나요"
            description="테이블에 놓인 주문 QR을 카메라로 스캔해 주세요. 메뉴와 주문 내역을 바로 볼 수 있어요."
          />
        </div>
      }
    >
      <OrderApp qr={qr} />
    </Show>
  );
}
function OrderApp(props: { qr: string }) {
  const base = `/api/guest/${props.qr}`;
  const [joined, setJoined] = createSignal(false);
  const live = createLive<GuestSnapshot>(
    () => `${base}/snapshot`,
    () => (joined() ? `${base}/events` : null),
  );
  const storage = `ongi-cart:${props.qr}`;
  const pendingKey = `ongi-pending:${props.qr}`;
  const [cart, setCart] = createSignal<CartLine[]>(
    cartSchema.safeParse(readDraft<unknown>(storage, [])).data ?? [],
  );
  const [pending, setPending] = createSignal<Pending | null>(
    pendingSchema.safeParse(readDraft<unknown>(pendingKey, null)).data ?? null,
  );
  const [pendingIssue, setPendingIssue] = createSignal(false);
  const [resolveOpen, setResolveOpen] = createSignal(false);
  const [tab, setTab] = createSignal("menu");
  const [category, setCategory] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [selected, setSelected] = createSignal<Menu>();
  const [quantity, setQuantity] = createSignal(1);
  const [itemNote, setItemNote] = createSignal("");
  const [cartOpen, setCartOpen] = createSignal(false);
  const [orderNote, setOrderNote] = createSignal(
    z
      .string()
      .max(500)
      .safeParse(readDraft<unknown>(`${storage}:note`, "")).data ?? "",
  );
  const [busy, setBusy] = createSignal(false);
  const [joinBusy, setJoinBusy] = createSignal(false);
  const [code, setCode] = createSignal("");
  const [joinError, setJoinError] = createSignal("");
  const [message, setMessage] = createSignal("");
  const [submitError, setSubmitError] = createSignal("");
  const [lastOrder, setLastOrder] = createSignal<number>();
  let joining = false;
  let checking = false;
  let dismiss: ReturnType<typeof setTimeout>;
  const tell = (text: string) => {
    clearTimeout(dismiss);
    setMessage(text);
    dismiss = setTimeout(() => setMessage(""), 4500);
  };
  const total = () => cart().reduce((sum, l) => sum + l.price * l.quantity, 0);
  const count = () => cart().reduce((sum, l) => sum + l.quantity, 0);
  const availableToOrder = () =>
    !!live.data()?.joined &&
    live.data()?.visit?.state === "open" &&
    live.data()?.settings.acceptingOrders;
  const priceChanged = () =>
    cart().some((l) => live.data()?.menus.find((m) => m.id === l.menuId)?.price !== l.price);
  const unavailable = () =>
    cart().some((l) => !live.data()?.menus.find((m) => m.id === l.menuId)?.available);
  const visibleMenus = () =>
    live
      .data()
      ?.menus.filter(
        (m) =>
          (!live.data()?.settings.categoriesEnabled ||
            !category() ||
            m.categoryId === category()) &&
          (!search() || m.name.includes(search())),
      ) ?? [];
  const groups = () =>
    live.data()?.settings.categoriesEnabled
      ? [
          ...(live.data()?.categories ?? []).map((c) => ({
            id: c.id,
            name: c.name,
            menus: visibleMenus().filter((m) => m.categoryId === c.id),
          })),
          { id: "", name: "더 맛있는 선택", menus: visibleMenus().filter((m) => !m.categoryId) },
        ].filter((g) => g.menus.length)
      : [{ id: "", name: "메뉴", menus: visibleMenus() }];
  createEffect(() => {
    storeDraft(storage, cart());
  });
  createEffect(() => {
    const settings = live.data()?.settings;
    if (settings) {
      applyStoreTheme(settings.accent);
      document.title = `${settings.name} · 테이블 주문`;
    }
  });
  createEffect(() => {
    storeDraft(pendingKey, pending());
  });
  createEffect(() => {
    storeDraft(`${storage}:note`, orderNote());
  });
  createEffect(() => {
    const data = live.data();
    if (!data) return;
    if (category() && !data.categories.some((c) => c.id === category())) setCategory("");
    setJoined(data.joined);
    if (pending() && data.visit && data.visit.id !== pending()?.visitId) setPendingIssue(true);
    if (!data.joined && !data.ended && !data.pinRequired && !joining) {
      joining = true;
      void joinVisit();
    }
  });
  async function joinVisit(explicit = false) {
    if (explicit && pending()) {
      setPendingIssue(true);
      setResolveOpen(true);
      return;
    }
    setJoinBusy(true);
    setJoinError("");
    try {
      if (explicit) {
        setCart([]);
        setPending(null);
        setOrderNote("");
      }
      await api(`${base}/join`, { code: code() || undefined });
      await live.refresh();
    } catch (e) {
      setJoinError(
        e instanceof ApiError ? e.message : "연결을 확인하고 있어요. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setJoinBusy(false);
    }
  }
  function openMenu(menu: Menu) {
    setSelected(menu);
    setQuantity(1);
    setItemNote("");
  }
  function addMenu() {
    const menu = selected();
    if (!menu) return;
    setCart((previous) => [
      ...previous,
      {
        key: crypto.randomUUID(),
        menuId: menu.id,
        name: menu.name,
        price: menu.price,
        image: menu.image,
        quantity: quantity(),
        note: itemNote(),
      },
    ]);
    setSelected(undefined);
    tell("장바구니에 담았어요.");
  }
  function finish(result: CommandResult) {
    const info = result.data as { number?: number } | undefined;
    setLastOrder(info?.number);
    setPending(null);
    setPendingIssue(false);
    setCart([]);
    setOrderNote("");
    setCartOpen(false);
    setTab("history");
    setSubmitError("");
    tell("주문이 완료됐어요. 맛있게 준비해 드릴게요.");
    void live.refresh();
  }
  async function reconcile() {
    const value = pending();
    if (!value || checking || busy() || pendingIssue()) return;
    checking = true;
    try {
      const { result } = await api<{ result: CommandResult | null }>(
        `${base}/requests/${value.request.requestId}`,
      );
      if (result) {
        finish(result);
        return;
      }
      // Retry only the explicit, already-submitted request with the SAME key.
      // An unsubmitted basket is never sent on reconnect.
      const visit = live.data()?.visit;
      if (visit?.id === value.visitId && visit.state === "open")
        finish(await api<CommandResult>(`${base}/orders`, value.request));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setPendingIssue(true);
      } else if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        setSubmitError(e.message);
        setCartOpen(true);
      }
    } finally {
      checking = false;
    }
  }
  async function submit() {
    const visit = live.data()?.visit;
    if (visit?.state !== "open") return;
    if (busy() || pending() || !availableToOrder() || !cart().length) return;
    setSubmitError("");
    setBusy(true);
    const request: GuestOrder = {
      requestId: crypto.randomUUID(),
      lines: cart().map((l) => ({
        menuId: l.menuId,
        quantity: l.quantity,
        expectedPrice: l.price,
        note: l.note,
      })),
      note: orderNote(),
    };
    const value = {
      request,
      visitId: visit.id,
      submittedAt: new Date().toISOString(),
    };
    if (!storeDraft(pendingKey, value)) {
      setSubmitError(
        "주문 정보를 안전하게 보관할 수 없어요. 브라우저의 사이트 저장을 허용하거나 일반 브라우저에서 다시 열어 주세요. 아직 주문하지 않았어요.",
      );
      setBusy(false);
      return;
    }
    setPending(value);
    try {
      finish(await api<CommandResult>(`${base}/orders`, request));
    } catch (e) {
      if (e instanceof ApiError && e.status < 500) {
        setPending(null);
        setSubmitError(e.message);
        void live.refresh();
      } else
        setSubmitError(
          "주문 결과를 확인하고 있어요. 다시 주문하지 않아도 자동으로 확인해 드릴게요.",
        );
    } finally {
      setBusy(false);
    }
  }
  onMount(() => {
    const timer = setInterval(() => void reconcile(), 5000);
    const online = () => void reconcile();
    window.addEventListener("online", online);
    onCleanup(() => {
      clearInterval(timer);
      clearTimeout(dismiss);
      window.removeEventListener("online", online);
    });
  });
  return (
    <div class="customer-app">
      <header class="customer-top">
        <h1 class="customer-store-name">
          <a href={location.pathname} title="메뉴 첫 화면">
            {live.data()?.settings.name ?? "메뉴"}
          </a>
        </h1>
        <div class="table-label">
          <MapPin size={13} />
          {live.data()?.table.name ?? "…"}번 테이블
        </div>
      </header>
      <Show
        when={live.data()}
        fallback={
          <div class="customer-loading">
            <For each={[1, 2, 3]}>
              {() => <div class="skeleton" style="height:120px;margin-bottom:15px" />}
            </For>
            <Show when={live.error()}>
              <p class="error-box">메뉴를 불러오지 못했어요. 연결을 확인해 주세요.</p>
              <Button onClick={() => void live.refresh()}>다시 불러오기</Button>
            </Show>
          </div>
        }
      >
        <Show when={pending()}>
          <div class="guest-notice">
            <Clock3 size={16} />
            <Show
              when={pendingIssue()}
              fallback={
                <span>주문 결과를 확인하고 있어요. 같은 주문을 다시 하지 않아도 돼요.</span>
              }
            >
              <span>
                이전 주문의 결과를 직원과 확인해 주세요. 확인 전에는 같은 주문을 다시 하지 마세요.
              </span>
              <Button variant="secondary" onClick={() => setResolveOpen(true)}>
                주문 확인
              </Button>
            </Show>
          </div>
        </Show>
        <Show when={live.connection() === "offline"}>
          <div class="guest-notice">
            <span>연결을 다시 확인하고 있어요. 담아둔 메뉴는 그대로 있어요.</span>
          </div>
        </Show>
        <Show when={live.data()?.ended}>
          <div class="visit-ended">
            <CheckCircle2 size={25} />
            <h3>함께해 주셔서 감사해요</h3>
            <p>이번 테이블 이용이 종료됐어요.</p>
            <Button variant="secondary" disabled={joinBusy()} onClick={() => void joinVisit(true)}>
              새 방문으로 입장
            </Button>
          </div>
        </Show>
        <Show when={!live.data()?.joined && !live.data()?.ended}>
          <div class="join-card">
            <Show
              when={live.data()?.pinRequired}
              fallback={
                <>
                  <p>{joinError() || "테이블을 확인하고 있어요."}</p>
                  <Show when={joinError()}>
                    <Button
                      variant="secondary"
                      disabled={joinBusy()}
                      onClick={() => void joinVisit()}
                    >
                      테이블 다시 확인
                    </Button>
                  </Show>
                </>
              }
            >
              <strong>테이블 입장코드를 입력해 주세요</strong>
              <small>직원이 안내한 6자리 숫자예요.</small>
              <form
                class="row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void joinVisit();
                }}
              >
                <input
                  aria-label="테이블 입장코드"
                  inputmode="numeric"
                  maxlength={6}
                  pattern="[0-9]{6}"
                  required
                  autocomplete="one-time-code"
                  value={code()}
                  onInput={(e) => setCode(e.currentTarget.value)}
                />
                <Button type="submit" disabled={joinBusy()}>
                  입장
                </Button>
              </form>
              <Show when={joinError()}>
                <p class="error-box">{joinError()}</p>
              </Show>
            </Show>
          </div>
        </Show>
        <Show when={live.data()?.joined && live.data()?.visit?.state === "settled"}>
          <div class="guest-notice">
            <CheckCircle2 size={17} />
            <span>정산이 완료됐어요. 추가 주문은 직원에게 말씀해 주세요.</span>
          </div>
        </Show>
        <Show when={!live.data()?.settings.acceptingOrders}>
          <div class="guest-notice">지금은 주문을 쉬고 있어요. 메뉴는 편하게 둘러보세요.</div>
        </Show>
        <Show
          when={tab() === "menu"}
          fallback={
            <section class="customer-history">
              <div class="customer-heading">
                <h2>우리 테이블 주문</h2>
                <p>함께 주문한 내역을 한눈에 확인해요.</p>
              </div>
              <Show when={lastOrder() && live.data()?.joined}>
                <div class="order-success">
                  <CheckCircle2 size={24} />
                  <div>
                    <strong>주문 #{lastOrder()} 접수됐어요</strong>
                    <span>잠시만 기다려 주세요. 정성껏 준비할게요.</span>
                  </div>
                </div>
              </Show>
              <Show
                when={live.data()?.orders.length}
                fallback={
                  <Empty
                    icon={<ClipboardList size={30} />}
                    title="아직 주문한 메뉴가 없어요"
                    description="메뉴를 골라 첫 주문을 해보세요."
                    action={<Button onClick={() => setTab("menu")}>메뉴 보러 가기</Button>}
                  />
                }
              >
                <For each={live.data()?.orders}>
                  {(o) => (
                    <article class="guest-order">
                      <div class="row between">
                        <strong>주문 #{o.number}</strong>
                        <Pill
                          tone={
                            o.items.every((i) => !remaining(i))
                              ? "neutral"
                              : o.acknowledgedAt
                                ? "teal"
                                : "orange"
                          }
                        >
                          {o.items.every((i) => !remaining(i))
                            ? o.items.every((i) => i.cancelled === i.quantity)
                              ? "취소됨"
                              : "음식 나감"
                            : o.acknowledgedAt
                              ? "준비 중"
                              : "주문 완료 · 확인 대기"}
                        </Pill>
                      </div>
                      <small>{time(o.createdAt)} 주문</small>
                      <div class="divider" />
                      <For each={o.items}>
                        {(item) => (
                          <div
                            class={`guest-order-line ${item.cancelled === item.quantity ? "cancelled" : ""}`}
                          >
                            <div class="row between">
                              <span>
                                {item.name} <strong>{item.quantity - item.cancelled}개</strong>
                              </span>
                              <strong>{won((item.quantity - item.cancelled) * item.price)}</strong>
                            </div>
                            <Show when={item.note}>
                              <small>{item.note}</small>
                            </Show>
                            <Show when={item.cancelled}>
                              <small>{item.cancelled}개 취소</small>
                            </Show>
                            <Show when={item.served}>
                              <small>{item.served}개 나갔어요</small>
                            </Show>
                          </div>
                        )}
                      </For>
                      <Show when={o.note}>
                        <p class="guest-order-note">요청사항 · {o.note}</p>
                      </Show>
                      <div class="guest-order-total">
                        주문 금액 <strong>{won(orderTotal(o.items))}</strong>
                      </div>
                    </article>
                  )}
                </For>
                <div class="guest-grand-total">
                  <span>우리 테이블 총 주문 금액</span>
                  <strong>{won(live.data()?.visit?.total ?? 0)}</strong>
                  <small>결제는 식사 후 매장에서 해주세요.</small>
                </div>
              </Show>
            </section>
          }
        >
          <Show when={live.data()?.settings.categoriesEnabled}>
            <nav class="customer-categories" aria-label="메뉴 카테고리">
              <button
                type="button"
                class={!category() ? "active" : ""}
                onClick={() => setCategory("")}
              >
                전체
              </button>
              <For each={live.data()?.categories}>
                {(c) => (
                  <button
                    type="button"
                    class={category() === c.id ? "active" : ""}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.name}
                  </button>
                )}
              </For>
            </nav>
          </Show>
          <div class="customer-search">
            <input
              aria-label="메뉴 이름 검색"
              placeholder="찾는 메뉴가 있나요?"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
          <div class="customer-menu">
            <Show
              when={visibleMenus().length}
              fallback={
                <Empty title="메뉴를 준비하고 있어요" description="잠시 후 다시 확인해 주세요." />
              }
            >
              <For each={groups()}>
                {(group) => (
                  <section class="menu-section">
                    <div class="menu-section-title">
                      <h2>{group.name}</h2>
                      <span>{group.menus.length}</span>
                    </div>
                    <For each={group.menus}>
                      {(menu) => (
                        <button
                          type="button"
                          class={`customer-menu-row ${menu.available ? "" : "sold-out"}`}
                          onClick={() => openMenu(menu)}
                        >
                          <div class="customer-menu-copy">
                            <Show when={menu.sort === 0 && menu.available}>
                              <span class="recommended">우리 매장 추천</span>
                            </Show>
                            <h3>{menu.name}</h3>
                            <p>{menu.description}</p>
                            <strong>{won(menu.price)}</strong>
                            <Show when={!menu.available}>
                              <span class="sold-out-label">오늘은 품절이에요</span>
                            </Show>
                          </div>
                          <div class="customer-menu-image">
                            <FoodImage src={menu.image} name={menu.name} />
                            <Show when={menu.available}>
                              <span class="add-circle">
                                <Plus size={18} />
                              </span>
                            </Show>
                          </div>
                        </button>
                      )}
                    </For>
                  </section>
                )}
              </For>
            </Show>
            <footer class="customer-footer">
              <small>주문 변경·취소는 직원에게 말씀해 주세요.</small>
            </footer>
          </div>
        </Show>
        <div class="customer-bottom">
          <Show when={count() > 0 && tab() === "menu"}>
            <button type="button" class="basket-bar" onClick={() => setCartOpen(true)}>
              <span class="basket-count">{count()}</span>
              <strong>장바구니 보기</strong>
              <span>{won(total())}</span>
              <ChevronRight size={18} />
            </button>
          </Show>
          <nav class="customer-nav" aria-label="손님 페이지">
            <button
              type="button"
              class={tab() === "menu" ? "active" : ""}
              onClick={() => setTab("menu")}
            >
              <UtensilsCrossed size={19} />
              메뉴
            </button>
            <button
              type="button"
              class={tab() === "history" ? "active" : ""}
              onClick={() => {
                setTab("history");
                void live.refresh();
              }}
            >
              <ClipboardList size={20} />
              주문 내역
              <Show when={live.data()?.orders.length}>
                <span>{live.data()?.orders.length}</span>
              </Show>
            </button>
          </nav>
        </div>
        <Modal open={!!selected()} title="메뉴 자세히 보기" onClose={() => setSelected(undefined)}>
          <Show when={selected()}>
            {(menu) => (
              <div class="stack">
                <div class="detail-food">
                  <FoodImage src={menu().image} name={menu().name} />
                </div>
                <h2>{menu().name}</h2>
                <p class="muted">{menu().description}</p>
                <strong class="detail-price">{won(menu().price)}</strong>
                <div class="divider" />
                <div class="row between">
                  <strong>수량</strong>
                  <Quantity value={quantity()} onChange={setQuantity} />
                </div>
                <Field label="메뉴 요청사항 (선택)">
                  <input
                    maxlength={500}
                    value={itemNote()}
                    onInput={(e) => setItemNote(e.currentTarget.value)}
                    placeholder="예: 덜 맵게 해주세요"
                  />
                </Field>
                <Button
                  class="block"
                  disabled={!menu().available || !availableToOrder() || !!pending()}
                  onClick={addMenu}
                >
                  {!menu().available
                    ? "오늘은 품절이에요"
                    : !availableToOrder()
                      ? "테이블 입장 후 담을 수 있어요"
                      : `${won(menu().price * quantity())} 담기`}
                </Button>
              </div>
            )}
          </Show>
        </Modal>
        <Modal
          open={cartOpen()}
          title="주문 전 확인해 주세요"
          onClose={() => !busy() && setCartOpen(false)}
          busy={busy()}
        >
          <div class="stack">
            <Pill tone="teal">{live.data()?.table.name}번 테이블</Pill>
            <For each={cart()}>
              {(line) => (
                <div class="cart-line">
                  <div class="row between">
                    <h3>{line.name}</h3>
                    <button
                      type="button"
                      class="icon-btn"
                      aria-label={`${line.name} 장바구니에서 삭제`}
                      disabled={busy() || !!pending()}
                      onClick={() => setCart((old) => old.filter((l) => l.key !== line.key))}
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <Show when={line.note}>
                    <p class="muted">{line.note}</p>
                  </Show>
                  <div class="row between">
                    <Quantity
                      min={1}
                      value={line.quantity}
                      disabled={busy() || !!pending()}
                      onChange={(n) =>
                        setCart((old) =>
                          old.map((l) => (l.key === line.key ? { ...l, quantity: n } : l)),
                        )
                      }
                    />
                    <strong>{won(line.price * line.quantity)}</strong>
                  </div>
                  <Show when={!live.data()?.menus.find((m) => m.id === line.menuId)?.available}>
                    <p class="error-box">지금은 주문할 수 없는 메뉴예요. 장바구니에서 빼주세요.</p>
                  </Show>
                  <Show
                    when={
                      live.data()?.menus.find((m) => m.id === line.menuId)?.price !== line.price
                    }
                  >
                    <p class="error-box">
                      현재 가격{" "}
                      {won(live.data()?.menus.find((m) => m.id === line.menuId)?.price ?? 0)} · 기존
                      담은 가격과 달라요.
                    </p>
                  </Show>
                </div>
              )}
            </For>
            <Show when={priceChanged() && !pending()}>
              <Button
                variant="secondary"
                onClick={() =>
                  setCart((old) =>
                    old.map((l) => ({
                      ...l,
                      price: live.data()?.menus.find((m) => m.id === l.menuId)?.price ?? l.price,
                    })),
                  )
                }
              >
                변경된 가격으로 다시 확인
              </Button>
            </Show>
            <Field label="주문 요청사항 (선택)">
              <textarea
                maxlength={500}
                disabled={busy() || !!pending()}
                value={orderNote()}
                onInput={(e) => setOrderNote(e.currentTarget.value)}
                placeholder="직원에게 전할 내용이 있다면 남겨주세요."
              />
            </Field>
            <Show when={submitError()}>
              <div role="alert" class="error-box">
                {submitError()}
              </div>
            </Show>
            <div class="row between cart-total">
              <span>총 주문 금액</span>
              <strong>{won(total())}</strong>
            </div>
            <p class="muted" style="font-size:12px">
              이 테이블로 주문을 보내요. 결제는 식사 후 매장에서 해주세요.
            </p>
            <Button
              class="block"
              disabled={
                busy() ||
                !!pending() ||
                !count() ||
                !availableToOrder() ||
                priceChanged() ||
                unavailable()
              }
              onClick={() => void submit()}
            >
              {pending()
                ? "주문 결과 확인 중…"
                : busy()
                  ? "주문 보내는 중…"
                  : `${won(total())} 주문하기`}
            </Button>
          </div>
        </Modal>
      </Show>
      <Show when={message()}>
        <div class="toast customer-toast" role="status">
          <Check size={17} />
          {message()}
        </div>
      </Show>
      <Modal
        open={resolveOpen()}
        title="직원과 주문을 확인해 주세요"
        onClose={() => setResolveOpen(false)}
      >
        <p>
          입장 정보가 바뀌어 이전 주문의 결과를 자동으로 확인할 수 없어요. 직원에게 주문 시각과 담은
          메뉴를 보여주세요.
        </p>
        <p class="info-box">
          {pending() ? time(pending()?.submittedAt ?? "") : ""} · 확인 번호{" "}
          {pending()?.request.requestId.slice(0, 8)}
        </p>
        <For each={cart()}>
          {(line) => (
            <p>
              {line.name} {line.quantity}개
            </p>
          )}
        </For>
        <Button
          onClick={() => {
            setPending(null);
            setPendingIssue(false);
            setResolveOpen(false);
            setCart([]);
            setOrderNote("");
            tell("확인을 마쳤어요. 필요한 메뉴만 새로 담아 주세요.");
          }}
        >
          직원과 처리 결과를 확인했어요
        </Button>
      </Modal>
    </div>
  );
}
