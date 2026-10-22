import { z } from "zod";
import { queryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/shared/api/client";
import { calendarKey } from "./keys";

export const eventSchema = z.object({
  event_id: z.string(), application_id: z.string(), loan_id: z.string().optional(), date: z.string(), amount: z.string(),
  direction: z.enum(["inflow", "outflow", "none"]), kind: z.string(), title: z.string(), forecast: z.boolean(),
});
export const calendarSchema = z.object({
  today: z.string(), events: z.array(eventSchema),
  plans: z.array(z.object({ application_id: z.string(), state: z.string(), amount: z.string().nullable(), events: z.array(eventSchema) })),
  accounts: z.array(z.object({ application_id: z.string(), product_id: z.string(), amount: z.string(), opened_at: z.string(), outstanding_principal: z.string(), status: z.string().optional(), refinanced_by: z.string().nullable().optional() })),
});
export type CalendarEvent = z.infer<typeof eventSchema>;
export type CalendarData = z.infer<typeof calendarSchema>;
export const calendarQuery = queryOptions({ queryKey: calendarKey, queryFn: ({ signal }) => apiRequest("/calendar", calendarSchema, { signal }) });

export function filterProductEvents(events: CalendarEvent[], product: string): CalendarEvent[] {
  if (product === "all") return events;
  if (product.startsWith("loan:")) return events.filter(event => event.loan_id === product.slice(5));
  if (product.startsWith("app:")) return events.filter(event => event.application_id === product.slice(4));
  return [];
}
