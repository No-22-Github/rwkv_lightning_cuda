import { Check, Copy, FolderOpen, HardDrive } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/api/http";
import { nodeApi } from "@/lib/api/node";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast, usePageTitle, useUI } from "@/stores/ui";

export function CopyButton({
  text,
  label,
  className,
  size = "xs",
  disabled,
}: {
  text: string;
  label?: string;
  className?: string;
  size?: "xs" | "sm" | "default";
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size={size}
      className={className}
      disabled={disabled || !text}
      onClick={async () => {
        try {
          await copyText(text);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1800);
        } catch (error) {
          toast.error(
            t("toast.failed", {
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }}
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? t("common.copied") : (label ?? t("common.copy"))}
    </Button>
  );
}

/**
 * Reports whether the page heading is still on screen, so the toolbar can
 * carry the view name only while this one is scrolled out of sight. Set
 * eagerly on mount — a page always opens scrolled to the top, and waiting for
 * the observer's first callback would flash the duplicate title for a frame.
 */
function useHeadingVisibility() {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const setVisible = usePageTitle.getState().setInlineVisible;
    setVisible(true);
    const node = ref.current;
    if (!node) return () => setVisible(false);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      // The scroll container clips the heading, so the viewport root is
      // enough; the threshold trips once the heading is more than half gone.
      { threshold: 0.5 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, []);
  return ref;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  const headingRef = useHeadingVisibility();
  return (
    <div
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1
          ref={headingRef}
          className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em]"
        >
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-3xl text-[13px] leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

/**
 * Remote path input. Browsing goes through the Agent whitelist
 * (`POST /api/v1/node/fs`); the native host picker is only offered for nodes
 * that advertise `host_dialog`, because it opens on the *node's* desktop.
 */
export function PathField({
  label,
  value,
  onChange,
  placeholder,
  backendId,
  hostDialog = false,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  backendId: string;
  hostDialog?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const openFsBrowser = useUI((s) => s.openFsBrowser);
  const [busy, setBusy] = useState(false);
  return (
    <Field label={label} hint={t("fs.description")} className={className}>
      <div className="flex gap-2">
        <Input
          value={value}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        {hostDialog && (
          <Button
            title={t("fs.hostDialog")}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await nodeApi.pickFile(backendId);
                if (result.path) onChange(result.path);
              } catch (error) {
                toast.error(
                  t("toast.failed", {
                    error:
                      error instanceof Error ? error.message : String(error),
                  }),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            <FolderOpen className="size-3.5" />
          </Button>
        )}
        <Button
          disabled={!backendId}
          onClick={() => openFsBrowser(onChange, value)}
        >
          <HardDrive className="size-3.5" />
          {t("common.browse")}
        </Button>
      </div>
    </Field>
  );
}
