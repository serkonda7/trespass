import { m } from "@trespass/shared/paraglide/messages";
import type { JSX } from "solid-js";
import { Wordmark } from "~/components/layout/wordmark";

/** Signed-out pages (login, invite): wordmark over one card on survey paper. */
export function AuthLayout(props: { children: JSX.Element }) {
  return (
    <main class="grid-paper relative flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4">
      <div
        class="absolute inset-x-0 top-0 h-1.5 bg-[repeating-linear-gradient(135deg,var(--primary)_0_12px,var(--background)_12px_24px)]"
        aria-hidden="true"
      />
      <div class="flex flex-col items-center gap-2">
        <Wordmark class="[&_svg]:size-8 [&>span]:text-2xl" />
        <p class="kicker">{m.auth_tagline()}</p>
      </div>
      <div class="w-full max-w-sm">{props.children}</div>
    </main>
  );
}
