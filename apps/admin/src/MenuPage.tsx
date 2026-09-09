import { type Category, type Menu, won } from "@table/contracts";
import { Button, CheckField, Empty, Field, FoodImage, Modal, Pill } from "@table/ui";
import { Pencil, Plus, Search, Trash2, Upload } from "lucide-solid";
import { createSignal, For, Show } from "solid-js";
import { useAdmin } from "./context";

export function ImageUpload(props: {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}) {
  const ctx = useAdmin();
  const [busy, setBusy] = createSignal(false);
  return (
    <div class="upload-box">
      <Show when={props.value}>
        <img src={props.value} alt="등록할 사진 미리보기" />
      </Show>
      <label class="upload-label">
        <Upload size={20} />
        <strong>{busy() ? "사진을 준비하고 있어요…" : (props.label ?? "사진 올리기")}</strong>
        <small>JPG · PNG · WebP / 최대 10MB</small>
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy()}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            if (!file) return;
            setBusy(true);
            try {
              const form = new FormData();
              form.set("file", file);
              const response = await fetch("/api/admin/images", { method: "POST", body: form });
              const result = await response.json();
              if (!response.ok) throw new Error(result.message);
              props.onChange(result.url);
            } catch (error) {
              ctx.notify({ message: (error as Error).message, error: true });
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      <Show when={props.value}>
        <Button variant="ghost" class="small" onClick={() => props.onChange("")}>
          사진 지우기
        </Button>
      </Show>
    </div>
  );
}
const emptyMenu = (): Omit<Menu, "id"> => ({
  name: "",
  description: "",
  price: 0,
  image: "",
  categoryId: null,
  available: true,
  visible: true,
  sort: 0,
});
export function MenuPage() {
  const ctx = useAdmin();
  const [search, setSearch] = createSignal("");
  const [category, setCategory] = createSignal("");
  const [edit, setEdit] = createSignal<Partial<Menu> & Omit<Menu, "id">>();
  const [deleting, setDeleting] = createSignal<Menu>();
  const [categoriesOpen, setCategoriesOpen] = createSignal(false);
  const [categoryName, setCategoryName] = createSignal("");
  const [categoryId, setCategoryId] = createSignal<string>();
  const [categoryDelete, setCategoryDelete] = createSignal<Category>();
  const menus = () =>
    ctx.live
      .data()
      ?.menus.filter(
        (m) => (!category() || m.categoryId === category()) && m.name.includes(search()),
      ) ?? [];
  const update = <K extends keyof Menu>(key: K, value: Menu[K]) =>
    setEdit((previous) => (previous ? { ...previous, [key]: value } : previous));
  return (
    <>
      <div class="page-head">
        <div>
          <div class="eyebrow">A MENU MADE WITH CARE</div>
          <h1>우리 매장의 메뉴</h1>
          <p>사진 한 장, 설명 한 줄까지. 손님이 고르는 순간을 준비해요.</p>
        </div>
        <div class="row">
          <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
            카테고리 관리
          </Button>
          <Button
            icon={<Plus size={18} />}
            onClick={() => setEdit({ ...emptyMenu(), sort: ctx.live.data()?.menus.length ?? 0 })}
          >
            메뉴 추가
          </Button>
        </div>
      </div>
      <div class="order-toolbar">
        <div class="chips">
          <button
            type="button"
            class={`chip ${!category() ? "active" : ""}`}
            onClick={() => setCategory("")}
          >
            전체 메뉴 <span class="count">{ctx.live.data()?.menus.length}</span>
          </button>
          <For each={ctx.live.data()?.categories}>
            {(c) => (
              <button
                type="button"
                class={`chip ${category() === c.id ? "active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.name}
              </button>
            )}
          </For>
        </div>
        <div class="search-box">
          <Search size={16} />
          <input
            aria-label="메뉴 검색"
            placeholder="메뉴 이름 검색"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </div>
      <Show
        when={menus().length}
        fallback={
          <div class="panel">
            <Empty
              title="메뉴를 채워 주세요"
              description="메뉴를 등록하면 손님 주문페이지에 바로 나타나요."
              action={<Button onClick={() => setEdit(emptyMenu())}>첫 메뉴 추가</Button>}
            />
          </div>
        }
      >
        <div class="menu-grid">
          <For each={menus()}>
            {(m) => (
              <article class="menu-card">
                <div class="menu-photo">
                  <FoodImage src={m.image} name={m.name} />
                  <span class="menu-photo-badge">
                    <Pill tone={!m.visible ? "neutral" : m.available ? "teal" : "red"}>
                      {!m.visible ? "숨김" : m.available ? "판매 중" : "품절"}
                    </Pill>
                  </span>
                </div>
                <div class="menu-body">
                  <small>
                    {ctx.live.data()?.categories.find((c) => c.id === m.categoryId)?.name ??
                      "미분류"}
                  </small>
                  <div class="row between">
                    <h3>{m.name}</h3>
                    <strong>{won(m.price)}</strong>
                  </div>
                  <p>{m.description || "메뉴 설명을 더해 보세요."}</p>
                  <div class="row between menu-card-actions">
                    <Button
                      variant="secondary"
                      class="small"
                      disabled={ctx.busy()}
                      onClick={() =>
                        void ctx.run(
                          { type: "menu.save", ...m, available: !m.available },
                          m.available ? "품절로 표시했어요." : "다시 판매를 시작했어요.",
                        )
                      }
                    >
                      {m.available ? "품절 처리" : "판매 재개"}
                    </Button>
                    <div class="row">
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`${m.name} 수정`}
                        onClick={() => setEdit({ ...m })}
                      >
                        <Pencil size={16} />
                      </button>
                      <button
                        type="button"
                        class="icon-btn"
                        aria-label={`${m.name} 삭제`}
                        onClick={() => setDeleting(m)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            )}
          </For>
        </div>
      </Show>
      <Modal
        open={!!edit()}
        title={edit()?.id ? "메뉴 수정" : "새 메뉴 추가"}
        onClose={() => setEdit(undefined)}
        busy={ctx.busy()}
        wide
      >
        <Show when={edit()}>
          {(m) => (
            <form
              class="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await ctx.run({ type: "menu.save", ...m() }, "메뉴를 저장했어요."))
                  setEdit(undefined);
              }}
            >
              <div class="form-grid">
                <div class="full">
                  <ImageUpload value={m().image} onChange={(url) => update("image", url)} />
                </div>
                <Field label="메뉴 이름">
                  <input
                    required
                    maxlength={80}
                    value={m().name}
                    onInput={(e) => update("name", e.currentTarget.value)}
                  />
                </Field>
                <Field label="가격 (원)">
                  <input
                    type="number"
                    required
                    min="0"
                    max="100000000"
                    step="100"
                    value={m().price}
                    onInput={(e) => update("price", Number(e.currentTarget.value))}
                  />
                </Field>
                <Field label="카테고리">
                  <select
                    value={m().categoryId ?? ""}
                    onChange={(e) => update("categoryId", e.currentTarget.value || null)}
                  >
                    <option value="">미분류</option>
                    <For each={ctx.live.data()?.categories}>
                      {(c) => <option value={c.id}>{c.name}</option>}
                    </For>
                  </select>
                </Field>
                <Field label="표시 순서" hint="작은 숫자가 먼저 보여요.">
                  <input
                    type="number"
                    min="0"
                    max="10000"
                    value={m().sort}
                    onInput={(e) => update("sort", Number(e.currentTarget.value))}
                  />
                </Field>
                <div class="full">
                  <Field label="메뉴 설명">
                    <textarea
                      maxlength={500}
                      value={m().description}
                      onInput={(e) => update("description", e.currentTarget.value)}
                      placeholder="재료와 맛, 메뉴에 담긴 이야기를 적어주세요."
                    />
                  </Field>
                </div>
              </div>
              <CheckField
                label="손님에게 메뉴 보여주기"
                checked={m().visible}
                onChange={(v) => update("visible", v)}
              />
              <CheckField
                label="판매 중"
                detail="끄면 품절로 표시되어 주문할 수 없어요."
                checked={m().available}
                onChange={(v) => update("available", v)}
              />
              <div class="modal-footer">
                <Button variant="secondary" onClick={() => setEdit(undefined)}>
                  취소
                </Button>
                <Button type="submit" disabled={ctx.busy()}>
                  메뉴 저장
                </Button>
              </div>
            </form>
          )}
        </Show>
      </Modal>
      <Modal
        open={!!deleting()}
        title="메뉴를 삭제할까요?"
        onClose={() => setDeleting(undefined)}
        busy={ctx.busy()}
      >
        <div class="stack">
          <p>
            <strong>{deleting()?.name}</strong> 메뉴가 손님 화면에서 사라져요. 이전 주문과 판매
            기록은 남아요.
          </p>
          <Button
            variant="danger"
            disabled={ctx.busy()}
            onClick={async () => {
              const target = deleting();
              if (!target) return;
              if (await ctx.run({ type: "menu.delete", id: target.id }, "메뉴를 삭제했어요."))
                setDeleting(undefined);
            }}
          >
            메뉴 삭제
          </Button>
        </div>
      </Modal>
      <Modal
        open={categoriesOpen()}
        title="카테고리 관리"
        onClose={() => setCategoriesOpen(false)}
        busy={ctx.busy()}
      >
        <div class="stack">
          <For each={ctx.live.data()?.categories}>
            {(c) => (
              <div class="row between category-row">
                <span>{c.name}</span>
                <div class="row">
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`${c.name} 수정`}
                    onClick={() => {
                      setCategoryId(c.id);
                      setCategoryName(c.name);
                    }}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    aria-label={`${c.name} 삭제`}
                    onClick={() => setCategoryDelete(c)}
                  >
                    <Trash2 size={16} />
                  </button>
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
                  {
                    type: "category.save",
                    id: categoryId(),
                    name: categoryName(),
                    sort:
                      ctx.live.data()?.categories.find((c) => c.id === categoryId())?.sort ??
                      ctx.live.data()?.categories.length ??
                      0,
                  },
                  "카테고리를 저장했어요.",
                )
              ) {
                setCategoryName("");
                setCategoryId(undefined);
              }
            }}
          >
            <input
              aria-label="카테고리 이름"
              required
              placeholder="새 카테고리 이름"
              value={categoryName()}
              onInput={(e) => setCategoryName(e.currentTarget.value)}
            />
            <Button type="submit" disabled={ctx.busy()}>
              {categoryId() ? "수정" : "추가"}
            </Button>
          </form>
          <Show when={categoryDelete()}>
            <div class="error-box stack">
              {categoryDelete()?.name} 카테고리를 삭제하면 메뉴는 미분류로 이동해요.
              <div class="row">
                <Button variant="secondary" onClick={() => setCategoryDelete(undefined)}>
                  돌아가기
                </Button>
                <Button
                  variant="danger"
                  disabled={ctx.busy()}
                  onClick={async () => {
                    const target = categoryDelete();
                    if (!target) return;
                    if (
                      await ctx.run(
                        { type: "category.delete", id: target.id },
                        "카테고리를 삭제했어요.",
                      )
                    )
                      setCategoryDelete(undefined);
                  }}
                >
                  삭제
                </Button>
              </div>
            </div>
          </Show>
        </div>
      </Modal>
    </>
  );
}
