export type GuideSection = {id:string;title:string;body:string};
export const documentationGroups = [
  {title:"Проверка проекта",ids:["start","case-alignment","jury-checks"]},
  {title:"Кабинет и подбор",ids:["workspace","business-data","selection","luma"]},
  {title:"Кредитный конвейер",ids:["process-model","data-sources","scoring","affordability","decision"]},
  {title:"Продукты",ids:["working-capital","overdraft","credit-line","refinancing","investment"]},
  {title:"Оформление и обслуживание",ids:["comparison","application","servicing","supplier-payments","calendar"]},
  {title:"Устройство и ограничения",ids:["architecture","data-model","api","reliability","model-compliance","deployment","quality","scope"]},
];

export function parseGuide(markdown:string):GuideSection[] {
  const matches=[...markdown.matchAll(/^## (.+) \{#([a-z][a-z0-9-]*)\}\s*$/gm)];
  const sections=matches.map((match,index)=>({id:match[2],title:match[1],body:markdown.slice(match.index!+match[0].length,matches[index+1]?.index??markdown.length).trim()}));
  if(new Set(sections.map(section=>section.id)).size!==sections.length) throw new Error("Duplicate documentation anchor");
  return sections;
}
