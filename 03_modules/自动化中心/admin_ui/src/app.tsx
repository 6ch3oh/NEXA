import { Refine } from "@refinedev/core";
import routerProvider from "@refinedev/react-router";
import { BrowserRouter, Route, Routes } from "react-router";
import { AppLayout } from "./components";
import { ownerReadDataProvider } from "./data-provider";
import {
  CustomerDetailPage, CustomersPage, KnowledgeReviewPage, ModelUsagePage,
  OverviewPage, RequestDetailPage, RequestsPage, TierUsagePage,
} from "./pages";

export function OwnerAdminRoutes() {
  return <AppLayout><Routes>
    <Route path="/" element={<OverviewPage />} />
    <Route path="/customers" element={<CustomersPage />} />
    <Route path="/customers/:customerId" element={<CustomerDetailPage />} />
    <Route path="/requests" element={<RequestsPage />} />
    <Route path="/requests/:requestId" element={<RequestDetailPage />} />
    <Route path="/knowledge-review" element={<KnowledgeReviewPage />} />
    <Route path="/model-usage" element={<ModelUsagePage />} />
    <Route path="/tier-usage" element={<TierUsagePage />} />
  </Routes></AppLayout>;
}

export function App() {
  return <BrowserRouter><Refine
    dataProvider={ownerReadDataProvider}
    routerProvider={routerProvider}
    resources={[
      { name: "customers", list: "/customers", show: "/customers/:id" },
      { name: "requests", list: "/requests", show: "/requests/:id" },
      { name: "knowledge-review", list: "/knowledge-review" },
    ]}
    options={{ disableTelemetry: true, warnWhenUnsavedChanges: false, syncWithLocation: false }}
  ><OwnerAdminRoutes /></Refine></BrowserRouter>;
}
