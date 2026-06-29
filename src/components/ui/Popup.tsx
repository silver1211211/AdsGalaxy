"use client";

import React, { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Design tokens ────────────────────────────────────────────────────────────
//
// Backdrop   : bg-slate-950/45 backdrop-blur-md
// Container  : bg-white rounded-3xl shadow-[0_20px_60px_rgba(15,23,42,0.16)]
// Animation  : spring(damping:28, stiffness:340) + fade
// Close btn  : 32×32 rounded-full bg-slate-100 text-slate-400
// Title      : text-[17px] font-black text-slate-900
// Description: text-sm font-medium text-slate-500 leading-relaxed
// Btn primary: bg-[#0c9de8] text-white rounded-2xl py-3.5 text-sm font-black
// Btn danger : bg-red-500 text-white rounded-2xl py-3.5 text-sm font-black
// Btn cancel : bg-slate-100 text-slate-600 rounded-2xl py-3.5 text-sm font-black
// Detail box : rounded-2xl bg-slate-50 border border-slate-100 p-4
//
// ─────────────────────────────────────────────────────────────────────────────

export type PopupVariant = "default" | "success" | "warning" | "error" | "info";

const VARIANT_CONFIG: Record<
  PopupVariant,
  { iconBg: string; iconColor: string; Icon: React.ElementType }
> = {
  default: { iconBg: "bg-slate-100",   iconColor: "text-slate-500",    Icon: Info          },
  info:    { iconBg: "bg-blue-50",     iconColor: "text-[#0c9de8]",    Icon: Info          },
  success: { iconBg: "bg-emerald-50",  iconColor: "text-emerald-600",  Icon: CheckCircle2  },
  warning: { iconBg: "bg-amber-50",    iconColor: "text-amber-600",    Icon: AlertTriangle },
  error:   { iconBg: "bg-red-50",      iconColor: "text-red-600",      Icon: AlertCircle   },
};

export interface PopupAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "danger" | "cancel";
  loading?: boolean;
  disabled?: boolean;
}

export interface PopupProps {
  isOpen: boolean;
  onClose: () => void;

  /** Semantic variant — drives the default icon and icon colour */
  variant?: PopupVariant;

  /** Override the icon. Pass `null` to hide it entirely. */
  icon?: React.ReactNode | null;

  /** Bold heading */
  title?: string;

  /** Subdued body copy */
  description?: string;

  /**
   * Optional highlighted detail section rendered inside a tinted box.
   * Good for rejection reasons, settlement dates, error codes, etc.
   */
  detail?: React.ReactNode;

  /** Arbitrary children rendered below description and detail */
  children?: React.ReactNode;

  /** Primary call-to-action */
  primaryAction?: PopupAction;

  /** Secondary / cancel call-to-action (rendered as side-by-side with primary) */
  secondaryAction?: PopupAction;

  /** Ghost dismiss text rendered below main action row */
  dismissAction?: { label: string; onClick: () => void };

  /** Container max-width: xs ≈ 320, sm ≈ 384 (default), md ≈ 448 */
  maxWidth?: "xs" | "sm" | "md";

  /** Dismiss when user clicks the backdrop (default: true) */
  closeOnBackdrop?: boolean;

  /** Show the ✕ close button in the top-right corner (default: true) */
  showCloseButton?: boolean;

  /**
   * Semantic identifier — reserved for the future queue/sequencing system.
   * Popups with an id can be targeted by a popup manager without UI changes.
   */
  popupId?: string;
}

const MAX_WIDTH_CLASS: Record<NonNullable<PopupProps["maxWidth"]>, string> = {
  xs: "max-w-xs",
  sm: "max-w-sm",
  md: "max-w-md",
};

export default function Popup({
  isOpen,
  onClose,
  variant = "default",
  icon,
  title,
  description,
  detail,
  children,
  primaryAction,
  secondaryAction,
  dismissAction,
  maxWidth = "sm",
  closeOnBackdrop = true,
  showCloseButton = true,
}: PopupProps) {
  // Prevent body scroll while open
  useEffect(() => {
    if (isOpen) document.body.style.overflow = "hidden";
    else document.body.style.overflow = "";
    return () => { document.body.style.overflow = ""; };
  }, [isOpen]);

  const cfg = VARIANT_CONFIG[variant];
  const hasSideBySide = !!(primaryAction && secondaryAction);

  const renderIcon = () => {
    if (icon === null) return null;
    const inner = icon !== undefined ? icon : <cfg.Icon size={20} />;
    return (
      <div
        className={cn(
          "h-11 w-11 shrink-0 flex items-center justify-center rounded-2xl",
          cfg.iconBg,
          cfg.iconColor,
        )}
      >
        {inner}
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 z-[600] flex items-center justify-center p-4"
          aria-modal="true"
          role="dialog"
        >
          {/* ── Backdrop ── */}
          <motion.div
            key="popup-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-slate-950/45 backdrop-blur-md"
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
          />

          {/* ── Container ── */}
          <motion.div
            key="popup-container"
            initial={{ opacity: 0, scale: 0.96, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 16 }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className={cn(
              "relative w-full bg-white rounded-3xl",
              "shadow-[0_20px_60px_rgba(15,23,42,0.16)] overflow-hidden",
              MAX_WIDTH_CLASS[maxWidth],
            )}
          >
            {/* ── Close button ── */}
            {showCloseButton && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-colors"
              >
                <X size={16} />
              </button>
            )}

            <div className="p-6 space-y-5">
              {/* ── Header: icon + title ── */}
              {(icon !== null && (icon !== undefined || title)) && (
                <div className={cn("flex items-start gap-4", showCloseButton && "pr-10")}>
                  {renderIcon()}
                  {title && (
                    <div className="flex-1 min-w-0 pt-1.5">
                      <h3 className="text-[17px] font-black text-slate-900 leading-snug">
                        {title}
                      </h3>
                    </div>
                  )}
                </div>
              )}

              {/* ── Description ── */}
              {description && (
                <p className="text-sm font-medium text-slate-500 leading-relaxed">
                  {description}
                </p>
              )}

              {/* ── Detail section ── */}
              {detail && (
                <div className="rounded-2xl bg-slate-50 border border-slate-100 p-4 text-sm">
                  {detail}
                </div>
              )}

              {/* ── Custom content ── */}
              {children}

              {/* ── Action buttons ── */}
              {(primaryAction || secondaryAction || dismissAction) && (
                <div className="space-y-2.5 pt-1">
                  {(primaryAction || secondaryAction) && (
                    <div className={cn("flex gap-3", hasSideBySide ? "flex-row" : "flex-col")}>
                      {secondaryAction && (
                        <button
                          type="button"
                          onClick={secondaryAction.onClick}
                          disabled={secondaryAction.loading || secondaryAction.disabled}
                          className="flex-1 py-3.5 rounded-2xl text-sm font-black bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {secondaryAction.label}
                        </button>
                      )}
                      {primaryAction && (
                        <button
                          type="button"
                          onClick={primaryAction.onClick}
                          disabled={primaryAction.loading || primaryAction.disabled}
                          className={cn(
                            "flex-1 py-3.5 rounded-2xl text-sm font-black transition-colors flex items-center justify-center",
                            primaryAction.variant === "danger"
                              ? "bg-red-500 text-white hover:bg-red-600"
                              : "bg-[#0c9de8] text-white hover:bg-blue-600",
                            (primaryAction.loading || primaryAction.disabled) &&
                              "opacity-50 cursor-not-allowed",
                          )}
                        >
                          {primaryAction.loading ? (
                            <div className="h-5 w-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          ) : (
                            primaryAction.label
                          )}
                        </button>
                      )}
                    </div>
                  )}
                  {dismissAction && (
                    <button
                      type="button"
                      onClick={dismissAction.onClick}
                      className="w-full py-2 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {dismissAction.label}
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
