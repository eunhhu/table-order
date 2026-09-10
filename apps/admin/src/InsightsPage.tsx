import { type Insights, type Order, type Payment, type Visit, won } from "@table/contracts";
import { Button, CheckField, Empty, Modal, Pill } from "@table/ui";
import { api, time } from "@table/ui/client";
import { CalendarDays, CreditCard, RotateCcw, ShoppingBag, Users, Wallet } from "lucide-solid";
import { createResource, createSignal, For, Show } from "solid-js";
import { useAdmin } from "./context";

const localDay = (start = 4) =>
  new Date(Date.now() + (9 - start) * 3600_000).toISOString().slice(0, 10);
const methods = { card: "카드", cash: "현금", transfer: "계좌이체", other: "기타" };
interface VisitHistory {
  visit: Visit;
  orders: Order[];
  payments: Payment[];
  activities: Insights["activities"];
}
export function InsightsPage(props: { mode: "insights" | "payments" }) {
  const ctx = useAdmin();
  const [from, setFrom] = createSignal(localDay(ctx.live.data()?.settings.businessDayStart));
  const [to, setTo] = createSignal(from());
  const [query, setQuery] = createSignal({ from: from(), to: to(), page: 0 });
  const [report, { refetch }] = createResource(query, (q) =>
    api<Insights>(`/api/admin/insights?from=${q.from}&to=${q.to}&page=${q.page}`),
  );
  const [selected, setSelected] = createSignal<string>();
  const [history, { refetch: refetchHistory }] = createResource(selected, (id) =>
    api<VisitHistory>(`/api/admin/visits/${id}`),
  );
  const [voiding, setVoiding] = createSignal<Payment>();
  const [reason, setReason] = createSignal("결제 수단 오기록");
  const [resetOpen, setResetOpen] = createSignal(false);
  const [resetConfirmed, setResetConfirmed] = createSignal(false);
  const stats = () => [
    { name: "수납액", value: won(report()?.revenue ?? 0), icon: Wallet, tone: "teal" },
    { name: "방문 팀", value: `${report()?.visits ?? 0}팀`, icon: Users, tone: "blue" },
    { name: "평균 수납액", value: won(report()?.average ?? 0), icon: CreditCard, tone: "orange" },
    {
      name: "취소된 메뉴 금액",
      value: won(report()?.cancelledAmount ?? 0),
      icon: ShoppingBag,
      tone: "neutral",
    },
  ];
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">
            {props.mode === "payments" ? "PAYMENTS & VISITS" : "YOUR RESTAURANT, IN NUMBERS"}
          </div>
          <h1>{props.mode === "payments" ? "정산 내역" : "매장 인사이트"}</h1>
          <p>
            {props.mode === "payments"
              ? "수납 기록부터 방문의 주문 내역까지 차분하게 확인해요."
              : "우리 매장의 하루를 숫자로 돌아보세요."}
          </p>
        </div>
        <Button
          variant="danger"
          icon={<RotateCcw size={17} />}
          onClick={() => {
            setResetConfirmed(false);
            setResetOpen(true);
          }}
        >
          영업 기록 초기화
        </Button>
      </div>
      <form
        class="row between wrap panel"
        onSubmit={(e) => {
          e.preventDefault();
          setQuery({ from: from(), to: to(), page: 0 });
        }}
      >
        <div class="period-picker">
          <CalendarDays size={18} />
          <input
            type="date"
            aria-label="조회 시작일"
            value={from()}
            onChange={(e) => setFrom(e.currentTarget.value)}
          />
          <span class="muted">—</span>
          <input
            type="date"
            aria-label="조회 종료일"
            value={to()}
            onChange={(e) => setTo(e.currentTarget.value)}
          />
          <Button type="submit" disabled={report.loading}>
            조회
          </Button>
        </div>
        <small>영업일 기준 {ctx.live.data()?.settings.businessDayStart}시 마감 · 최대 93일</small>
      </form>
      <Show when={report.error}>
        <p class="error-box">{report.error?.message}</p>
      </Show>
      <Show when={report.loading}>
        <p class="muted" role="status">
          내역을 불러오고 있어요…
        </p>
      </Show>
      <Show when={!report.error && report()}>
        {(r) => (
          <>
            <div class="stats-grid" style="margin-top:24px">
              <For each={stats()}>
                {(stat) => (
                  <div class="stat-card">
                    <div class="row between">
                      <span class="stat-label">{stat.name}</span>
                      <span class={`stat-icon ${stat.tone}`}>
                        <stat.icon size={18} />
                      </span>
                    </div>
                    <div class="stat-value">{stat.value}</div>
                  </div>
                )}
              </For>
            </div>
            <Show when={props.mode === "insights"}>
              <div class="insight-charts">
                <section class="panel">
                  <div class="row between">
                    <h3>날짜별 수납액</h3>
                    <small>수납 기록 − 해당일 정정</small>
                  </div>
                  <Show
                    when={r().daily.length}
                    fallback={
                      <Empty
                        title="아직 수납 기록이 없어요"
                        description="테이블 정산을 기록하면 여기에 나타나요."
                      />
                    }
                  >
                    <div class="bar-chart">
                      <For each={r().daily}>
                        {(day) => (
                          <div class="bar-group" title={`${day.day} ${won(day.revenue)}`}>
                            <span
                              class="bar"
                              style={{
                                height: `${Math.max(2, (Math.abs(day.revenue) / Math.max(1, ...r().daily.map((d) => Math.abs(d.revenue)))) * 140)}px`,
                                background: day.revenue < 0 ? "#d99181" : undefined,
                              }}
                            />
                            <small>{day.day.slice(5)}</small>
                          </div>
                        )}
                      </For>
                    </div>
                    <div class="chips">
                      <For each={r().daily}>
                        {(d) => (
                          <span class="pill neutral">
                            {d.day.slice(5)} · {won(d.revenue)}
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
                <section class="panel">
                  <h3>손님이 많이 찾은 메뉴</h3>
                  <Show when={r().items.length} fallback={<Empty title="판매한 메뉴가 없어요" />}>
                    <div class="rank-list">
                      <For each={r().items.slice(0, 5)}>
                        {(item, index) => (
                          <div class="rank-row">
                            <span class="rank-number">{index() + 1}</span>
                            <div class="grow">
                              <span class="rank-title">{item.name}</span>
                              <div class="rank-meter">
                                <span
                                  style={{
                                    width: `${(item.quantity / Math.max(1, r().items[0].quantity)) * 100}%`,
                                  }}
                                />
                              </div>
                            </div>
                            <strong>{item.quantity}개</strong>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>
              </div>
              <div class="insight-charts">
                <section class="panel">
                  <h3>시간대별 방문</h3>
                  <div class="bar-chart">
                    <For each={r().hourly}>
                      {(h) => (
                        <div class="bar-group" title={`${h.hour}시 ${h.visits}팀`}>
                          <span
                            class="bar"
                            style={{
                              height: `${(h.visits / Math.max(1, ...r().hourly.map((i) => i.visits))) * 140}px`,
                            }}
                          />
                          <small>{h.hour % 3 === 0 ? h.hour : ""}</small>
                        </div>
                      )}
                    </For>
                  </div>
                  <small>
                    입력된 방문 인원 {r().guests}명 · 인원 미입력 {r().unknownGuests}팀
                  </small>
                </section>
                <section class="panel">
                  <h3>최근 운영 기록</h3>
                  <div class="activity-list" style="margin-top:20px;max-height:220px;overflow:auto">
                    <For each={r().activities.slice(0, 20)}>
                      {(event) => (
                        <div>
                          <time>{time(event.createdAt)}</time>
                          {event.detail}
                        </div>
                      )}
                    </For>
                    <Show when={!r().activities.length}>
                      <p class="muted">이 기간의 운영 기록이 없어요.</p>
                    </Show>
                  </div>
                </section>
              </div>
              <div class="table-wrapper" style="margin-bottom:24px">
                <table class="table-management">
                  <thead>
                    <tr>
                      <th>메뉴</th>
                      <th>판매 수량</th>
                      <th>취소 수량</th>
                      <th>주문 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={r().items}>
                      {(i) => (
                        <tr>
                          <td>{i.name}</td>
                          <td>{i.quantity}개</td>
                          <td>{i.cancelled}개</td>
                          <td>{won(i.revenue)}</td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <div class="row between" style="margin-bottom:14px">
              <h2>
                수납 기록 <span class="muted">{r().paymentCount}</span>
              </h2>
              <small>기록을 선택하면 상세 주문을 볼 수 있어요.</small>
            </div>
            <Show
              when={r().payments.length}
              fallback={
                <div class="panel">
                  <Empty
                    title="이 기간의 정산 내역이 없어요"
                    description="수납을 기록하면 테이블과 주문 내역이 함께 남아요."
                  />
                </div>
              }
            >
              <div class="table-wrapper">
                <table class="table-management">
                  <thead>
                    <tr>
                      <th>테이블</th>
                      <th>수납 시각</th>
                      <th>수단</th>
                      <th>금액</th>
                      <th>상태</th>
                      <th>처리자</th>
                      <th>상세</th>
                    </tr>
                  </thead>
                  <tbody>
                    <For each={r().payments}>
                      {(p) => (
                        <tr>
                          <td>
                            <strong>{p.tableName}번</strong>
                          </td>
                          <td>
                            {new Date(p.createdAt).toLocaleDateString("ko-KR")} {time(p.createdAt)}
                          </td>
                          <td>{methods[p.method]}</td>
                          <td class={p.voidedAt ? "muted" : "revenue-positive"}>{won(p.amount)}</td>
                          <td>
                            <Pill tone={p.voidedAt ? "red" : "teal"}>
                              {p.voidedAt ? "정정됨" : "수납 완료"}
                            </Pill>
                          </td>
                          <td>{p.actor}</td>
                          <td>
                            <Button
                              variant="secondary"
                              class="small"
                              onClick={() => setSelected(p.visitId)}
                            >
                              내역 보기
                            </Button>
                          </td>
                        </tr>
                      )}
                    </For>
                  </tbody>
                </table>
              </div>
            </Show>
            <p class="muted" style="font-size:11px;margin-top:14px">
              수납액은 외부 결제 결과를 기록한 값이에요. 주문 금액·방문 수와 집계 시점이 달라요.
              실제 결제·환불은 매장에서 별도로 진행해 주세요.
            </p>
            <h2 style="margin:28px 0 14px">
              방문 기록 <span class="muted">{r().visits}팀</span>
            </h2>
            <div class="table-wrapper">
              <table class="table-management">
                <thead>
                  <tr>
                    <th>테이블</th>
                    <th>첫 주문 시각</th>
                    <th>인원</th>
                    <th>상태</th>
                    <th>주문</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={r().visitRecords}>
                    {(v) => (
                      <tr>
                        <td>
                          <strong>{v.tableName}번</strong>
                        </td>
                        <td>
                          {new Date(v.startedAt).toLocaleDateString("ko-KR")} {time(v.startedAt)}
                        </td>
                        <td>{v.guests ? `${v.guests}명` : "미입력"}</td>
                        <td>{v.state === "closed" ? "종료" : "손님 있음"}</td>
                        <td>
                          <Button
                            variant="secondary"
                            class="small"
                            onClick={() => setSelected(v.id)}
                          >
                            내역 보기
                          </Button>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
            <div class="row between" style="margin-top:18px">
              <Button
                variant="secondary"
                disabled={report.loading || query().page === 0}
                onClick={() => setQuery((q) => ({ ...q, page: q.page - 1 }))}
              >
                이전 기록
              </Button>
              <small>
                {query().page + 1}페이지 · 수납·방문 각각 100건씩 · 통계는 조회 기간 전체
              </small>
              <Button
                variant="secondary"
                disabled={
                  report.loading ||
                  (query().page + 1) * 100 >= Math.max(r().visits, r().paymentCount)
                }
                onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}
              >
                다음 기록
              </Button>
            </div>
          </>
        )}
      </Show>
      <Modal
        open={resetOpen()}
        title="전체 영업 기록을 초기화할까요?"
        onClose={() => !ctx.busy() && setResetOpen(false)}
        busy={ctx.busy()}
      >
        <div class="stack">
          <div class="error-box">
            모든 주문, 방문, 수납, 판매 통계와 운영 기록이 삭제되고 모든 테이블이 빈 상태가 돼요.
            메뉴, 테이블, 매장 설정과 직원 계정은 유지됩니다. 이 작업은 되돌릴 수 없어요.
          </div>
          <CheckField
            checked={resetConfirmed()}
            onChange={setResetConfirmed}
            label="삭제되는 내용을 확인했어요"
            detail="영업 중이라면 진행 중인 주문까지 모두 사라져요."
          />
          <div class="row">
            <Button variant="secondary" class="grow" onClick={() => setResetOpen(false)}>
              취소
            </Button>
            <Button
              variant="danger"
              class="grow"
              disabled={!resetConfirmed() || ctx.busy()}
              onClick={async () => {
                if (
                  await ctx.run(
                    { type: "history.reset", confirm: true },
                    "영업 기록을 초기화했어요.",
                  )
                ) {
                  setResetOpen(false);
                  setSelected(undefined);
                  setQuery({ from: from(), to: to(), page: 0 });
                  void refetch();
                }
              }}
            >
              전체 기록 삭제
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={!!selected()}
        title="방문 · 정산 상세"
        onClose={() => {
          setSelected(undefined);
          setVoiding(undefined);
        }}
        wide
        busy={ctx.busy()}
      >
        <Show
          when={!history.error && history()}
          fallback={
            <p>
              {history.error
                ? "내역을 불러오지 못했어요. 창을 닫고 다시 열어 주세요."
                : "주문을 불러오고 있어요…"}
            </p>
          }
        >
          {(h) => (
            <div class="stack">
              <div class="row between">
                <span>{new Date(h().visit.startedAt).toLocaleString("ko-KR")}</span>
                <strong>{won(h().visit.total)}</strong>
              </div>
              <For each={h().orders}>
                {(o) => (
                  <section>
                    <h3>
                      주문 #{o.number} <small>{time(o.createdAt)}</small>
                    </h3>
                    <For each={o.items}>
                      {(i) => (
                        <div class="history-line">
                          <span>
                            {i.name} × {i.quantity - i.cancelled}
                            <Show when={i.cancelled}>
                              <small> ({i.cancelled}개 취소)</small>
                            </Show>
                          </span>
                          <strong>{won((i.quantity - i.cancelled) * i.price)}</strong>
                        </div>
                      )}
                    </For>
                  </section>
                )}
              </For>
              <For each={h().payments}>
                {(p) => (
                  <div class="row between wrap">
                    <span>
                      {methods[p.method]} · {won(p.amount)}{" "}
                      <Pill tone={p.voidedAt ? "red" : "teal"}>
                        {p.voidedAt ? "정정됨" : "수납 완료"}
                      </Pill>
                      <Show when={p.voidReason}>
                        <small> {p.voidReason}</small>
                      </Show>
                    </span>
                    <Show when={!p.voidedAt}>
                      <Button variant="danger" class="small" onClick={() => setVoiding(p)}>
                        기록 정정
                      </Button>
                    </Show>
                  </div>
                )}
              </For>
              <Show when={voiding()}>
                <div class="error-box stack">
                  <strong>수납 기록 정정</strong>
                  <p>원 기록을 보존하고 수납액에서 제외해요. 실제 환불은 실행되지 않아요.</p>
                  <div class="chips">
                    <For each={["결제 수단 오기록", "금액 확인 필요", "매장에서 환불 완료"]}>
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
                  <div class="row">
                    <Button variant="secondary" onClick={() => setVoiding(undefined)}>
                      돌아가기
                    </Button>
                    <Button
                      variant="danger"
                      disabled={ctx.busy()}
                      onClick={async () => {
                        const payment = voiding();
                        if (!payment) return;
                        if (
                          await ctx.run(
                            { type: "payment.void", paymentId: payment.id, reason: reason() },
                            "수납 기록을 정정했어요.",
                          )
                        ) {
                          setVoiding(undefined);
                          void refetchHistory();
                          void refetch();
                        }
                      }}
                    >
                      기록 정정 확정
                    </Button>
                  </div>
                </div>
              </Show>
              <Show
                when={
                  h().visit.state === "closed" &&
                  h().payments.length &&
                  h().payments.every((p) => !!p.voidedAt)
                }
              >
                <div class="info-box stack">
                  종료된 방문의 수납을 다시 기록할 수 있어요. 금액 {won(h().visit.total)}
                  <div class="chips">
                    <For each={["card", "cash", "transfer", "other"] as const}>
                      {(method) => (
                        <Button
                          variant="secondary"
                          disabled={ctx.busy()}
                          onClick={async () => {
                            if (
                              await ctx.run(
                                {
                                  type: "payment.settle",
                                  visitId: h().visit.id,
                                  version: h().visit.version,
                                  method,
                                  close: true,
                                },
                                "수납을 다시 기록했어요.",
                              )
                            ) {
                              void refetchHistory();
                              void refetch();
                            }
                          }}
                        >
                          {methods[method]}로 기록
                        </Button>
                      )}
                    </For>
                  </div>
                </div>
              </Show>
              <div class="activity-list">
                <For each={h().activities}>
                  {(e) => (
                    <div>
                      <time>{time(e.createdAt)}</time>
                      {e.detail}
                    </div>
                  )}
                </For>
              </div>
            </div>
          )}
        </Show>
      </Modal>
    </>
  );
}
