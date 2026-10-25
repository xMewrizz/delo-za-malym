import { AlertDialog } from "radix-ui";
import { FilePenLine } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { formatMoney } from "@/shared/lib/format";
import type { Offer } from "../api/applications";
import { productName } from "../model/presentation";

export function SigningPanel({ offer, busy, onSign }: {
  offer: Offer;
  busy: boolean;
  onSign: (offerId: string) => void;
}) {
  const isLimit = ["overdraft", "revolving_credit_line"].includes(offer.product_id);
  const effect = isLimit
    ? "После подписания откроется лимит. Деньги на счёт пока не поступят."
    : offer.product_id === "refinancing"
      ? "После подписания деньги пойдут на погашение выбранных кредитов."
      : "После подписания деньги поступят на расчётный счёт.";

  return <section className="application-signing" aria-labelledby="signing-title">
    <div className="application-signing-copy">
      <span className="application-signing-icon"><FilePenLine size={22} aria-hidden="true" /></span>
      <div>
        <h4 id="signing-title">Осталось подписать договор</h4>
        <p>{effect}</p>
      </div>
    </div>
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <Button disabled={busy}>Подписать договор</Button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal container={typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>(".cabinet-shell")}>
        <AlertDialog.Overlay className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm" />
        <AlertDialog.Content className="application-signing-dialog">
          <AlertDialog.Title>Подписать договор?</AlertDialog.Title>
          <AlertDialog.Description>Проверьте выбранные условия перед подписанием.</AlertDialog.Description>
          <div className="application-signing-summary">
            <p>{productName(offer.product_id)}</p>
            <strong>{formatMoney(offer.amount)}</strong>
            <dl>
              <div><dt>Срок</dt><dd>{offer.term_months ? `${offer.term_months} мес.` : "По условиям продукта"}</dd></div>
              <div><dt>Ставка</dt><dd>{offer.annual_rate_percent ? `${Number(offer.annual_rate_percent).toLocaleString("ru-RU")}% годовых` : "По условиям продукта"}</dd></div>
            </dl>
          </div>
          <p className="application-signing-effect">{effect}</p>
          <p className="application-signing-demo">Демонстрационное оформление, без заключения договора с банком.</p>
          <div className="application-signing-actions">
            <AlertDialog.Cancel asChild><Button variant="outline">Вернуться</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button onClick={() => onSign(offer.offer_id)}>Подписать</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </section>;
}
