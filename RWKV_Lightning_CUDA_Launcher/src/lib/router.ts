import { useEffect, useState } from "react";

export const ROUTES = [
  "nodes",
  "chat",
  "translate",
  "runtime",
  "training",
  "quant",
  "settings",
] as const;

export type Route = (typeof ROUTES)[number];

/** Deep links kept from the previous console. */
const ALIASES: Record<string, Route> = {
  "": "nodes",
  "state-tuning": "training",
  quantization: "quant",
};

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "").split("?")[0].trim();
  if (raw in ALIASES) return ALIASES[raw];
  return (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : "nodes";
}

export function navigate(route: Route) {
  if (parse(location.hash) === route) return;
  location.hash = `/${route}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
