import { formatMoney } from "@/shared/lib/format";
import type { Offer } from "../api/applications";

export function OfferKeyFigures({ option }: { option: Offer }) {
  const isLimit = option.product_id === "overdraft" || option.product_id === "revolving_credit_line";
  const hasPayment = option.monthly_payment != null;
  return <dl className="offer-key-figures">
    <div><dt>{isLimit ? "Лимит финансирования" : "Сумма кредита"}</dt><dd>{formatMoney(option.amount)}</dd></div>
    <div><dt>{hasPayment ? option.product_id === "investment_loan" ? "Макс. платёж в месяц" : "Платёж в месяц" : "Погашение"}</dt>
      <dd className={hasPayment ? "offer-payment-value" : "offer-payment-description"}>{hasPayment ? formatMoney(option.monthly_payment!) : option.product_id === "revolving_credit_line" ? "До конца срока" : "Из поступлений"}</dd>
    </div>
  </dl>;
}
