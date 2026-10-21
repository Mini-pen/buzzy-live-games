import { useEffect } from "react";

/**
 * * Freezes 100svh once, then again only when the screen rotates.
 *   Address-bar show and hide do not move the buzzer.
 */
export function useFrozenSvh(active: boolean): void {
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const apply = (): void => {
      const probe = document.createElement("div");
      probe.style.cssText =
        "position:absolute;left:0;top:0;height:100svh;width:0;visibility:hidden;pointer-events:none;";
      document.body.appendChild(probe);
      const height = probe.getBoundingClientRect().height;
      probe.remove();
      if (height > 0) {
        document.documentElement.style.setProperty("--bz-stable-vh", `${Math.round(height)}px`);
      }
    };
    apply();
    const onOrientation = (): void => apply();
    window.addEventListener("orientationchange", onOrientation);
    const media = window.matchMedia?.("(orientation: portrait)");
    media?.addEventListener?.("change", onOrientation);
    return () => {
      window.removeEventListener("orientationchange", onOrientation);
      media?.removeEventListener?.("change", onOrientation);
    };
  }, [active]);
}
