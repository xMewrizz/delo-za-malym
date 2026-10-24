import { useLayoutEffect, useRef, useState } from "react";

export function useConversationScroll(
  chatId: string | null,
  messageCount: number,
  sending: boolean,
  visible: boolean,
) {
  const log = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const previous = useRef({ chatId, messageCount, sending });
  const [unread, setUnread] = useState(false);

  useLayoutEffect(() => {
    const node = log.current;
    if (!node) return;
    const changedChat = previous.current.chatId !== chatId;
    if (changedChat || (sending && !previous.current.sending)) follow.current = true;
    if (follow.current) {
      node.scrollTop = node.scrollHeight;
      setUnread(false);
    } else if (messageCount > previous.current.messageCount) {
      setUnread(true);
    }
    previous.current = { chatId, messageCount, sending };
  }, [chatId, messageCount, sending, visible]);

  function onScroll() {
    const node = log.current;
    if (!node) return;
    follow.current = node.scrollHeight - node.clientHeight - node.scrollTop <= 64;
    if (follow.current) setUnread(false);
  }

  function jumpToLatest() {
    follow.current = true;
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    setUnread(false);
  }

  return { log, unread, onScroll, jumpToLatest };
}
