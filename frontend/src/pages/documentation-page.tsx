import {useEffect,useRef,useState} from "react";
import {ArrowDownToLine,ArrowUpRight,Check,Link2,Minus,Plus} from "lucide-react";
import {Link,useLocation,useNavigate} from "react-router";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import guide from "../../public/project-docs/guide.md?raw";
import {documentationGroups,parseGuide} from "./documentation-model";
import "./documentation-page.css";

const sections=parseGuide(guide);
const mechanics = [
  {id:"scoring",title:"Скоринг: 0–100 баллов",description:"Три фактора, их веса и пороги риска. Как каждый показатель влияет на оценку."},
  {id:"affordability",title:"Допустимая нагрузка",description:"70% расчётного потока минус действующие платежи. Сезонность и отрицательные месяцы."},
  {id:"decision",title:"От данных к решению",description:"Проверки, ограничения продуктов и числовой пример всей цепочки. Причины каждого результата."},
  {id:"quality",title:"Как проверить проект",description:"Повторяемые сценарии, автоматические проверки и запуск наполненного демо с локальной Лумой."},
];

export function DocumentationPage(){
  const body=useRef<HTMLDivElement>(null);
  const [active,setActive]=useState(sections[0].id),[open,setOpen]=useState(false),[copied,setCopied]=useState<string|null>(null);
  const {hash,key:locationKey}=useLocation();
  const navigate=useNavigate();
  useEffect(()=>{const previous=document.title;document.title="Документация — Дело за малым";return()=>{document.title=previous;};},[]);
  useEffect(()=>{
    let frame=0,last="";
    const nodes=[...body.current?.querySelectorAll<HTMLElement>("[data-doc-section]")||[]];
    function update(){frame=0;let current=nodes[0]?.id;for(const node of nodes){if(node.getBoundingClientRect().top<=160) current=node.id;else break;}if(window.scrollY+window.innerHeight>=document.documentElement.scrollHeight-2)current=nodes.at(-1)?.id||current;if(current&&current!==last){last=current;setActive(current);}}
    const scroll=()=>{if(!frame) frame=requestAnimationFrame(update);};
    update();window.addEventListener("scroll",scroll,{passive:true});window.addEventListener("resize",scroll);
    return()=>{cancelAnimationFrame(frame);window.removeEventListener("scroll",scroll);window.removeEventListener("resize",scroll);};
  },[]);
  useEffect(()=>{if(!hash)return;const id=hash.slice(1);if(!sections.some(section=>section.id===id))return;const frame=requestAnimationFrame(()=>{document.getElementById(id)?.scrollIntoView({block:"start"});document.getElementById(id+"-title")?.focus({preventScroll:true});});return()=>cancelAnimationFrame(frame);},[hash,locationKey]);
  async function copy(id:string){
    try{await navigator.clipboard.writeText(`${window.location.origin}/documentation#${id}`);setCopied(id);}catch{navigate(`/documentation#${id}`);}
  }
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(null),1800);return()=>clearTimeout(timer);},[copied]);
  return <div className="documentation-page">
    <header className="documentation-heading"><div><p className="documentation-eyebrow">РУКОВОДСТВО ПО ПРОЕКТУ</p><h1>Как работает<br />кредитный кабинет.</h1><p>Скоринг, платёжеспособность и правила решения. Откуда берутся данные, что считает банковский модуль и как проверить результат.</p></div><div className="documentation-heading-actions"><a href="/project-docs/guide.md" download="Дело за малым — документация.md"><ArrowDownToLine size={16}/>Скачать руководство</a><a href="/docs" target="_blank" rel="noreferrer">Интерактивный API<ArrowUpRight size={16}/></a></div></header>
    <div className="documentation-layout">
      <aside className="documentation-toc" aria-label="Оглавление документации" data-open={open}>
        <button type="button" className="documentation-toc-toggle" aria-expanded={open} aria-controls="documentation-links" onClick={()=>setOpen(value=>!value)}><span>В этом руководстве<small>{sections.find(section=>section.id===active)?.title}</small></span>{open?<Minus size={18}/>:<Plus size={18}/>}</button>
        <nav id="documentation-links" aria-label="Разделы руководства">{documentationGroups.map(group=><div key={group.title}><p>{group.title}</p>{group.ids.map(id=>{const section=sections.find(item=>item.id===id)!;return <Link key={id} to={`/documentation#${id}`} aria-current={active===id?"location":undefined} onClick={()=>{setActive(id);setOpen(false);}}>{section.title}</Link>;})}</div>)}</nav>
      </aside>
      <div className="documentation-content" ref={body}>
        <div className="documentation-mechanics" aria-labelledby="documentation-mechanics-title"><div className="documentation-mechanics-heading"><h2 id="documentation-mechanics-title">Ключевые механики</h2><p>Начните с банковской логики и способов её проверки.</p></div><div className="documentation-mechanics-links">{mechanics.map((item,index)=><Link key={item.id} to={`/documentation#${item.id}`}><span className="documentation-mechanic-index" aria-hidden="true">{String(index+1).padStart(2,"0")}</span><h3>{item.title}</h3><p>{item.description}</p><ArrowUpRight size={18} aria-hidden="true"/></Link>)}</div></div>
        {sections.map((section,index)=><section key={section.id} id={section.id} data-doc-section>
        <header className="documentation-section-heading"><span>{String(index+1).padStart(2,"0")}</span><h2 tabIndex={-1} id={section.id+"-title"}>{section.title}</h2><button type="button" onClick={()=>void copy(section.id)} aria-label={`Скопировать ссылку: ${section.title}`}>{copied===section.id?<Check size={17}/>:<Link2 size={17}/>}</button></header>
        <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{table:({children})=><div className="documentation-table-scroll" tabIndex={0} role="region" aria-label={`Таблица: ${section.title}`}><table>{children}</table></div>,a:({href,children})=>href?.startsWith("/cabinet")?<Link to={href}>{children}</Link>:<a href={href}>{children}</a>}}>{section.body}</Markdown>
      </section>)}<footer className="documentation-end"><p>Хотите увидеть сценарии в действии?</p><Link to="/cabinet?mode=overview">Открыть подготовленный кабинет<ArrowUpRight size={17}/></Link></footer></div>
    </div>
  </div>;
}

