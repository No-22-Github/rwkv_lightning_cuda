import { Check, Copy, FolderOpen, HardDrive } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/api/http";
import { nodeApi } from "@/lib/api/node";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast, useUI } from "@/stores/ui";

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
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <div className="font-mono text-[11px] font-semibold tracking-[0.08em] text-muted-foreground">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-0.5 text-[22px] font-semibold tracking-[-0.02em]">
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
