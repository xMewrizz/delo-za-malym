import { useEffect, useRef, useState } from "react";
import type { ApplicationView } from "../api/applications";
import { useSavedDraft } from "@/shared/lib/saved-draft";
import { formatMoney } from "@/shared/lib/format";
import { refinancingIds } from "../model/refinancing";
import { Button } from "@/shared/ui/button";
import { productName } from "../model/presentation";


export function RefinancingLoans({ view, selected, onChange }: {
  view: ApplicationView; selected: string[]; onChange: (ids: string[]) => void;
}) {
  const loans = (view.application.financials.existing_loans || []).filter(loan => loan.is_commitment !== true && Number(loan.outstanding_principal || 0) > 0);
  const chosen = loans.filter(loan => selected.includes(loan.loan_id));
  return <section className="space-y-4 rounded-2xl border border-border p-4" aria-label="Кредиты для рефинансирования">
    <h3 className="font-bold">Какие кредиты хотите заменить?</h3>
    <p className="text-sm text-muted-foreground">Остатки долга и графики уже получены из банка. Новый кредит полностью погасит выбранные обязательства; дополнительных денег на счёт не выдаём.</p>
    {!loans.length && <p role="status">Действующих кредитов для замены нет.</p>}
    {selected.some(id => !loans.some(loan => loan.loan_id === id)) && <p role="alert">Один из выбранных кредитов уже закрыт. Снимите выбор и отметьте действующие обязательства.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{loans.map((loan, index) => <label key={loan.loan_id} className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-4 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
      <input type="checkbox" className="mt-1 size-4 accent-primary" aria-label={`Рефинансировать кредит ${index + 1}`} checked={selected.includes(loan.loan_id)} onChange={event => onChange(event.target.checked ? [...selected, loan.loan_id] : selected.filter(id => id !== loan.loan_id))} />
      <span className="min-w-0"><strong className="block">{loan.product_id ? productName(loan.product_id) : `Кредит ${index + 1}`} · {loan.outstanding_principal != null ? formatMoney(loan.outstanding_principal) : "остаток уточняется"}</strong><span className="mt-1 block text-sm text-muted-foreground">Максимальный платёж: {loan.monthly_payment != null ? `${formatMoney(loan.monthly_payment)} в месяц` : "уточняется"}</span>{loan.maturity_date && <span className="text-xs text-muted-foreground">До {new Date(loan.maturity_date + "T12:00:00").toLocaleDateString("ru-RU")}</span>}</span>
    </label>)}</div>
    {selected.length > 0 && <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Снять выбор кредитов</Button>}
    {chosen.length > 0 && <dl className="grid gap-4 rounded-xl bg-secondary p-4 text-sm sm:grid-cols-2">
      <div><dt>На погашение выбранных долгов</dt><dd className="mt-1 text-lg font-bold">{formatMoney(String(chosen.reduce((sum, loan) => sum + Number(loan.outstanding_principal || 0), 0)))}</dd></div>
      <div><dt>Сумма максимальных платежей</dt><dd className="mt-1 text-lg font-bold">{chosen.every(loan => loan.monthly_payment != null) ? `${formatMoney(String(chosen.reduce((sum, loan) => sum + Number(loan.monthly_payment), 0)))} / мес.` : "Платежи нужно уточнить"}</dd></div>
    </dl>}
  </section>;
}

export function RefinancingWorkspace({ view, busy, onSave, onExplore }: {
  view: ApplicationView; busy: boolean;
  onSave: (changes: Record<string, unknown>, after?: () => void) => void;
  onExplore: () => void;
}) {
  const [selected, setSelected] = useSavedDraft(`delo-refinancing:${view.application.application_id}:${view.application.application_version}`, refinancingIds(view));
  const calculate = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => { if (calculate.current && !busy) { calculate.current = false; onExplore(); } }, [busy, onExplore, view]);
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault();
    if (!selected.length) { setError("Выберите хотя бы один кредит для замены."); return; }
    setError("");
    onSave({ "need.purpose": "refinancing", "need.preferred_product": "refinancing", "product_details.refinancing": { loan_ids: selected } }, () => { calculate.current = true; });
  }}><fieldset disabled={busy} className="space-y-4"><RefinancingLoans view={view} selected={selected} onChange={setSelected} />{error && <p role="alert">{error}</p>}<Button type="submit" disabled={!selected.length || busy}>Подобрать рефинансирование</Button></fieldset></form>;
}
