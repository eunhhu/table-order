import { Check, ChefHat, Minus, Plus, UtensilsCrossed, X } from "lucide-solid";
import {
  createEffect,
  createSignal,
  createUniqueId,
  ErrorBoundary,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

export function AppBoundary(props: { children: JSX.Element }) {
  return (
    <ErrorBoundary
      fallback={
        <div class="login-page">
          <div class="login-card stack">
            <Brand />
            <h1>화면을 다시 확인할게요</h1>
            <p>연결 상태를 확인하고 다시 열어 주세요. 저장된 주문은 그대로 유지돼요.</p>
            <Button onClick={() => location.reload()}>화면 다시 열기</Button>
          </div>
        </div>
      }
    >
      {props.children}
    </ErrorBoundary>
  );
}

export function Brand(props: { compact?: boolean }) {
  return (
    <div class="brand">
      <span class="brand-mark">
        <UtensilsCrossed size={23} />
      </span>
      <span>
        테이블 오더
        <span class="brand-sub">{props.compact ? "TABLE ORDER" : "매일의 식사를 따뜻하게"}</span>
      </span>
    </div>
  );
}
export function Button(
  props: JSX.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger" | "ghost";
    icon?: JSX.Element;
  },
) {
  return (
    <button
      {...props}
      type={props.type ?? "button"}
      class={`btn ${props.variant ?? "primary"} ${props.class ?? ""}`}
    >
      {props.icon}
      {props.children}
    </button>
  );
}
export function Pill(props: { tone?: string; children: JSX.Element }) {
  return <span class={`pill ${props.tone ?? "neutral"}`}>{props.children}</span>;
}
export function Quantity(props: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <fieldset class="quantity" aria-label={props.label ?? "수량"}>
      <button
        type="button"
        aria-label="수량 줄이기"
        disabled={props.disabled || props.value <= (props.min ?? 1)}
        onClick={() => props.onChange(props.value - 1)}
      >
        <Minus size={16} />
      </button>
      <output>{props.value}</output>
      <button
        type="button"
        aria-label="수량 늘리기"
        disabled={props.disabled || props.value >= (props.max ?? 99)}
        onClick={() => props.onChange(props.value + 1)}
      >
        <Plus size={16} />
      </button>
    </fieldset>
  );
}
function OpenDialog(props: {
  title: string;
  children: JSX.Element;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  let dialog!: HTMLDialogElement;
  const titleId = createUniqueId();
  onMount(() => {
    dialog.showModal();
    // A recovered staff submission has already succeeded; don't leave its form ready to submit twice.
    const recovered = () => props.onClose();
    window.addEventListener("ongi:command-recovered", recovered);
    onCleanup(() => window.removeEventListener("ongi:command-recovered", recovered));
  });
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape uses onCancel; the close button is keyboard accessible. This click only handles the native backdrop.
    <dialog
      ref={dialog}
      class={`modal ${props.wide ? "wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        if (!props.busy) props.onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog && !props.busy) {
          const box = dialog.getBoundingClientRect();
          if (
            e.clientX < box.left ||
            e.clientX > box.right ||
            e.clientY < box.top ||
            e.clientY > box.bottom
          )
            props.onClose();
        }
      }}
    >
      <header class="modal-head">
        <h2 id={titleId}>{props.title}</h2>
        <button
          type="button"
          class="icon-btn"
          aria-label="닫기"
          disabled={props.busy}
          onClick={props.onClose}
        >
          <X size={22} />
        </button>
      </header>
      <div class="modal-body">{props.children}</div>
    </dialog>
  );
}
export function Modal(props: {
  open: boolean;
  title: string;
  children: JSX.Element;
  onClose: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  return (
    <Show when={props.open}>
      <OpenDialog {...props} />
    </Show>
  );
}
export function Empty(props: {
  title: string;
  description?: string;
  action?: JSX.Element;
  icon?: JSX.Element;
}) {
  return (
    <div class="empty-state">
      <div class="empty-icon">{props.icon ?? <ChefHat size={32} />}</div>
      <h3>{props.title}</h3>
      <Show when={props.description}>
        <p>{props.description}</p>
      </Show>
      {props.action}
    </div>
  );
}
export function Field(props: { label: string; children: JSX.Element; hint?: string }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Each caller supplies a native input, textarea, or select as this wrapping label's child.
    <label class="field">
      <span>{props.label}</span>
      {props.children}
      <Show when={props.hint}>
        <small>{props.hint}</small>
      </Show>
    </label>
  );
}
export function CheckField(props: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  detail?: string;
}) {
  return (
    <label class="check-field">
      <span>
        <strong>{props.label}</strong>
        <Show when={props.detail}>
          <small>{props.detail}</small>
        </Show>
      </span>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="switch" aria-hidden="true">
        <Check size={12} />
      </span>
    </label>
  );
}
export function FoodImage(props: { src?: string; name: string; class?: string }) {
  const [failed, setFailed] = createSignal(false);
  createEffect(() => {
    void props.src;
    setFailed(false);
  });
  return (
    <Show
      when={props.src && !failed()}
      fallback={
        <div class={`food-placeholder ${props.class ?? ""}`}>
          <UtensilsCrossed size={28} />
        </div>
      }
    >
      <img
        class={`food-image ${props.class ?? ""}`}
        src={props.src}
        alt={props.name}
        loading="lazy"
        onError={() => setFailed(true)}
        width="240"
        height="200"
      />
    </Show>
  );
}
