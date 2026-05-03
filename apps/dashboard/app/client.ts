import { createClient } from "honox/client";

createClient({
  hydrate: async (elem, root) => {
    const { hydrateRoot } = await import("react-dom/client");
    hydrateRoot(root, elem as unknown as import("react").ReactNode);
  },
  createElement: async (type: unknown, props: unknown) => {
    const { createElement } = await import("react");
    return createElement(type as never, props as never) as unknown as Node;
  },
});
