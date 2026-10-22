import { useQuery } from "@tanstack/react-query";
import {
  ArrowDownUp,
  ArrowUpRight,
  Banknote,
  ChevronDown,
  RefreshCw,
  Repeat2,
} from "lucide-react";
import { getErrorMessage } from "@/shared/api/client";
import { Link } from "react-router";
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
  const investment = product.product_id === "investment_loan";
  const loan = product.product_id === "working_capital_loan";
  const refinancing = product.product_id === "refinancing";
  const revolving = product.product_id === "revolving_credit_line";
  const Icon = investment ? Banknote : revolving ? Repeat2 : refinancing ? RefreshCw : loan ? Banknote : ArrowDownUp;
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
            {investment ? "Для оборудования и развития" : revolving ? "Для регулярных закупок" : refinancing ? "Для действующих кредитов" : loan ? "На оборотные задачи" : "На каждый день"}
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
          {investment ? "Вложитесь в оборудование или новую точку. Укажите стоимость проекта и свой взнос, выберите срок и отсрочку погашения долга." : revolving ? "Используйте лимит частями. Возвращайте основной долг и берите деньги снова, без новой заявки в пределах открытой линии." : refinancing ? "Замените выбранные кредиты одним. Сравните новый платёж и все оставшиеся выплаты с текущими условиями." : loan
            ? "Закупайте товары и материалы. Оплачивайте расходы. Возвращайте деньги по графику."
            : "Оплачивайте важное, пока выручка в пути. Поступления на счёт погасят задолженность."}
        </CardDescription>
      </CardHeader>
      <CardContent className="product-content">
        <dl className="product-mechanics">
          <div>
            <dt>Когда подходит</dt>
            <dd>{investment ? "Для оборудования, ремонта и новых мощностей" : revolving ? "Для повторяющихся закупок и оборотных расходов" : refinancing ? "Чтобы пересмотреть текущие обязательства" : loan ? "Для закупок и текущих расходов" : "Когда расходы раньше выручки"}</dd>
          </div>
          <div>
            <dt>Как возвращать</dt>
            <dd>{investment ? "Проценты ежемесячно; основной долг — после выбранной отсрочки" : revolving ? "Проценты ежемесячно, долг — до конца срока" : loan || refinancing || investment ? "Платежами по новому графику" : "Поступлениями на счёт"}</dd>
          </div>
        </dl>
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
            <p>{investment ? "Собственный взнос — от 20% проекта. Отсрочка основного долга — 0, 3 или 6 месяцев, входит в общий срок. Платёж проверяется после отсрочки; полная стоимость видна до отправки заявки." : revolving ? "Открытие лимита не зачисляет деньги на счёт. Вы сами выбираете сумму выборки и платежа. Проценты начисляются на использованный долг; за неиспользованный лимит комиссии нет." : refinancing ? "Сумма направляется на полное погашение выбранных долгов. Уменьшение платежа за счёт увеличения срока может повысить общую стоимость — покажем разницу до оформления." : loan
              ? "Деньги выдаются одной суммой под задачу бизнеса. Возврат идёт по графику; погашенную часть кредита нельзя использовать повторно."
              : "Овердрафт помогает оплатить расходы при временной нехватке денег на счёте. Поступления на счёт уменьшают задолженность."}</p>
          </div>
        </details>
        <Link className="product-cabinet-link" to="/cabinet?mode=manual">Подобрать условия в кабинете<ArrowUpRight size={17} aria-hidden="true" /></Link>
      </CardContent>
    </Card>
  );
}
