import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { CopyButton } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const ERROR_LINE = /error|failed|exception|out of memory|traceback/i;

export function LogViewer({
  lines,
  title,
  endpoint,
  empty,
  className,
  bodyClassName,
  filterable = true,
}: {
  lines: string[];
  title: string;
  endpoint?: string;
  empty?: string;
  className?: string;
  bodyClassName?: string;
  filterable?: boolean;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const bodyRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    if (!query.trim()) return lines;
    const needle = query.toLowerCase();
    return lines.filter((line) => line.toLowerCase().includes(needle));
  }, [lines, query]);

  useEffect(() => {
    if (!follow) return;
    const node = bodyRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [visible.length, follow]);

  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {endpoint && (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {endpoint}
          </span>
        )}
        <div className="flex-1" />
        {filterable && (
          <div className="relative w-[180px]">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("common.filter")}
              className="h-7 pl-7 text-xs"
            />
          </div>
        )}
        <Button
          size="xs"
          onClick={() => setFollow((value) => !value)}
          title="Follow tail"
          className={cn(follow && "bg-accent text-foreground")}
        >
          {follow ? "▼" : "❚❚"}
        </Button>
        <CopyButton text={visible.join("\n")} size="xs" />
      </CardHeader>
      <div
        ref={bodyRef}
        onScroll={(event) => {
          const node = event.currentTarget;
          const atBottom =
            node.scrollHeight - node.scrollTop - node.clientHeight < 40;
          setFollow(atBottom);
        }}
        className={cn(
          "max-h-[240px] min-h-[76px] overflow-auto bg-background px-3.5 py-3 font-mono text-[11.5px] leading-[1.85]",
          bodyClassName,
        )}
      >
        {visible.length === 0 ? (
          <p className="text-muted-foreground">
            {empty ?? t("runtime.logsEmpty")}
          </p>
        ) : (
          visible.map((line, index) => (
            <div
              key={`${index}-${line.slice(0, 24)}`}
              className={cn(
                "break-all whitespace-pre-wrap",
                ERROR_LINE.test(line)
                  ? "text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {line || "\u00a0"}
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
