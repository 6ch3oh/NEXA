import type { DataProvider } from "@refinedev/core";

const API_ROOT = "/api/owner-read";
export const DATASET_MODE = "NONPROD_DEMO_DATASET";

type Params = Record<string, string | number | null | undefined>;

interface ReadEnvelope<T> {
  data: T;
  meta: { dataset_mode: string; read_only: true };
}

export async function ownerRead<T>(operation: string, params: Params = {}): Promise<T> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      query.set(key, String(value));
    }
  }
  const suffix = query.size ? `?${query.toString()}` : "";
  const response = await fetch(`${API_ROOT}/${operation}${suffix}`, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  const payload = (await response.json()) as Partial<ReadEnvelope<T>> & { error?: string };
  if (!response.ok) throw new Error(payload.error || "读取运营数据失败");
  if (payload.meta?.dataset_mode !== DATASET_MODE || payload.meta?.read_only !== true) {
    throw new Error("数据源未通过 NONPROD 只读边界校验");
  }
  return payload.data as T;
}

const readOnlyRejected = async (): Promise<never> => {
  throw new Error("NEXA OWNER Admin UI v0.1 仅支持读取");
};

function refineFilters(filters: unknown): Params {
  if (!Array.isArray(filters)) return {};
  const result: Params = {};
  for (const item of filters) {
    if (item && typeof item === "object" && "field" in item && "value" in item) {
      result[String(item.field)] = String(item.value);
    }
  }
  return result;
}

export const ownerReadDataProvider = {
  getApiUrl: () => API_ROOT,
  getList: async (input: any) => {
    const pagination = input.pagination || {};
    const pageSize = pagination.pageSize || 50;
    const current = pagination.current || pagination.currentPage || 1;
    const params = {
      ...refineFilters(input.filters),
      ...(input.meta?.params || {}),
      limit: pageSize,
      offset: (current - 1) * pageSize,
    };
    const operation: Record<string, string> = {
      customers: "listCustomers",
      requests: "listRequests",
      "knowledge-review": "listKnowledgeReviewQueue",
    };
    const payload: any = await ownerRead(operation[input.resource], params);
    const data = payload.items.map((item: any) => ({
      id: item.customer_id || item.request_id,
      ...item,
    }));
    return {
      data,
      total: payload.page.offset + data.length + (payload.page.has_more ? 1 : 0),
    };
  },
  getOne: async (input: any) => {
    const operation = input.resource === "customers" ? "getCustomer" : "getRequest";
    const key = input.resource === "customers" ? "customer_id" : "request_id";
    const data: any = await ownerRead(operation, { [key]: input.id, ...(input.meta?.params || {}) });
    return { data: { id: input.id, ...data } };
  },
  create: readOnlyRejected,
  update: readOnlyRejected,
  deleteOne: readOnlyRejected,
  createMany: readOnlyRejected,
  updateMany: readOnlyRejected,
  deleteMany: readOnlyRejected,
  custom: async (input: any) => ({
    data: await ownerRead(input.url, input.meta?.params || input.payload || {}),
  }),
} as DataProvider;
