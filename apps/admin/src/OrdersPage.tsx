import { type Item, type Order, remaining, won } from "@table/contracts";
import { Button, Empty, Modal, Pill, Quantity } from "@table/ui";
import { createRememberedString, minutes, time } from "@table/ui/client";
import { Check, CheckCheck, Clock3, CookingPot } from "lucide-solid";
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js";
import { useAdmin } from "./context";

export function OrderCard(props: { order: Order; compact?: boolean; tableName?: string }) {
  const ctx = useAdmin();
  const [target, setTarget] = createSignal<{
    item: Item;
    type: "item.cancel" | "item.serve" | "item.prepare";
    version: number;
  }>();
  const [quantity, setQuantity] = createSignal(1);
  const [reason, setReason] = createSignal("손님 요청");
  const left = () => props.order.items.reduce((sum, i) => sum + remaining(i), 0);
  const state = () =>
    props.order.items.every((i) => i.quantity === i.cancelled)
      ? "전체 취소"
      : !left()
        ? "음식 나감"
        : props.order.acknowledgedAt
          ? "준비 중"
          : "새 주문";
  const open = (item: Item, type: "item.cancel" | "item.serve" | "item.prepare") => {
    setQuantity(type === "item.cancel" ? 1 : Math.max(1, remaining(item)));
    setReason("손님 요청");
    setTarget({ item, type, version: props.order.version });
  };
  const offerUndo = (data: unknown) => {
    const undo = (
      data as {
        undo?: {
          orderId: string;
          version: number;
          quantities: { itemId: string; quantity: number }[];
        };
      }
    )?.undo;
    if (undo?.quantities.length)
      ctx.notify({
        message: "음식 나감을 기록했어요.",
        action: () => {
          void ctx.run({ type: "serve.undo", ...undo }, "서빙 기록을 되돌렸어요.");
        },
        actionLabel: "되돌리기",
      });
  };
  return (
    <article class={`order-card ${!props.order.acknowledgedAt && left() ? "new" : ""}`}>
      <header class="order-card-head">
        <div>
          <div class="row">
            <Show when={props.tableName}>
              <strong class="order-table">
                {props.tableName}
                <small>번 테이블</small>
              </strong>
            </Show>
            <Pill
              tone={state() === "새 주문" ? "orange" : state() === "준비 중" ? "teal" : "neutral"}
            >
              {state()}
            </Pill>
          </div>
          <span class="order-meta">
            주문 #{String(props.order.number).padStart(3, "0")} ·{" "}
            {time(props.order.orderedAt ?? props.order.createdAt)}
            {props.order.source === "staff" ? " · 직원 추가" : ""}
          </span>
        </div>
        <span class={`wait-time ${minutes(props.order.createdAt) >= 15 && left() ? "long" : ""}`}>
          <Clock3 size={13} />
          {minutes(props.order.createdAt)}분
        </span>
      </header>
      <Show when={props.order.recordedReason}>
        <div class="order-note">
          사후 입력 · {props.order.recordedReason} · 기록 {time(props.order.createdAt)}
        </div>
      </Show>
      <Show when={props.order.note}>
        <div class="order-note">요청 · {props.order.note}</div>
      </Show>
      <div class="order-lines">
        <For each={props.order.items}>
          {(item) => (
            <div class={`order-line ${item.cancelled === item.quantity ? "cancelled" : ""}`}>
              <div class="row between">
                <strong>{item.name}</strong>
                <strong class="line-quantity">
                  {item.quantity - item.cancelled}
                  <small>개</small>
                </strong>
              </div>
              <Show when={item.note}>
                <p class="muted item-note">{item.note}</p>
              </Show>
              <div class="row between item-bottom">
                <small>
                  {won(item.price)}
                  {item.cancelled ? ` · ${item.cancelled}개 취소` : ""}
                  {item.served ? ` · ${item.served}개 나감` : ""}
                  {ctx.live.data()?.settings.advancedKitchen && item.prepared
                    ? ` · ${item.prepared}개 조리 완료`
                    : ""}
                </small>
                <div class="item-actions">
                  <Show when={item.quantity > item.cancelled}>
                    <button
                      type="button"
                      disabled={ctx.busy()}
                      onClick={() => open(item, "item.cancel")}
                    >
                      취소
                    </button>
                  </Show>
                  <Show when={props.order.acknowledgedAt && remaining(item) > 0}>
                    <Show when={ctx.live.data()?.settings.advancedKitchen}>
                      <button
                        type="button"
                        disabled={ctx.busy() || item.prepared >= item.quantity - item.cancelled}
                        onClick={() => open(item, "item.prepare")}
                      >
                        조리
                      </button>
                    </Show>
                    <button
                      type="button"
                      disabled={ctx.busy()}
                      onClick={() => open(item, "item.serve")}
                    >
                      수량별 나감
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          )}
        </For>
      </div>
      <footer class="order-card-footer">
        <Show
          when={left() > 0}
          fallback={
            <span class="order-done">
              <CheckCheck size={16} />
              모두 처리했어요
            </span>
          }
        >
          <Show
            when={props.order.acknowledgedAt}
            fallback={
              <Button
                class="block"
                disabled={ctx.busy()}
                icon={<Check size={17} />}
                onClick={() =>
                  void ctx.run({ type: "order.ack", orderId: props.order.id }, "주문을 확인했어요.")
                }
              >
                확인 · 준비할게요
              </Button>
            }
          >
            <Button
              class="block"
              disabled={ctx.busy()}
              variant="secondary"
              icon={<CheckCheck size={17} />}
              onClick={async () => {
                const result = await ctx.run({
                  type: "order.serve",
                  orderId: props.order.id,
                  version: props.order.version,
                });
                if (result) offerUndo(result.data);
              }}
            >
              음식 나감 <span class="muted">{left()}개</span>
            </Button>
          </Show>
        </Show>
        <Show when={props.order.acknowledgedBy}>
          <small class="ack-by">{props.order.acknowledgedBy} 확인</small>
        </Show>
      </footer>
      <Modal
        open={!!target()}
        title={
          target()?.type === "item.cancel"
            ? "주문 취소"
            : target()?.type === "item.prepare"
              ? "조리 완료"
              : "음식 나감"
        }
        onClose={() => setTarget(undefined)}
        busy={ctx.busy()}
      >
        <Show when={target()}>
          {(t) => (
            <div class="stack">
              <h3>{t().item.name}</h3>
              <div class="row between">
                <span>수량</span>
                <Quantity
                  value={quantity()}
                  max={
                    t().type === "item.cancel"
                      ? t().item.quantity - t().item.cancelled
                      : t().type === "item.prepare"
                        ? Math.max(1, t().item.quantity - t().item.cancelled - t().item.prepared)
                        : remaining(t().item)
                  }
                  onChange={setQuantity}
                />
              </div>
              <Show when={t().type === "item.cancel"}>
                <div class="chips">
                  <For each={["손님 요청", "잘못 주문", "품절", "서비스 처리"]}>
                    {(r) => (
                      <button
                        type="button"
                        class={`chip ${reason() === r ? "active" : ""}`}
                        onClick={() => setReason(r)}
                      >
                        {r}
                      </button>
                    )}
                  </For>
                </div>
                <div class="info-box">
                  {won(t().item.price * quantity())}이 주문 합계에서 빠져요.
                  <Show when={t().item.served > 0}>
                    <br />
                    이미 나간 음식의 기록은 그대로 남아요.
                  </Show>
                </div>
              </Show>
              <Button
                disabled={ctx.busy()}
                variant={t().type === "item.cancel" ? "danger" : "primary"}
                onClick={async () => {
                  const value = t();
                  const result = await ctx.run(
                    {
                      type: value.type,
                      itemId: value.item.id,
                      quantity: quantity(),
                      reason: reason(),
                      version: value.version,
                    } as import("@table/contracts").Action,
                    value.type === "item.cancel" ? "선택한 수량을 취소했어요." : "처리했어요.",
                  );
                  if (result) {
                    if (value.type === "item.serve") offerUndo(result.data);
                    setTarget(undefined);
                  }
                }}
              >
                {quantity()}개{" "}
                {t().type === "item.cancel"
                  ? "취소하기"
                  : t().type === "item.prepare"
                    ? "조리 완료"
                    : "음식 나감"}
              </Button>
            </div>
          )}
        </Show>
      </Modal>
    </article>
  );
}
export function OrdersPage() {
  const ctx = useAdmin();
  const preference = `ongi-kitchen:${ctx.data().staff.id}`;
  const [filter, setFilter] = createRememberedString(`${preference}:filter`, "pending");
  const [zone, setZone] = createRememberedString(`${preference}:zone`);
  const [category, setCategory] = createRememberedString(`${preference}:category`);
  const [tick, setTick] = createSignal(0);
  const timer = setInterval(() => setTick((v) => v + 1), 30000);
  onCleanup(() => clearInterval(timer));
  const all = () => ctx.live.data()?.orders ?? [];
  const visible = createMemo(() => {
    tick();
    const data = ctx.live.data();
    return all().filter((o) => {
      const table = data?.tables.find(
        (t) => t.id === data.visits.find((v) => v.id === o.visitId)?.tableId,
      );
      const left = o.items.some((i) => remaining(i) > 0);
      return (
        (!zone() || table?.zoneId === zone()) &&
        (!category() || o.items.some((i) => i.category === category())) &&
        (filter() === "all" ||
          (filter() === "pending" && left) ||
          (filter() === "new" && !o.acknowledgedAt && left) ||
          (filter() === "cooking" && !!o.acknowledgedAt && left))
      );
    });
  });
  const newCount = () =>
    all().filter((o) => !o.acknowledgedAt && o.items.some((i) => remaining(i) > 0)).length;
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">KITCHEN & ORDERS</div>
          <h1>주문 · 주방</h1>
          <p>확인하고, 준비하고, 따뜻할 때 내어주세요.</p>
        </div>
        <Pill tone="orange">
          <CookingPot size={14} />
          확인할 새 주문 {newCount()}건
        </Pill>
      </div>
      <div class="order-toolbar">
        <div class="chips">
          <For
            each={[
              { id: "pending", name: "미처리 전체" },
              { id: "new", name: "새 주문" },
              { id: "cooking", name: "준비 중" },
              { id: "all", name: "모든 주문" },
            ]}
          >
            {(f) => (
              <button
                type="button"
                class={`chip ${filter() === f.id ? "active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                {f.name}
              </button>
            )}
          </For>
        </div>
        <div class="row">
          <select
            aria-label="주문 구역"
            value={zone()}
            onChange={(e) => setZone(e.currentTarget.value)}
          >
            <option value="">모든 구역</option>
            <For each={ctx.live.data()?.zones}>{(z) => <option value={z.id}>{z.name}</option>}</For>
          </select>
          <select
            aria-label="주방 메뉴 분류"
            value={category()}
            onChange={(e) => setCategory(e.currentTarget.value)}
          >
            <option value="">모든 메뉴</option>
            <For each={ctx.live.data()?.categories}>
              {(c) => <option value={c.name}>{c.name}</option>}
            </For>
          </select>
        </div>
      </div>
      <Show
        when={visible().length}
        fallback={
          <div class="panel">
            <Empty
              title="지금은 여유로운 시간이에요"
              description="새 주문이 들어오면 여기에 자동으로 나타나요. 다른 화면에 있어도 주문은 계속 받아요."
            />
          </div>
        }
      >
        <div class="orders-grid">
          <For each={visible()}>
            {(o) => (
              <OrderCard
                order={o}
                tableName={
                  ctx.live
                    .data()
                    ?.tables.find(
                      (t) =>
                        t.id === ctx.live.data()?.visits.find((v) => v.id === o.visitId)?.tableId,
                    )?.name
                }
              />
            )}
          </For>
        </div>
      </Show>
    </>
  );
}
