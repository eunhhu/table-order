import { type Action, type Menu, remaining, type Visit, won } from "@table/contracts";
import { Button, CheckField, Empty, Field, FoodImage, Modal, Pill, Quantity } from "@table/ui";
import { createRememberedString, minutes } from "@table/ui/client";
import {
  ArrowRightLeft,
  Check,
  CreditCard,
  LayoutGrid,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Users,
  Wallet,
  X,
} from "lucide-solid";
import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { useAdmin } from "./context";
import { OrderCard } from "./OrdersPage";

export function TablesPage() {
  const ctx = useAdmin();
  const preference = `ongi-floor:${ctx.data().staff.id}`;
  const [zone, setZone] = createRememberedString(`${preference}:zone`);
  const [filter, setFilter] = createRememberedString(`${preference}:filter`, "all");
  const [search, setSearch] = createRememberedString(`${preference}:search`);
  if (!["all", "occupied", "new", "unserved", "unpaid", "empty"].includes(filter()))
    setFilter("all");
  const [selected, setSelected] = createSignal<string>();
  const data = ctx.data;
  const tableVisit = (id: string) => data().visits.find((v) => v.tableId === id);
  const orders = (id: string) => data().orders.filter((o) => o.visitId === tableVisit(id)?.id);
  const isNew = (id: string) =>
    orders(id).some((o) => !o.acknowledgedAt && o.items.some((i) => remaining(i)));
  const left = (id: string) =>
    orders(id)
      .flatMap((o) => o.items)
      .reduce((sum, i) => sum + remaining(i), 0);
  const filtered = createMemo(() =>
    data().tables.filter(
      (t) =>
        (!zone() || t.zoneId === zone()) &&
        (!search() || t.name.includes(search())) &&
        (filter() === "all" ||
          (filter() === "new" && isNew(t.id)) ||
          (filter() === "occupied" && t.state === "occupied") ||
          (filter() === "unserved" && left(t.id) > 0) ||
          (filter() === "unpaid" && tableVisit(t.id)?.state === "open") ||
          (filter() === "empty" && t.state !== "occupied")),
    ),
  );
  const stats = () => [
    {
      label: "손님 있는 테이블",
      value: data().tables.filter((t) => t.state === "occupied").length,
      suffix: `/ ${data().tables.length}`,
      icon: LayoutGrid,
      tone: "teal",
      caption: "QR 진입부터 정산·퇴석 전까지",
    },
    {
      label: "확인할 새 주문",
      value: data().orders.filter((o) => !o.acknowledgedAt && o.items.some((i) => remaining(i)))
        .length,
      suffix: "건",
      icon: ShoppingBag,
      tone: "orange",
      caption: "기다리는 주문을 확인해 주세요",
    },
    {
      label: "아직 나가지 않은 음식",
      value: data()
        .orders.flatMap((o) => o.items)
        .reduce((sum, i) => sum + remaining(i), 0),
      suffix: "개",
      icon: Sparkles,
      tone: "blue",
      caption: "따뜻하게 준비하고 있어요",
    },
    {
      label: "현재 미정산 금액",
      value: data()
        .visits.filter((v) => v.state === "open")
        .reduce((sum, v) => sum + v.total, 0)
        .toLocaleString(),
      suffix: "원",
      icon: Wallet,
      tone: "neutral",
      caption: "이용 중인 테이블 합계",
    },
  ];
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">YOUR FLOOR, AT A GLANCE</div>
          <h1>한눈에 보는 우리 매장</h1>
          <p>테이블을 살펴보고, 필요한 일을 가볍게 처리하세요.</p>
        </div>
        <div class="row">
          <span class="live-dot" />
          <span class="muted">주문이 자동으로 반영돼요</span>
        </div>
      </div>
      <div class="stats-grid">
        <For each={stats()}>
          {(stat) => (
            <div class="stat-card">
              <div class="row between">
                <span class="stat-label">{stat.label}</span>
                <span class={`stat-icon ${stat.tone}`}>
                  <stat.icon size={18} />
                </span>
              </div>
              <div class="stat-value">
                {stat.value}
                <span>{stat.suffix}</span>
              </div>
              <small>{stat.caption}</small>
            </div>
          )}
        </For>
      </div>
      <section class="floor-section">
        <div class="row between section-head">
          <div class="row">
            <h2>테이블 현황</h2>
            <span class="muted">{data().tables.length}</span>
          </div>
          <div class="search-box">
            <Search size={17} />
            <input
              aria-label="테이블 번호 검색"
              inputmode="numeric"
              placeholder="테이블 번호 검색"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
            />
          </div>
        </div>
        <div class="tabs">
          <button type="button" class={!zone() ? "active" : ""} onClick={() => setZone("")}>
            전체 구역
          </button>
          <For each={data().zones}>
            {(z) => (
              <button
                type="button"
                class={zone() === z.id ? "active" : ""}
                onClick={() => setZone(z.id)}
              >
                {z.name}
              </button>
            )}
          </For>
        </div>
        <div class="row between filter-row">
          <div class="chips">
            <For
              each={[
                { id: "all", label: "전체" },
                { id: "occupied", label: "손님 있음" },
                { id: "new", label: "새 주문" },
                { id: "unserved", label: "미서빙" },
                { id: "unpaid", label: "미정산" },
                { id: "empty", label: "빈 테이블" },
              ]}
            >
              {(f) => (
                <button
                  type="button"
                  class={`chip ${filter() === f.id ? "active" : ""}`}
                  onClick={() => setFilter(f.id)}
                >
                  {f.label}
                </button>
              )}
            </For>
          </div>
          <div class="legend">
            <span>
              <i class="dot teal" />
              손님 있음
            </span>
            <span>
              <i class="dot orange" />새 주문
            </span>
            <span>
              <i class="dot gray" />빈 테이블
            </span>
          </div>
        </div>
        <Show
          when={filtered().length}
          fallback={
            <Empty
              title={
                data().tables.length ? "해당하는 테이블이 없어요" : "첫 테이블을 준비해 볼까요?"
              }
              description={
                data().tables.length
                  ? "구역이나 검색 조건을 바꿔보세요."
                  : "매장 설정에서 테이블을 추가하고 QR을 출력해 주세요."
              }
            />
          }
        >
          <div class="tables-grid">
            <For each={filtered()}>
              {(table) => (
                <article class={`table-card ${table.state} ${isNew(table.id) ? "has-new" : ""}`}>
                  <button type="button" class="table-main" onClick={() => setSelected(table.id)}>
                    <div class="row between">
                      <span class="table-number">{table.name}</span>
                      <Pill
                        tone={
                          isNew(table.id)
                            ? "orange"
                            : table.state === "occupied"
                              ? "teal"
                              : "neutral"
                        }
                      >
                        {isNew(table.id)
                          ? "새 주문"
                          : table.state !== "occupied"
                            ? "빈 테이블"
                            : "손님 있음"}
                      </Pill>
                    </div>
                    <small class="table-zone">
                      {data().zones.find((z) => z.id === table.zoneId)?.name ?? "홀"}
                    </small>
                    <Show
                      when={tableVisit(table.id)}
                      fallback={<div class="empty-table-caption">QR 스캔을 기다리고 있어요</div>}
                    >
                      {(v) => (
                        <>
                          <div class="table-meta">
                            <span>
                              <Users size={13} />
                              {v().guests ? `${v().guests}명` : "인원 미입력"}
                            </span>
                            <span>{minutes(v().startedAt)}분 이용</span>
                          </div>
                          <div class="table-amount">{won(v().total)}</div>
                        </>
                      )}
                    </Show>
                  </button>
                  <footer class="table-card-bottom">
                    <Show when={table.state === "occupied"}>
                      <button type="button" onClick={() => setSelected(table.id)}>
                        {!orders(table.id).length ? (
                          <>첫 주문 대기</>
                        ) : left(table.id) ? (
                          <>
                            <span class="dot orange" />
                            나갈 음식 {left(table.id)}개
                          </>
                        ) : (
                          <>
                            <Check size={14} />
                            모두 나갔어요
                          </>
                        )}
                        <span class="arrow">→</span>
                      </button>
                    </Show>
                  </footer>
                </article>
              )}
            </For>
          </div>
        </Show>
      </section>
      <Show when={selected()}>
        {(id) => <TableDetail tableId={id()} onClose={() => setSelected(undefined)} />}
      </Show>
    </>
  );
}

function TableDetail(props: { tableId: string; onClose: () => void }) {
  const ctx = useAdmin();
  const data = ctx.data;
  const table = () => data().tables.find((t) => t.id === props.tableId);
  const visit = () => data().visits.find((v) => v.tableId === props.tableId);
  const orders = () => data().orders.filter((o) => o.visitId === visit()?.id);
  const [add, setAdd] = createSignal<string>();
  const [move, setMove] = createSignal(false);
  const [quote, setQuote] = createSignal<Visit>();
  const [closing, setClosing] = createSignal<Visit>();
  let drawer!: HTMLDialogElement;
  onMount(() => drawer.showModal());
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Native dialog supports Escape and the visible close button. */}
      <dialog
        ref={drawer}
        class="table-drawer"
        aria-label={`${table()?.name}번 테이블 상세`}
        onCancel={(e) => {
          e.preventDefault();
          if (!ctx.busy()) props.onClose();
        }}
        onClick={(e) => {
          if (e.target === drawer && e.clientX < drawer.getBoundingClientRect().left && !ctx.busy())
            props.onClose();
        }}
      >
        <header class="drawer-head">
          <div>
            <small>{data().zones.find((z) => z.id === table()?.zoneId)?.name ?? "홀"}</small>
            <h2>{table()?.name}번 테이블</h2>
          </div>
          <button type="button" class="icon-btn" aria-label="상세 닫기" onClick={props.onClose}>
            <X size={22} />
          </button>
        </header>
        <Show
          when={visit()}
          fallback={
            <Empty
              title="빈 테이블이에요"
              description="손님이 QR을 스캔하면 자동으로 손님 있음 상태로 바뀌어요."
            />
          }
        >
          {(v) => (
            <>
              <div class="drawer-scroll">
                <div class="visit-summary">
                  <div class="row between">
                    <Pill tone="teal">손님 있음</Pill>
                    <span class="muted">{minutes(v().startedAt)}분 이용</span>
                  </div>
                  <div class="row between guest-selector">
                    <span class="muted">
                      <Users size={15} />
                      인원
                    </span>
                    <div class="chips">
                      <For each={[1, 2, 3, 4, 5, 6]}>
                        {(n) => (
                          <button
                            type="button"
                            disabled={ctx.busy()}
                            class={`number-chip ${v().guests === n ? "active" : ""}`}
                            onClick={() =>
                              void ctx.run({ type: "visit.guests", visitId: v().id, guests: n })
                            }
                          >
                            {n}
                          </button>
                        )}
                      </For>
                      <button
                        type="button"
                        class="number-chip"
                        disabled={ctx.busy()}
                        aria-label="인원 1명 늘리기"
                        onClick={() =>
                          void ctx.run({
                            type: "visit.guests",
                            visitId: v().id,
                            guests: (v().guests ?? 6) + 1,
                          })
                        }
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
                <div class="row between drawer-section-head">
                  <h3>
                    이번 방문의 주문 <span class="muted">{orders().length}</span>
                  </h3>
                  <Button
                    variant="secondary"
                    class="small"
                    icon={<Plus size={14} />}
                    disabled={ctx.busy() || v().state !== "open"}
                    onClick={() => setAdd(v().id)}
                  >
                    주문 추가
                  </Button>
                </div>
                <Show
                  when={orders().length}
                  fallback={
                    <Empty
                      title="아직 주문이 없어요"
                      description="손님이 QR로 주문하거나 직원이 직접 추가할 수 있어요."
                    />
                  }
                >
                  <div class="stack">
                    <For each={orders()}>{(o) => <OrderCard order={o} compact />}</For>
                  </div>
                </Show>
              </div>
              <footer class="drawer-footer">
                <div class="row between total-row">
                  <span>주문 합계</span>
                  <strong>{won(v().total ?? 0)}</strong>
                </div>
                <div class="row">
                  <Button
                    variant="secondary"
                    icon={<ArrowRightLeft size={17} />}
                    disabled={ctx.busy()}
                    onClick={() => setMove(true)}
                  >
                    이동
                  </Button>
                  <Show
                    when={orders().length === 0 && v().state === "open"}
                    fallback={
                      <Button
                        class="grow"
                        icon={<CreditCard size={17} />}
                        disabled={ctx.busy()}
                        onClick={() => setQuote({ ...v() })}
                      >
                        정산하고 테이블 비우기
                      </Button>
                    }
                  >
                    <Button
                      class="grow"
                      variant="secondary"
                      disabled={ctx.busy()}
                      onClick={() => setClosing({ ...v() })}
                    >
                      주문 없이 테이블 비우기
                    </Button>
                  </Show>
                </div>
              </footer>
            </>
          )}
        </Show>
      </dialog>
      <Show when={add()} keyed>
        {(visitId) => <NewOrder open visitId={visitId} onClose={() => setAdd(undefined)} />}
      </Show>
      <Modal
        open={move()}
        title="어느 테이블로 옮길까요?"
        onClose={() => setMove(false)}
        busy={ctx.busy()}
      >
        <div class="move-grid">
          <For each={data().tables.filter((t) => t.state === "empty")}>
            {(t) => (
              <Button
                variant="secondary"
                disabled={ctx.busy()}
                onClick={async () => {
                  const current = visit();
                  if (!current) return;
                  const result = await ctx.run(
                    {
                      type: "visit.move",
                      visitId: current.id,
                      tableId: t.id,
                      version: current.version,
                    },
                    `${t.name}번 테이블로 옮겼어요.`,
                  );
                  if (result) {
                    setMove(false);
                    props.onClose();
                  }
                }}
              >
                {t.name}번
              </Button>
            )}
          </For>
        </div>
        <Show when={!data().tables.some((t) => t.state === "empty")}>
          <Empty title="이동할 빈 테이블이 없어요" />
        </Show>
      </Modal>
      <Modal
        open={!!closing()}
        title="주문 없이 방문을 종료할까요?"
        onClose={() => setClosing(undefined)}
        busy={ctx.busy()}
      >
        <Show when={closing()}>
          {(q) => (
            <div class="stack">
              <p class="info-box">
                수납 기록을 남기지 않고 테이블을 비워요. 손님이 퇴장했는지 확인해 주세요. 기존
                손님의 메뉴 페이지는 종료돼요.
              </p>
              <Show when={q().version !== visit()?.version || orders().length > 0}>
                <p class="error-box">
                  방문이나 주문 내용이 바뀌었어요. 닫고 최신 내용을 확인해 주세요.
                </p>
              </Show>
              <Button
                variant="danger"
                disabled={
                  ctx.busy() ||
                  q().id !== visit()?.id ||
                  q().version !== visit()?.version ||
                  visit()?.state !== "open" ||
                  orders().length > 0
                }
                onClick={async () => {
                  const result = await ctx.run(
                    { type: "visit.close", visitId: q().id, version: q().version },
                    "수납 기록 없이 방문을 종료했어요.",
                  );
                  if (result) {
                    setClosing(undefined);
                    props.onClose();
                  }
                }}
              >
                퇴장 확인 · 테이블 비우기
              </Button>
            </div>
          )}
        </Show>
      </Modal>
      <Modal
        open={!!quote()}
        title={`${table()?.name}번 테이블 정산`}
        onClose={() => setQuote(undefined)}
        busy={ctx.busy()}
      >
        <Show when={quote()}>
          {(q) => (
            <div class="stack">
              <div class="settle-amount">
                <small>현장에서 받은 금액을 기록해요</small>
                <strong>{won(q().total)}</strong>
              </div>
              <Show when={q().version !== visit()?.version}>
                <div class="error-box">
                  주문 내용이 바뀌었어요. 새 금액은 {won(visit()?.total ?? 0)}이에요.
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const current = visit();
                    setQuote(current ? { ...current } : undefined);
                  }}
                >
                  최신 주문과 금액 확인
                </Button>
              </Show>
              <div class="info-box">수납 기록을 남기면 테이블이 바로 빈 상태로 바뀌어요.</div>
              <div class="payment-buttons">
                <For
                  each={
                    [
                      { id: "card", name: "카드" },
                      { id: "cash", name: "현금" },
                      { id: "transfer", name: "계좌이체" },
                      { id: "other", name: "기타" },
                    ] as const
                  }
                >
                  {(method) => (
                    <Button
                      disabled={ctx.busy() || q().version !== visit()?.version}
                      variant={method.id === "card" ? "primary" : "secondary"}
                      onClick={async () => {
                        const result = await ctx.run(
                          {
                            type: "payment.settle",
                            visitId: q().id,
                            version: q().version,
                            method: method.id,
                            close: true,
                          },
                          "수납을 기록했어요.",
                        );
                        if (result) {
                          setQuote(undefined);
                          props.onClose();
                        }
                      }}
                    >
                      {method.name}
                      {method.id === "cash" ? "으로" : "로"} 정산 완료
                    </Button>
                  )}
                </For>
              </div>
              <small>
                실제 결제 기능이 아닌 수납 기록이에요. 매장 단말기나 현금 수납을 먼저 완료해 주세요.
              </small>
            </div>
          )}
        </Show>
      </Modal>
    </>
  );
}

function NewOrder(props: { open: boolean; visitId: string; onClose: () => void }) {
  const ctx = useAdmin();
  const [counts, setCounts] = createSignal<Record<string, number>>({});
  const [custom, setCustom] = createSignal(false);
  const [name, setName] = createSignal("");
  const [price, setPrice] = createSignal(0);
  const [note, setNote] = createSignal("");
  const [late, setLate] = createSignal(false);
  const [lateTime, setLateTime] = createSignal(
    new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  );
  const [lateReason, setLateReason] = createSignal<"연결 장애" | "단말 문제" | "종이 주문 이관">(
    "연결 장애",
  );
  const menus = () => ctx.live.data()?.menus.filter((m) => m.available) ?? [];
  const total = () =>
    menus().reduce((sum, m) => sum + m.price * (counts()[m.id] ?? 0), 0) + (custom() ? price() : 0);
  const change = (menu: Menu, n: number) =>
    setCounts((previous) => ({ ...previous, [menu.id]: n }));
  return (
    <Modal open={props.open} title="직원 주문 추가" onClose={props.onClose} busy={ctx.busy()} wide>
      <div class="staff-menu-list">
        <For each={menus()}>
          {(m) => (
            <div class="staff-menu-row">
              <div class="staff-menu-photo">
                <FoodImage src={m.image} name={m.name} />
              </div>
              <div class="grow">
                <strong>{m.name}</strong>
                <small>{won(m.price)}</small>
              </div>
              <Quantity min={0} value={counts()[m.id] ?? 0} onChange={(n) => change(m, n)} />
            </div>
          )}
        </For>
      </div>
      <div class="divider" />
      <Button variant="ghost" icon={<Plus size={16} />} onClick={() => setCustom(!custom())}>
        메뉴에 없는 항목 직접 추가
      </Button>
      <Show when={custom()}>
        <div class="form-grid">
          <Field label="항목 이름">
            <input value={name()} onInput={(e) => setName(e.currentTarget.value)} />
          </Field>
          <Field label="가격 (원)">
            <input
              type="number"
              min="0"
              value={price()}
              onInput={(e) => setPrice(Number(e.currentTarget.value))}
            />
          </Field>
        </div>
      </Show>
      <Field label="요청사항 (선택)">
        <input
          value={note()}
          maxlength={500}
          onInput={(e) => setNote(e.currentTarget.value)}
          placeholder="필요할 때만 남겨 주세요"
        />
      </Field>
      <div class="modal-footer">
        <Button
          disabled={
            ctx.busy() ||
            (late() && !Number.isFinite(Date.parse(lateTime()))) ||
            (!Object.values(counts()).some(Boolean) && !(custom() && name()))
          }
          onClick={async () => {
            const action: Action = {
              type: "order.create",
              visitId: props.visitId,
              lines: menus()
                .filter((m) => counts()[m.id])
                .map((m) => ({
                  menuId: m.id,
                  quantity: counts()[m.id],
                  expectedPrice: m.price,
                  note: "",
                })),
              custom:
                custom() && name() ? [{ name: name(), price: price(), quantity: 1, note: "" }] : [],
              note: note(),
              recovery: late()
                ? { orderedAt: new Date(lateTime()).toISOString(), reason: lateReason() }
                : undefined,
            };
            if (await ctx.run(action, "주문을 추가했어요.")) {
              setCounts({});
              setName("");
              setPrice(0);
              setNote("");
              setCustom(false);
              setLate(false);
              props.onClose();
            }
          }}
        >
          {won(total())} 주문 추가
        </Button>
      </div>
      <CheckField
        checked={late()}
        onChange={setLate}
        label="이전에 받은 종이 주문 기록"
        detail="연결 장애 중 받은 주문을 나중에 기록할 때만 켜주세요."
      />
      <Show when={late()}>
        <div class="stack">
          <p class="info-box">
            이 테이블에 같은 주문이 이미 들어왔는지 먼저 확인해 주세요. 실제 주문 시각과 지금 기록한
            시각을 함께 남겨요.
          </p>
          <Field label="실제 주문 받은 시각">
            <input
              type="datetime-local"
              value={lateTime()}
              onChange={(e) => setLateTime(e.currentTarget.value)}
            />
          </Field>
          <div class="chips">
            <For each={["연결 장애", "단말 문제", "종이 주문 이관"] as const}>
              {(reason) => (
                <button
                  type="button"
                  class={`chip ${lateReason() === reason ? "active" : ""}`}
                  onClick={() => setLateReason(reason)}
                >
                  {reason}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>
    </Modal>
  );
}
