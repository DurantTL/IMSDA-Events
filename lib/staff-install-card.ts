/**
 * Which "Add to Home Screen" card staff Home shows, if any (#1836). Pure: the browser facts go in, a variant comes out.
 * Nothing here reads the device; the component passes what it saw, and nothing about the device is stored or sent.
 */
export const INSTALL_CARD_DISMISSED_KEY = "imsda-staff-install-card-dismissed";

export type InstallCardVariant = "install" | "ios-safari" | "ios-other-browser" | "none";

export type InstallCardInput = {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  /** Already open as a saved app. */
  standalone: boolean;
  /** The browser fired `beforeinstallprompt` and it is still usable. */
  installPromptAvailable: boolean;
  /** "Not now" was chosen on this device. */
  dismissed: boolean;
  /** The browser reported `appinstalled`. */
  installed: boolean;
};

/** iPhone, iPod and iPad. iPadOS Safari reports a Mac user agent, so a touch-screen "MacIntel" counts as an iPad. */
export function isIosDevice(input: Pick<InstallCardInput, "userAgent" | "platform" | "maxTouchPoints">): boolean {
  if (/iPhone|iPad|iPod/i.test(input.userAgent)) return true;
  return input.platform === "MacIntel" && input.maxTouchPoints > 1;
}

/** Other iOS browsers all run on WebKit but add their own token (Chrome, Firefox, Edge, Opera, DuckDuckGo, Brave and others). */
function isIosNonSafari(userAgent: string): boolean {
  return /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave|GSA\/|YaBrowser|Vivaldi|Focus|Mercury/i.test(userAgent);
}

export function installCardVariant(input: InstallCardInput): InstallCardVariant {
  if (input.standalone || input.installed || input.dismissed) return "none";
  if (isIosDevice(input)) return isIosNonSafari(input.userAgent) ? "ios-other-browser" : "ios-safari";
  return input.installPromptAvailable ? "install" : "none";
}
