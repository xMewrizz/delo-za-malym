import { createBrowserRouter } from "react-router";
import { NotFoundPage } from "@/pages/not-found-page";
import { AppLayout } from "./layout";

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      {
        path: "/",
        lazy: async () => ({
          Component: (await import("@/pages/home-page")).HomePage,
        }),
      },
      {
        path: "/project",
        lazy: async () => ({ Component: (await import("@/pages/project-page")).ProjectPage }),
      },
      {
        path: "/documentation",
        lazy: async () => ({ Component: (await import("@/pages/documentation-page")).DocumentationPage }),
      },
      {
        path: "/cabinet",
        lazy: async () => ({
          Component: (await import("@/pages/cabinet-page")).CabinetPage,
        }),
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]);
