import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it} from "vitest";
import {LumaMessageText} from "./luma-message-text";

describe("Luma message formatting",()=>{
  it("renders emphasis and lists without displaying Markdown markers",()=>{
    const html=renderToStaticMarkup(<LumaMessageText text={'Для закупки:\n\n- **Оборотный кредит** — одна сумма.\n- Кредитная линия — для повторных закупок.'}/>);
    expect(html).toContain('<strong>Оборотный кредит</strong>');
    expect(html).toContain('<ul>');expect(html).not.toContain('**');
  });
  it("does not execute HTML or turn model-supplied URLs into links",()=>{
    const html=renderToStaticMarkup(<LumaMessageText text={'[Условия](https://example.test)\n\n<script>alert(1)</script>'}/>);
    expect(html).toContain('Условия');expect(html).not.toContain('href=');expect(html).not.toContain('<script');
  });
});
