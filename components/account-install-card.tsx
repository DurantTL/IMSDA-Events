"use client";

import { InstallCard, InstallCardRestore, InstallPromptCapture } from "@/components/install-card";

/** The account overview card and its Help restore button (#1713): the shared install card for families and club leaders. */
export function AccountInstallPromptCapture() {
  return <InstallPromptCapture />;
}

export function AccountInstallCard() {
  return <InstallCard audience="account" />;
}

export function AccountInstallCardRestore() {
  return <InstallCardRestore audience="account" />;
}
