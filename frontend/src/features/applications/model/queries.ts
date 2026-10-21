import { queryOptions } from "@tanstack/react-query";
import {
  getApplication,
  getProfile,
  listApplications,
  listScenarios,
} from "../api/applications";

export const applicationKeys = {
  all: ["applications"] as const,
  list: ["applications", "list"] as const,
  detail: (id: string) => ["applications", "detail", id] as const,
  profile: ["profile"] as const,
  scenarios: ["scenarios"] as const,
};

export const applicationQueries = {
  list: () =>
    queryOptions({
      queryKey: applicationKeys.list,
      queryFn: ({ signal }) => listApplications(signal),
    }),
  detail: (id: string) =>
    queryOptions({
      queryKey: applicationKeys.detail(id),
      queryFn: ({ signal }) => getApplication(id, signal),
    }),
  profile: () =>
    queryOptions({
      queryKey: applicationKeys.profile,
      queryFn: ({ signal }) => getProfile(signal),
    }),
  scenarios: () =>
    queryOptions({
      queryKey: applicationKeys.scenarios,
      queryFn: ({ signal }) => listScenarios(signal),
    }),
};
