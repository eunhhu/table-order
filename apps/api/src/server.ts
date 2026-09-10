import { guestOrderSchema, id } from "@table/contracts";
import { app as baseApp } from "./app";
import {
  enterGuest,
  guestEntryEvents,
  guestEntryRequest,
  guestEntrySnapshot,
  submitGuestEntry,
} from "./guest-entry";

export const app = baseApp
  .get("/t/:qr", ({ params }) => enterGuest(params.qr))
  .get("/t/:qr/", ({ params }) => enterGuest(params.qr))
  .get("/api/guest/:qr/entries/:entryId/snapshot", ({ request, params }) =>
    guestEntrySnapshot(request, params.qr, id.parse(params.entryId)),
  )
  .post("/api/guest/:qr/entries/:entryId/orders", ({ request, params, body }) =>
    submitGuestEntry(request, params.qr, id.parse(params.entryId), guestOrderSchema.parse(body)),
  )
  .get("/api/guest/:qr/entries/:entryId/requests/:id", ({ request, params }) =>
    guestEntryRequest(request, params.qr, id.parse(params.entryId), id.parse(params.id)),
  )
  .get("/api/guest/:qr/entries/:entryId/events", ({ request, params }) =>
    guestEntryEvents(request, params.qr, id.parse(params.entryId)),
  );
