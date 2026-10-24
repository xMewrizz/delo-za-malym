import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ChevronDown, RefreshCw } from "lucide-react";
import { Link } from "react-router";
import { getErrorMessage } from "@/shared/api/client";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Skeleton } from "@/shared/ui/skeleton";
import { productQueries } from "../model/queries";
import type { Product } from "../api/products";
import { ProductArtwork } from "./product-artwork";
import "./products-catalog.css";

type ProductId = Product["product_id"];

const productOrder: ProductId[] = [
  "working_capital_loan", "overdraft", "refinancing", "revolving_credit_line", "investment_loan",
];

const productPresentation: Record<ProductId, {
  label: string;
  title: string;
  description: string;
  repayment: string;
  details: string;
}> = {
  working_capital_loan: {
    label: "Закупки и текущие расходы",
    title: "Кредит на оборотные цели",
    description: "Пополнить запасы. Оплатить поставку. Дать бизнесу двигаться дальше.",
    repayment: "Одна сумма сейчас — возврат по графику.",
    details: "Деньги выдаются одной суммой под задачу бизнеса. Погашенную часть кредита нельзя использовать повторно. Срок и платёж подберём в кабинете.",
  },
  overdraft: {
    label: "Расходы раньше выручки",
    title: "Овердрафт",
    description: "Оплатите важное, пока деньги от клиентов ещё в пути.",
    repayment: "Поступления на счёт уменьшают долг.",
    details: "Овердрафт помогает оплатить расходы при временной нехватке денег на счёте. Доступный лимит зависит от данных бизнеса и предстоящих платежей.",
  },
  refinancing: {
    label: "Действующие кредиты",
    title: "Рефинансирование",
    description: "Соберите выбранные кредиты в один. Сравните платёж и общую стоимость.",
    repayment: "Новый график для выбранных долгов.",
    details: "Сумма направляется на полное погашение выбранных долгов. Уменьшение платежа за счёт увеличения срока может повысить общую стоимость — покажем разницу до оформления.",
  },
  revolving_credit_line: {
    label: "Регулярные закупки",
    title: "Возобновляемая кредитная линия",
    description: "Берите деньги частями. Возвращайте долг и используйте лимит снова.",
    repayment: "Проценты — только на использованный долг.",
    details: "Открытие лимита не зачисляет деньги на счёт. Вы сами выбираете сумму выборки и платежа. Проценты уплачиваются ежемесячно, долг — до конца срока; за неиспользованный лимит комиссии нет.",
  },
  investment_loan: {
    label: "Оборудование и развитие",
    title: "Инвестиционный кредит",
    description: "Новая точка, оборудование или мощности — следующий шаг вашего дела.",
    repayment: "Можно отложить погашение основного долга.",
    details: "Собственный взнос — от 20% проекта. Отсрочка основного долга — 0, 3 или 6 месяцев, входит в общий срок. Проценты уплачиваются ежемесячно. Полная стоимость видна до отправки заявки.",
  },
};

export function ProductsCatalog() {
  const products = useQuery(productQueries.list());

  if (products.isPending)
    return (
      <div role="status" aria-label="Загружаем продукты" className="product-showcase">
        <span className="sr-only">Загружаем продукты…</span>
        {productOrder.map((id, index) => (
          <Skeleton key={id} className={`product-tile-placeholder ${index < 2 ? `product-tile-placeholder-featured product-tile-placeholder-${index}` : ""}`} />
        ))}
      </div>
    );

  if (products.isError)
    return (
      <Card>
        <CardHeader>
          <CardTitle>Не удалось загрузить продукты</CardTitle>
          <CardDescription role="alert">{getErrorMessage(products.error)}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" disabled={products.isFetching} onClick={() => void products.refetch()}>
            <RefreshCw aria-hidden="true" />
            {products.isFetching ? "Загружаем…" : "Попробовать снова"}
          </Button>
        </CardContent>
      </Card>
    );

  if (!products.data.length)
    return (
      <Card role="status">
        <CardContent className="text-muted-foreground">Сейчас нет доступных продуктов.</CardContent>
      </Card>
    );

  return (
    <div className="product-showcase">
      {productOrder.flatMap((id) => {
        const product = products.data.find((item) => item.product_id === id);
        return product ? [<ProductTile key={id} product={product} />] : [];
      })}
    </div>
  );
}

function ProductTile({ product }: { product: Product }) {
  const id = product.product_id;
  const content = productPresentation[id];
  const featured = id === "working_capital_loan" || id === "overdraft";
  const titleId = `product-${id}`;

  return (
    <article className={`product-tile product-tile-${id}${featured ? " product-tile-featured" : ""}`} aria-labelledby={titleId}>
      <div className="product-tile-main">
        <div className="product-tile-copy">
          <p className="product-tile-label">{content.label}</p>
          <h3 id={titleId}>{content.title}</h3>
          <p className="product-tile-description">{content.description}</p>
        </div>
        <ProductArtwork productId={id} />
      </div>
      <div className="product-tile-footer">
        <details className="product-tile-details">
          <summary>
            Подробнее<ChevronDown size={15} aria-hidden="true" />
            <span className="sr-only">: {content.title}</span>
          </summary>
          <div className="product-tile-explanation">
            <p className="product-tile-repayment">{content.repayment}</p>
            <p>{content.details}</p>
          </div>
        </details>
        <Link className="product-tile-link" to="/cabinet?mode=manual" aria-label={`Подобрать условия: ${content.title}`}>
          Подобрать<ArrowUpRight size={18} aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}
