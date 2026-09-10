import type { SettingsInput, Staff, Table } from "@table/contracts";
import { Button, CheckField, Empty, Field, Modal, Pill } from "@table/ui";
import { api } from "@table/ui/client";
import { createStoreTheme } from "@table/ui/theme";
import { Download, ExternalLink, Pencil, Plus, QrCode, Trash2 } from "lucide-solid";
import { createResource, createSignal, For, Match, Show, Switch } from "solid-js";
import { useAdmin } from "./context";
import { ImageUpload } from "./MenuPage";

export function SettingsPage() {
  const ctx = useAdmin();
  const [tab, setTab] = createSignal("store");
  const [draft, setDraft] = createSignal<SettingsInput>({ ...ctx.data().settings });
  const [table, setTable] = createSignal<{
    id?: string;
    name: string;
    zoneId: string | null;
    sort: number;
  }>();
  const [deleting, setDeleting] = createSignal<Table>();
  const [qr, setQr] = createSignal<Table>();
  const [zoneName, setZoneName] = createSignal("");
  const [zoneEdit, setZoneEdit] = createSignal<string>();
  const [zoneDelete, setZoneDelete] = createSignal<string>();
  const [users, { refetch }] = createResource(
    () => tab() === "staff",
    (enabled) => (enabled ? api<Staff[]>("/api/admin/users") : Promise.resolve([])),
  );
  const [user, setUser] = createSignal<{
    id?: string;
    name: string;
    login: string;
    role: "owner" | "staff";
    active: boolean;
    password?: string;
  }>();
  const [qrInfo] = createResource(
    () => qr()?.id,
    (id) => api<{ url: string }>(`/api/admin/qr/${id}/info`),
  );
  const update = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">MAKE YOURSELF AT HOME</div>
          <h1>매장 설정</h1>
          <p>영업 전 한 번 준비하면, 바쁜 시간에는 가볍게 사용할 수 있어요.</p>
        </div>
      </div>
      <div class="tabs settings-tabs">
        <For
          each={[
            { id: "store", name: "매장 · 주문 설정" },
            { id: "tables", name: "테이블 · QR" },
            { id: "zones", name: "구역 관리" },
            { id: "staff", name: "직원 계정" },
          ]}
        >
          {(t) => (
            <button
              type="button"
              class={tab() === t.id ? "active" : ""}
              onClick={() => setTab(t.id)}
            >
              {t.name}
            </button>
          )}
        </For>
      </div>
      <Switch>
        <Match when={tab() === "store"}>
          <form
            class="panel stack settings-panel"
            onSubmit={async (e) => {
              e.preventDefault();
              await ctx.run(
                { type: "settings.save", settings: draft() },
                "매장 설정을 저장했어요.",
              );
            }}
          >
            <h3>매장의 첫인상</h3>
            <div class="form-grid">
              <Field label="매장 이름">
                <input
                  required
                  maxlength={80}
                  value={draft().name}
                  onInput={(e) => update("name", e.currentTarget.value)}
                />
              </Field>
              <Field label="포인트 컬러" hint="버튼·배경·메뉴판·QR 카드가 같은 톤으로 바뀌어요.">
                <input
                  type="color"
                  value={draft().accent}
                  onInput={(e) => update("accent", e.currentTarget.value)}
                />
              </Field>
              <div class="full theme-preview" style={createStoreTheme(draft().accent)}>
                <div class="row between wrap">
                  <strong>우리 매장 스타일</strong>
                  <span class="theme-preview-button">주문하기</span>
                </div>
                <small>저장하면 관리자와 손님 화면에 함께 적용돼요.</small>
              </div>
              <div class="full">
                <ImageUpload
                  value={draft().logo}
                  onChange={(url) => update("logo", url)}
                  label="QR 카드용 매장 로고"
                />
              </div>
            </div>
            <div class="divider" />
            <h3>주문과 매장 운영</h3>
            <CheckField
              checked={draft().acceptingOrders}
              onChange={(v) => update("acceptingOrders", v)}
              label="손님 주문 받기"
              detail="영업을 마치거나 잠시 주문을 쉬고 싶을 때만 꺼주세요. 직원 앱 연결 여부와는 관계없어요."
            />
            <CheckField
              checked={draft().categoriesEnabled}
              onChange={(v) => update("categoriesEnabled", v)}
              label="손님 메뉴판에 카테고리 표시"
              detail="끄면 구분 없이 모든 메뉴가 한 목록에 보여요."
            />
            <CheckField
              checked={draft().advancedKitchen}
              onChange={(v) => update("advancedKitchen", v)}
              label="조리 완료를 따로 기록"
              detail="기본은 확인 → 음식 나감 두 번이에요. 주방에서 세부 단계를 구분할 때 켜주세요."
            />
            <Field
              label="영업일 마감 시간"
              hint="한국 시간 기준. 새벽 영업을 전날 매출과 함께 볼 수 있어요."
            >
              <select
                value={draft().businessDayStart}
                onChange={(e) => update("businessDayStart", Number(e.currentTarget.value))}
              >
                <For each={Array.from({ length: 13 }, (_, i) => i)}>
                  {(h) => <option value={h}>{h === 0 ? "자정" : `오전 ${h}시`}</option>}
                </For>
              </select>
            </Field>
            <div class="modal-footer">
              <Button type="submit" disabled={ctx.busy()}>
                설정 저장
              </Button>
            </div>
          </form>
        </Match>
        <Match when={tab() === "tables"}>
          <div class="row between wrap" style="margin-bottom:20px">
            <p class="muted">테이블 QR은 인쇄해 두고 계속 사용할 수 있어요.</p>
            <div class="row">
              <a class="btn secondary" href="/api/admin/qr/all.pdf" download="">
                <Download size={17} />
                전체 QR 출력
              </a>
              <Button
                icon={<Plus size={17} />}
                onClick={() =>
                  setTable({
                    name: String((ctx.live.data()?.tables.length ?? 0) + 1).padStart(2, "0"),
                    zoneId: ctx.live.data()?.zones[0]?.id ?? null,
                    sort: (ctx.live.data()?.tables.length ?? 0) + 1,
                  })
                }
              >
                테이블 추가
              </Button>
            </div>
          </div>
          <Show
            when={ctx.live.data()?.tables.length}
            fallback={
              <div class="panel">
                <Empty
                  title="아직 테이블이 없어요"
                  description="번호와 구역을 정해 첫 테이블을 추가해 주세요."
                />
              </div>
            }
          >
            <div class="table-wrapper">
              <table class="table-management">
                <thead>
                  <tr>
                    <th>테이블</th>
                    <th>구역</th>
                    <th>상태</th>
                    <th>QR 카드</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={ctx.live.data()?.tables}>
                    {(t) => (
                      <tr>
                        <td>
                          <strong>{t.name}번</strong>
                        </td>
                        <td>
                          {ctx.live.data()?.zones.find((z) => z.id === t.zoneId)?.name ?? "미지정"}
                        </td>
                        <td>
                          <Pill tone={t.state === "occupied" ? "teal" : "neutral"}>
                            {t.state === "occupied" ? "손님 있음" : "빈 테이블"}
                          </Pill>
                        </td>
                        <td>
                          <Button
                            class="small"
                            variant="secondary"
                            icon={<QrCode size={16} />}
                            onClick={() => setQr(t)}
                          >
                            QR 카드
                          </Button>
                        </td>
                        <td>
                          <div class="row">
                            <button
                              type="button"
                              class="icon-btn"
                              aria-label={`${t.name}번 테이블 수정`}
                              onClick={() =>
                                setTable({ id: t.id, name: t.name, zoneId: t.zoneId, sort: t.sort })
                              }
                            >
                              <Pencil size={15} />
                            </button>
                            <button
                              type="button"
                              class="icon-btn"
                              aria-label={`${t.name}번 테이블 삭제`}
                              disabled={t.state === "occupied"}
                              onClick={() => setDeleting(t)}
                            >
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </div>
          </Show>
        </Match>
        <Match when={tab() === "zones"}>
          <div class="panel settings-panel stack">
            <h3>구역을 나누면 테이블을 더 쉽게 찾을 수 있어요</h3>
            <For each={ctx.live.data()?.zones}>
              {(z) => (
                <div class="row between category-row">
                  <span>{z.name}</span>
                  <div class="row">
                    <Button
                      class="small"
                      variant="secondary"
                      onClick={() => {
                        setZoneEdit(z.id);
                        setZoneName(z.name);
                      }}
                    >
                      이름 수정
                    </Button>
                    <Button class="small" variant="ghost" onClick={() => setZoneDelete(z.id)}>
                      삭제
                    </Button>
                  </div>
                </div>
              )}
            </For>
            <form
              class="row"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await ctx.run(
                    { type: "zone.save", id: zoneEdit(), name: zoneName() },
                    "구역을 저장했어요.",
                  )
                ) {
                  setZoneName("");
                  setZoneEdit(undefined);
                }
              }}
            >
              <input
                required
                aria-label="구역 이름"
                placeholder="메인 홀, 2층, 창가…"
                value={zoneName()}
                onInput={(e) => setZoneName(e.currentTarget.value)}
              />
              <Button type="submit" disabled={ctx.busy()}>
                {zoneEdit() ? "수정" : "추가"}
              </Button>
            </form>
            <Show when={zoneDelete()}>
              <div class="error-box stack">
                <p>구역을 삭제하면 테이블은 미지정 구역으로 이동해요.</p>
                <div class="row">
                  <Button variant="secondary" onClick={() => setZoneDelete(undefined)}>
                    돌아가기
                  </Button>
                  <Button
                    variant="danger"
                    disabled={ctx.busy()}
                    onClick={async () => {
                      const id = zoneDelete();
                      if (!id) return;
                      if (await ctx.run({ type: "zone.delete", id }, "구역을 삭제했어요."))
                        setZoneDelete(undefined);
                    }}
                  >
                    구역 삭제
                  </Button>
                </div>
              </div>
            </Show>
          </div>
        </Match>
        <Match when={tab() === "staff"}>
          <div class="row between" style="margin-bottom:20px">
            <p class="muted">각 직원의 이름으로 처리 기록을 남겨요.</p>
            <Button
              icon={<Plus size={17} />}
              onClick={() =>
                setUser({ name: "", login: "", role: "staff", active: true, password: "" })
              }
            >
              직원 추가
            </Button>
          </div>
          <Show when={users.error}>
            <p class="error-box">{users.error?.message}</p>
          </Show>
          <div class="table-wrapper">
            <table class="table-management">
              <thead>
                <tr>
                  <th>직원</th>
                  <th>아이디</th>
                  <th>권한</th>
                  <th>상태</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                <For each={users.error ? [] : users()}>
                  {(u) => (
                    <tr>
                      <td>{u.name}</td>
                      <td>{u.login}</td>
                      <td>{u.role === "owner" ? "점주" : "직원"}</td>
                      <td>
                        <Pill tone={u.active ? "teal" : "neutral"}>
                          {u.active ? "사용 중" : "중지"}
                        </Pill>
                      </td>
                      <td>
                        <Button
                          variant="secondary"
                          class="small"
                          onClick={() => setUser({ ...u, password: "" })}
                        >
                          수정
                        </Button>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
        </Match>
      </Switch>
      <Modal
        open={!!table()}
        title={table()?.id ? "테이블 수정" : "테이블 추가"}
        onClose={() => setTable(undefined)}
        busy={ctx.busy()}
      >
        <Show when={table()}>
          {(t) => (
            <form
              class="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await ctx.run({ type: "table.save", ...t() }, "테이블을 저장했어요."))
                  setTable(undefined);
              }}
            >
              <Field label="테이블 번호 또는 이름">
                <input
                  required
                  value={t().name}
                  onInput={(e) => setTable({ ...t(), name: e.currentTarget.value })}
                />
              </Field>
              <Field label="구역">
                <select
                  value={t().zoneId ?? ""}
                  onChange={(e) => setTable({ ...t(), zoneId: e.currentTarget.value || null })}
                >
                  <option value="">미지정</option>
                  <For each={ctx.live.data()?.zones}>
                    {(z) => <option value={z.id}>{z.name}</option>}
                  </For>
                </select>
              </Field>
              <Field label="표시 순서">
                <input
                  type="number"
                  min="0"
                  max="10000"
                  value={t().sort}
                  onInput={(e) => setTable({ ...t(), sort: Number(e.currentTarget.value) })}
                />
              </Field>
              <Button type="submit" disabled={ctx.busy()}>
                테이블 저장
              </Button>
            </form>
          )}
        </Show>
      </Modal>
      <Modal
        open={!!deleting()}
        title="테이블을 삭제할까요?"
        onClose={() => setDeleting(undefined)}
        busy={ctx.busy()}
      >
        <div class="stack">
          <p>
            {deleting()?.name}번 테이블의 QR은 더 이상 사용할 수 없어요. 이전 방문과 수납 기록은
            보존해요.
          </p>
          <Button
            variant="danger"
            disabled={ctx.busy()}
            onClick={async () => {
              const target = deleting();
              if (!target) return;
              if (await ctx.run({ type: "table.delete", id: target.id }, "테이블을 삭제했어요."))
                setDeleting(undefined);
            }}
          >
            테이블 삭제
          </Button>
        </div>
      </Modal>
      <Modal
        open={!!qr()}
        title={`${qr()?.name}번 테이블 QR 카드`}
        onClose={() => setQr(undefined)}
      >
        <Show when={qr()}>
          {(t) => (
            <div class="stack">
              <img
                class="qr-preview"
                src={`/api/admin/qr/${t().id}.png`}
                alt={`${t().name}번 테이블 주문 QR 포스터`}
              />
              <div class="row">
                <a class="btn primary grow" href={`/api/admin/qr/${t().id}.pdf`} download="">
                  <Download size={16} />
                  인쇄용 PDF
                </a>
                <a class="btn secondary grow" href={`/api/admin/qr/${t().id}.png`} download="">
                  PNG 저장
                </a>
              </div>
              <Show when={!qrInfo.error && qrInfo()}>
                <a class="btn secondary" target="_blank" rel="noreferrer" href={qrInfo()?.url}>
                  <ExternalLink size={16} />
                  손님 주문페이지 열기
                </a>
              </Show>
              <small>
                QR 카드 전체를 출력해 테이블에 붙여 주세요. 카메라로 스캔해 주문페이지가 열리는지
                확인해 주세요.
              </small>
            </div>
          )}
        </Show>
      </Modal>
      <Modal
        open={!!user()}
        title={user()?.id ? "직원 계정 수정" : "직원 추가"}
        onClose={() => setUser(undefined)}
        busy={ctx.busy()}
      >
        <Show when={user()}>
          {(u) => (
            <form
              class="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await ctx.run(
                    { type: "user.save", ...u(), password: u().password || undefined },
                    "직원 계정을 저장했어요.",
                  )
                ) {
                  setUser(undefined);
                  void refetch();
                }
              }}
            >
              <Field label="이름">
                <input
                  required
                  value={u().name}
                  onInput={(e) => setUser({ ...u(), name: e.currentTarget.value })}
                />
              </Field>
              <Field label="로그인 아이디">
                <input
                  required
                  autocomplete="off"
                  value={u().login}
                  onInput={(e) => setUser({ ...u(), login: e.currentTarget.value })}
                />
              </Field>
              <Field
                label={u().id ? "새 비밀번호 (변경할 때만)" : "비밀번호"}
                hint="12자 이상으로 설정해 주세요."
              >
                <input
                  type="password"
                  autocomplete="new-password"
                  minlength={12}
                  required={!u().id}
                  value={u().password}
                  onInput={(e) => setUser({ ...u(), password: e.currentTarget.value })}
                />
              </Field>
              <Field label="권한">
                <select
                  value={u().role}
                  onChange={(e) =>
                    setUser({ ...u(), role: e.currentTarget.value as "owner" | "staff" })
                  }
                >
                  <option value="staff">직원 · 주문과 테이블 운영</option>
                  <option value="owner">점주 · 전체 관리</option>
                </select>
              </Field>
              <CheckField
                label="계정 사용"
                detail="끄면 이 계정으로 로그인할 수 없어요. 변경 시 기존 로그인은 만료돼요."
                checked={u().active}
                onChange={(active) => setUser({ ...u(), active })}
              />
              <Button type="submit" disabled={ctx.busy()}>
                계정 저장
              </Button>
            </form>
          )}
        </Show>
      </Modal>
    </>
  );
}
