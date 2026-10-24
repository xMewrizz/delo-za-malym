import { createContext } from "react";
import type { ApplicationView } from "@/features/applications";

export const SupplierFinancingContext = createContext<((view: ApplicationView) => void) | null>(null);
