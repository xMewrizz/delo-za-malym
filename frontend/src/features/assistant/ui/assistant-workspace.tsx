import { Tabs } from "radix-ui";
import type { ReactNode, Ref } from "react";
import "./assistant-workspace.css";
import {LumaMark} from "@/shared/ui/luma-mark";

export type WorkspaceSection = "data" | "offers";

export function AssistantWorkspace({
  section, onSectionChange, headingRef, offersRef, updating, pending,
  data, footer, offers,
}: {
  section: WorkspaceSection;
  onSectionChange: (section: WorkspaceSection) => void;
  headingRef: Ref<HTMLHeadingElement>;
  offersRef: Ref<HTMLDivElement>;
  updating: boolean;
  pending: boolean;
  data: ReactNode;
  footer?: ReactNode;
  offers: ReactNode;
}) {
  return (
    <div className="assistant-working-area assistant-workspace">
      <h2 ref={headingRef} tabIndex={-1} className="sr-only">Данные и предложения</h2>
      <header className="assistant-workspace-heading"><span><LumaMark/>Ваш запрос</span><div className="assistant-update-status" data-busy={updating} role="status">{(updating || pending) && <><i aria-hidden="true"/><span>{updating ? "Обновляем…" : "Проверьте изменения"}</span></>}</div></header>
      <Tabs.Root className="assistant-workspace-tabs" value={section} onValueChange={value => onSectionChange(value as WorkspaceSection)}>
        <Tabs.List className="assistant-workspace-navigation" aria-label="Рабочая область Лумы">
          <Tabs.Trigger value="data">Данные{pending && <span className="assistant-tab-dot" aria-label="Есть неподтверждённые изменения" />}</Tabs.Trigger>
          <Tabs.Trigger value="offers">Предложения</Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="data" forceMount hidden={section !== "data"} className="assistant-workspace-panel">
          <div className="assistant-workspace-scroll" tabIndex={0} aria-label="Собранные данные">{data}</div>
          {footer && <div className="assistant-workspace-footer">{footer}</div>}
        </Tabs.Content>
        <Tabs.Content value="offers" forceMount hidden={section !== "offers"} className="assistant-workspace-panel">
          <div ref={offersRef} className="assistant-workspace-scroll" tabIndex={0} aria-label="Сравнение предложений">{offers}</div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
