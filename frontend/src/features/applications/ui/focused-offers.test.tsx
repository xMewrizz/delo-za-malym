// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {renderToStaticMarkup} from 'react-dom/server';
import {MemoryRouter} from 'react-router';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {describe,it,expect,vi} from 'vitest';
import {ExplorationPanel} from './exploration-panel';
import {FocusedOffers} from './focused-offers';
import type {ApplicationView} from '../api/applications';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const options=[6,12,18,24,36].map(term=>({option_id:`option-${term}`,offer_id:`offer-${term}`,product_id:'working_capital_loan',term_months:term,amount:'600000.00',monthly_payment:String(720000/term),annual_rate_percent:'24.00',total_repayment:'720000.00',total_interest:'120000.00',fees_total:'0.00'}));
const view={application:{application_id:'comparison',application_version:1,need:{purpose:'working_capital',preferred_product:'working_capital_loan',requested_amount:'600000.00'},financials:{existing_loans:[]}},explorations:[{exploration_id:'explore',application_version:1,product_id:'working_capital_loan',result:{status:'options_ready',options}}]} as unknown as ApplicationView;
describe('compact comparison in manual selection and Luma',()=>{
 it('keeps grace periods and refinancing payment increases visible before opening details',()=>{
  const markup=renderToStaticMarkup(<FocusedOffers view={view} explorationId="explore" options={[{...options[0],product_id:'investment_loan',investment:{principal_grace_months:3,grace_monthly_payment:'6000'}},{...options[1],product_id:'refinancing',refinancing:{first_month_payment_change:'2000',monthly_payment_reduction:'5000',total_cost_change:'10000'}}]} busy={false} comparison={[]} onComparison={()=>{}} onApply={()=>{}}/>);
  const host=document.createElement('div');host.innerHTML=markup;
  expect(host.querySelectorAll('.focused-offer-list>li')[0].textContent).toContain('Первые 3 мес.');
  expect(host.querySelectorAll('.focused-offer-list>li')[1].textContent).toContain('В первом месяце платёж вырастет');
 });
 it.each([false,true])('keeps five choices compact and applies the exact option (Luma: %s)',async(focused)=>{
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host),client=new QueryClient(),apply=vi.fn();
  const click=async(text:string)=>act(async()=>[...document.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===text)!.click());
  try{
   await act(async()=>root.render(<MemoryRouter><QueryClientProvider client={client}><ExplorationPanel view={view} busy={false} onExplore={vi.fn()} onApply={apply} focused={focused} compact/></QueryClientProvider></MemoryRouter>));
   expect(host.querySelectorAll('.focused-offer-list>li')).toHaveLength(5);
   expect(host.querySelector('.offer-comparison-grid,.offer-compare-tray')).toBeNull();
   expect([...host.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent==='Сравнить')?.disabled).toBe(true);
   const checks=host.querySelectorAll<HTMLInputElement>('.focused-offer-check input');
   for(const check of [checks[2],checks[3]])await act(async()=>check.click());
   await click('Сравнить · 2');
   const dialog=document.querySelector('[role="dialog"]')!;
   expect(dialog.textContent).toContain('Сравнение условий');
   expect([...dialog.querySelectorAll('thead th')].map(item=>item.textContent)).toEqual(['Условия','18 мес.','24 мес.']);
   await act(async()=>dialog.querySelector<HTMLButtonElement>('tbody tr:last-child td:last-child button')!.click());
   await click('Перейти к заявке');
   expect(apply).toHaveBeenCalledExactlyOnceWith('explore','option-24');
   expect(document.querySelector('[role="dialog"]')).toBeNull();
   expect(host.querySelectorAll('.focused-offer-list>li')).toHaveLength(5);
   for(const check of [checks[0],checks[1],checks[4]])await act(async()=>check.click());
   await click('Сравнить · 5');
   expect(document.querySelectorAll('[role="dialog"] thead th')).toHaveLength(6);
   expect(document.querySelector('[role="dialog"]')?.getAttribute('data-wide')).toBe('true');
   await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Закрыть сравнение"]')!.click());
   await vi.waitFor(()=>expect(document.activeElement?.textContent).toBe('Сравнить · 5'));
   await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="Подробнее: 12 мес."]')!.click());
   await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="Закрыть условия"]')!.click());
   await vi.waitFor(()=>expect(document.activeElement?.getAttribute('aria-label')).toBe('Подробнее: 12 мес.'));
  }finally{await act(async()=>root.unmount());client.clear();host.remove();}
 });
});
