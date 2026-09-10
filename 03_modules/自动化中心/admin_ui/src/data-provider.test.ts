import { ownerReadDataProvider } from "./data-provider";

describe("NEXA Owner Read Data Provider", () => {
  it("uses GET with service pagination and no credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { items: [{ customer_id: "customer-1" }], page: { offset: 50, has_more: true } }, meta: { dataset_mode: "NONPROD_DEMO_DATASET", read_only: true } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await ownerReadDataProvider.getList({ resource: "customers", pagination: { currentPage: 2, pageSize: 50, mode: "server" }, filters: [], sorters: [], meta: {} });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("limit=50&offset=50"), expect.objectContaining({ method: "GET", credentials: "omit" }));
  });
  it("rejects every write method", async () => {
    await expect(ownerReadDataProvider.create!({ resource: "requests", variables: {} })).rejects.toThrow("仅支持读取");
    await expect(ownerReadDataProvider.update!({ resource: "requests", id: "x", variables: {} })).rejects.toThrow("仅支持读取");
    await expect(ownerReadDataProvider.deleteOne!({ resource: "requests", id: "x" })).rejects.toThrow("仅支持读取");
  });
});
