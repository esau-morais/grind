import { useEffect, useId, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { createPortal } from "react-dom";
import { XIcon } from "@phosphor-icons/react";
import { cn } from "#/lib/utils";

export const LIQUID_EASE = [0.22, 1, 0.36, 1] as const;
export const TRANSITION = { duration: 0.32, ease: LIQUID_EASE } as const;

function ImageViewerOverlay({
  src,
  alt,
  layoutId,
  onClose,
}: {
  src: string;
  alt: string;
  layoutId: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TRANSITION}
      className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center overscroll-contain p-4 sm:p-8 bg-background/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Fullscreen view of ${alt}`}
    >
      <motion.span
        layoutId={layoutId}
        transition={TRANSITION}
        className="relative block max-h-full max-w-full overflow-hidden rounded-xl border border-border shadow-2xl"
      >
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] max-w-[90vw] w-auto object-contain block"
        />
      </motion.span>
    </motion.div>,
    document.body,
  );
}

export function ImageViewer({
  src,
  alt,
  children,
  triggerClassName,
}: {
  src: string;
  alt: string;
  children: React.ReactNode;
  triggerClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLSpanElement>(null);
  const layoutId = useId();

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <motion.span
        ref={triggerRef}
        layoutId={layoutId}
        transition={TRANSITION}
        role="button"
        tabIndex={0}
        aria-label={`View ${alt} fullscreen`}
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) =>
          (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setIsOpen(true))
        }
        className={cn(
          "relative block cursor-zoom-in overflow-hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen && "invisible",
          triggerClassName,
        )}
      >
        {children}
      </motion.span>

      <AnimatePresence onExitComplete={() => triggerRef.current?.focus()}>
        {isOpen && <ImageViewerOverlay src={src} alt={alt} layoutId={layoutId} onClose={close} />}
      </AnimatePresence>
    </>
  );
}

function TextViewerOverlay({
  content,
  filename,
  onClose,
}: {
  content: string;
  filename: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={TRANSITION}
      className="fixed inset-0 z-50 flex items-center justify-center overscroll-contain p-4 sm:p-8 bg-background/80"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`File viewer: ${filename}`}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={TRANSITION}
        className="flex w-full max-w-3xl max-h-[85vh] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 shrink-0">
          <span className="truncate font-mono text-xs text-muted-foreground">{filename}</span>
          <button
            type="button"
            aria-label="Close file viewer"
            onClick={onClose}
            className="flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <XIcon size={14} aria-hidden="true" />
          </button>
        </div>
        {/* Content */}
        <pre className="flex-1 overflow-auto px-4 py-3 font-mono text-xs text-foreground leading-relaxed whitespace-pre break-words">
          {content}
        </pre>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

export function TextFileViewer({
  base64,
  filename,
  children,
  triggerClassName,
}: {
  base64: string;
  filename: string;
  children: React.ReactNode;
  triggerClassName?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  let decoded = "";
  try {
    decoded = atob(base64);
  } catch {
    decoded = "[Could not decode file content]";
  }

  const close = () => {
    setIsOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`View ${filename}`}
        onClick={() => setIsOpen(true)}
        className={triggerClassName}
      >
        {children}
      </button>

      <AnimatePresence onExitComplete={() => triggerRef.current?.focus()}>
        {isOpen && <TextViewerOverlay content={decoded} filename={filename} onClose={close} />}
      </AnimatePresence>
    </>
  );
}

export function downloadAttachment(att: { mime: string; base64: string; filename?: string }) {
  const link = document.createElement("a");
  link.href = `data:${att.mime};base64,${att.base64}`;
  link.download = att.filename ?? "attachment";
  link.click();
}

export function getAttachmentInteraction(mime: string): "image" | "text" | "download" {
  if (mime.startsWith("image/")) return "image";
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "application/typescript" ||
    mime.includes("+json") ||
    mime.includes("+xml")
  )
    return "text";
  return "download";
}
