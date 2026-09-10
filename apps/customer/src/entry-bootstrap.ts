export const GUEST_ENTRY_KEY = "table-order:guest-entry";

type GuestEntryContext = { qr: string; entryId: string; path: string };

const match = location.pathname.match(/^\/order\/([a-f0-9]{32})\/([a-f0-9-]{36})\/?$/);
if (match) {
  const context: GuestEntryContext = {
    qr: match[1],
    entryId: match[2],
    path: location.pathname,
  };
  try {
    sessionStorage.setItem(GUEST_ENTRY_KEY, JSON.stringify(context));
  } catch {}
  // App.ts intentionally remains unaware of the bearer-selector URL. It reads the
  // familiar /t/:qr path once; client.ts restores /order/... before UI links render.
  history.replaceState(null, "", `/t/${context.qr}`);
}
