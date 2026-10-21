import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { getErrorMessage } from "@/shared/api/client";
import { formatMoney } from "@/shared/lib/format";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { productQueries } from "../model/queries";
import type { Product } from "../api/products";
import "./products-catalog.css";

export function ProductsCatalog() {
  const products = useQuery(productQueries.list());

  if (products.isPending)
    return (
      <div
        role="status"
        aria-label="Загружаем продукты"
        className="product-grid"
      >
        <span className="sr-only">Загружаем продукты…</span>
        {[0, 1].map((key) => (
          <Skeleton key={key} className="h-105 rounded-[28px]" />
        ))}
      </div>
    );

  if (products.isError)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Не удалось загрузить продукты</CardTitle>
          <CardDescription role="alert">
            {getErrorMessage(products.error)}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="outline"
            disabled={products.isFetching}
            onClick={() => void products.refetch()}
          >
            <RefreshCw aria-hidden="true" />
            {products.isFetching ? "Загружаем…" : "Попробовать снова"}
          </Button>
        </CardContent>
      </Card>
    );

  if (!products.data.length)
    return (
      <Card role="status">
        <CardContent className="text-muted-foreground">
          Сейчас нет доступных продуктов.
        </CardContent>
      </Card>
    );

  return (
    <div className="product-grid">
      {products.data.map((product) => (
        <ProductCard key={product.product_id} product={product} />
      ))}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  const loan = product.product_id === "working_capital_loan";
  const Icon = loan ? Banknote : ArrowDownUp;
  const titleId = `product-${product.product_id}`;
  return (
    <Card
      className={`product-card ${loan ? "product-card-loan" : "product-card-overdraft"}`}
      role="article"
      aria-labelledby={titleId}
    >
      <CardHeader>
        <div className="product-card-top">
          <span className="product-tag">
            {loan ? "На развитие бизнеса" : "На каждый день"}
          </span>
          <span className="product-symbol" aria-hidden="true">
            <Icon />
          </span>
        </div>
        <CardTitle>
          <h3 id={titleId} className="product-title">
            {loan ? "Кредит на оборотные цели" : product.name}
          </h3>
        </CardTitle>
        <CardDescription className="product-description">
          {loan
            ? "Закупайте товары и материалы. Оплачивайте расходы. Возвращайте деньги по графику."
            : "Оплачивайте важное, пока выручка в пути. Поступления на счёт погасят задолженность."}
        </CardDescription>
      </CardHeader>
      <CardContent className="product-content">
        <dl className="product-figures">
          <div>
            <dt>{loan ? "Сумма кредита" : "Доступный лимит"}</dt>
            <dd>до {formatMoney(product.maximum_amount)}</dd>
          </div>
          <div>
            <dt>Ставка в год</dt>
            <dd>
              {Number(product.annual_rate_percent).toLocaleString("ru-RU")}
              <span>%</span>
            </dd>
          </div>
        </dl>
        <div className="product-term">
          <span>{loan ? "На срок" : "Погашение долга"}</span>
          <b>
            {loan
              ? `${product.terms.join(" / ")} мес.`
              : `до ${product.max_debt_days} дней`}
          </b>
        </div>
        <details className="product-details">
          <summary>
            <span>
              Подробнее о продукте
              <ArrowUpRight size={16} aria-hidden="true" />
            </span>
            <ChevronDown
              size={17}
              className="product-details-chevron"
              aria-hidden="true"
            />
          </summary>
          <div className="product-details-content">
            <p>{product.name}</p>
            <dl>
              <div>
                <dt>{loan ? "Сумма" : "Лимит"}</dt>
                <dd>
                  {formatMoney(product.minimum_amount)} —{" "}
                  {formatMoney(product.maximum_amount)}
                </dd>
              </div>
              <div>
                <dt>{loan ? "Сроки кредита" : "Срок соглашения"}</dt>
                <dd>
                  {loan
                    ? `${product.terms.join(", ")} мес.`
                    : `${product.agreement_months} мес.`}
                </dd>
              </div>
            </dl>
            <p className="product-details-note">
              Откройте кабинет, чтобы проверить условия по данным бизнеса и
              сравнить варианты.
            </p>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
