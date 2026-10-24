import Markdown from "react-markdown";

/** Format prose from the model; never interpret embedded HTML or active links. */
export function LumaMessageText({text}:{text:string}) {
  return <div className="luma-message-text"><Markdown skipHtml allowedElements={["p","strong","em","ul","ol","li","br"]} unwrapDisallowed>{text}</Markdown></div>;
}
