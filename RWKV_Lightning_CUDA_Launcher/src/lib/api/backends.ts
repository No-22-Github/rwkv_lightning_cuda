import { clientRequest } from "./http";
import type {
  AddBackendRequest,
  BackendListResponse,
  BackendView,
} from "./types";

/** Backend registry. These endpoints live on the local Client, not a node. */
export const backendsApi = {
  list: (signal?: AbortSignal) =>
    clientRequest<BackendListResponse>("/api/v1/backends", { signal }),

  /**
   * Adding always probes once. HTTP 200 does **not** imply `reachable: true`;
   * inspect the returned view before reporting success.
   */
  add: (body: AddBackendRequest) =>
    clientRequest<BackendView>("/api/v1/backends", { body }),

  remove: (id: string) =>
    clientRequest<{ ok: boolean }>(
      `/api/v1/backends/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  probe: (id: string) =>
    clientRequest<BackendView>(
      `/api/v1/backends/${encodeURIComponent(id)}/probe`,
      { method: "POST", body: {} },
    ),
};
