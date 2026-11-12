"use client";

import { InstallCard, InstallCardRestore, InstallPromptCapture } from "@/components/install-card";

/** The staff Home card and its Help restore button (#1836): the shared install card (#1713) for the staff audience. */
export function StaffInstallPromptCapture() {
  return <InstallPromptCapture />;
}

export function StaffInstallCard() {
  return <InstallCard audience="staff" />;
}

export function StaffInstallCardRestore() {
  return <InstallCardRestore audience="staff" />;
}
